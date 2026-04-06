import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfig } from '@orcha/config-loader';
import {
  readState,
  writeState,
  addProcess,
  removeProcess,
  getProcess,
  isProcessAlive,
  cleanStaleProcesses,
} from './state.js';

let tempDir: string;

const setupTempWorkspace = () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'orcha-state-test-'));
  const configPath = path.join(tempDir, 'orcha.config.yaml');
  writeFileSync(
    configPath,
    `version: 1\nworkspace:\n  name: test\nservices: {}\npresets: {}\ndefaults: {}\n`,
  );
  process.env.ORCHA_CONFIG = configPath;
  resetConfig();
};

beforeEach(() => {
  setupTempWorkspace();
});

afterEach(() => {
  delete process.env.ORCHA_CONFIG;
  resetConfig();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('state', () => {
  test('readState returns empty processes when no state file', () => {
    const state = readState();
    expect(state.processes).toEqual([]);
  });

  test('writeState and readState round-trip', () => {
    const state = {
      processes: [
        { serviceId: 'svc-a', profile: 'default', pid: 12345, startedAt: '2024-01-01T00:00:00Z', logFile: '/tmp/a.log' },
      ],
    };
    writeState(state);
    const loaded = readState();
    expect(loaded.processes).toHaveLength(1);
    expect(loaded.processes[0].serviceId).toBe('svc-a');
  });

  test('addProcess adds a new entry', () => {
    addProcess({ serviceId: 'svc-a', profile: 'default', pid: 111, startedAt: '2024-01-01', logFile: '/tmp/a.log' });
    const state = readState();
    expect(state.processes).toHaveLength(1);
    expect(state.processes[0].serviceId).toBe('svc-a');
  });

  test('addProcess replaces existing entry for same service', () => {
    addProcess({ serviceId: 'svc-a', profile: 'default', pid: 111, startedAt: '2024-01-01', logFile: '/tmp/a.log' });
    addProcess({ serviceId: 'svc-a', profile: 'staging', pid: 222, startedAt: '2024-01-02', logFile: '/tmp/a2.log' });
    const state = readState();
    expect(state.processes).toHaveLength(1);
    expect(state.processes[0].pid).toBe(222);
    expect(state.processes[0].profile).toBe('staging');
  });

  test('removeProcess removes an entry', () => {
    addProcess({ serviceId: 'svc-a', profile: 'default', pid: 111, startedAt: '2024-01-01', logFile: '/tmp/a.log' });
    addProcess({ serviceId: 'svc-b', profile: 'default', pid: 222, startedAt: '2024-01-01', logFile: '/tmp/b.log' });
    removeProcess('svc-a');
    const state = readState();
    expect(state.processes).toHaveLength(1);
    expect(state.processes[0].serviceId).toBe('svc-b');
  });

  test('getProcess returns entry for known service', () => {
    addProcess({ serviceId: 'svc-a', profile: 'default', pid: 111, startedAt: '2024-01-01', logFile: '/tmp/a.log' });
    const entry = getProcess('svc-a');
    expect(entry).toBeDefined();
    expect(entry!.pid).toBe(111);
  });

  test('getProcess returns undefined for unknown service', () => {
    expect(getProcess('nonexistent')).toBeUndefined();
  });

  test('isProcessAlive returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test('isProcessAlive returns false for non-existent PID', () => {
    // Use a very large PID unlikely to exist
    expect(isProcessAlive(9999999)).toBe(false);
  });

  test('cleanStaleProcesses removes dead processes', () => {
    // Add a process with a PID that does not exist
    addProcess({ serviceId: 'dead-svc', profile: 'default', pid: 9999999, startedAt: '2024-01-01', logFile: '/tmp/dead.log' });
    // Add a process with our own PID (alive)
    addProcess({ serviceId: 'live-svc', profile: 'default', pid: process.pid, startedAt: '2024-01-01', logFile: '/tmp/live.log' });
    cleanStaleProcesses();
    const state = readState();
    expect(state.processes).toHaveLength(1);
    expect(state.processes[0].serviceId).toBe('live-svc');
  });
});
