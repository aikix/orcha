/**
 * @orcha/config-loader
 *
 * Reads orcha.config.yaml and exposes service definitions, presets, fixtures,
 * flows, and other configuration in a structured API.
 *
 * This is the single source of truth for all workspace configuration.
 * No team-specific data is hardcoded — everything comes from the YAML file.
 */

import path from 'node:path';
import type {
  ServiceDefinition,
  ResolvedServiceDefinition,
  ServiceProfile,
  StackPreset,
  SeedFixture,
  FlowScenarioDefinition,
  ExternalScriptDefinition,
  OrchaConfig,
} from '@orcha/service-definitions';
import { loadConfig, getWorkspaceRoot, resetConfig } from './loader.js';

// Re-export types for convenience
export type {
  ServiceKind,
  RuntimeMode,
  VerificationKind,
  CommandSpec,
  ScriptRuntime,
  ComposeRuntime,
  RuntimeAdapter,
  HealthCheck,
  VerificationProbe,
  ServiceProfile,
  ServiceDefinition,
  ResolvedServiceDefinition,
  FlowStep,
  FlowScenarioDefinition,
  StackPreset,
  SeedFixture,
  ExternalScriptDefinition,
  OrchaConfig,
} from '@orcha/service-definitions';

export { loadConfig, getWorkspaceRoot, resetConfig };

// ---------------------------------------------------------------------------
// Workspace constants (derived from config)
// ---------------------------------------------------------------------------

export const WORKSPACE_ROOT = (): string => getWorkspaceRoot();

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

const getServices = (): Record<string, ServiceDefinition> => {
  return loadConfig().services;
};

const getAliases = (): Record<string, string> => {
  return loadConfig().aliases ?? {};
};

/**
 * Resolve a service ID, following aliases.
 */
export const canonicalizeServiceId = (serviceId: string): string => {
  const aliases = getAliases();
  return aliases[serviceId] ?? serviceId;
};

/**
 * Get a single service definition by ID.
 */
export const getServiceDefinition = (serviceId: string): ServiceDefinition => {
  const canonical = canonicalizeServiceId(serviceId);
  const services = getServices();
  const definition = services[canonical];
  if (!definition) {
    const available = Object.keys(services).join(', ');
    throw new Error(`Unknown service "${serviceId}". Available: ${available}`);
  }
  return definition;
};

/**
 * List all service definitions (excluding infra by default).
 */
export const listServiceDefinitions = (includeInfra = false): ServiceDefinition[] => {
  const services = getServices();
  return Object.values(services).filter((s) => includeInfra || s.kind !== 'infra');
};

/**
 * List all service definitions including infra.
 */
export const listAllServiceDefinitions = (): ServiceDefinition[] => {
  return Object.values(getServices());
};

/**
 * Get available profiles for a service.
 */
export const listServiceProfiles = (serviceId: string): string[] => {
  const definition = getServiceDefinition(serviceId);
  return definition.profiles ? Object.keys(definition.profiles) : ['local'];
};

/**
 * Get the default profile for a service.
 */
export const getDefaultProfile = (serviceId: string): string => {
  const definition = getServiceDefinition(serviceId);
  return definition.defaultProfile ?? 'local';
};

/**
 * Merge two env objects, with deep merge on NODE_CONFIG if both contain it.
 */
const mergeEnv = (
  base: Record<string, string>,
  override: Record<string, string>,
): Record<string, string> => {
  const result = { ...base, ...override };

  // Deep merge NODE_CONFIG if both base and override have it
  if (base.NODE_CONFIG && override.NODE_CONFIG) {
    try {
      const baseConfig = JSON.parse(base.NODE_CONFIG) as Record<string, unknown>;
      const overrideConfig = JSON.parse(override.NODE_CONFIG) as Record<string, unknown>;
      result.NODE_CONFIG = JSON.stringify(deepMergeRecords(baseConfig, overrideConfig));
    } catch {
      // If parsing fails, override wins
    }
  }

  return result;
};

const deepMergeRecords = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeRecords(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Resolve a service definition with a specific profile applied.
 * Merges profile overrides (env, nodeConfig, dependencies, healthChecks) with the base definition.
 */
export const resolveServiceDefinition = (
  serviceId: string,
  requestedProfile?: string,
): ResolvedServiceDefinition => {
  const definition = getServiceDefinition(serviceId);
  const activeProfile = requestedProfile ?? definition.defaultProfile ?? 'local';

  if (!definition.profiles) {
    if (requestedProfile && requestedProfile !== 'local') {
      throw new Error(
        `Service "${definition.id}" does not support profile "${activeProfile}". Available: local`,
      );
    }
    return { ...definition, profile: 'local' };
  }

  const profileOverride = definition.profiles[activeProfile];

  if (!profileOverride) {
    // If using the default profile and it's not explicitly defined, return base definition
    if (!requestedProfile || activeProfile === 'local') {
      return { ...definition, profile: activeProfile };
    }
    const available = Object.keys(definition.profiles).join(', ');
    throw new Error(
      `Service "${definition.id}" does not support profile "${activeProfile}". Available: ${available}`,
    );
  }

  return {
    ...definition,
    profile: activeProfile,
    dependencies: profileOverride.dependencies ?? definition.dependencies,
    referenceDeps: profileOverride.referenceDeps ?? definition.referenceDeps,
    healthChecks: profileOverride.healthChecks ?? definition.healthChecks,
    env: profileOverride.env ? mergeEnv(definition.env, profileOverride.env) : definition.env,
    nodeConfig: profileOverride.nodeConfig
      ? deepMergeRecords(definition.nodeConfig, profileOverride.nodeConfig)
      : definition.nodeConfig,
  };
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const listPresets = (): StackPreset[] => {
  const presets = loadConfig().presets ?? {};
  return Object.entries(presets).map(([id, preset]) => ({
    ...preset,
    id,
  }));
};

export const getPreset = (presetId: string): StackPreset | undefined => {
  const presets = loadConfig().presets ?? {};
  const preset = presets[presetId];
  if (!preset) return undefined;
  return { ...preset, id: presetId };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const listFixtures = (): readonly SeedFixture[] => {
  return loadConfig().fixtures ?? [];
};

export const getFixture = (fixtureId: string): SeedFixture | undefined => {
  return listFixtures().find((f) => f.id === fixtureId);
};

// ---------------------------------------------------------------------------
// Flow scenarios
// ---------------------------------------------------------------------------

export const listFlowScenarios = (): readonly FlowScenarioDefinition[] => {
  return loadConfig().flows ?? [];
};

export const getFlowScenario = (scenarioId: string): FlowScenarioDefinition | undefined => {
  return listFlowScenarios().find((f) => f.id === scenarioId);
};

// ---------------------------------------------------------------------------
// External scripts
// ---------------------------------------------------------------------------

export const listExternalScripts = (): readonly ExternalScriptDefinition[] => {
  return loadConfig().externalScripts ?? [];
};

export const getExternalScript = (scriptId: string): ExternalScriptDefinition | undefined => {
  return listExternalScripts().find((s) => s.id === scriptId);
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const getDefaults = () => {
  return loadConfig().defaults ?? {};
};

// ---------------------------------------------------------------------------
// Onboard config
// ---------------------------------------------------------------------------

export const getOnboardConfig = () => {
  return loadConfig().onboard ?? { binaries: ['bun', 'docker', 'gh'], skills: [] };
};

// ---------------------------------------------------------------------------
// GitHub config
// ---------------------------------------------------------------------------

export const getGitHubConfig = () => {
  return loadConfig().github;
};
