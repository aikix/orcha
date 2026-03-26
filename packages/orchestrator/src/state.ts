/**
 * Process state persistence — tracks which services orcha has started.
 * Stored in .orcha/state/processes.json relative to the workspace root.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getWorkspaceRoot } from '@orcha/config-loader';

export type ProcessEntry = {
  readonly serviceId: string;
  readonly profile: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly logFile: string;
};

export type ProcessState = {
  readonly processes: ProcessEntry[];
};

const getStateDir = (): string => {
  const dir = path.join(getWorkspaceRoot(), '.orcha', 'state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const getStatePath = (): string => path.join(getStateDir(), 'processes.json');

export const getLogDir = (): string => {
  const dir = path.join(getWorkspaceRoot(), '.orcha', 'state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

export const readState = (): ProcessState => {
  const statePath = getStatePath();
  if (!existsSync(statePath)) return { processes: [] };
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as ProcessState;
  } catch {
    return { processes: [] };
  }
};

export const writeState = (state: ProcessState): void => {
  writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf8');
};

export const addProcess = (entry: ProcessEntry): void => {
  const state = readState();
  // Remove any existing entry for same service
  const filtered = state.processes.filter((p) => p.serviceId !== entry.serviceId);
  writeState({ processes: [...filtered, entry] });
};

export const removeProcess = (serviceId: string): void => {
  const state = readState();
  writeState({ processes: state.processes.filter((p) => p.serviceId !== serviceId) });
};

export const getProcess = (serviceId: string): ProcessEntry | undefined => {
  return readState().processes.find((p) => p.serviceId === serviceId);
};

/**
 * Check if a PID is still running.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0); // signal 0 = just check
    return true;
  } catch {
    return false;
  }
};

/**
 * Clean up stale entries (processes that are no longer running).
 */
export const cleanStaleProcesses = (): void => {
  const state = readState();
  const alive = state.processes.filter((p) => isProcessAlive(p.pid));
  if (alive.length !== state.processes.length) {
    writeState({ processes: alive });
  }
};
