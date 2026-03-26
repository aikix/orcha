import type { AnalyzedRepo, DetectedPort } from './repo-analyzer.js';

export type DetectedDependency = {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
};

/**
 * Build a port-to-service map from analyzed repos.
 */
const buildPortMap = (repos: AnalyzedRepo[]): Map<number, string> => {
  const portMap = new Map<number, string>();
  for (const repo of repos) {
    const allPorts = [...repo.ports, ...repo.configPorts];
    for (const p of allPorts) {
      // Only map the "primary" port (first detected) to avoid conflicts
      if (!portMap.has(p.port)) {
        portMap.set(p.port, repo.name);
      }
    }
  }
  return portMap;
};

/**
 * Build a name-to-repo map for quick lookups.
 */
const buildNameMap = (repos: AnalyzedRepo[]): Map<string, AnalyzedRepo> => {
  const nameMap = new Map<string, AnalyzedRepo>();
  for (const repo of repos) {
    nameMap.set(repo.name, repo);
  }
  return nameMap;
};

/**
 * Detect dependencies between repos using heuristics:
 * 1. npm dependency references (one repo depends on another's package)
 * 2. Env var hints referencing other service names
 * 3. Config files referencing ports that belong to other services
 * 4. docker-compose depends_on
 */
export const detectDependencies = (repos: AnalyzedRepo[]): DetectedDependency[] => {
  const deps: DetectedDependency[] = [];
  const portMap = buildPortMap(repos);
  const nameMap = buildNameMap(repos);
  const repoNames = repos.map((r) => r.name);

  for (const repo of repos) {
    // 1. Check npm dependencies for references to sibling repos
    for (const dep of repo.dependencies) {
      // Match patterns like @org/repo-name or just repo-name
      for (const otherName of repoNames) {
        if (otherName === repo.name) continue;
        if (dep.includes(otherName) || dep.endsWith(otherName)) {
          deps.push({
            from: repo.name,
            to: otherName,
            reason: `npm dependency "${dep}"`,
          });
        }
      }
    }

    // 2. Check env var hints for references to other service names
    for (const hint of repo.envVarHints) {
      const hintLower = hint.toLowerCase().replace(/[_-]/g, '');
      for (const otherName of repoNames) {
        if (otherName === repo.name) continue;
        const otherLower = otherName.toLowerCase().replace(/[_-]/g, '');
        if (hintLower.includes(otherLower)) {
          deps.push({
            from: repo.name,
            to: otherName,
            reason: `env var hint "${hint}"`,
          });
        }
      }
    }

    // 3. Check scripts for references to ports of other services
    for (const script of repo.scripts) {
      const portMatches = script.command.match(/localhost:(\d{4,5})/g);
      if (portMatches) {
        for (const match of portMatches) {
          const port = parseInt(match.split(':')[1], 10);
          const owner = portMap.get(port);
          if (owner && owner !== repo.name) {
            deps.push({
              from: repo.name,
              to: owner,
              reason: `script "${script.name}" references port ${port}`,
            });
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return deps.filter((d) => {
    const key = `${d.from}->${d.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
