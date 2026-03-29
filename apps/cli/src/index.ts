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
import { c, icon, summaryLine, isBotCommit } from './format.js';
import {
  parseOrgUrl,
  listOrgRepos,
  discover,
  discoverLocal,
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
  getWorkspaceRoot,
  canonicalizeServiceId,
  listFixtures,
  getFixture,
  listFlowScenarios,
  getFlowScenario,
  type ServiceDefinition,
  type SeedFixture,
  type VerificationProbe,
  type FlowStep,
} from '@orcha/config-loader';
import {
  startStack,
  stopService,
  stopAll,
  getStatus,
  readLogTail,
  getStartOrder,
} from '@orcha/orchestrator';

const execFileAsync = promisify(execFile);

const printHelp = () => {
  console.log(`Usage:
  orcha [command]

Setup:
  init [org-url] [workspace-dir]   Init workspace (org URL, local dir, or both)
  init <workspace-dir>             Scan existing local workspace (no GitHub needed)
  list-repos <org-url>             List repos in a GitHub org
  scan <org-url> [--all]           Shallow clone + analyze repos
  clone <org-url> [repos...]       Clone repos into workspace
  generate-config <org-url>        Regex-based config fallback

Stack:
  up [preset|service] [--profile]  Start services with dependency resolution
  down [service]                   Stop a service or all managed services
  status                           Show running service statuses
  logs <service> [lines]           Tail service logs

Workspace:
  list services                    List all registered services from config
  list presets                     List stack presets (named service groups)
  graph [preset|service]           Show dependency graph (which services depend on which)
  impact <service>                 Blast radius: what breaks if this service goes down
  doctor                           Check prerequisite binaries + service health
  inspect config <service>         Show resolved config after profile merge
  verify stack                     Health check all services (HTTP/TCP probes)
  verify api [service]             Run API contract probes (status + response keys)
  verify flow [scenario]           Run multi-step cross-service flow scenarios
  seed [fixture...]                Insert test data via HTTP (with dependency ordering)

Knowledge:
  kb list [service]                List KB documents (markdown docs per service)
  kb status                        Show KB freshness (last updated per service)

Code Intelligence:
  pr list [--since <window>]       List PRs across all repos via GitHub CLI (default: 2w)
  pr context <pr-url>              Full PR context: diff, comments, reviews, files
  delta scan [--since <window>]    Scan local git commits across repos (default: 1w)

Flags:
  --profile <name>                 Profile for graph/up/inspect
  --all                            Include all repos (skip selection)
  --json                           Machine-readable JSON output
  --brief                          Concise one-line summary (for agent display)
  --no-color                       Disable colored output (also: NO_COLOR env)
  --help, -h                       Show this help

Examples:
  orcha init https://github.com/my-org              Scan org, diff against ./<org>/
  orcha init https://github.com/my-org ~/Workspace   Scan org, diff against existing dir
  orcha init ~/Workspace/myteam                      Scan existing local workspace
  orcha init                                         Scan current directory
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
// init (local): Scan an existing workspace directory without GitHub API
// ---------------------------------------------------------------------------
const runInitLocal = async (
  workspaceDir: string,
  jsonOutput: boolean,
) => {
  if (!existsSync(workspaceDir)) {
    console.error(`Directory not found: ${workspaceDir}`);
    process.exit(1);
  }

  if (!jsonOutput) console.log(`\nScanning local workspace: ${workspaceDir}...`);

  const result = await discoverLocal(workspaceDir, {
    onRepoAnalyzing: (name, idx, total) => {
      if (!jsonOutput) process.stdout.write(`  [${idx + 1}/${total}] ${name}...`);
    },
    onRepoAnalyzed: (analyzed) => {
      if (!jsonOutput) {
        const ports = [...analyzed.ports, ...analyzed.configPorts].map((p) => `${p.port}(${p.source})`).join(', ') || 'none';
        console.log(` ${analyzed.classification} | ports: ${ports}`);
      }
    },
  });

  const services = result.analyzed.filter((a) => a.classification === 'service').length;
  const infra = result.analyzed.filter((a) => a.classification === 'infra').length;
  const libs = result.analyzed.filter((a) => a.classification === 'library').length;

  if (jsonOutput) {
    console.log(JSON.stringify({
      mode: 'local',
      workspaceDir,
      orgUrl: result.orgUrl,
      repos: result.analyzed.map((a) => ({
        name: a.name,
        language: a.repoInfo.language,
        classification: a.classification,
        ports: [...a.ports, ...a.configPorts],
        hasDev: a.hasDev,
        hasStart: a.hasStart,
        hasDockerCompose: a.hasDockerCompose,
        cloneUrl: a.repoInfo.cloneUrl,
      })),
      dependencies: result.dependencies,
      summary: {
        total: result.analyzed.length,
        services,
        infra,
        libraries: libs,
        orgInferred: !!result.orgUrl,
      },
    }, null, 2));
  } else {
    console.log(`\nFound ${result.analyzed.length} repos: ${services} services, ${infra} infra, ${libs} libraries`);
    console.log(`Dependencies: ${result.dependencies.length} detected`);
    if (result.orgUrl) {
      console.log(`GitHub org inferred: ${result.orgUrl.host}/${result.orgUrl.org}`);
    }
    console.log(`\nUse /orcha-init in Claude Code for agent-powered config generation.`);
    console.log(`Or: orcha generate-config to write orcha.config.yaml from this analysis.`);
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

const runDoctor = async (jsonOutput: boolean, briefOutput: boolean) => {
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

  // Compute summary stats
  const binOk = binaryResults.filter((b) => b.ok).length;
  const binTotal = binaryResults.length;
  const svcHealthy = serviceResults.filter((s) => s.checks.length > 0 && s.checks.every((ch) => ch.ok)).length;
  const svcDown = serviceResults.filter((s) => s.checks.length > 0 && !s.checks.every((ch) => ch.ok)).length;
  const svcNoCheck = serviceResults.filter((s) => s.checks.length === 0).length;
  const missingBins = binaryResults.filter((b) => !b.ok).map((b) => b.name);
  const downSvcs = serviceResults.filter((s) => s.checks.length > 0 && !s.checks.every((ch) => ch.ok)).map((s) => s.id);

  if (jsonOutput) {
    console.log(JSON.stringify({ binaries: binaryResults, services: serviceResults }, null, 2));
  } else if (briefOutput) {
    const parts = [];
    parts.push(binOk === binTotal ? `All ${binTotal} binaries OK` : `${binOk}/${binTotal} binaries OK (missing: ${missingBins.join(', ')})`);
    if (svcHealthy > 0) parts.push(`${svcHealthy} services healthy`);
    if (svcDown > 0) parts.push(`${downSvcs.join(', ')} down`);
    if (svcNoCheck > 0) parts.push(`${svcNoCheck} no health checks`);
    console.log(parts.join('. ') + '.');
  } else {
    // Summary verdict
    console.log('\n' + summaryLine([
      binOk === binTotal ? c.green(`${binOk}/${binTotal} binaries OK`) : c.red(`${binOk}/${binTotal} binaries OK`),
      svcHealthy > 0 ? c.green(`${svcHealthy} healthy`) : '',
      svcDown > 0 ? c.red(`${svcDown} down`) : '',
      svcNoCheck > 0 ? c.dim(`${svcNoCheck} no checks`) : '',
    ]));

    console.log(`\n${c.bold('Binaries:')}`);
    for (const b of binaryResults) {
      const i = b.ok ? icon.pass : icon.fail;
      console.log(`  ${i} ${b.name.padEnd(10)} ${b.ok ? b.version : c.red(b.version)}`);
    }

    console.log(`\n${c.bold('Services:')}`);
    console.log(c.dim(`  ${'SERVICE'.padEnd(32)} ${'STATE'.padEnd(10)} URL`));
    console.log(c.dim(`  ${''.padEnd(32, '-')} ${''.padEnd(10, '-')} ${''.padEnd(40, '-')}`));
    for (const svc of serviceResults) {
      const allOk = svc.checks.length > 0 && svc.checks.every((ch) => ch.ok);
      const anyCheck = svc.checks.length > 0;
      const state = !anyCheck ? c.dim('n/a') : allOk ? c.green('READY') : c.red('STOPPED');
      console.log(`  ${svc.id.padEnd(32)} ${state.padEnd(20)} ${svc.url}`);
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
// impact: Blast radius analysis for a service
// ---------------------------------------------------------------------------
const runImpact = (serviceId: string, profile: string | undefined, jsonOutput: boolean) => {
  const allServices = listAllServiceDefinitions();
  const target = getServiceDefinition(serviceId);

  // Find direct dependents (services that list this service in their dependencies)
  const directDependents = allServices.filter((svc) =>
    svc.dependencies.includes(serviceId) || (svc.referenceDeps ?? []).includes(serviceId),
  );

  // Find transitive dependents (services that depend on direct dependents, recursively)
  const allDependents = new Set<string>(directDependents.map((s) => s.id));
  let frontier = directDependents.map((s) => s.id);
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const depId of frontier) {
      const transitive = allServices.filter((svc) =>
        svc.dependencies.includes(depId) && !allDependents.has(svc.id),
      );
      for (const t of transitive) {
        allDependents.add(t.id);
        nextFrontier.push(t.id);
      }
    }
    frontier = nextFrontier;
  }

  // Find affected verification probes
  const affectedProbes = allServices
    .filter((svc) => svc.id === serviceId || allDependents.has(svc.id))
    .flatMap((svc) => svc.verification.api.map((p) => ({ service: svc.id, probe: p.id, label: p.label })));

  // Find affected flow scenarios
  const flows = listFlowScenarios();
  const affectedFlows = flows.filter((f) =>
    f.requiredServices.includes(serviceId) ||
    f.requiredServices.some((rs) => allDependents.has(rs)),
  );

  const transitiveOnly = [...allDependents].filter((id) => !directDependents.some((d) => d.id === id));

  if (jsonOutput) {
    console.log(JSON.stringify({
      service: serviceId,
      label: target.label,
      kind: target.kind,
      directDependents: directDependents.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
      transitiveDependents: transitiveOnly.map((id) => {
        const svc = getServiceDefinition(id);
        return { id: svc.id, label: svc.label, kind: svc.kind };
      }),
      affectedProbes,
      affectedFlows: affectedFlows.map((f) => ({ id: f.id, label: f.label })),
      totalBlastRadius: allDependents.size,
    }, null, 2));
  } else {
    console.log(`\n${c.bold('Impact Analysis:')} ${target.label} (${serviceId})`);
    console.log(summaryLine([
      c.yellow(`${allDependents.size} services affected`),
      `${directDependents.length} direct`,
      `${transitiveOnly.length} transitive`,
      affectedProbes.length > 0 ? `${affectedProbes.length} probes` : '',
      affectedFlows.length > 0 ? `${affectedFlows.length} flows` : '',
    ]));

    if (directDependents.length > 0) {
      console.log(`\n${c.bold('Direct dependents')} (services that depend on ${serviceId}):`);
      for (const dep of directDependents) {
        console.log(`  ${icon.warn} ${dep.id} ${c.dim(`(${dep.kind})`)}`);
      }
    }

    if (transitiveOnly.length > 0) {
      console.log(`\n${c.bold('Transitive dependents')} (affected through dependency chain):`);
      for (const id of transitiveOnly) {
        const svc = getServiceDefinition(id);
        console.log(`  ${icon.info} ${svc.id} ${c.dim(`(${svc.kind})`)}`);
      }
    }

    if (directDependents.length === 0 && transitiveOnly.length === 0) {
      console.log(`\n  ${c.green('No other services depend on this service.')}`);
    }

    if (affectedProbes.length > 0) {
      console.log(`\n${c.bold('Affected verification probes:')}`);
      for (const p of affectedProbes) {
        console.log(`  ${c.dim(p.service)} → ${p.label}`);
      }
    }

    if (affectedFlows.length > 0) {
      console.log(`\n${c.bold('Affected flow scenarios:')}`);
      for (const f of affectedFlows) {
        console.log(`  ${icon.warn} ${f.label}`);
      }
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
// pr list: List PRs across repos
// ---------------------------------------------------------------------------
type PrEntry = {
  repo: string;
  number: number;
  title: string;
  author: string;
  state: string;
  reviewDecision: string;
  createdAt: string;
  url: string;
};

const runPrList = async (since: string, jsonOutput: boolean) => {
  const services = listServiceDefinitions(true); // include infra for completeness
  const github = loadConfig().github;
  if (!github) {
    console.error('No github config in orcha.config.yaml');
    process.exit(1);
  }

  // Build date filter
  const sinceDate = new Date();
  const match = since.match(/^(\d+)([dwm])$/);
  if (match) {
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    if (unit === 'd') sinceDate.setDate(sinceDate.getDate() - n);
    else if (unit === 'w') sinceDate.setDate(sinceDate.getDate() - n * 7);
    else if (unit === 'm') sinceDate.setMonth(sinceDate.getMonth() - n);
  }
  const dateStr = sinceDate.toISOString().slice(0, 10);

  // Build repo selector: HOST/OWNER/REPO for GHE, OWNER/REPO for github.com
  const repoSelector = (repoName: string) =>
    github.host === 'github.com'
      ? `${github.org}/${repoName}`
      : `${github.host}/${github.org}/${repoName}`;

  // Get unique repos (skip infra, deduplicate by repo name)
  const seen = new Set<string>();
  const repos: Array<{ name: string; repoPath: string }> = [];
  for (const svc of services) {
    const repoName = svc.repoPath.split('/').pop() ?? svc.id;
    if (seen.has(repoName) || svc.kind === 'infra') continue;
    seen.add(repoName);
    repos.push({ name: repoName, repoPath: svc.repoPath });
  }

  const allPrs: PrEntry[] = [];

  // Scan repos in parallel
  await Promise.all(repos.map(async (repo) => {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list',
        '--repo', repoSelector(repo.name),
        '--limit', '30',
        '--search', `updated:>=${dateStr}`,
        '--state', 'all',
        '--json', 'number,title,author,state,reviewDecision,createdAt,url',
      ], { timeout: 30_000 });

      const prs = JSON.parse(stdout) as Array<{
        number: number; title: string; author: { login: string };
        state: string; reviewDecision: string; createdAt: string; url: string;
      }>;

      for (const pr of prs) {
        allPrs.push({
          repo: repo.name,
          number: pr.number,
          title: pr.title,
          author: pr.author.login,
          state: pr.state,
          reviewDecision: pr.reviewDecision || 'REVIEW_REQUIRED',
          createdAt: pr.createdAt.slice(0, 10),
          url: pr.url,
        });
      }
    } catch {
      // Skip repos where gh fails (no access, not found, etc.)
    }
  }));

  // Sort by created date descending
  allPrs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (jsonOutput) {
    console.log(JSON.stringify({
      since: dateStr,
      reposScanned: repos.length,
      totalPrs: allPrs.length,
      prs: allPrs,
    }, null, 2));
  } else {
    console.log(`\nPRs since ${dateStr} — ${allPrs.length} across ${repos.length} repos\n`);
    if (allPrs.length === 0) {
      console.log('  No PRs found.');
      return;
    }
    console.log(`  ${'REPO'.padEnd(24)} ${'#'.padEnd(5)} ${'TITLE'.padEnd(42)} ${'AUTHOR'.padEnd(18)} ${'STATE'.padEnd(8)} ${'REVIEW'.padEnd(18)} DATE`);
    console.log(`  ${''.padEnd(24, '-')} ${''.padEnd(5, '-')} ${''.padEnd(42, '-')} ${''.padEnd(18, '-')} ${''.padEnd(8, '-')} ${''.padEnd(18, '-')} ${''.padEnd(10, '-')}`);
    for (const pr of allPrs) {
      const title = pr.title.length > 40 ? pr.title.slice(0, 39) + '…' : pr.title;
      console.log(`  ${pr.repo.padEnd(24)} ${String(pr.number).padEnd(5)} ${title.padEnd(42)} ${pr.author.padEnd(18)} ${pr.state.padEnd(8)} ${pr.reviewDecision.padEnd(18)} ${pr.createdAt}`);
    }
  }
};

// ---------------------------------------------------------------------------
// kb: Knowledge base management
// ---------------------------------------------------------------------------
const getKbDir = (): string => {
  const config = loadConfig();
  const kbDir = (config.knowledge as any)?.directory ?? path.join(getWorkspaceRoot(), 'knowledge');
  if (!existsSync(kbDir)) mkdirSync(kbDir, { recursive: true });
  return kbDir;
};

const runKbList = (serviceId: string | undefined, jsonOutput: boolean) => {
  const kbDir = getKbDir();
  const entries: Array<{ service: string; file: string; path: string; modified: string }> = [];

  // List service subdirectories or specific service
  const subdirs = serviceId ? [serviceId] : (() => {
    try {
      return readdirSync(kbDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch { return []; }
  })();

  for (const dir of subdirs) {
    const svcKbDir = path.join(kbDir, dir);
    if (!existsSync(svcKbDir)) continue;
    try {
      const files = readdirSync(svcKbDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(svcKbDir, file);
        const { mtimeMs } = require('node:fs').statSync(filePath);
        entries.push({
          service: dir,
          file,
          path: filePath,
          modified: new Date(mtimeMs).toISOString().slice(0, 10),
        });
      }
    } catch { /* skip unreadable dirs */ }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ kbDir, documents: entries }, null, 2));
  } else {
    if (entries.length === 0) {
      console.log(`\nNo KB documents found in ${kbDir}`);
      console.log('Use /orcha-kb-update <service> to generate KB docs from recent PRs.');
      return;
    }
    console.log(`\nKB Documents (${entries.length}) — ${kbDir}\n`);
    console.log(`  ${'SERVICE'.padEnd(28)} ${'FILE'.padEnd(35)} MODIFIED`);
    console.log(`  ${''.padEnd(28, '-')} ${''.padEnd(35, '-')} ${''.padEnd(10, '-')}`);
    for (const e of entries) {
      console.log(`  ${e.service.padEnd(28)} ${e.file.padEnd(35)} ${e.modified}`);
    }
  }
};

const runKbStatus = (jsonOutput: boolean) => {
  // Show KB freshness: which services have KB docs, which merged PRs are not yet covered
  const kbDir = getKbDir();
  const services = listServiceDefinitions();

  type KbServiceStatus = { service: string; docCount: number; lastUpdated: string | null };
  const statuses: KbServiceStatus[] = [];

  for (const svc of services) {
    const svcKbDir = path.join(kbDir, svc.id);
    if (!existsSync(svcKbDir)) {
      statuses.push({ service: svc.id, docCount: 0, lastUpdated: null });
      continue;
    }
    const files = readdirSync(svcKbDir).filter((f) => f.endsWith('.md'));
    let lastUpdated: string | null = null;
    for (const file of files) {
      const { mtimeMs } = require('node:fs').statSync(path.join(svcKbDir, file));
      const date = new Date(mtimeMs).toISOString().slice(0, 10);
      if (!lastUpdated || date > lastUpdated) lastUpdated = date;
    }
    statuses.push({ service: svc.id, docCount: files.length, lastUpdated });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ kbDir, services: statuses }, null, 2));
  } else {
    console.log(`\nKB Status — ${kbDir}\n`);
    console.log(`  ${'SERVICE'.padEnd(28)} ${'DOCS'.padEnd(6)} LAST UPDATED`);
    console.log(`  ${''.padEnd(28, '-')} ${''.padEnd(6, '-')} ${''.padEnd(12, '-')}`);
    for (const s of statuses) {
      console.log(`  ${s.service.padEnd(28)} ${String(s.docCount).padEnd(6)} ${s.lastUpdated ?? 'never'}`);
    }
  }
};

// ---------------------------------------------------------------------------
// seed: Execute seed fixtures from config
// ---------------------------------------------------------------------------
const executeHttpRequest = async (
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; ok: boolean; body?: unknown }> => {
  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(30_000),
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    let responseBody: unknown;
    try { responseBody = await response.json(); } catch { /* not json */ }
    return { status: response.status, ok: response.ok, body: responseBody };
  } catch (err) {
    return { status: 0, ok: false, body: { error: err instanceof Error ? err.message : String(err) } };
  }
};

const topologicalSortFixtures = (fixtures: readonly SeedFixture[]): SeedFixture[] => {
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

const runSeed = async (fixtureIds: string[], jsonOutput: boolean) => {
  const allFixtures = listFixtures();
  if (allFixtures.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'No fixtures defined in orcha.config.yaml' }));
    } else {
      console.error('No fixtures defined in orcha.config.yaml');
    }
    return;
  }

  // Select fixtures: specific IDs or all
  const selected = fixtureIds.length > 0
    ? allFixtures.filter((f) => fixtureIds.includes(f.id))
    : [...allFixtures];

  // Include dependencies
  const withDeps = new Set(selected.map((f) => f.id));
  for (const f of selected) {
    for (const dep of f.dependsOn ?? []) withDeps.add(dep);
  }
  const toRun = topologicalSortFixtures(allFixtures.filter((f) => withDeps.has(f.id)));

  type SeedResult = { id: string; targetService: string; status: number; expected: number; ok: boolean; error?: string };
  const results: SeedResult[] = [];

  for (const fixture of toRun) {
    if (!jsonOutput) process.stdout.write(`  [${fixture.id}] ${fixture.label}...`);

    const result = await executeHttpRequest(fixture.method, fixture.url, fixture.body, fixture.headers);
    const ok = result.status === fixture.expectedStatus;
    results.push({
      id: fixture.id,
      targetService: fixture.targetService,
      status: result.status,
      expected: fixture.expectedStatus,
      ok,
      error: ok ? undefined : `expected ${fixture.expectedStatus}, got ${result.status}`,
    });

    if (!jsonOutput) console.log(ok ? ` OK (${result.status})` : ` FAIL (${result.status}, expected ${fixture.expectedStatus})`);
  }

  if (jsonOutput) {
    const passed = results.filter((r) => r.ok).length;
    console.log(JSON.stringify({ total: results.length, passed, results }, null, 2));
  } else {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} fixtures seeded`);
  }
};

// ---------------------------------------------------------------------------
// verify api: Execute verification probes from config
// ---------------------------------------------------------------------------
const runVerifyApi = async (serviceId: string | undefined, jsonOutput: boolean) => {
  const services = serviceId
    ? [getServiceDefinition(serviceId)]
    : listAllServiceDefinitions();

  type ProbeResult = { service: string; id: string; label: string; method: string; url: string; status: number; expected: number; ok: boolean; error?: string; keyCheck?: { expected: string[]; missing: string[] } };
  const results: ProbeResult[] = [];

  for (const svc of services) {
    const probes = svc.verification.api;
    if (probes.length === 0) continue;

    for (const probe of probes) {
      if (!jsonOutput) process.stdout.write(`  [${svc.id}] ${probe.label}...`);

      const result = await executeHttpRequest(probe.method, probe.url, probe.body, probe.headers);
      const statusOk = result.status === probe.expectedStatus;

      // Check expected keys if specified
      let keyCheck: { expected: string[]; missing: string[] } | undefined;
      if (statusOk && probe.expectKeys && result.body && typeof result.body === 'object') {
        const bodyKeys = Object.keys(result.body as Record<string, unknown>);
        const missing = probe.expectKeys.filter((k) => !bodyKeys.includes(k));
        if (missing.length > 0) {
          keyCheck = { expected: [...probe.expectKeys], missing };
        }
      }

      const ok = statusOk && !keyCheck;
      results.push({
        service: svc.id,
        id: probe.id,
        label: probe.label,
        method: probe.method,
        url: probe.url,
        status: result.status,
        expected: probe.expectedStatus,
        ok,
        error: !statusOk ? `expected ${probe.expectedStatus}, got ${result.status}` : undefined,
        keyCheck,
      });

      if (!jsonOutput) {
        if (ok) console.log(` OK (${result.status})`);
        else if (!statusOk) console.log(` FAIL (${result.status}, expected ${probe.expectedStatus})`);
        else console.log(` FAIL (missing keys: ${keyCheck!.missing.join(', ')})`);
      }
    }
  }

  if (jsonOutput) {
    const passed = results.filter((r) => r.ok).length;
    console.log(JSON.stringify({ total: results.length, passed, results }, null, 2));
  } else {
    if (results.length === 0) {
      console.log('No API verification probes defined.');
    } else {
      const passed = results.filter((r) => r.ok).length;
      console.log(`\n${passed}/${results.length} probes passed`);
    }
  }
};

// ---------------------------------------------------------------------------
// verify flow: Execute multi-step flow scenarios from config
// ---------------------------------------------------------------------------
const runVerifyFlow = async (scenarioId: string | undefined, jsonOutput: boolean) => {
  const scenarios = listFlowScenarios();
  if (scenarios.length === 0) {
    if (jsonOutput) console.log(JSON.stringify({ error: 'No flow scenarios defined in orcha.config.yaml' }));
    else console.error('No flow scenarios defined in orcha.config.yaml');
    return;
  }

  const toRun = scenarioId
    ? [getFlowScenario(scenarioId)].filter(Boolean)
    : [...scenarios];

  if (toRun.length === 0) {
    console.error(`Unknown flow scenario: ${scenarioId}`);
    process.exit(1);
  }

  type StepResult = { id: string; label: string; status: number; expected: number; ok: boolean; captured?: unknown; error?: string };
  type FlowResult = { id: string; label: string; passed: number; total: number; steps: StepResult[] };
  const results: FlowResult[] = [];

  for (const scenario of toRun) {
    if (!scenario) continue;
    if (!jsonOutput) console.log(`\n  Flow: ${scenario.label}\n`);

    const captures: Record<string, unknown> = {};
    const steps: StepResult[] = [];

    for (const step of scenario.steps) {
      // Delay if specified
      if (step.delayBeforeMs) {
        await new Promise((r) => setTimeout(r, step.delayBeforeMs));
      }

      if (!jsonOutput) process.stdout.write(`    [${step.id}] ${step.label}...`);

      const result = await executeHttpRequest(step.method, step.url, step.body, step.headers);
      const ok = result.status === step.expectedStatus;

      // Capture response if requested
      if (ok && step.captureAs && result.body) {
        captures[step.captureAs] = result.body;
      }

      steps.push({
        id: step.id,
        label: step.label,
        status: result.status,
        expected: step.expectedStatus,
        ok,
        captured: step.captureAs ? result.body : undefined,
        error: ok ? undefined : `expected ${step.expectedStatus}, got ${result.status}`,
      });

      if (!jsonOutput) console.log(ok ? ` OK (${result.status})` : ` FAIL (${result.status})`);

      // Stop flow on first failure
      if (!ok) break;
    }

    const passed = steps.filter((s) => s.ok).length;
    results.push({ id: scenario.id, label: scenario.label, passed, total: scenario.steps.length, steps });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ scenarios: results }, null, 2));
  } else {
    for (const r of results) {
      const status = r.passed === r.total ? 'PASS' : 'FAIL';
      console.log(`\n  ${r.label}: ${status} (${r.passed}/${r.total} steps)`);
    }
  }
};

// ---------------------------------------------------------------------------
// up: Start services with dependency resolution
// ---------------------------------------------------------------------------
const runUp = async (target: string, profile: string | undefined, jsonOutput: boolean) => {
  const order = getStartOrder(target, profile);

  if (!jsonOutput) {
    const preset = getPreset(target);
    const profileLabel = profile ? ` --profile ${profile}` : '';
    console.log(`\nStarting ${target}${profileLabel} (${order.length} services)...\n`);
  }

  const results = await startStack(target, profile, {
    onStarting: (id, prof) => {
      if (!jsonOutput) process.stdout.write(`  [starting] ${id} (${prof})...`);
    },
    onHealthWait: (id) => {
      if (!jsonOutput) process.stdout.write(' waiting for health...');
    },
    onHealthy: (id) => {
      if (!jsonOutput) console.log(' READY');
    },
    onFailed: (id, error) => {
      if (!jsonOutput) console.log(` FAILED (${error})`);
    },
  });

  if (jsonOutput) {
    console.log(JSON.stringify({ target, profile: profile ?? 'default', results }, null, 2));
  } else {
    const healthy = results.filter((r) => r.healthy).length;
    const failed = results.filter((r) => !r.healthy).length;
    console.log(`\n${healthy} started, ${failed} failed`);
  }
};

// ---------------------------------------------------------------------------
// down: Stop services
// ---------------------------------------------------------------------------
const runDown = async (serviceId: string | undefined, jsonOutput: boolean) => {
  if (serviceId) {
    await stopService(serviceId);
    if (jsonOutput) {
      console.log(JSON.stringify({ stopped: [serviceId] }));
    } else {
      console.log(`Stopped ${serviceId}`);
    }
  } else {
    const stopped = await stopAll();
    if (jsonOutput) {
      console.log(JSON.stringify({ stopped }));
    } else {
      if (stopped.length === 0) {
        console.log('No services were running.');
      } else {
        console.log(`Stopped ${stopped.length} services: ${stopped.join(', ')}`);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// status: Show running services
// ---------------------------------------------------------------------------
const runStatus = async (jsonOutput: boolean, briefOutput: boolean) => {
  const statuses = await getStatus();

  const ready = statuses.filter((s) => s.state === 'READY').length;
  const running = statuses.filter((s) => s.state === 'RUNNING').length;
  const stopped = statuses.filter((s) => s.state === 'STOPPED').length;

  if (jsonOutput) {
    console.log(JSON.stringify({ services: statuses }, null, 2));
  } else if (briefOutput) {
    const parts = [`${ready + running}/${statuses.length} running`];
    if (ready > 0) parts.push(`${ready} ready`);
    if (stopped > 0) parts.push(`${stopped} stopped`);
    console.log(parts.join('. ') + '.');
  } else {
    // Summary verdict
    console.log('\n' + summaryLine([
      ready > 0 ? c.green(`${ready} ready`) : '',
      running > 0 ? c.yellow(`${running} running (no health check)`) : '',
      stopped > 0 ? c.dim(`${stopped} stopped`) : '',
    ]));

    console.log('');
    console.log(c.dim(`  ${'SERVICE'.padEnd(32)} ${'STATE'.padEnd(8)} ${'PID'.padEnd(8)} ${'PROFILE'.padEnd(10)} URL`));
    console.log(c.dim(`  ${''.padEnd(32, '-')} ${''.padEnd(8, '-')} ${''.padEnd(8, '-')} ${''.padEnd(10, '-')} ${''.padEnd(30, '-')}`));
    for (const s of statuses) {
      const pidStr = s.pid ? String(s.pid) : '-';
      const profStr = s.profile ?? '-';
      const stateStr = s.state === 'READY' ? c.green(s.state) : s.state === 'RUNNING' ? c.yellow(s.state) : c.dim(s.state);
      console.log(`  ${s.serviceId.padEnd(32)} ${stateStr.padEnd(18)} ${pidStr.padEnd(8)} ${profStr.padEnd(10)} ${s.url}`);
    }
  }
};

// ---------------------------------------------------------------------------
// logs: Tail service logs
// ---------------------------------------------------------------------------
const runLogs = (serviceId: string, lines: number, jsonOutput: boolean) => {
  const content = readLogTail(serviceId, lines);
  if (content === null) {
    if (jsonOutput) {
      console.log(JSON.stringify({ serviceId, error: 'No logs found. Service may not be running or uses docker compose.' }));
    } else {
      console.error(`No logs found for ${serviceId}. Service may not be running or uses docker compose.`);
      console.error(`For compose services, use: docker compose -p orcha-${serviceId} logs`);
    }
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ serviceId, lines: content.split('\n').length, content }));
  } else {
    console.log(content);
  }
};

// ---------------------------------------------------------------------------
// pr context: Full PR context from a URL
// ---------------------------------------------------------------------------
type PrUrl = { host: string; owner: string; repo: string; number: number };

const parsePrUrl = (url: string): PrUrl => {
  // https://git.example.com/my-team/status-ui/pull/617
  // https://github.com/org/repo/pull/123
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

const runPrContext = async (prUrlString: string, jsonOutput: boolean) => {
  const pr = parsePrUrl(prUrlString);
  const repoSelector = pr.host === 'github.com'
    ? `${pr.owner}/${pr.repo}`
    : `${pr.host}/${pr.owner}/${pr.repo}`;

  // Fetch PR metadata
  const { stdout: metaOut } = await execFileAsync('gh', [
    'pr', 'view', String(pr.number),
    '--repo', repoSelector,
    '--json', 'number,title,author,state,body,reviewDecision,files,additions,deletions,baseRefName,headRefName,comments,reviews,labels',
  ], { timeout: 30_000 });
  const meta = JSON.parse(metaOut);

  // Fetch diff
  let diff = '';
  try {
    const { stdout: diffOut } = await execFileAsync('gh', [
      'pr', 'diff', String(pr.number),
      '--repo', repoSelector,
    ], { timeout: 30_000 });
    diff = diffOut;
  } catch { /* diff may fail for merged PRs on some GHE versions */ }

  if (jsonOutput) {
    console.log(JSON.stringify({
      url: prUrlString,
      repo: `${pr.owner}/${pr.repo}`,
      number: meta.number,
      title: meta.title,
      author: meta.author?.login,
      state: meta.state,
      reviewDecision: meta.reviewDecision,
      base: meta.baseRefName,
      head: meta.headRefName,
      additions: meta.additions,
      deletions: meta.deletions,
      body: meta.body,
      files: meta.files,
      comments: meta.comments,
      reviews: meta.reviews,
      labels: meta.labels,
      diff,
    }, null, 2));
  } else {
    console.log(`\n${meta.title}`);
    console.log(`${pr.owner}/${pr.repo}#${meta.number} | ${meta.state} | ${meta.reviewDecision ?? 'PENDING'}`);
    console.log(`${meta.author?.login} | ${meta.baseRefName} ← ${meta.headRefName} | +${meta.additions}/-${meta.deletions}`);

    if (meta.body) {
      console.log(`\n${meta.body.slice(0, 500)}${meta.body.length > 500 ? '...' : ''}`);
    }

    console.log(`\nFiles (${meta.files?.length ?? 0}):`);
    for (const f of (meta.files ?? [])) {
      console.log(`  ${f.path} (+${f.additions}/-${f.deletions})`);
    }

    if (meta.reviews?.length > 0) {
      console.log(`\nReviews:`);
      for (const r of meta.reviews) {
        console.log(`  ${r.author?.login}: ${r.state}${r.body ? ` — ${r.body.slice(0, 80)}` : ''}`);
      }
    }

    if (meta.comments?.length > 0) {
      console.log(`\nComments (${meta.comments.length}):`);
      for (const c of meta.comments.slice(0, 5)) {
        console.log(`  ${c.author?.login}: ${c.body?.slice(0, 100)}`);
      }
    }

    if (diff) {
      const diffLines = diff.split('\n').length;
      console.log(`\nDiff: ${diffLines} lines (use --json to get full diff)`);
    }
  }
};

// ---------------------------------------------------------------------------
// delta scan: Scan git commits across repos
// ---------------------------------------------------------------------------
type CommitEntry = { hash: string; subject: string; author: string; date: string };
type RepoCommits = { repo: string; commits: CommitEntry[]; insertions: number; deletions: number };

const runDeltaScan = async (since: string, jsonOutput: boolean, briefOutput: boolean) => {
  const services = listServiceDefinitions(true);

  // Build --since arg for git log
  const sinceArg = since.replace(/(\d+)d/, '$1 days ago')
    .replace(/(\d+)w/, '$1 weeks ago')
    .replace(/(\d+)m/, '$1 months ago');

  // Deduplicate repos
  const seen = new Set<string>();
  const repos: Array<{ name: string; repoPath: string }> = [];
  for (const svc of services) {
    const repoName = svc.repoPath.split('/').pop() ?? svc.id;
    if (seen.has(repoName) || svc.kind === 'infra') continue;
    seen.add(repoName);
    if (existsSync(svc.repoPath)) {
      repos.push({ name: repoName, repoPath: svc.repoPath });
    }
  }

  const results: RepoCommits[] = [];

  await Promise.all(repos.map(async (repo) => {
    try {
      // Get commits
      const { stdout } = await execFileAsync('git', [
        'log', `--since=${sinceArg}`, '--format=%H|%s|%an|%aI', '--no-merges',
      ], { cwd: repo.repoPath, timeout: 10_000 });

      const commits: CommitEntry[] = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [hash, subject, author, date] = line.split('|');
        return { hash, subject, author, date: date?.slice(0, 10) ?? '' };
      });

      // Get stat summary
      let insertions = 0, deletions = 0;
      if (commits.length > 0) {
        try {
          const { stdout: statOut } = await execFileAsync('git', [
            'log', `--since=${sinceArg}`, '--no-merges', '--shortstat', '--format=',
          ], { cwd: repo.repoPath, timeout: 10_000 });
          for (const line of statOut.split('\n')) {
            const insMatch = line.match(/(\d+) insertion/);
            const delMatch = line.match(/(\d+) deletion/);
            if (insMatch) insertions += parseInt(insMatch[1], 10);
            if (delMatch) deletions += parseInt(delMatch[1], 10);
          }
        } catch { /* ignore stat errors */ }
      }

      results.push({ repo: repo.name, commits, insertions, deletions });
    } catch {
      results.push({ repo: repo.name, commits: [], insertions: 0, deletions: 0 });
    }
  }));

  // Sort by commit count descending
  results.sort((a, b) => b.commits.length - a.commits.length);
  const totalCommits = results.reduce((sum, r) => sum + r.commits.length, 0);

  // Separate bot vs human commits
  const totalBot = results.reduce((sum, r) => sum + r.commits.filter((cm) => isBotCommit(cm.author, cm.subject)).length, 0);
  const totalHuman = totalCommits - totalBot;
  const activeRepos = results.filter((r) => r.commits.length > 0);
  const quietRepos = results.filter((r) => r.commits.length === 0);
  const mostActive = activeRepos.length > 0 ? activeRepos[0] : null;

  if (jsonOutput) {
    console.log(JSON.stringify({ since, reposScanned: repos.length, totalCommits, totalBot, totalHuman, repos: results }, null, 2));
  } else if (briefOutput) {
    const parts = [`${totalHuman} commits across ${activeRepos.length} repos (since ${since})`];
    if (mostActive) parts.push(`most active: ${mostActive.repo} (${mostActive.commits.length})`);
    if (totalBot > 0) parts.push(`${totalBot} bot commits`);
    if (quietRepos.length > 0) parts.push(`${quietRepos.length} quiet`);
    console.log(parts.join('. ') + '.');
  } else {
    // Summary verdict
    console.log('\n' + summaryLine([
      c.bold(`${totalCommits} commits across ${activeRepos.length} repos`) + c.dim(` (since ${since})`),
      mostActive ? `Most active: ${c.cyan(mostActive.repo)} (${mostActive.commits.length})` : '',
      totalBot > 0 ? c.dim(`${totalBot} bot`) : '',
      quietRepos.length > 0 ? c.dim(`${quietRepos.length} quiet`) : '',
    ]));

    // Human commits table
    console.log('');
    console.log(c.dim(`  ${'REPO'.padEnd(28)} ${'COMMITS'.padEnd(9)} ${'LINES'.padEnd(14)} LATEST`));
    console.log(c.dim(`  ${''.padEnd(28, '-')} ${''.padEnd(9, '-')} ${''.padEnd(14, '-')} ${''.padEnd(40, '-')}`));

    for (const r of activeRepos) {
      const humanCommits = r.commits.filter((cm) => !isBotCommit(cm.author, cm.subject));
      const botCount = r.commits.length - humanCommits.length;
      const latestHuman = humanCommits.length > 0 ? humanCommits[0] : null;
      const latest = latestHuman
        ? `${latestHuman.subject.slice(0, 38)} ${c.dim(`(${latestHuman.author})`)}`
        : c.dim(`${r.commits[0].subject.slice(0, 38)} (bot)`);
      const lines = `+${r.insertions}/-${r.deletions}`;
      const commitStr = botCount > 0 ? `${humanCommits.length}+${c.dim(`${botCount}bot`)}` : String(r.commits.length);
      console.log(`  ${r.repo.padEnd(28)} ${commitStr.padEnd(20)} ${lines.padEnd(14)} ${latest}`);
    }

    if (quietRepos.length > 0) {
      console.log(c.dim(`\n  ${quietRepos.length} repos with no activity: ${quietRepos.map((r) => r.repo).join(', ')}`));
    }
  }
};

// ---------------------------------------------------------------------------
// verify stack: Probe all service health checks
// ---------------------------------------------------------------------------
const runVerifyStack = async (jsonOutput: boolean, briefOutput: boolean) => {
  const services = listAllServiceDefinitions();

  type CheckResult = { name: string; url: string; ok: boolean; detail: string };
  type ServiceVerification = { id: string; kind: string; url: string; passed: number; total: number; checks: CheckResult[] };
  const results: ServiceVerification[] = [];

  // Run all health checks in parallel per service
  await Promise.all(services.map(async (svc) => {
    if (svc.healthChecks.length === 0) {
      results.push({ id: svc.id, kind: svc.kind, url: svc.localUrl, passed: 0, total: 0, checks: [] });
      return;
    }

    const checks: CheckResult[] = await Promise.all(svc.healthChecks.map(async (hc) => {
      const result = await probeHealth(hc.url, hc.expectedStatus);
      return {
        name: hc.name,
        url: hc.url,
        ok: result.ok,
        detail: result.ok
          ? (result.status ? `${result.status} OK` : 'connected')
          : (result.error ?? `status ${result.status}`),
      };
    }));

    const passed = checks.filter((ch) => ch.ok).length;
    results.push({ id: svc.id, kind: svc.kind, url: svc.localUrl, passed, total: checks.length, checks });
  }));

  // Sort: services with checks first, then by id
  results.sort((a, b) => {
    if (a.total > 0 && b.total === 0) return -1;
    if (a.total === 0 && b.total > 0) return 1;
    return a.id.localeCompare(b.id);
  });

  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalChecks = results.reduce((sum, r) => sum + r.total, 0);
  const svcHealthy = results.filter((r) => r.total > 0 && r.passed === r.total).length;
  const svcDown = results.filter((r) => r.total > 0 && r.passed < r.total).length;
  const svcNoCheck = results.filter((r) => r.total === 0).length;
  const downNames = results.filter((r) => r.total > 0 && r.passed < r.total).map((r) => r.id);

  if (jsonOutput) {
    console.log(JSON.stringify({ summary: { passed: totalPassed, total: totalChecks }, services: results }, null, 2));
  } else if (briefOutput) {
    const parts = [`Stack: ${totalPassed}/${totalChecks} checks passed`];
    if (svcHealthy > 0) parts.push(`${svcHealthy} healthy`);
    if (svcDown > 0) parts.push(`${downNames.join(', ')} down`);
    console.log(parts.join('. ') + '.');
  } else {
    // Summary verdict
    const allPass = totalPassed === totalChecks;
    console.log('\n' + summaryLine([
      allPass ? c.green(`${totalPassed}/${totalChecks} checks passed`) : c.red(`${totalPassed}/${totalChecks} checks passed`),
      svcHealthy > 0 ? c.green(`${svcHealthy} healthy`) : '',
      svcDown > 0 ? c.red(`${svcDown} down`) : '',
      svcNoCheck > 0 ? c.dim(`${svcNoCheck} no checks`) : '',
    ]));

    console.log('');
    console.log(c.dim(`  ${'SERVICE'.padEnd(32)} ${'CHECKS'.padEnd(8)} ${'STATUS'.padEnd(10)} DETAIL`));
    console.log(c.dim(`  ${''.padEnd(32, '-')} ${''.padEnd(8, '-')} ${''.padEnd(10, '-')} ${''.padEnd(30, '-')}`));
    for (const svc of results) {
      if (svc.total === 0) {
        console.log(`  ${c.dim(svc.id.padEnd(32))} ${c.dim('n/a'.padEnd(8))} ${''.padEnd(10)} ${c.dim('no health checks')}`);
        continue;
      }
      const pass = svc.passed === svc.total;
      const status = pass ? c.green('PASS') : c.red('FAIL');
      const checkStr = `${svc.passed}/${svc.total}`;
      const detail = svc.checks.map((ch) => `${ch.name}: ${ch.ok ? c.green(ch.detail) : c.red(ch.detail)}`).join(', ');
      console.log(`  ${svc.id.padEnd(32)} ${checkStr.padEnd(8)} ${status.padEnd(20)} ${detail}`);
    }
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
  const briefOutput = args.includes('--brief');
  const includeAll = args.includes('--all');

  // Filter out flags and their values to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (['--workspace', '--json', '--all', '--help', '--profile', '--since', '--brief', '--no-color'].includes(args[i])) {
        // flags that take a value — skip next arg too
        if (args[i] === '--workspace' || args[i] === '--profile' || args[i] === '--since') i++;
      }
      continue;
    }
    positional.push(args[i]);
  }

  switch (command) {
    case 'init': {
      const arg1 = positional[1];

      if (!arg1) {
        // No args: scan current directory as local workspace
        await runInitLocal(process.cwd(), jsonOutput);
        break;
      }

      // Detect if arg1 is a URL or a local path
      const isUrl = arg1.includes('github.com') || arg1.includes('git.') || arg1.startsWith('http://') || arg1.startsWith('https://');

      if (isUrl) {
        // org URL mode: orcha init <org-url> [workspace-dir]
        const orgName = parseOrgUrl(arg1).org;
        const workspaceDir = positional[2]
          ? path.resolve(positional[2])
          : path.resolve(process.cwd(), orgName);
        await runInit(arg1, workspaceDir, jsonOutput, includeAll);
      } else {
        // local path mode: orcha init <workspace-dir>
        await runInitLocal(path.resolve(arg1), jsonOutput);
      }
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

    case 'kb': {
      const sub = positional[1];
      if (sub === 'list') {
        const svcId = positional[2];
        runKbList(svcId, jsonOutput);
      } else if (sub === 'status') {
        runKbStatus(jsonOutput);
      } else {
        console.error('Usage: orcha kb <list [service]|status>');
        console.error('Use /orcha-kb-update <service> for agent-powered KB generation.');
        process.exit(1);
      }
      break;
    }

    case 'up': {
      const target = positional[1] ?? getDefaults().upTarget ?? 'all';
      const profIdx = args.indexOf('--profile');
      const prof = profIdx >= 0 ? args[profIdx + 1] : undefined;
      await runUp(target, prof, jsonOutput);
      break;
    }

    case 'down': {
      const svcId = positional[1];
      await runDown(svcId, jsonOutput);
      break;
    }

    case 'status': {
      await runStatus(jsonOutput, briefOutput);
      break;
    }

    case 'logs': {
      const svcId = positional[1];
      if (!svcId) { console.error('Usage: orcha logs <service> [lines]'); process.exit(1); }
      const lineCount = positional[2] ? parseInt(positional[2], 10) : 50;
      runLogs(svcId, lineCount, jsonOutput);
      break;
    }

    case 'delta': {
      const sub = positional[1];
      if (sub === 'scan') {
        const sinceIdx = args.indexOf('--since');
        const since = sinceIdx >= 0 ? args[sinceIdx + 1] : '1w';
        await runDeltaScan(since, jsonOutput, briefOutput);
      } else {
        console.error('Usage: orcha delta scan [--since <window>]');
        process.exit(1);
      }
      break;
    }

    case 'pr': {
      const sub = positional[1];
      if (sub === 'list') {
        const sinceIdx = args.indexOf('--since');
        const since = sinceIdx >= 0 ? args[sinceIdx + 1] : '2w';
        await runPrList(since, jsonOutput);
      } else if (sub === 'context') {
        const prUrl = positional[2];
        if (!prUrl) { console.error('Usage: orcha pr context <pr-url>'); process.exit(1); }
        await runPrContext(prUrl, jsonOutput);
      } else {
        console.error('Usage: orcha pr <list|context>');
        process.exit(1);
      }
      break;
    }

    case 'verify': {
      const sub = positional[1];
      if (sub === 'stack') {
        await runVerifyStack(jsonOutput, briefOutput);
      } else if (sub === 'api') {
        const svcId = positional[2];
        await runVerifyApi(svcId, jsonOutput);
      } else if (sub === 'flow') {
        const scenId = positional[2];
        await runVerifyFlow(scenId, jsonOutput);
      } else {
        console.error('Usage: orcha verify <stack|api [service]|flow [scenario]>');
        process.exit(1);
      }
      break;
    }

    case 'seed': {
      const fixtureIds = positional.slice(1);
      await runSeed(fixtureIds, jsonOutput);
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
      await runDoctor(jsonOutput, briefOutput);
      break;
    }

    case 'impact': {
      const svcId = positional[1];
      if (!svcId) { console.error('Usage: orcha impact <service> [--profile <name>]'); process.exit(1); }
      const profIdx = args.indexOf('--profile');
      const prof = profIdx >= 0 ? args[profIdx + 1] : undefined;
      runImpact(svcId, prof, jsonOutput);
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
