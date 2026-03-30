#!/usr/bin/env bun

/**
 * Build standalone binaries for all supported platforms.
 * Used by semantic-release during the prepare step.
 *
 * Usage: bun run scripts/build-binaries.ts [version]
 */

import { spawnSync } from 'bun';
import { mkdirSync, existsSync } from 'node:fs';

const version = process.argv[2] ?? 'dev';
const entryPoint = 'apps/cli/src/index.ts';
const distDir = 'dist';

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const targets = [
  { name: 'linux-x64', target: 'bun-linux-x64' },
  { name: 'darwin-arm64', target: 'bun-darwin-arm64' },
  { name: 'darwin-x64', target: 'bun-darwin-x64' },
];

console.log(`Building orcha v${version} for ${targets.length} platforms...\n`);

let failures = 0;

for (const { name, target } of targets) {
  const outfile = `${distDir}/orcha-${name}`;
  process.stdout.write(`  [${name}] building...`);

  const result = spawnSync([
    'bun', 'build', entryPoint,
    '--compile',
    '--minify',
    `--target=${target}`,
    `--outfile=${outfile}`,
  ]);

  if (result.exitCode === 0) {
    console.log(` done`);
  } else {
    console.log(` FAILED`);
    console.error(result.stderr.toString());
    failures++;
  }
}

console.log(`\nBuild complete: ${targets.length - failures}/${targets.length} succeeded`);

if (failures > 0) {
  process.exit(1);
}
