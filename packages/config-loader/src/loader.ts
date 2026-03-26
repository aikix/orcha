import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { OrchaConfig } from '@orcha/service-definitions';

let cachedConfig: OrchaConfig | null = null;
let cachedConfigDir: string | null = null;

const CONFIG_FILE_NAME = 'orcha.config.yaml';
const CONFIG_LOCAL_FILE_NAME = 'orcha.config.local.yaml';

/**
 * Resolve the path to orcha.config.yaml.
 *
 * Resolution order:
 * 1. ORCHA_CONFIG env var (explicit path)
 * 2. orcha.config.yaml in current working directory
 * 3. Walk up from cwd looking for orcha.config.yaml
 */
const resolveConfigPath = (): string | null => {
  if (process.env.ORCHA_CONFIG) {
    const explicit = path.resolve(process.env.ORCHA_CONFIG);
    if (existsSync(explicit)) return explicit;
    return null;
  }

  // Walk up from cwd
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
};

/**
 * Interpolate ${workspace.root} and other variables in string values.
 */
const interpolate = (value: string, vars: Record<string, string>): string => {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    return vars[key] ?? `\${${key}}`;
  });
};

/**
 * Recursively interpolate all string values in an object.
 */
const interpolateDeep = <T>(obj: T, vars: Record<string, string>): T => {
  if (typeof obj === 'string') return interpolate(obj, vars) as T;
  if (Array.isArray(obj)) return obj.map((item) => interpolateDeep(item, vars)) as T;
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateDeep(value, vars);
    }
    return result as T;
  }
  return obj;
};

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 */
const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
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
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
};

/**
 * Load and parse orcha.config.yaml.
 * Merges with orcha.config.local.yaml if present.
 * Resolves variable interpolation.
 */
export const loadConfig = (): OrchaConfig => {
  if (cachedConfig) return cachedConfig;

  const configPath = resolveConfigPath();
  if (!configPath) {
    throw new Error(
      `Could not find ${CONFIG_FILE_NAME}. Run "orcha init <org-url>" to generate one, or set ORCHA_CONFIG env var.`,
    );
  }

  const configDir = path.dirname(configPath);
  cachedConfigDir = configDir;

  const raw = readFileSync(configPath, 'utf8');
  let parsed = YAML.parse(raw) as Record<string, unknown>;

  // Merge local overrides if present
  const localPath = path.join(configDir, CONFIG_LOCAL_FILE_NAME);
  if (existsSync(localPath)) {
    const localRaw = readFileSync(localPath, 'utf8');
    const localParsed = YAML.parse(localRaw) as Record<string, unknown>;
    parsed = deepMerge(parsed, localParsed);
  }

  // Build interpolation variables
  const vars: Record<string, string> = {
    'workspace.root': configDir,
  };

  const config = interpolateDeep(parsed, vars) as OrchaConfig;
  cachedConfig = config;
  return config;
};

/**
 * Get the directory containing orcha.config.yaml (the workspace root).
 */
export const getWorkspaceRoot = (): string => {
  if (cachedConfigDir) return cachedConfigDir;
  loadConfig(); // triggers resolution
  return cachedConfigDir!;
};

/**
 * Reset the cached config. Useful for testing.
 */
export const resetConfig = (): void => {
  cachedConfig = null;
  cachedConfigDir = null;
};
