import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import { loadConfig, getWorkspaceRoot, resetConfig } from './loader';

const FIXTURES_DIR = path.join(import.meta.dir, '__fixtures__');

describe('config-loader', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    delete process.env.ORCHA_CONFIG;
    resetConfig();
  });

  test('loads a valid orcha.config.yaml via ORCHA_CONFIG env var', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.version).toBe(1);
    expect(config.workspace.name).toBe('test-team');
    expect(config.github?.host).toBe('github.com');
    expect(config.github?.org).toBe('test-org');
  });

  test('resolves ${workspace.root} in paths', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    // workspace.root should resolve to the directory containing the config file
    expect(config.services['api-service'].repoPath).toBe(path.join(FIXTURES_DIR, 'api-service'));
    expect(config.services.redis.repoPath).toBe(path.join(FIXTURES_DIR, 'api-service'));
  });

  test('parses service definitions correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    const services = config.services;
    expect(Object.keys(services)).toEqual(['redis', 'api-service', 'web-ui']);

    const redis = services.redis;
    expect(redis.kind).toBe('infra');
    expect(redis.localUrl).toBe('redis://localhost:6379');
    expect(redis.healthChecks).toHaveLength(1);
    expect(redis.dependencies).toEqual([]);

    const api = services['api-service'];
    expect(api.kind).toBe('service');
    expect(api.runtime.type).toBe('script');
    expect(api.dependencies).toEqual(['redis']);
    expect(api.profiles?.staging?.description).toBe('Against staging backend');
  });

  test('parses presets correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.presets?.core?.services).toEqual(['web-ui']);
    expect(config.presets?.['api-only']?.services).toEqual(['api-service']);
  });

  test('parses aliases correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.aliases?.cache).toBe('redis');
  });

  test('parses fixtures correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.fixtures).toHaveLength(1);
    expect(config.fixtures?.[0].id).toBe('seed-user');
    expect(config.fixtures?.[0].targetService).toBe('api-service');
  });

  test('parses flows correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.flows).toHaveLength(1);
    expect(config.flows?.[0].id).toBe('user-flow');
    expect(config.flows?.[0].steps).toHaveLength(1);
  });

  test('parses defaults correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.defaults?.upTarget).toBe('core');
    expect(config.defaults?.verifyApiService).toBe('api-service');
  });

  test('parses onboard config correctly', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config = loadConfig();

    expect(config.onboard?.binaries).toEqual(['bun', 'docker']);
    expect(config.onboard?.skills).toEqual(['orcha-check', 'orcha-sync']);
  });

  test('getWorkspaceRoot returns config directory', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const root = getWorkspaceRoot();

    expect(root).toBe(FIXTURES_DIR);
  });

  test('caches config across multiple calls', () => {
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
    const config1 = loadConfig();
    const config2 = loadConfig();

    expect(config1).toBe(config2); // same reference
  });

  test('throws when no config file found', () => {
    process.env.ORCHA_CONFIG = '/nonexistent/path/orcha.config.yaml';
    expect(() => loadConfig()).toThrow('Could not find orcha.config.yaml');
  });
});
