import { describe, test, expect } from 'bun:test';
import { generateConfig } from './config-generator.js';
import type { AnalyzedRepo } from './repo-analyzer.js';
import type { RepoInfo } from './org-scanner.js';
import type { DetectedDependency } from './dependency-detector.js';
import YAML from 'yaml';

const makeRepoInfo = (name: string): RepoInfo => ({
  name,
  description: null,
  language: null,
  archived: false,
  fork: false,
  pushedAt: '2025-01-01T00:00:00Z',
  defaultBranch: 'main',
  cloneUrl: '',
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

describe('generateConfig', () => {
  test('generates valid YAML with org URL', () => {
    const repos = [makeRepo('api-service', { configPorts: [{ port: 3000, source: 'config' }] })];
    const deps: DetectedDependency[] = [];
    const yaml = generateConfig({ host: 'github.com', org: 'my-org' }, 'my-org', repos, deps);
    const parsed = YAML.parse(yaml);

    expect(parsed.version).toBe(1);
    expect(parsed.workspace.name).toBe('my-org');
    expect(parsed.github.host).toBe('github.com');
    expect(parsed.github.org).toBe('my-org');
    expect(parsed.services['api-service']).toBeDefined();
    expect(parsed.services['api-service'].localUrl).toBe('http://localhost:3000');
  });

  test('generates config without github section when orgUrl is null', () => {
    const repos = [makeRepo('api-service')];
    const yaml = generateConfig(null, 'my-workspace', repos, []);
    const parsed = YAML.parse(yaml);

    expect(parsed.version).toBe(1);
    expect(parsed.workspace.name).toBe('my-workspace');
    expect(parsed.github).toBeUndefined();
  });

  test('classifies services correctly', () => {
    const repos = [
      makeRepo('web-ui', { classification: 'service', configPorts: [{ port: 8080, source: 'config' }] }),
      makeRepo('redis', { classification: 'infra', dockerComposeServices: ['redis'], ports: [{ port: 6379, source: 'docker-compose' }] }),
      makeRepo('shared-lib', { classification: 'library' }),
    ];
    const yaml = generateConfig(null, 'test', repos, []);
    const parsed = YAML.parse(yaml);

    expect(parsed.services['web-ui'].kind).toBe('service');
    expect(parsed.services['redis'].kind).toBe('infra');
    expect(parsed.services['shared-lib'].kind).toBe('library');
  });

  test('includes dependencies in service entries', () => {
    const repos = [makeRepo('web-ui'), makeRepo('api-service')];
    const deps: DetectedDependency[] = [{ from: 'web-ui', to: 'api-service', reason: 'npm dependency' }];
    const yaml = generateConfig(null, 'test', repos, deps);
    const parsed = YAML.parse(yaml);

    expect(parsed.services['web-ui'].dependencies).toContain('api-service');
    expect(parsed.services['api-service'].dependencies).toEqual([]);
  });

  test('generates presets with all services', () => {
    const repos = [
      makeRepo('service-a'),
      makeRepo('service-b'),
      makeRepo('redis', { classification: 'infra' }),
    ];
    const yaml = generateConfig(null, 'test', repos, []);
    const parsed = YAML.parse(yaml);

    expect(parsed.presets.all.services).toContain('service-a');
    expect(parsed.presets.all.services).toContain('service-b');
    expect(parsed.presets.all.services).not.toContain('redis'); // infra excluded from presets
  });

  test('picks dev command correctly', () => {
    const repos = [
      makeRepo('has-dev', { scripts: [{ name: 'dev', command: 'vite' }] }),
      makeRepo('has-start-dev', { scripts: [{ name: 'start:dev', command: 'nodemon' }] }),
      makeRepo('has-only-start', { scripts: [{ name: 'start', command: 'node server.js' }] }),
    ];
    const yaml = generateConfig(null, 'test', repos, []);
    const parsed = YAML.parse(yaml);

    expect(parsed.services['has-dev'].runtime.command.args).toEqual(['run', 'dev']);
    expect(parsed.services['has-start-dev'].runtime.command.args).toEqual(['run', 'start:dev']);
    expect(parsed.services['has-only-start'].runtime.command.args).toEqual(['start']);
  });
});
