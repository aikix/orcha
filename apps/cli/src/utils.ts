/**
 * Pure utility functions extracted from the CLI for testability.
 */

import type { SeedFixture } from '@orcha/config-loader';

export type PrUrl = { host: string; owner: string; repo: string; number: number };

export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
};

export const getAssetName = (): string => {
  return `orcha-${process.platform}-${process.arch}`;
};

export const parsePrUrl = (url: string): PrUrl => {
  // https://github.com/org/repo/pull/123
  // https://git.example.com/team/service/pull/456
  const cleaned = url.replace(/\/+$/, '');
  const withProtocol = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
  const parsed = new URL(withProtocol);
  const parts = parsed.pathname.split('/').filter(Boolean);
  // parts: [owner, repo, 'pull', number]
  if (parts.length < 4 || parts[2] !== 'pull') {
    throw new Error(`Invalid PR URL: ${url}. Expected: https://host/owner/repo/pull/123`);
  }
  return {
    host: parsed.hostname,
    owner: parts[0],
    repo: parts[1],
    number: parseInt(parts[3], 10),
  };
};

export const topologicalSortFixtures = (fixtures: readonly SeedFixture[]): SeedFixture[] => {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const result: SeedFixture[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const fixture = byId.get(id);
    if (!fixture) return;
    for (const dep of fixture.dependsOn ?? []) {
      visit(dep);
    }
    result.push(fixture);
  };

  for (const f of fixtures) visit(f.id);
  return result;
};
