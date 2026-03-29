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

// ---------------------------------------------------------------------------
// Python detection
// ---------------------------------------------------------------------------

const extractPythonPorts = (repoDir: string): DetectedPort[] => {
  const ports: DetectedPort[] = [];
  const candidates = ['app.py', 'main.py', 'src/main.py', 'src/app.py', 'server.py', 'run.py', 'manage.py'];

  for (const name of candidates) {
    const filePath = path.join(repoDir, name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');

    // Flask: app.run(port=5000) or app.run(host="0.0.0.0", port=8000)
    const flaskMatch = content.match(/\.run\([^)]*port\s*=\s*(\d{4,5})/);
    if (flaskMatch) ports.push({ port: parseInt(flaskMatch[1], 10), source: `${name} (Flask)` });

    // FastAPI/Uvicorn: uvicorn.run(..., port=8000)
    const uvicornMatch = content.match(/uvicorn\.run\([^)]*port\s*=\s*(\d{4,5})/);
    if (uvicornMatch) ports.push({ port: parseInt(uvicornMatch[1], 10), source: `${name} (Uvicorn)` });

    // Generic: PORT = 8000 or port = int(os.environ.get("PORT", "8000"))
    const envPortMatch = content.match(/["']PORT["']\s*,\s*["'](\d{4,5})["']/);
    if (envPortMatch) ports.push({ port: parseInt(envPortMatch[1], 10), source: `${name} (env default)` });
  }

  // pyproject.toml: [tool.uvicorn] port = 8000
  const pyprojectPath = path.join(repoDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, 'utf8');
    const portMatch = content.match(/port\s*=\s*(\d{4,5})/);
    if (portMatch) ports.push({ port: parseInt(portMatch[1], 10), source: 'pyproject.toml' });
  }

  return ports;
};

const readPythonDeps = (repoDir: string): string[] => {
  const deps: string[] = [];

  const reqPath = path.join(repoDir, 'requirements.txt');
  if (existsSync(reqPath)) {
    const content = readFileSync(reqPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        deps.push(trimmed.split(/[=<>!~\[]/)[0].trim());
      }
    }
  }

  const pyprojectPath = path.join(repoDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, 'utf8');
    const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch) {
      const block = depsMatch[1];
      const depRegex = /["']([a-zA-Z0-9_-]+)/g;
      let m;
      while ((m = depRegex.exec(block)) !== null) {
        deps.push(m[1]);
      }
    }
  }

  return deps;
};

const detectPythonScripts = (repoDir: string): DetectedScript[] => {
  const scripts: DetectedScript[] = [];

  if (existsSync(path.join(repoDir, 'manage.py'))) {
    scripts.push({ name: 'dev', command: 'python manage.py runserver' });
  } else if (existsSync(path.join(repoDir, 'app.py')) || existsSync(path.join(repoDir, 'main.py'))) {
    const entry = existsSync(path.join(repoDir, 'app.py')) ? 'app.py' : 'main.py';
    scripts.push({ name: 'dev', command: `python ${entry}` });
  }

  const makefilePath = path.join(repoDir, 'Makefile');
  if (existsSync(makefilePath)) {
    const content = readFileSync(makefilePath, 'utf8');
    if (/^(dev|run|serve):/m.test(content)) {
      scripts.push({ name: 'dev', command: 'make dev' });
    }
  }

  return scripts;
};

// ---------------------------------------------------------------------------
// Go detection
// ---------------------------------------------------------------------------

const extractGoPorts = (repoDir: string): DetectedPort[] => {
  const ports: DetectedPort[] = [];
  const candidates = ['main.go', 'cmd/server/main.go', 'cmd/main.go', 'server.go'];

  for (const name of candidates) {
    const filePath = path.join(repoDir, name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');

    // http.ListenAndServe(":8080", ...)
    const listenMatch = content.match(/ListenAndServe\s*\(\s*["']:(\d{4,5})["']/);
    if (listenMatch) ports.push({ port: parseInt(listenMatch[1], 10), source: `${name} (http.ListenAndServe)` });

    // gin: r.Run(":8080")
    const ginMatch = content.match(/\.Run\s*\(\s*["']:(\d{4,5})["']/);
    if (ginMatch) ports.push({ port: parseInt(ginMatch[1], 10), source: `${name} (gin)` });

    // echo: e.Start(":8080")
    const echoMatch = content.match(/\.Start\s*\(\s*["']:(\d{4,5})["']/);
    if (echoMatch) ports.push({ port: parseInt(echoMatch[1], 10), source: `${name} (echo)` });

    // fiber: app.Listen(":3000")
    const fiberMatch = content.match(/\.Listen\s*\(\s*["']:(\d{4,5})["']/);
    if (fiberMatch) ports.push({ port: parseInt(fiberMatch[1], 10), source: `${name} (fiber)` });
  }

  return ports;
};

const readGoDeps = (repoDir: string): string[] => {
  const deps: string[] = [];
  const goModPath = path.join(repoDir, 'go.mod');
  if (!existsSync(goModPath)) return deps;

  const content = readFileSync(goModPath, 'utf8');
  const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
  if (requireMatch) {
    for (const line of requireMatch[1].split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('//')) {
        deps.push(trimmed.split(/\s+/)[0]);
      }
    }
  }
  return deps;
};

const detectGoScripts = (repoDir: string): DetectedScript[] => {
  const scripts: DetectedScript[] = [];

  if (existsSync(path.join(repoDir, 'main.go')) || existsSync(path.join(repoDir, 'cmd'))) {
    scripts.push({ name: 'dev', command: 'go run .' });
    scripts.push({ name: 'start', command: 'go run .' });
  }

  const makefilePath = path.join(repoDir, 'Makefile');
  if (existsSync(makefilePath)) {
    const content = readFileSync(makefilePath, 'utf8');
    if (/^(dev|run|serve):/m.test(content)) {
      scripts.push({ name: 'dev', command: 'make dev' });
    }
  }

  return scripts;
};

// ---------------------------------------------------------------------------
// Environment variable hints
// ---------------------------------------------------------------------------

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
  hasPython: boolean,
  hasGo: boolean,
  extraScripts: DetectedScript[],
): ServiceClassification => {
  if (hasDockerCompose && dockerComposeServices.length > 0 && !pkg?.scripts?.start && !pkg?.scripts?.dev && !hasPython && !hasGo) {
    return 'infra';
  }
  if (pkg?.scripts?.start || pkg?.scripts?.dev || pkg?.scripts?.['start:dev']) {
    return 'service';
  }
  if (hasPython || hasGo || extraScripts.length > 0) {
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

  // Python detection
  const hasPython = existsSync(path.join(repoDir, 'pyproject.toml'))
    || existsSync(path.join(repoDir, 'setup.py'))
    || existsSync(path.join(repoDir, 'requirements.txt'));
  if (hasPython) {
    configPorts.push(...extractPythonPorts(repoDir));
    scripts.push(...detectPythonScripts(repoDir));
  }
  const pythonDeps = hasPython ? readPythonDeps(repoDir) : [];

  // Go detection
  const hasGo = existsSync(path.join(repoDir, 'go.mod'));
  if (hasGo) {
    configPorts.push(...extractGoPorts(repoDir));
    scripts.push(...detectGoScripts(repoDir));
  }
  const goDeps = hasGo ? readGoDeps(repoDir) : [];

  const npmDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  return {
    name: repoInfo.name,
    repoInfo,
    classification: classify(pkg, hasDockerfile, hasDockerCompose, dockerCompose.services, hasPython, hasGo, scripts),
    ports: [...dockerfilePorts, ...dockerCompose.ports],
    scripts,
    hasDev: !!(pkg?.scripts?.dev || pkg?.scripts?.['start:dev'] || scripts.some((s) => s.name === 'dev')),
    hasStart: !!(pkg?.scripts?.start || scripts.some((s) => s.name === 'start')),
    hasTest: !!(pkg?.scripts?.test),
    hasDockerfile,
    hasDockerCompose,
    dockerComposeServices: dockerCompose.services,
    dependencies: [...Object.keys(npmDeps), ...pythonDeps, ...goDeps],
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

/**
 * Build a RepoInfo from a local git repo directory.
 * Reads git remote origin to populate cloneUrl, and extracts metadata from the repo.
 */
export const repoInfoFromLocal = async (repoDir: string): Promise<RepoInfo | null> => {
  const name = path.basename(repoDir);

  // Must be a git repo
  if (!existsSync(path.join(repoDir, '.git'))) return null;

  let cloneUrl = '';
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoDir,
      timeout: 5_000,
    });
    cloneUrl = stdout.trim();
  } catch {
    // No remote — still analyzable, just no clone URL
  }

  let language: string | null = null;
  if (existsSync(path.join(repoDir, 'package.json'))) language = 'JavaScript';
  if (existsSync(path.join(repoDir, 'tsconfig.json'))) language = 'TypeScript';
  if (existsSync(path.join(repoDir, 'pyproject.toml')) || existsSync(path.join(repoDir, 'setup.py'))) language = 'Python';
  if (existsSync(path.join(repoDir, 'go.mod'))) language = 'Go';
  if (existsSync(path.join(repoDir, 'pom.xml')) || existsSync(path.join(repoDir, 'build.gradle'))) language = 'Java';

  let defaultBranch = 'main';
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoDir,
      timeout: 5_000,
    });
    defaultBranch = stdout.trim();
  } catch { /* use default */ }

  return {
    name,
    description: null,
    language,
    archived: false,
    fork: false,
    pushedAt: new Date().toISOString(),
    defaultBranch,
    cloneUrl,
  };
};

/**
 * Analyze a local repo directory without cloning.
 */
export const analyzeLocalRepo = async (repoDir: string): Promise<AnalyzedRepo | null> => {
  const repoInfo = await repoInfoFromLocal(repoDir);
  if (!repoInfo) return null;
  return analyzeRepo(repoDir, repoInfo);
};
