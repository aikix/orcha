/**
 * @orcha/discovery
 *
 * Auto-discovers repos from a GitHub org, analyzes their structure,
 * detects dependencies, and generates an orcha.config.yaml.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseOrgUrl, listOrgRepos, type RepoInfo, type OrgUrl } from './org-scanner.js';
import { cloneAndAnalyze, type AnalyzedRepo } from './repo-analyzer.js';
import { detectDependencies, type DetectedDependency } from './dependency-detector.js';
import { generateConfig } from './config-generator.js';

export type { RepoInfo, OrgUrl, AnalyzedRepo, DetectedDependency };
export { parseOrgUrl, listOrgRepos, cloneAndAnalyze, detectDependencies, generateConfig };

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
 * Write the generated config to a file.
 */
export const writeConfig = (configYaml: string, outputDir: string): string => {
  const outputPath = path.join(outputDir, 'orcha.config.yaml');
  writeFileSync(outputPath, configYaml, 'utf8');
  return outputPath;
};
