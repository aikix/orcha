#!/usr/bin/env bun

/**
 * orcha CLI — agent-first multi-repo orchestration tool
 *
 * Design: CLI does plumbing (clone, scan, write files).
 * Agent skills do the thinking (analyze, infer, configure).
 * All commands support --json for structured agent consumption.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  parseOrgUrl,
  listOrgRepos,
  discover,
  writeConfig,
  type RepoInfo,
} from '@orcha/discovery';
import {
  getServiceDefinition,
  resolveServiceDefinition,
  listAllServiceDefinitions,
  listServiceDefinitions,
  getPreset,
  listPresets,
  getDefaults,
  loadConfig,
  canonicalizeServiceId,
  type ServiceDefinition,
} from '@orcha/config-loader';

const execFileAsync = promisify(execFile);

const printHelp = () => {
  console.log(`Usage:
  orcha [command]

Setup:
  init <org-url> [workspace-dir]   Diff remote org vs local workspace
  list-repos <org-url>             List repos in a GitHub org
  scan <org-url> [--all]           Shallow clone + analyze repos
  clone <org-url> [repos...]       Clone repos into workspace
  generate-config <org-url>        Regex-based config fallback

Workspace:
  list services                    List all registered services
  list presets                     List stack presets
  graph [preset|service]           Show dependency graph
  doctor                           Check binaries and service health
  inspect config <service>         Show resolved service configuration

Flags:
  --profile <name>                 Profile for graph/up/inspect
  --all                            Include all repos (skip selection)
  --json                           Machine-readable JSON output
  --help, -h                       Show this help

Examples:
  orcha init https://github.com/my-org ~/Workspace/myteam
  orcha graph core --profile staging
  orcha list services --json`);
};

// ---------------------------------------------------------------------------
// init: Diff remote org against local workspace, then scan
// ---------------------------------------------------------------------------
const runInit = async (
  orgUrlString: string,
  workspaceDir: string,
  jsonOutput: boolean,
  includeAll: boolean,
) => {
  const orgUrl = parseOrgUrl(orgUrlString);

  // Ensure workspace dir exists
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
    if (!jsonOutput) console.log(`Created workspace: ${workspaceDir}`);
  }

  if (!jsonOutput) console.log(`\nScanning ${orgUrl.host}/${orgUrl.org}...`);

  const remoteRepos = await listOrgRepos(orgUrl);

  // Diff against local workspace
  const localDirs = new Set(
    readdirSync(workspaceDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name),
  );

  const remoteNames = new Set(remoteRepos.map((r) => r.name));

  type RepoDiffEntry = {
    name: string;
    status: 'present' | 'missing' | 'local-only';
    repo?: RepoInfo;
    localPath?: string;
  };

  const diff: RepoDiffEntry[] = [];

  // Repos in remote org
  for (const repo of remoteRepos) {
    if (localDirs.has(repo.name)) {
      diff.push({
        name: repo.name,
        status: 'present',
        repo,
        localPath: path.join(workspaceDir, repo.name),
      });
    } else {
      diff.push({ name: repo.name, status: 'missing', repo });
    }
  }

  // Dirs only local (not in remote org)
  for (const dirName of localDirs) {
    if (!remoteNames.has(dirName)) {
      diff.push({
        name: dirName,
        status: 'local-only',
        localPath: path.join(workspaceDir, dirName),
      });
    }
  }

  const present = diff.filter((d) => d.status === 'present');
  const missing = diff.filter((d) => d.status === 'missing');
  const localOnly = diff.filter((d) => d.status === 'local-only');

  if (jsonOutput) {
    console.log(JSON.stringify({
      orgUrl,
      workspaceDir,
      diff,
      summary: {
        remoteRepos: remoteRepos.length,
        present: present.length,
        missing: missing.length,
        localOnly: localOnly.length,
      },
    }, null, 2));
  } else {
    console.log(`\nWorkspace: ${workspaceDir}`);
    console.log(`Remote: ${remoteRepos.length} repos | Local: ${localDirs.size} dirs\n`);

    if (present.length > 0) {
      console.log(`  Present (${present.length}):`);
      for (const d of present) {
        const lang = d.repo?.language ?? '-';
        console.log(`    ✓ ${d.name.padEnd(30)} ${lang}`);
      }
    }

    if (missing.length > 0) {
      console.log(`\n  Missing from workspace (${missing.length}):`);
      for (const d of missing) {
        const lang = d.repo?.language ?? '-';
        const desc = d.repo?.description?.slice(0, 40) ?? '';
        console.log(`    ✗ ${d.name.padEnd(30)} ${lang.padEnd(12)} ${desc}`);
      }
    }

    if (localOnly.length > 0) {
      console.log(`\n  Local only — not in org (${localOnly.length}):`);
      for (const d of localOnly) {
        console.log(`    ? ${d.name}`);
      }
    }

    console.log(`\nUse /orcha-init in Claude Code for agent-powered setup.`);
    console.log(`The agent will ask which missing repos to clone and generate orcha.config.yaml.`);
  }
};

// ---------------------------------------------------------------------------
// list-repos
// ---------------------------------------------------------------------------
const runListRepos = async (orgUrlString: string, jsonOutput: boolean) => {
  const orgUrl = parseOrgUrl(orgUrlString);
  const repos = await listOrgRepos(orgUrl);

  if (jsonOutput) {
    console.log(JSON.stringify({ orgUrl, repos }, null, 2));
  } else {
    console.log(`\n${orgUrl.host}/${orgUrl.org} — ${repos.length} repos\n`);
    console.log(`  # | Name                          | Lang       | Last Push  | Description`);
    console.log(`  --|-------------------------------|------------|------------|---------------------------`);
    repos.forEach((repo, i) => {
      const num = String(i + 1).padStart(3);
      const name = repo.name.padEnd(29);
      const lang = (repo.language ?? '-').padEnd(10);
      const pushed = repo.pushedAt.slice(0, 10);
      const desc = (repo.description ?? '').slice(0, 25);
      console.log(`  ${num} | ${name} | ${lang} | ${pushed} | ${desc}`);
    });
  }
};

// ---------------------------------------------------------------------------
// clone
// ---------------------------------------------------------------------------
const runClone = async (
  orgUrlString: string,
  repoNames: string[],
  workspaceDir: string,
  jsonOutput: boolean,
) => {
  const orgUrl = parseOrgUrl(orgUrlString);
  const allRepos = await listOrgRepos(orgUrl);

  const toClone = repoNames.length > 0
    ? allRepos.filter((r) => repoNames.includes(r.name))
    : allRepos;

  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  const results: Array<{ name: string; path: string; status: 'cloned' | 'exists' | 'error'; error?: string }> = [];

  for (const repo of toClone) {
    const targetDir = path.join(workspaceDir, repo.name);
    if (existsSync(targetDir)) {
      results.push({ name: repo.name, path: targetDir, status: 'exists' });
      if (!jsonOutput) console.log(`  [exists] ${repo.name}`);
      continue;
    }

    try {
      await execFileAsync('git', ['clone', repo.cloneUrl, targetDir], { timeout: 120_000 });
      results.push({ name: repo.name, path: targetDir, status: 'cloned' });
      if (!jsonOutput) console.log(`  [cloned] ${repo.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: repo.name, path: targetDir, status: 'error', error: message });
      if (!jsonOutput) console.log(`  [error]  ${repo.name}: ${message}`);
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ workspaceDir, results }, null, 2));
  } else {
    const cloned = results.filter((r) => r.status === 'cloned').length;
    const existing = results.filter((r) => r.status === 'exists').length;
    console.log(`\n${cloned} cloned, ${existing} already existed`);
  }
};

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------
const runScan = async (orgUrlString: string, includeAll: boolean, jsonOutput: boolean) => {
  const orgUrl = parseOrgUrl(orgUrlString);

  if (!jsonOutput) console.log(`Scanning ${orgUrl.host}/${orgUrl.org}...`);

  const repos = await listOrgRepos(orgUrl);
  if (!jsonOutput) console.log(`Found ${repos.length} repos. Analyzing...`);

  const result = await discover(orgUrlString, repos, orgUrl.org, {
    onRepoAnalyzing: (repo, idx, total) => {
      if (!jsonOutput) process.stdout.write(`  [${idx + 1}/${total}] ${repo.name}...`);
    },
    onRepoAnalyzed: (analyzed) => {
      if (!jsonOutput) {
        const ports = [...analyzed.ports, ...analyzed.configPorts].map((p) => `${p.port}(${p.source})`).join(', ') || 'none';
        console.log(` ${analyzed.classification} | ports: ${ports}`);
      }
    },
  });

  if (jsonOutput) {
    console.log(JSON.stringify({
      orgUrl: result.orgUrl,
      repos: result.analyzed.map((a) => ({
        name: a.name,
        description: a.repoInfo.description,
        language: a.repoInfo.language,
        classification: a.classification,
        scripts: a.scripts,
        ports: a.ports,
        configPorts: a.configPorts,
        hasDev: a.hasDev,
        hasStart: a.hasStart,
        hasTest: a.hasTest,
        hasDockerfile: a.hasDockerfile,
        hasDockerCompose: a.hasDockerCompose,
        dockerComposeServices: a.dockerComposeServices,
        dependencies: a.dependencies,
        envVarHints: a.envVarHints,
      })),
      detectedDependencies: result.dependencies,
    }, null, 2));
  } else {
    const services = result.analyzed.filter((a) => a.classification === 'service').length;
    const infra = result.analyzed.filter((a) => a.classification === 'infra').length;
    const libs = result.analyzed.filter((a) => a.classification === 'library').length;
    console.log(`\nSummary: ${services} services, ${infra} infra, ${libs} libraries`);
    console.log(`Dependencies: ${result.dependencies.length} detected`);
  }
};

// ---------------------------------------------------------------------------
// doctor: Check binaries and service health
// ---------------------------------------------------------------------------
const checkBinary = async (name: string): Promise<{ name: string; ok: boolean; version: string }> => {
  try {
    const { stdout } = await execFileAsync(name, ['--version'], { timeout: 5_000 });
    return { name, ok: true, version: stdout.trim().split('\n')[0] };
  } catch {
    return { name, ok: false, version: 'not found' };
  }
};

const probeHealth = async (url: string, expectedStatus?: number): Promise<{ ok: boolean; status: number | null; error?: string }> => {
  if (url.startsWith('tcp://')) {
    // TCP probe
    const hostPort = url.replace('tcp://', '').split(':');
    const host = hostPort[0];
    const port = parseInt(hostPort[1], 10);
    return new Promise((resolve) => {
      const net = require('node:net') as typeof import('node:net');
      const socket = net.createConnection({ host, port, timeout: 3000 });
      socket.on('connect', () => { socket.destroy(); resolve({ ok: true, status: null }); });
      socket.on('error', (err: Error) => { resolve({ ok: false, status: null, error: err.message }); });
      socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, status: null, error: 'timeout' }); });
    });
  }

  // HTTP probe
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const expected = expectedStatus ?? 200;
    return { ok: response.status === expected, status: response.status };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
};

const runDoctor = async (jsonOutput: boolean) => {
  const config = loadConfig();
  const onboard = config.onboard ?? { binaries: ['bun', 'docker', 'gh'] };
  const binaries = onboard.binaries ?? ['bun', 'docker', 'gh'];

  // Check binaries
  const binaryResults = await Promise.all(binaries.map(checkBinary));

  // Check service health
  const services = listAllServiceDefinitions();
  type ServiceHealth = { id: string; kind: string; url: string; checks: Array<{ name: string; ok: boolean; detail: string }> };
  const serviceResults: ServiceHealth[] = [];

  for (const svc of services) {
    if (svc.healthChecks.length === 0) {
      serviceResults.push({ id: svc.id, kind: svc.kind, url: svc.localUrl, checks: [] });
      continue;
    }

    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    for (const hc of svc.healthChecks) {
      const result = await probeHealth(hc.url, hc.expectedStatus);
      checks.push({
        name: hc.name,
        ok: result.ok,
        detail: result.ok
          ? (result.status ? `${result.status}` : 'connected')
          : (result.error ?? `status ${result.status}`),
      });
    }
    serviceResults.push({ id: svc.id, kind: svc.kind, url: svc.localUrl, checks });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ binaries: binaryResults, services: serviceResults }, null, 2));
  } else {
    console.log(`\nBinaries:`);
    for (const b of binaryResults) {
      const icon = b.ok ? '✓' : '✗';
      console.log(`  ${icon} ${b.name.padEnd(10)} ${b.version}`);
    }

    console.log(`\nServices:`);
    console.log(`  ${'SERVICE'.padEnd(32)} ${'STATE'.padEnd(10)} URL`);
    console.log(`  ${''.padEnd(32, '-')} ${''.padEnd(10, '-')} ${''.padEnd(40, '-')}`);
    for (const svc of serviceResults) {
      const allOk = svc.checks.length > 0 && svc.checks.every((c) => c.ok);
      const anyCheck = svc.checks.length > 0;
      const state = !anyCheck ? 'n/a' : allOk ? 'READY' : 'STOPPED';
      console.log(`  ${svc.id.padEnd(32)} ${state.padEnd(10)} ${svc.url}`);
    }
  }
};

// ---------------------------------------------------------------------------
// graph: Show dependency graph for a preset or service
// ---------------------------------------------------------------------------
const collectDependencies = (serviceId: string, profile: string | undefined, visited: Set<string>): void => {
  if (visited.has(serviceId)) return;
  visited.add(serviceId);

  const resolved = resolveServiceDefinition(serviceId, profile);
  for (const dep of resolved.dependencies) {
    collectDependencies(dep, undefined, visited); // deps use their own default profile
  }
};

const runGraph = (target: string, profile: string | undefined, jsonOutput: boolean) => {
  // Determine if target is a preset or service
  const preset = getPreset(target);
  const topLevelServices = preset ? preset.services : [target];

  // Collect all dependencies recursively
  const allServiceIds = new Set<string>();
  for (const svcId of topLevelServices) {
    collectDependencies(svcId, profile, allServiceIds);
  }

  // Build graph entries
  type GraphNode = { id: string; label: string; kind: string; dependencies: string[]; referenceDeps: string[] };
  const nodes: GraphNode[] = [];

  for (const id of allServiceIds) {
    const resolved = resolveServiceDefinition(id, topLevelServices.includes(id) ? profile : undefined);
    nodes.push({
      id: resolved.id,
      label: resolved.label,
      kind: resolved.kind,
      dependencies: [...resolved.dependencies],
      referenceDeps: [...(resolved.referenceDeps ?? [])],
    });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      target,
      profile: profile ?? 'default',
      preset: preset ? { id: preset.id, description: preset.description } : null,
      nodes,
    }, null, 2));
  } else {
    const presetLabel = preset ? ` (preset: ${preset.description})` : '';
    const profileLabel = profile ? ` --profile ${profile}` : '';
    console.log(`\nDependency Graph: ${target}${profileLabel}${presetLabel}`);
    console.log(`Nodes: ${nodes.length}\n`);

    // Table
    const nameWidth = Math.max(28, ...nodes.map((n) => n.id.length + 2));
    console.log(`  ${'SERVICE'.padEnd(nameWidth)} DEPENDENCIES`);
    console.log(`  ${''.padEnd(nameWidth, '-')} ${''.padEnd(50, '-')}`);

    for (const node of nodes) {
      const deps = node.dependencies.length > 0 ? node.dependencies.join(', ') : 'none';
      const refs = node.referenceDeps.length > 0 ? ` + ${node.referenceDeps.map((r) => `${r} (ref)`).join(', ')}` : '';
      console.log(`  ${node.id.padEnd(nameWidth)} ${deps}${refs}`);
    }
  }
};

// ---------------------------------------------------------------------------
// list: List services or presets
// ---------------------------------------------------------------------------
const runList = (subcommand: string, jsonOutput: boolean) => {
  if (subcommand === 'services') {
    const services = listAllServiceDefinitions();
    if (jsonOutput) {
      console.log(JSON.stringify(services.map((s) => ({
        id: s.id, label: s.label, kind: s.kind, localUrl: s.localUrl,
      })), null, 2));
    } else {
      console.log(`\n  ${'SERVICE'.padEnd(30)} ${'KIND'.padEnd(10)} URL`);
      console.log(`  ${''.padEnd(30, '-')} ${''.padEnd(10, '-')} ${''.padEnd(30, '-')}`);
      for (const s of services) {
        console.log(`  ${s.id.padEnd(30)} ${s.kind.padEnd(10)} ${s.localUrl}`);
      }
    }
  } else if (subcommand === 'presets') {
    const presets = listPresets();
    if (jsonOutput) {
      console.log(JSON.stringify(presets, null, 2));
    } else {
      console.log(`\n  ${'PRESET'.padEnd(20)} ${'SERVICES'.padEnd(30)} DESCRIPTION`);
      console.log(`  ${''.padEnd(20, '-')} ${''.padEnd(30, '-')} ${''.padEnd(30, '-')}`);
      for (const p of presets) {
        console.log(`  ${p.id.padEnd(20)} ${p.services.join(', ').padEnd(30)} ${p.description}`);
      }
    }
  } else {
    console.error(`Unknown list target: ${subcommand}. Use: services, presets`);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------
// inspect config: Show resolved service configuration
// ---------------------------------------------------------------------------
const runInspectConfig = (serviceId: string, profile: string | undefined, jsonOutput: boolean) => {
  const resolved = resolveServiceDefinition(serviceId, profile);

  if (jsonOutput) {
    console.log(JSON.stringify({
      serviceId: resolved.id,
      profile: resolved.profile,
      runtime: resolved.runtime,
      localUrl: resolved.localUrl,
      dependencies: resolved.dependencies,
      referenceDeps: resolved.referenceDeps ?? [],
      healthChecks: resolved.healthChecks,
      env: resolved.env,
      nodeConfig: resolved.nodeConfig,
    }, null, 2));
  } else {
    console.log(`\nService: ${resolved.id} (${resolved.label})`);
    console.log(`Profile: ${resolved.profile}`);
    console.log(`Kind:    ${resolved.kind}`);
    console.log(`URL:     ${resolved.localUrl}`);
    console.log(`Runtime: ${resolved.runtime.type === 'script' ? `${resolved.runtime.command.bin} ${resolved.runtime.command.args.join(' ')}` : `compose: ${(resolved.runtime as any).composeFile}`}`);

    if (resolved.dependencies.length > 0) {
      console.log(`\nDependencies: ${resolved.dependencies.join(', ')}`);
    }
    if (resolved.referenceDeps && resolved.referenceDeps.length > 0) {
      console.log(`Reference deps: ${resolved.referenceDeps.join(', ')}`);
    }

    if (resolved.healthChecks.length > 0) {
      console.log(`\nHealth checks:`);
      for (const hc of resolved.healthChecks) {
        console.log(`  ${hc.name}: ${hc.url}${hc.expectedStatus ? ` (${hc.expectedStatus})` : ''}`);
      }
    }

    if (Object.keys(resolved.env).length > 0) {
      console.log(`\nEnvironment:`);
      for (const [key, value] of Object.entries(resolved.env)) {
        if (key === 'NODE_CONFIG') {
          console.log(`  NODE_CONFIG: (see nodeConfig below)`);
        } else {
          console.log(`  ${key}=${value}`);
        }
      }
    }

    if (Object.keys(resolved.nodeConfig).length > 0) {
      console.log(`\nNode config:`);
      console.log(`  ${JSON.stringify(resolved.nodeConfig, null, 2).split('\n').join('\n  ')}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const jsonOutput = args.includes('--json');
  const includeAll = args.includes('--all');

  // Filter out flags and their values to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (['--workspace', '--json', '--all', '--help', '--profile'].includes(args[i])) {
        // flags that take a value — skip next arg too
        if (args[i] === '--workspace' || args[i] === '--profile') i++;
      }
      continue;
    }
    positional.push(args[i]);
  }

  switch (command) {
    case 'init': {
      const orgUrl = positional[1];
      if (!orgUrl) {
        console.error('Usage: orcha init <org-url> [workspace-dir]');
        process.exit(1);
      }
      // If workspace-dir not provided, create ./<org-name>/ from the org URL
      const orgName = parseOrgUrl(orgUrl).org;
      const workspaceDir = positional[2]
        ? path.resolve(positional[2])
        : path.resolve(process.cwd(), orgName);
      await runInit(orgUrl, workspaceDir, jsonOutput, includeAll);
      break;
    }

    case 'list-repos': {
      const orgUrl = positional[1];
      if (!orgUrl) { console.error('Usage: orcha list-repos <org-url>'); process.exit(1); }
      await runListRepos(orgUrl, jsonOutput);
      break;
    }

    case 'clone': {
      const orgUrl = positional[1];
      if (!orgUrl) { console.error('Usage: orcha clone <org-url> [repo1 repo2 ...] --workspace <dir>'); process.exit(1); }
      const wsIdx = args.indexOf('--workspace');
      const wsDir = wsIdx >= 0 ? path.resolve(args[wsIdx + 1]) : path.resolve(process.cwd(), parseOrgUrl(orgUrl).org);
      const repoNames = includeAll ? [] : positional.slice(2);
      await runClone(orgUrl, repoNames, wsDir, jsonOutput);
      break;
    }

    case 'scan': {
      const orgUrl = positional[1];
      if (!orgUrl) { console.error('Usage: orcha scan <org-url>'); process.exit(1); }
      await runScan(orgUrl, includeAll, jsonOutput);
      break;
    }

    case 'generate-config': {
      const orgUrl = positional[1];
      if (!orgUrl) { console.error('Usage: orcha generate-config <org-url>'); process.exit(1); }
      const repos = await listOrgRepos(parseOrgUrl(orgUrl));
      const result = await discover(orgUrl, repos, parseOrgUrl(orgUrl).org);
      const outputPath = writeConfig(result.configYaml, process.cwd());
      console.log(`Config written to: ${outputPath}`);
      break;
    }

    case 'graph': {
      const target = positional[1] ?? getDefaults().upTarget ?? 'all';
      const profileIdx = args.indexOf('--profile');
      const profile = profileIdx >= 0 ? args[profileIdx + 1] : undefined;
      runGraph(target, profile, jsonOutput);
      break;
    }

    case 'inspect': {
      const sub = positional[1];
      if (sub !== 'config') { console.error('Usage: orcha inspect config <service> [--profile <name>]'); process.exit(1); }
      const svcId = positional[2];
      if (!svcId) { console.error('Usage: orcha inspect config <service>'); process.exit(1); }
      const profIdx = args.indexOf('--profile');
      const prof = profIdx >= 0 ? args[profIdx + 1] : undefined;
      runInspectConfig(svcId, prof, jsonOutput);
      break;
    }

    case 'doctor': {
      await runDoctor(jsonOutput);
      break;
    }

    case 'list': {
      const subcommand = positional[1];
      if (!subcommand) { console.error('Usage: orcha list <services|presets>'); process.exit(1); }
      runList(subcommand, jsonOutput);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
};

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
