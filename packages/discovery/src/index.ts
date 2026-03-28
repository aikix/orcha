/**
 * @orcha/discovery
 *
 * Auto-discovers repos from a GitHub org, analyzes their structure,
 * detects dependencies, and generates an orcha.config.yaml.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseOrgUrl, listOrgRepos, type RepoInfo, type OrgUrl } from './org-scanner.js';
import { cloneAndAnalyze, analyzeLocalRepo, repoInfoFromLocal, type AnalyzedRepo } from './repo-analyzer.js';
import { detectDependencies, type DetectedDependency } from './dependency-detector.js';
import { generateConfig } from './config-generator.js';

export type { RepoInfo, OrgUrl, AnalyzedRepo, DetectedDependency };
export { parseOrgUrl, listOrgRepos, cloneAndAnalyze, analyzeLocalRepo, repoInfoFromLocal, detectDependencies, generateConfig };

export type DiscoveryResult = {
  readonly orgUrl: OrgUrl;
  readonly repos: RepoInfo[];
  readonly analyzed: AnalyzedRepo[];
  readonly dependencies: DetectedDependency[];
  readonly configYaml: string;
};

export type DiscoveryCallbacks = {
  onReposListed?: (repos: RepoInfo[]) => void;
  onRepoAnalyzing?: (repo: RepoInfo, index: number, total: number) => void;
  onRepoAnalyzed?: (analyzed: AnalyzedRepo, index: number, total: number) => void;
  onAnalysisComplete?: (analyzed: AnalyzedRepo[]) => void;
  onDepsDetected?: (deps: DetectedDependency[]) => void;
};

/**
 * Run the full discovery pipeline:
 * 1. Parse org URL
 * 2. List repos from GitHub
 * 3. Shallow clone + analyze each selected repo
 * 4. Detect dependencies
 * 5. Generate config YAML
 */
export const discover = async (
  orgUrlString: string,
  selectedRepos: RepoInfo[],
  workspaceName: string,
  callbacks: DiscoveryCallbacks = {},
): Promise<DiscoveryResult> => {
  const orgUrl = parseOrgUrl(orgUrlString);

  // Analyze repos (parallel, max 5 concurrent)
  const analyzed: AnalyzedRepo[] = [];
  const concurrency = 5;

  for (let i = 0; i < selectedRepos.length; i += concurrency) {
    const batch = selectedRepos.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (repo, batchIdx) => {
        const idx = i + batchIdx;
        callbacks.onRepoAnalyzing?.(repo, idx, selectedRepos.length);
        const result = await cloneAndAnalyze(repo);
        callbacks.onRepoAnalyzed?.(result, idx, selectedRepos.length);
        return result;
      }),
    );
    analyzed.push(...results);
  }

  callbacks.onAnalysisComplete?.(analyzed);

  // Detect dependencies
  const dependencies = detectDependencies(analyzed);
  callbacks.onDepsDetected?.(dependencies);

  // Generate config
  const configYaml = generateConfig(orgUrl, workspaceName, analyzed, dependencies);

  return {
    orgUrl,
    repos: selectedRepos,
    analyzed,
    dependencies,
    configYaml,
  };
};

/**
 * Infer OrgUrl from git remotes found in local repos.
 * Looks at all clone URLs and finds the most common host/org pattern.
 */
export const inferOrgFromRemotes = (repos: { cloneUrl: string }[]): OrgUrl | null => {
  const orgCounts = new Map<string, number>();

  for (const repo of repos) {
    if (!repo.cloneUrl) continue;
    try {
      let host: string;
      let org: string;

      if (repo.cloneUrl.startsWith('git@')) {
        // git@github.com:org/repo.git
        const match = repo.cloneUrl.match(/^git@([^:]+):([^/]+)\//);
        if (!match) continue;
        host = match[1];
        org = match[2];
      } else {
        // https://github.com/org/repo.git
        const parsed = new URL(repo.cloneUrl);
        host = parsed.hostname;
        org = parsed.pathname.replace(/^\//, '').split('/')[0];
      }

      if (host && org) {
        const key = `${host}/${org}`;
        orgCounts.set(key, (orgCounts.get(key) ?? 0) + 1);
      }
    } catch { /* skip unparseable URLs */ }
  }

  if (orgCounts.size === 0) return null;

  // Return the most common org
  let bestKey = '';
  let bestCount = 0;
  for (const [key, count] of orgCounts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  const [host, org] = bestKey.split('/');
  return { host, org };
};

export type LocalDiscoveryResult = {
  readonly orgUrl: OrgUrl | null;
  readonly analyzed: AnalyzedRepo[];
  readonly dependencies: DetectedDependency[];
  readonly configYaml: string;
  readonly workspaceDir: string;
};

export type LocalDiscoveryCallbacks = {
  onRepoAnalyzing?: (name: string, index: number, total: number) => void;
  onRepoAnalyzed?: (analyzed: AnalyzedRepo, index: number, total: number) => void;
};

/**
 * Run discovery on an existing local workspace directory.
 * Scans subdirectories for git repos, analyzes each, detects dependencies, generates config.
 * No GitHub API needed.
 */
export const discoverLocal = async (
  workspaceDir: string,
  callbacks: LocalDiscoveryCallbacks = {},
): Promise<LocalDiscoveryResult> => {
  const { readdirSync } = await import('node:fs');

  // Find subdirectories that are git repos
  const subdirs = readdirSync(workspaceDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);

  const analyzed: AnalyzedRepo[] = [];
  const repoInfos: { cloneUrl: string }[] = [];
  let idx = 0;

  for (const dirName of subdirs) {
    const repoDir = path.join(workspaceDir, dirName);
    callbacks.onRepoAnalyzing?.(dirName, idx, subdirs.length);

    const result = await analyzeLocalRepo(repoDir);
    if (result) {
      analyzed.push(result);
      repoInfos.push({ cloneUrl: result.repoInfo.cloneUrl });
      callbacks.onRepoAnalyzed?.(result, idx, subdirs.length);
    }
    idx++;
  }

  // Infer org from git remotes
  const orgUrl = inferOrgFromRemotes(repoInfos);

  // Detect dependencies
  const dependencies = detectDependencies(analyzed);

  // Generate config
  const workspaceName = orgUrl?.org ?? path.basename(workspaceDir);
  const configYaml = generateConfig(orgUrl, workspaceName, analyzed, dependencies);

  return {
    orgUrl,
    analyzed,
    dependencies,
    configYaml,
    workspaceDir,
  };
};

/**
 * Write the generated config to a file.
 */
export const writeConfig = (configYaml: string, outputDir: string): string => {
  const outputPath = path.join(outputDir, 'orcha.config.yaml');
  writeFileSync(outputPath, configYaml, 'utf8');
  return outputPath;
};
