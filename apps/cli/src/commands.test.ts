import { describe, test, expect } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const CLI_PATH = path.resolve(import.meta.dir, 'index.ts');
const FIXTURE_CONFIG = path.resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'packages',
  'config-loader',
  'src',
  '__fixtures__',
  'basic.orcha.config.yaml',
);

const run = async (...args: string[]) => {
  const { stdout, stderr } = await execFileAsync('bun', [CLI_PATH, ...args], {
    timeout: 15_000,
    env: { ...process.env, ORCHA_CONFIG: FIXTURE_CONFIG, NO_COLOR: '1' },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

const runJson = async (...args: string[]) => {
  const { stdout } = await run(...args, '--json');
  return JSON.parse(stdout);
};

describe('CLI commands', () => {
  test('list services --json', async () => {
    const data = await runJson('list', 'services');
    expect(Array.isArray(data)).toBe(true);
    const ids = data.map((s: any) => s.id);
    expect(ids).toContain('redis');
    expect(ids).toContain('api-service');
    expect(ids).toContain('web-ui');
  });

  test('list presets --json', async () => {
    const data = await runJson('list', 'presets');
    expect(Array.isArray(data)).toBe(true);
    const ids = data.map((p: any) => p.id);
    expect(ids).toContain('core');
    expect(ids).toContain('api-only');
  });

  test('graph core --json', async () => {
    const data = await runJson('graph', 'core');
    expect(data.target).toBe('core');
    expect(data.nodes.length).toBeGreaterThanOrEqual(3);
    const nodeIds = data.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('web-ui');
    expect(nodeIds).toContain('api-service');
    expect(nodeIds).toContain('redis');
  });

  test('graph api-service --json', async () => {
    const data = await runJson('graph', 'api-service');
    const nodeIds = data.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('api-service');
    expect(nodeIds).toContain('redis');
    expect(nodeIds).not.toContain('web-ui');
  });

  test('graph with --profile staging --json', async () => {
    const data = await runJson('graph', 'api-service', '--profile', 'staging');
    expect(data.profile).toBe('staging');
    const nodeIds = data.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('api-service');
  });

  test('impact redis --json', async () => {
    const data = await runJson('impact', 'redis');
    expect(data.service).toBe('redis');
    expect(data.totalBlastRadius).toBeGreaterThanOrEqual(1);
    const directIds = data.directDependents.map((d: any) => d.id);
    expect(directIds).toContain('api-service');
  });

  test('impact api-service --json', async () => {
    const data = await runJson('impact', 'api-service');
    expect(data.service).toBe('api-service');
    const directIds = data.directDependents.map((d: any) => d.id);
    expect(directIds).toContain('web-ui');
  });

  test('impact web-ui --json', async () => {
    const data = await runJson('impact', 'web-ui');
    expect(data.service).toBe('web-ui');
    expect(data.totalBlastRadius).toBe(0);
  });

  test('inspect config api-service --json', async () => {
    const data = await runJson('inspect', 'config', 'api-service');
    expect(data.serviceId).toBe('api-service');
    expect(data.dependencies).toContain('redis');
    expect(data.localUrl).toBe('http://localhost:3000');
  });

  test('inspect config with --profile staging --json', async () => {
    const data = await runJson('inspect', 'config', 'api-service', '--profile', 'staging');
    expect(data.serviceId).toBe('api-service');
    expect(data.profile).toBe('staging');
  });

  test('doctor --json', async () => {
    const data = await runJson('doctor');
    expect(data).toHaveProperty('binaries');
    expect(data).toHaveProperty('services');
    expect(Array.isArray(data.binaries)).toBe(true);
    expect(Array.isArray(data.services)).toBe(true);
  });

  test('version', async () => {
    const { stdout } = await run('version');
    expect(stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('--version flag', async () => {
    const { stdout } = await run('--version');
    expect(stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('--help flag', async () => {
    const { stdout } = await run('--help');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('orcha');
  });

  test('unknown command exits with error', async () => {
    try {
      await run('nonexistent-command');
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.stderr || err.message).toContain('Unknown command');
    }
  });
});
