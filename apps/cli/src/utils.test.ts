import { describe, test, expect } from 'bun:test';
import { compareVersions, parsePrUrl, topologicalSortFixtures, getAssetName } from './utils.js';
import type { SeedFixture } from '@orcha/config-loader';

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test('major greater returns 1', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  test('minor less returns -1', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
  });

  test('patch greater returns 1', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
  });

  test('missing segment treated as 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});

describe('parsePrUrl', () => {
  test('parses github.com PR URL', () => {
    const result = parsePrUrl('https://github.com/my-org/my-repo/pull/42');
    expect(result).toEqual({ host: 'github.com', owner: 'my-org', repo: 'my-repo', number: 42 });
  });

  test('parses GHE PR URL', () => {
    const result = parsePrUrl('https://git.corp.com/team/service/pull/99');
    expect(result).toEqual({ host: 'git.corp.com', owner: 'team', repo: 'service', number: 99 });
  });

  test('handles URL without protocol', () => {
    const result = parsePrUrl('github.com/org/repo/pull/7');
    expect(result).toEqual({ host: 'github.com', owner: 'org', repo: 'repo', number: 7 });
  });

  test('throws on invalid URL', () => {
    expect(() => parsePrUrl('https://github.com/org/repo')).toThrow('Invalid PR URL');
  });
});

describe('topologicalSortFixtures', () => {
  test('sorts fixtures with dependencies', () => {
    const fixtures: SeedFixture[] = [
      { id: 'b', label: 'B', targetService: 's', method: 'POST', url: 'http://x', expectedStatus: 201, dependsOn: ['a'] },
      { id: 'a', label: 'A', targetService: 's', method: 'POST', url: 'http://x', expectedStatus: 201 },
    ];
    const sorted = topologicalSortFixtures(fixtures);
    expect(sorted.map((f) => f.id)).toEqual(['a', 'b']);
  });

  test('preserves order when no dependencies', () => {
    const fixtures: SeedFixture[] = [
      { id: 'x', label: 'X', targetService: 's', method: 'POST', url: 'http://x', expectedStatus: 200 },
      { id: 'y', label: 'Y', targetService: 's', method: 'POST', url: 'http://y', expectedStatus: 200 },
    ];
    const sorted = topologicalSortFixtures(fixtures);
    expect(sorted.map((f) => f.id)).toEqual(['x', 'y']);
  });
});

describe('getAssetName', () => {
  test('returns orcha-<platform>-<arch>', () => {
    const name = getAssetName();
    expect(name).toMatch(/^orcha-\w+-\w+$/);
  });
});
