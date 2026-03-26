import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import {
  listServiceDefinitions,
  listAllServiceDefinitions,
  getServiceDefinition,
  resolveServiceDefinition,
  canonicalizeServiceId,
  listServiceProfiles,
  getDefaultProfile,
  listPresets,
  getPreset,
  listFixtures,
  getFixture,
  listFlowScenarios,
  getFlowScenario,
  getDefaults,
  getOnboardConfig,
  getGitHubConfig,
  resetConfig,
} from './index';

const FIXTURES_DIR = path.join(import.meta.dir, '__fixtures__');

describe('config-loader API', () => {
  beforeEach(() => {
    resetConfig();
    process.env.ORCHA_CONFIG = path.join(FIXTURES_DIR, 'basic.orcha.config.yaml');
  });

  afterEach(() => {
    delete process.env.ORCHA_CONFIG;
    resetConfig();
  });

  // Service definitions
  test('listServiceDefinitions excludes infra by default', () => {
    const services = listServiceDefinitions();
    expect(services).toHaveLength(2);
    expect(services.map((s) => s.id)).toEqual(['api-service', 'web-ui']);
  });

  test('listServiceDefinitions includes infra when requested', () => {
    const services = listServiceDefinitions(true);
    expect(services).toHaveLength(3);
  });

  test('listAllServiceDefinitions includes everything', () => {
    const services = listAllServiceDefinitions();
    expect(services).toHaveLength(3);
  });

  test('getServiceDefinition returns correct service', () => {
    const service = getServiceDefinition('api-service');
    expect(service.id).toBe('api-service');
    expect(service.label).toBe('API Service');
    expect(service.kind).toBe('service');
  });

  test('getServiceDefinition throws for unknown service', () => {
    expect(() => getServiceDefinition('unknown')).toThrow('Unknown service "unknown"');
  });

  // Aliases
  test('canonicalizeServiceId follows aliases', () => {
    expect(canonicalizeServiceId('cache')).toBe('redis');
    expect(canonicalizeServiceId('api-service')).toBe('api-service');
  });

  test('getServiceDefinition works with aliases', () => {
    const service = getServiceDefinition('cache');
    expect(service.id).toBe('redis');
  });

  // Profiles
  test('listServiceProfiles returns available profiles', () => {
    const profiles = listServiceProfiles('api-service');
    expect(profiles).toContain('staging');
  });

  test('listServiceProfiles returns [local] for service without profiles', () => {
    const profiles = listServiceProfiles('web-ui');
    expect(profiles).toEqual(['local']);
  });

  test('getDefaultProfile returns local when no default set', () => {
    expect(getDefaultProfile('api-service')).toBe('local');
  });

  // resolveServiceDefinition
  test('resolveServiceDefinition with no profile returns base', () => {
    const resolved = resolveServiceDefinition('api-service');
    expect(resolved.profile).toBe('local');
    expect(resolved.dependencies).toEqual(['redis']);
  });

  test('resolveServiceDefinition with staging merges env', () => {
    const resolved = resolveServiceDefinition('api-service', 'staging');
    expect(resolved.profile).toBe('staging');
    // NODE_CONFIG should be deep-merged
    const nodeConfig = JSON.parse(resolved.env.NODE_CONFIG);
    expect(nodeConfig.http.port).toBe(3000); // from base
    expect(nodeConfig.api.url).toBe('https://staging.example.com'); // from staging
    expect(nodeConfig.cache.enabled).toBe(true); // from base
  });

  test('resolveServiceDefinition throws for unknown profile', () => {
    expect(() => resolveServiceDefinition('api-service', 'production')).toThrow(
      'does not support profile "production"',
    );
  });

  // Presets
  test('listPresets returns all presets', () => {
    const presets = listPresets();
    expect(presets).toHaveLength(2);
    expect(presets.map((p) => p.id)).toEqual(['core', 'api-only']);
  });

  test('getPreset returns correct preset', () => {
    const preset = getPreset('core');
    expect(preset?.services).toEqual(['web-ui']);
  });

  test('getPreset returns undefined for unknown preset', () => {
    expect(getPreset('unknown')).toBeUndefined();
  });

  // Fixtures
  test('listFixtures returns all fixtures', () => {
    expect(listFixtures()).toHaveLength(1);
  });

  test('getFixture returns correct fixture', () => {
    const fixture = getFixture('seed-user');
    expect(fixture?.targetService).toBe('api-service');
  });

  // Flows
  test('listFlowScenarios returns all flows', () => {
    expect(listFlowScenarios()).toHaveLength(1);
  });

  test('getFlowScenario returns correct flow', () => {
    const flow = getFlowScenario('user-flow');
    expect(flow?.requiredServices).toEqual(['api-service']);
  });

  // Defaults
  test('getDefaults returns config defaults', () => {
    const defaults = getDefaults();
    expect(defaults.upTarget).toBe('core');
  });

  // Onboard
  test('getOnboardConfig returns onboard settings', () => {
    const onboard = getOnboardConfig();
    expect(onboard.binaries).toEqual(['bun', 'docker']);
    expect(onboard.skills).toEqual(['orcha-check', 'orcha-sync']);
  });

  // GitHub
  test('getGitHubConfig returns github settings', () => {
    const github = getGitHubConfig();
    expect(github?.host).toBe('github.com');
    expect(github?.org).toBe('test-org');
  });
});
