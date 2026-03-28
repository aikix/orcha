import { describe, test, expect } from 'bun:test';
import { detectDependencies } from './dependency-detector.js';
import { inferOrgFromRemotes } from './index.js';
import type { AnalyzedRepo } from './repo-analyzer.js';
import type { RepoInfo } from './org-scanner.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal AnalyzedRepo for testing
// ---------------------------------------------------------------------------

const makeRepoInfo = (name: string, overrides: Partial<RepoInfo> = {}): RepoInfo => ({
  name,
  description: null,
  language: null,
  archived: false,
  fork: false,
  pushedAt: '2025-01-01T00:00:00Z',
  defaultBranch: 'main',
  cloneUrl: '',
  ...overrides,
});

const makeRepo = (name: string, overrides: Partial<AnalyzedRepo> = {}): AnalyzedRepo => ({
  name,
  repoInfo: makeRepoInfo(name),
  classification: 'service',
  ports: [],
  scripts: [],
  hasDev: true,
  hasStart: true,
  hasTest: false,
  hasDockerfile: false,
  hasDockerCompose: false,
  dockerComposeServices: [],
  dependencies: [],
  envVarHints: [],
  configPorts: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Dependency Detection
// ---------------------------------------------------------------------------

describe('detectDependencies', () => {
  test('detects npm dependency references', () => {
    const repos = [
      makeRepo('web-ui', { dependencies: ['@myorg/api-service', 'react'] }),
      makeRepo('api-service'),
    ];
    const deps = detectDependencies(repos);
    expect(deps).toHaveLength(1);
    expect(deps[0].from).toBe('web-ui');
    expect(deps[0].to).toBe('api-service');
    expect(deps[0].reason).toContain('npm dependency');
  });

  test('detects env var hints referencing other services', () => {
    const repos = [
      makeRepo('web-ui', { envVarHints: ['API_SERVICE_URL', 'REDIS_HOST'] }),
      makeRepo('api-service'),
      makeRepo('redis'),
    ];
    const deps = detectDependencies(repos);
    const depNames = deps.map((d) => `${d.from}->${d.to}`);
    expect(depNames).toContain('web-ui->api-service');
  });

  test('detects port-based dependencies from scripts', () => {
    const repos = [
      makeRepo('web-ui', { scripts: [{ name: 'dev', command: 'PROXY=http://localhost:3001 vite' }] }),
      makeRepo('api-service', { configPorts: [{ port: 3001, source: 'config' }] }),
    ];
    const deps = detectDependencies(repos);
    expect(deps).toHaveLength(1);
    expect(deps[0].from).toBe('web-ui');
    expect(deps[0].to).toBe('api-service');
  });

  test('does not detect self-dependencies', () => {
    const repos = [
      makeRepo('api-service', { dependencies: ['api-service'], envVarHints: ['API_SERVICE_URL'] }),
    ];
    const deps = detectDependencies(repos);
    expect(deps).toHaveLength(0);
  });

  test('deduplicates dependencies', () => {
    const repos = [
      makeRepo('web-ui', {
        dependencies: ['@org/api-service'],
        envVarHints: ['API_SERVICE_URL'],
      }),
      makeRepo('api-service'),
    ];
    const deps = detectDependencies(repos);
    // Both npm dep and env var hint point to same target — should deduplicate
    expect(deps).toHaveLength(1);
  });

  test('handles empty repos', () => {
    const deps = detectDependencies([]);
    expect(deps).toHaveLength(0);
  });

  test('handles repos with no cross-references', () => {
    const repos = [
      makeRepo('service-a'),
      makeRepo('service-b'),
    ];
    const deps = detectDependencies(repos);
    expect(deps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Org Inference from Remotes
// ---------------------------------------------------------------------------

describe('inferOrgFromRemotes', () => {
  test('infers org from HTTPS clone URLs', () => {
    const repos = [
      { cloneUrl: 'https://github.com/my-org/repo-a.git' },
      { cloneUrl: 'https://github.com/my-org/repo-b.git' },
    ];
    const org = inferOrgFromRemotes(repos);
    expect(org).toEqual({ host: 'github.com', org: 'my-org' });
  });

  test('infers org from SSH clone URLs', () => {
    const repos = [
      { cloneUrl: 'git@github.com:my-team/service-a.git' },
      { cloneUrl: 'git@github.com:my-team/service-b.git' },
    ];
    const org = inferOrgFromRemotes(repos);
    expect(org).toEqual({ host: 'github.com', org: 'my-team' });
  });

  test('picks the most common org when mixed', () => {
    const repos = [
      { cloneUrl: 'https://github.com/org-a/repo-1.git' },
      { cloneUrl: 'https://github.com/org-b/repo-2.git' },
      { cloneUrl: 'https://github.com/org-a/repo-3.git' },
    ];
    const org = inferOrgFromRemotes(repos);
    expect(org?.org).toBe('org-a');
  });

  test('returns null for empty input', () => {
    expect(inferOrgFromRemotes([])).toBeNull();
  });

  test('returns null when no valid URLs', () => {
    const repos = [{ cloneUrl: '' }, { cloneUrl: 'not-a-url' }];
    expect(inferOrgFromRemotes(repos)).toBeNull();
  });

  test('handles GitHub Enterprise URLs', () => {
    const repos = [
      { cloneUrl: 'https://git.corp.com/platform/api.git' },
      { cloneUrl: 'https://git.corp.com/platform/web.git' },
    ];
    const org = inferOrgFromRemotes(repos);
    expect(org).toEqual({ host: 'git.corp.com', org: 'platform' });
  });
});
