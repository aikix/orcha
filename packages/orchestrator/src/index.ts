/**
 * @orcha/orchestrator
 *
 * Start/stop services with dependency resolution, health gating, and process management.
 * Infra services use Docker Compose. Application services use script commands.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {
  resolveServiceDefinition,
  getPreset,
  getDefaults,
  getServiceDefinition,
  listAllServiceDefinitions,
  type ResolvedServiceDefinition,
} from '@orcha/config-loader';
import {
  readState,
  addProcess,
  removeProcess,
  isProcessAlive,
  cleanStaleProcesses,
  getLogDir,
  type ProcessEntry,
} from './state.js';

export { readState, cleanStaleProcesses, isProcessAlive, getLogDir } from './state.js';
export type { ProcessEntry } from './state.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Health probing
// ---------------------------------------------------------------------------

const probeTcp = (host: string, port: number, timeoutMs = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
};

const probeHttp = async (url: string, expectedStatus = 200, timeoutMs = 5000): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status === expectedStatus;
  } catch {
    return false;
  }
};

const probeService = async (resolved: ResolvedServiceDefinition): Promise<boolean> => {
  for (const hc of resolved.healthChecks) {
    if (hc.url.startsWith('tcp://')) {
      const [host, portStr] = hc.url.replace('tcp://', '').split(':');
      const ok = await probeTcp(host, parseInt(portStr, 10));
      if (!ok) return false;
    } else {
      const ok = await probeHttp(hc.url, hc.expectedStatus);
      if (!ok) return false;
    }
  }
  return resolved.healthChecks.length > 0;
};

/**
 * Wait for a service to become healthy, polling every interval.
 */
const waitForHealth = async (
  resolved: ResolvedServiceDefinition,
  timeoutMs = 60_000,
  intervalMs = 2000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeService(resolved)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
};

// ---------------------------------------------------------------------------
// Dependency resolution — topological sort
// ---------------------------------------------------------------------------

const collectDependencyOrder = (
  serviceId: string,
  profile: string | undefined,
  visited: Set<string>,
  order: string[],
): void => {
  if (visited.has(serviceId)) return;
  visited.add(serviceId);

  const resolved = resolveServiceDefinition(serviceId, profile);
  for (const dep of resolved.dependencies) {
    collectDependencyOrder(dep, undefined, visited, order); // deps use default profile
  }
  order.push(serviceId);
};

export const getStartOrder = (target: string, profile?: string): string[] => {
  const preset = getPreset(target);
  const topLevelServices = preset ? [...preset.services] : [target];

  const visited = new Set<string>();
  const order: string[] = [];
  for (const svcId of topLevelServices) {
    collectDependencyOrder(svcId, profile, visited, order);
  }
  return order;
};

// ---------------------------------------------------------------------------
// Start a service
// ---------------------------------------------------------------------------

export type StartResult = {
  serviceId: string;
  profile: string;
  pid: number;
  healthy: boolean;
  error?: string;
};

const startComposeService = async (
  resolved: ResolvedServiceDefinition,
): Promise<{ pid: number }> => {
  if (resolved.runtime.type !== 'compose') throw new Error('Not a compose service');
  const { composeFile, projectName, services } = resolved.runtime;

  const composeArgs = [
    'compose',
    '-f', composeFile,
    '-p', projectName,
    'up', '-d',
    ...(services ?? []),
  ];

  await execFileAsync('docker', composeArgs, {
    cwd: resolved.workingDirectory,
    timeout: 60_000,
  });

  // Docker Compose doesn't give us a single PID — use a sentinel
  return { pid: -1 };
};

const startScriptService = async (
  resolved: ResolvedServiceDefinition,
): Promise<{ pid: number; logFile: string }> => {
  if (resolved.runtime.type !== 'script') throw new Error('Not a script service');
  const { command } = resolved.runtime;

  const logFile = path.join(getLogDir(), `${resolved.id}.log`);
  const logStream = createWriteStream(logFile, { flags: 'w' });

  // Build env from resolved config
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...resolved.env,
    NODE_ENV: resolved.env.NODE_ENV ?? 'development',
  };

  const child = spawn(command.bin, [...command.args], {
    cwd: resolved.workingDirectory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.unref();

  return { pid: child.pid!, logFile };
};

export const startService = async (
  serviceId: string,
  profile: string | undefined,
  callbacks?: {
    onStarting?: (id: string, profile: string) => void;
    onHealthWait?: (id: string) => void;
    onHealthy?: (id: string) => void;
    onFailed?: (id: string, error: string) => void;
  },
): Promise<StartResult> => {
  const resolved = resolveServiceDefinition(serviceId, profile);
  const activeProfile = resolved.profile;

  callbacks?.onStarting?.(serviceId, activeProfile);

  try {
    let pid: number;
    let logFile = '';

    if (resolved.runtime.type === 'compose') {
      const result = await startComposeService(resolved);
      pid = result.pid;
      logFile = `docker compose -p ${resolved.runtime.projectName}`;
    } else {
      const result = await startScriptService(resolved);
      pid = result.pid;
      logFile = result.logFile;
    }

    // Persist state
    addProcess({
      serviceId,
      profile: activeProfile,
      pid,
      startedAt: new Date().toISOString(),
      logFile,
    });

    // Wait for health
    if (resolved.healthChecks.length > 0) {
      callbacks?.onHealthWait?.(serviceId);
      const healthy = await waitForHealth(resolved, 60_000, 2000);
      if (healthy) {
        callbacks?.onHealthy?.(serviceId);
        return { serviceId, profile: activeProfile, pid, healthy: true };
      } else {
        callbacks?.onFailed?.(serviceId, 'health check timeout');
        return { serviceId, profile: activeProfile, pid, healthy: false, error: 'health check timeout' };
      }
    }

    // No health checks — assume success after a brief delay
    await new Promise((r) => setTimeout(r, resolved.postStartDelayMs ?? 1000));
    callbacks?.onHealthy?.(serviceId);
    return { serviceId, profile: activeProfile, pid, healthy: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    callbacks?.onFailed?.(serviceId, message);
    return { serviceId, profile: activeProfile, pid: -1, healthy: false, error: message };
  }
};

// ---------------------------------------------------------------------------
// Stop a service
// ---------------------------------------------------------------------------

export const stopService = async (serviceId: string): Promise<boolean> => {
  const resolved = resolveServiceDefinition(serviceId);

  if (resolved.runtime.type === 'compose') {
    const { composeFile, projectName } = resolved.runtime;
    try {
      await execFileAsync('docker', [
        'compose', '-f', composeFile, '-p', projectName, 'down',
      ], { cwd: resolved.workingDirectory, timeout: 30_000 });
    } catch { /* best effort */ }
    removeProcess(serviceId);
    return true;
  }

  // Script service — kill the process tree
  const state = readState();
  const entry = state.processes.find((p) => p.serviceId === serviceId);
  if (entry && entry.pid > 0) {
    try {
      // Kill the process group (negative PID kills the group)
      process.kill(-entry.pid, 'SIGTERM');
    } catch {
      try { process.kill(entry.pid, 'SIGTERM'); } catch { /* already dead */ }
    }
  }
  removeProcess(serviceId);
  return true;
};

export const stopAll = async (): Promise<string[]> => {
  cleanStaleProcesses();
  const state = readState();
  const stopped: string[] = [];
  for (const entry of state.processes) {
    await stopService(entry.serviceId);
    stopped.push(entry.serviceId);
  }
  return stopped;
};

// ---------------------------------------------------------------------------
// Start a preset or service with all dependencies
// ---------------------------------------------------------------------------

export const startStack = async (
  target: string,
  profile: string | undefined,
  callbacks?: {
    onStarting?: (id: string, profile: string) => void;
    onHealthWait?: (id: string) => void;
    onHealthy?: (id: string) => void;
    onFailed?: (id: string, error: string) => void;
  },
): Promise<StartResult[]> => {
  const order = getStartOrder(target, profile);
  const results: StartResult[] = [];

  for (const serviceId of order) {
    // Skip if already running and healthy
    const existing = readState().processes.find((p) => p.serviceId === serviceId);
    if (existing && isProcessAlive(existing.pid)) {
      const resolved = resolveServiceDefinition(serviceId);
      const healthy = await probeService(resolved);
      if (healthy) {
        results.push({ serviceId, profile: existing.profile, pid: existing.pid, healthy: true });
        continue;
      }
    }

    // Use the specified profile only for top-level services in the preset
    const preset = getPreset(target);
    const isTopLevel = preset ? preset.services.includes(serviceId) : serviceId === target;
    const svcProfile = isTopLevel ? profile : undefined;

    const result = await startService(serviceId, svcProfile, callbacks);
    results.push(result);

    if (!result.healthy) {
      // Stop on first failure — downstream services would fail anyway
      break;
    }
  }

  return results;
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type ServiceStatus = {
  serviceId: string;
  state: 'READY' | 'RUNNING' | 'STOPPED' | 'UNKNOWN';
  pid: number | null;
  profile: string | null;
  url: string;
  startedAt: string | null;
};

export const getStatus = async (): Promise<ServiceStatus[]> => {
  cleanStaleProcesses();
  const state = readState();
  const allServices = listAllServiceDefinitions();
  const results: ServiceStatus[] = [];

  for (const svc of allServices) {
    const entry = state.processes.find((p) => p.serviceId === svc.id);

    if (!entry) {
      results.push({ serviceId: svc.id, state: 'STOPPED', pid: null, profile: null, url: svc.localUrl, startedAt: null });
      continue;
    }

    const alive = entry.pid > 0 ? isProcessAlive(entry.pid) : true; // compose services use pid -1
    if (!alive) {
      removeProcess(svc.id);
      results.push({ serviceId: svc.id, state: 'STOPPED', pid: null, profile: null, url: svc.localUrl, startedAt: null });
      continue;
    }

    // Check health
    const resolved = resolveServiceDefinition(svc.id);
    const healthy = await probeService(resolved);

    results.push({
      serviceId: svc.id,
      state: healthy ? 'READY' : 'RUNNING',
      pid: entry.pid > 0 ? entry.pid : null,
      profile: entry.profile,
      url: svc.localUrl,
      startedAt: entry.startedAt,
    });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export const getLogFile = (serviceId: string): string | null => {
  const state = readState();
  const entry = state.processes.find((p) => p.serviceId === serviceId);
  if (!entry) return null;
  if (entry.logFile.startsWith('docker')) return null; // compose logs handled differently
  return existsSync(entry.logFile) ? entry.logFile : null;
};

export const readLogTail = (serviceId: string, lines = 50): string | null => {
  const logFile = getLogFile(serviceId);
  if (!logFile) return null;
  const content = readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
};
