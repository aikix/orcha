import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import { analyzeRepo, type AnalyzedRepo } from './repo-analyzer.js';
import type { RepoInfo } from './org-scanner.js';

const FIXTURES_DIR = path.resolve(import.meta.dir, '__fixtures__');

const makeRepoInfo = (name: string, language: string | null = null): RepoInfo => ({
  name,
  description: null,
  language,
  archived: false,
  fork: false,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  cloneUrl: `https://github.com/test/${name}.git`,
});

describe('analyzeRepo — node-service', () => {
  const repoDir = path.join(FIXTURES_DIR, 'node-service');
  const result = analyzeRepo(repoDir, makeRepoInfo('node-service', 'JavaScript'));

  test('classifies as service', () => {
    expect(result.classification).toBe('service');
  });

  test('detects dev and start scripts', () => {
    expect(result.hasDev).toBe(true);
    expect(result.hasStart).toBe(true);
  });

  test('detects test script', () => {
    expect(result.hasTest).toBe(true);
  });

  test('detects config port 3001', () => {
    const configPortNumbers = result.configPorts.map((p) => p.port);
    expect(configPortNumbers).toContain(3001);
  });

  test('detects express dependency', () => {
    expect(result.dependencies).toContain('express');
  });
});

describe('analyzeRepo — python-service', () => {
  const repoDir = path.join(FIXTURES_DIR, 'python-service');
  const result = analyzeRepo(repoDir, makeRepoInfo('python-service', 'Python'));

  test('classifies as service', () => {
    expect(result.classification).toBe('service');
  });

  test('detects Flask port 5000', () => {
    const portNumbers = result.configPorts.map((p) => p.port);
    expect(portNumbers).toContain(5000);
  });

  test('detects flask and redis dependencies', () => {
    expect(result.dependencies).toContain('flask');
    expect(result.dependencies).toContain('redis');
  });
});

describe('analyzeRepo — go-service', () => {
  const repoDir = path.join(FIXTURES_DIR, 'go-service');
  const result = analyzeRepo(repoDir, makeRepoInfo('go-service', 'Go'));

  test('classifies as service', () => {
    expect(result.classification).toBe('service');
  });

  test('detects port 8080', () => {
    const portNumbers = result.configPorts.map((p) => p.port);
    expect(portNumbers).toContain(8080);
  });

  test('detects dev script', () => {
    expect(result.hasDev).toBe(true);
  });
});

describe('analyzeRepo — docker-only', () => {
  const repoDir = path.join(FIXTURES_DIR, 'docker-only');
  const result = analyzeRepo(repoDir, makeRepoInfo('docker-only'));

  test('classifies as infra', () => {
    expect(result.classification).toBe('infra');
  });

  test('detects Dockerfile port 6379', () => {
    const portNumbers = result.ports.map((p) => p.port);
    expect(portNumbers).toContain(6379);
  });

  test('detects docker compose services', () => {
    expect(result.dockerComposeServices).toContain('redis');
  });
});

describe('analyzeRepo — library', () => {
  const repoDir = path.join(FIXTURES_DIR, 'library');
  const result = analyzeRepo(repoDir, makeRepoInfo('shared-utils', 'TypeScript'));

  test('classifies as library', () => {
    expect(result.classification).toBe('library');
  });

  test('has no dev or start scripts', () => {
    expect(result.hasDev).toBe(false);
    expect(result.hasStart).toBe(false);
  });
});
