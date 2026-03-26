import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { RepoInfo } from './org-scanner.js';

const execFileAsync = promisify(execFile);

export type ServiceClassification = 'service' | 'infra' | 'library';

export type DetectedPort = {
  readonly port: number;
  readonly source: string;
};

export type DetectedScript = {
  readonly name: string;
  readonly command: string;
};

export type AnalyzedRepo = {
  readonly name: string;
  readonly repoInfo: RepoInfo;
  readonly classification: ServiceClassification;
  readonly ports: DetectedPort[];
  readonly scripts: DetectedScript[];
  readonly hasDev: boolean;
  readonly hasStart: boolean;
  readonly hasTest: boolean;
  readonly hasDockerfile: boolean;
  readonly hasDockerCompose: boolean;
  readonly dockerComposeServices: string[];
  readonly dependencies: string[];
  readonly envVarHints: string[];
  readonly configPorts: DetectedPort[];
};

/**
 * Shallow clone a repo to a temp directory.
 * Uses execFile (not exec) to prevent shell injection.
 */
export const shallowClone = async (cloneUrl: string, name: string): Promise<string> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), `orcha-scan-${name}-`));
  const repoDir = path.join(tempDir, name);

  await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', cloneUrl, repoDir], {
    timeout: 60_000,
  });

  return repoDir;
};

/**
 * Remove a temp clone directory.
 */
export const cleanupClone = async (cloneDir: string): Promise<void> => {
  const tempDir = path.dirname(cloneDir);
  await rm(tempDir, { recursive: true, force: true });
};

const readPackageJson = (
  repoDir: string,
): { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null => {
  const pkgPath = path.join(repoDir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
};

const extractDockerfilePorts = (repoDir: string): DetectedPort[] => {
  const dockerfilePath = path.join(repoDir, 'Dockerfile');
  if (!existsSync(dockerfilePath)) return [];

  const content = readFileSync(dockerfilePath, 'utf8');
  const ports: DetectedPort[] = [];
  const exposeRegex = /^EXPOSE\s+(.+)/gim;
  let match;
  while ((match = exposeRegex.exec(content)) !== null) {
    const portStrings = match[1].split(/\s+/);
    for (const ps of portStrings) {
      const port = parseInt(ps, 10);
      if (!isNaN(port)) {
        ports.push({ port, source: 'Dockerfile EXPOSE' });
      }
    }
  }
  return ports;
};

const extractDockerComposeInfo = (repoDir: string): { services: string[]; ports: DetectedPort[] } => {
  const composeNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const name of composeNames) {
    const composePath = path.join(repoDir, name);
    if (!existsSync(composePath)) continue;

    const content = readFileSync(composePath, 'utf8');
    const services: string[] = [];
    const ports: DetectedPort[] = [];

    const servicesMatch = content.match(/^services:\s*\n((?:\s+.+\n?)*)/m);
    if (servicesMatch) {
      const block = servicesMatch[1];
      const serviceNameRegex = /^\s{2}(\w[\w-]*):/gm;
      let m;
      while ((m = serviceNameRegex.exec(block)) !== null) {
        services.push(m[1]);
      }
    }

    const portRegex = /['"]?(\d+):(\d+)['"]?/g;
    let pm;
    while ((pm = portRegex.exec(content)) !== null) {
      ports.push({ port: parseInt(pm[1], 10), source: `docker-compose ${name}` });
    }

    return { services, ports };
  }
  return { services: [], ports: [] };
};

const extractConfigPorts = (repoDir: string): DetectedPort[] => {
  const configNames = ['config/default.js', 'config/default.cjs', 'config/default.json'];
  const ports: DetectedPort[] = [];

  for (const name of configNames) {
    const configPath = path.join(repoDir, name);
    if (!existsSync(configPath)) continue;

    const content = readFileSync(configPath, 'utf8');
    const portRegex = /port['":\s]+(\d{4,5})/gi;
    let m;
    while ((m = portRegex.exec(content)) !== null) {
      const port = parseInt(m[1], 10);
      if (port > 1000 && port < 65536) {
        ports.push({ port, source: name });
      }
    }
  }
  return ports;
};

const extractEnvVarHints = (repoDir: string): string[] => {
  const envFiles = ['.env.example', '.env.template', '.env.sample'];
  const hints: string[] = [];

  for (const name of envFiles) {
    const envPath = path.join(repoDir, name);
    if (!existsSync(envPath)) continue;

    const content = readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key] = trimmed.split('=');
      if (/url|endpoint|host|service|api|base.*url/i.test(key)) {
        hints.push(key.trim());
      }
    }
  }
  return hints;
};

const classify = (
  pkg: { scripts?: Record<string, string> } | null,
  hasDockerfile: boolean,
  hasDockerCompose: boolean,
  dockerComposeServices: string[],
): ServiceClassification => {
  if (hasDockerCompose && dockerComposeServices.length > 0 && !pkg?.scripts?.start && !pkg?.scripts?.dev) {
    return 'infra';
  }
  if (pkg?.scripts?.start || pkg?.scripts?.dev || pkg?.scripts?.['start:dev']) {
    return 'service';
  }
  return 'library';
};

/**
 * Analyze a single cloned repo directory.
 */
export const analyzeRepo = (repoDir: string, repoInfo: RepoInfo): AnalyzedRepo => {
  const pkg = readPackageJson(repoDir);
  const scripts: DetectedScript[] = [];
  if (pkg?.scripts) {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      scripts.push({ name, command });
    }
  }

  const hasDockerfile = existsSync(path.join(repoDir, 'Dockerfile'));
  const dockerCompose = extractDockerComposeInfo(repoDir);
  const hasDockerCompose = dockerCompose.services.length > 0;

  const dockerfilePorts = extractDockerfilePorts(repoDir);
  const configPorts = extractConfigPorts(repoDir);
  const envVarHints = extractEnvVarHints(repoDir);

  const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  return {
    name: repoInfo.name,
    repoInfo,
    classification: classify(pkg, hasDockerfile, hasDockerCompose, dockerCompose.services),
    ports: [...dockerfilePorts, ...dockerCompose.ports],
    scripts,
    hasDev: !!(pkg?.scripts?.dev || pkg?.scripts?.['start:dev']),
    hasStart: !!pkg?.scripts?.start,
    hasTest: !!pkg?.scripts?.test,
    hasDockerfile,
    hasDockerCompose,
    dockerComposeServices: dockerCompose.services,
    dependencies: Object.keys(allDeps),
    envVarHints,
    configPorts,
  };
};

/**
 * Shallow clone, analyze, and cleanup a repo.
 */
export const cloneAndAnalyze = async (repoInfo: RepoInfo): Promise<AnalyzedRepo> => {
  const repoDir = await shallowClone(repoInfo.cloneUrl, repoInfo.name);
  try {
    return analyzeRepo(repoDir, repoInfo);
  } finally {
    await cleanupClone(repoDir);
  }
};
