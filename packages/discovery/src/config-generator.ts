import YAML from 'yaml';
import type { AnalyzedRepo } from './repo-analyzer.js';
import type { DetectedDependency } from './dependency-detector.js';
import type { OrgUrl } from './org-scanner.js';

type ServiceEntry = {
  id: string;
  label: string;
  kind: string;
  repoPath: string;
  workingDirectory: string;
  runtime: Record<string, unknown>;
  localUrl: string;
  healthChecks: Array<Record<string, unknown>>;
  dependencies: string[];
  runtimeModes: string[];
  env: Record<string, string>;
  nodeConfig: Record<string, unknown>;
  verification: { api: unknown[]; data: unknown[] };
};

/**
 * Determine the best dev command for a service.
 */
const getDevCommand = (repo: AnalyzedRepo): { bin: string; args: string[] } => {
  if (repo.scripts.find((s) => s.name === 'dev')) {
    return { bin: 'npm', args: ['run', 'dev'] };
  }
  if (repo.scripts.find((s) => s.name === 'start:dev')) {
    return { bin: 'npm', args: ['run', 'start:dev'] };
  }
  if (repo.scripts.find((s) => s.name === 'start-dev')) {
    return { bin: 'npm', args: ['run', 'start-dev'] };
  }
  return { bin: 'npm', args: ['start'] };
};

/**
 * Pick the primary port for a service.
 */
const getPrimaryPort = (repo: AnalyzedRepo): number | null => {
  // Prefer config ports, then Dockerfile, then docker-compose
  if (repo.configPorts.length > 0) return repo.configPorts[0].port;
  if (repo.ports.length > 0) return repo.ports[0].port;
  return null;
};

/**
 * Generate a human-readable label from a repo name.
 */
const toLabel = (name: string): string => {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Build a dependency map: repo name -> list of dependency repo names.
 */
const buildDependencyMap = (deps: DetectedDependency[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const dep of deps) {
    const existing = map.get(dep.from) ?? [];
    if (!existing.includes(dep.to)) {
      existing.push(dep.to);
    }
    map.set(dep.from, existing);
  }
  return map;
};

/**
 * Generate orcha.config.yaml content from analyzed repos.
 */
export const generateConfig = (
  orgUrl: OrgUrl | null,
  workspaceName: string,
  repos: AnalyzedRepo[],
  deps: DetectedDependency[],
): string => {
  const depMap = buildDependencyMap(deps);

  const services: Record<string, ServiceEntry> = {};

  for (const repo of repos) {
    const port = getPrimaryPort(repo);
    const dependencies = depMap.get(repo.name) ?? [];

    if (repo.classification === 'infra') {
      services[repo.name] = {
        id: repo.name,
        label: toLabel(repo.name),
        kind: 'infra',
        repoPath: `\${workspace.root}/${repo.name}`,
        workingDirectory: `\${workspace.root}/${repo.name}`,
        runtime: {
          type: 'compose',
          composeFile: `./compose/${repo.name}.yml`, // TODO: create this file
          projectName: `orcha-${repo.name}`,
          services: repo.dockerComposeServices,
        },
        localUrl: port ? `http://localhost:${port}` : '',
        healthChecks: port
          ? [{ name: 'tcp', url: `tcp://localhost:${port}` }]
          : [],
        dependencies,
        runtimeModes: ['local'],
        env: {},
        nodeConfig: {},
        verification: { api: [], data: [] },
      };
    } else if (repo.classification === 'service') {
      const cmd = getDevCommand(repo);
      services[repo.name] = {
        id: repo.name,
        label: toLabel(repo.name),
        kind: 'service',
        repoPath: `\${workspace.root}/${repo.name}`,
        workingDirectory: `\${workspace.root}/${repo.name}`,
        runtime: { type: 'script', command: cmd },
        localUrl: port ? `http://localhost:${port}` : '# TODO: set port',
        healthChecks: port
          ? [{ name: 'health', url: `http://localhost:${port}/health`, expectedStatus: 200 }]
          : [],
        dependencies,
        runtimeModes: ['local', 'remote'],
        env: port ? { PORT: String(port) } : {},
        nodeConfig: {},
        verification: {
          api: port
            ? [{ id: 'health', label: 'Health check', kind: 'api', method: 'GET', url: `http://localhost:${port}/health`, expectedStatus: 200 }]
            : [],
          data: [],
        },
      };
    } else {
      // library
      services[repo.name] = {
        id: repo.name,
        label: toLabel(repo.name),
        kind: 'library',
        repoPath: `\${workspace.root}/${repo.name}`,
        workingDirectory: `\${workspace.root}/${repo.name}`,
        runtime: { type: 'script', command: { bin: 'echo', args: ['library — no runtime'] } },
        localUrl: '',
        healthChecks: [],
        dependencies,
        runtimeModes: ['remote'],
        env: {},
        nodeConfig: {},
        verification: { api: [], data: [] },
      };
    }
  }

  // Build presets: one "core" preset with all services
  const serviceNames = repos
    .filter((r) => r.classification === 'service')
    .map((r) => r.name);

  const config: Record<string, unknown> = {
    version: 1,
    workspace: { name: workspaceName },
    ...(orgUrl ? { github: { host: orgUrl.host, org: orgUrl.org } } : {}),
    services,
    aliases: {},
    presets: {
      all: {
        description: 'All services',
        services: serviceNames,
      },
    },
    fixtures: [],
    flows: [],
    defaults: {
      upTarget: 'all',
    },
    onboard: {
      binaries: ['bun', 'docker', 'gh'],
      skills: [],
    },
  };

  const githubLine = orgUrl ? `\n GitHub: ${orgUrl.host}/${orgUrl.org}` : '';
  const doc = new YAML.Document(config);
  doc.commentBefore = ` orcha.config.yaml — generated by orcha init\n Workspace: ${workspaceName}${githubLine}\n\n Review and customize this file. TODOs mark fields that need manual attention.`;

  return doc.toString();
};
