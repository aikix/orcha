# Architecture

Orcha is an agent-first orchestration tool. The CLI does plumbing; agent skills do thinking. This document describes the system design, package structure, and feature scope.

## Design Principles

1. **Agent-first, human-second** — Every CLI command supports `--json`. Agent skills are the primary user interface. Human-readable output is the fallback.
2. **CLI = plumbing, Agent = intelligence** — The CLI performs mechanical operations (clone, start, probe, list). Agent skills chain CLI commands with code reading and reasoning to accomplish things neither could do alone.
3. **Config over code** — Service topology is declarative YAML (`orcha.config.yaml`), not hardcoded. Teams own their config. Zero team-specific data in Orcha.
4. **Profiles over flags** — `--profile staging` swaps the entire dependency graph, environment, and health checks. No manual env var juggling.

## Package Structure

Monorepo using Bun workspaces + Turborepo. All packages use TypeScript with ESM.

```
orcha/
├── apps/cli/                      → CLI entry point (single file, no framework)
├── packages/
│   ├── orchestrator/              → Service lifecycle (start, stop, health gating, state)
│   ├── discovery/                 → Org scan, repo analysis, dependency detection
│   ├── config-loader/             → Reads orcha.config.yaml, profiles, interpolation
│   ├── service-definitions/       → TypeScript types only (ServiceDefinition, OrchaConfig)
│   └── mcp-server/                → MCP resources + tools for any AI agent
├── .claude/commands/              → Agent skills for Claude Code
├── .cursor/skills/                → Agent skills for Cursor
├── skills/                        → Claude Code plugin format (SKILL.md)
└── .claude-plugin/                → Plugin manifest
```

### Dependency Chain

```
@orcha/cli
  → @orcha/orchestrator       (depends on config-loader)
  → @orcha/discovery          (depends on config-loader)
  → @orcha/config-loader      (depends on service-definitions)
  → @orcha/service-definitions (pure types, no runtime deps)
```

When adding features, follow this chain: types → config-loader → orchestrator/discovery → CLI → agent skills.

## Feature Scope: CLI vs Agent Skills

The CLI and agent skills have distinct responsibilities. The CLI handles deterministic, mechanical operations. Agent skills add intelligence — reading code, making decisions, correlating signals.

### Setup & Initialization

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Scan org / workspace | `orcha init [url \| dir]` | `/orcha-init` | CLI scans and diffs. Agent decides which repos to clone, reads source code, generates accurate config. |
| Full onboarding | `doctor` + `up` + `seed` | `/orcha-onboard` | Agent chains: prereq check → init → start → verify → seed → orientation. |
| Clone repos | `clone <url> [repos...]` | — | Plumbing only. Called by `/orcha-init`. |
| List org repos | `list-repos <url>` | — | Plumbing only. Called by `init`. |
| Generate config (fallback) | `generate-config <url>` | — | Regex-based fallback. Superseded by `/orcha-init` code analysis. |
| Install agent skills | `setup-skills --ai <tool>` | — | Manual setup step. Not agent-driven. |

### Stack Operations

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Start services | `up [preset] --profile <name>` | — | Direct use. Also called by `/orcha-onboard`. |
| Stop services | `down [service]` | — | Direct use. |
| Show status | `status` | — | Used inside `/orcha-check`, `/orcha-debug`. |
| Health monitoring | `watch [--restart]` | — | Long-running process. Direct use. |
| Tail logs | `logs <service> [lines]` | — | Used by `/orcha-debug` for root cause analysis. |

### Health & Diagnostics

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Prereqs + health | `doctor` | `/orcha-check` | CLI checks binaries and probes. Agent adds dependency chain analysis and recommendations. |
| Debug failing service | `logs` + `inspect config` + `graph` | `/orcha-debug` | Agent correlates logs, config, and dependency graph to find root cause. |
| Blast radius | `impact <service>` | `/orcha-impact` | CLI traces dependents. Agent analyzes probe impacts, flow breakage, profile-specific effects. |

### Verification

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Health check all | `verify stack` | — | Used by `/orcha-check`, `/orcha-onboard`, `/orcha-debug`. |
| API contract probes | `verify api [service]` | — | CLI only. No agent skill yet. |
| Flow scenarios | `verify flow [scenario]` | — | CLI only. No agent skill yet. |
| Seed test data | `seed [fixture...]` | — | Called by `/orcha-onboard`. |

### Code Intelligence

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| List PRs | `pr list --since <window>` | — | Used by `/orcha-sync`, `/orcha-weekly`, `/orcha-kb-update`. |
| PR context + review | `pr context <url>` | `/orcha-pr-review` | CLI fetches diff/comments. Agent analyzes correctness, security, blast radius. |
| Git commit scan | `delta scan --since <window>` | — | Used by `/orcha-sync`, `/orcha-weekly`. |
| Daily sync | `pr list` + `delta scan` + `kb status` | `/orcha-sync` | Agent synthesizes activity into summary. |
| Weekly report | all intelligence commands | `/orcha-weekly` | Agent generates report with architecture evolution proposals. |

### Knowledge Base

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| List KB docs | `kb list [service]` | — | Used by `/orcha-check`, `/orcha-debug`. |
| KB freshness | `kb status` | — | Used by `/orcha-sync`, `/orcha-weekly`. |
| Generate KB from code | — | `/orcha-kb-baseline` | Agent reads source code, writes architectural reference docs. No CLI command — pure agent intelligence. |
| Update KB from PRs | — | `/orcha-kb-update` | Agent reads merged PRs, generates KB updates. No CLI command. |

### Configuration & Topology

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Dependency graph | `graph [preset \| service]` | — | Used by `/orcha-check`, `/orcha-debug`, `/orcha-impact`. |
| Resolved config | `inspect config <service>` | — | Used by `/orcha-debug`. |
| List services / presets | `list services \| presets` | — | Used by `/orcha-onboard`. |

### Maintenance

| Feature | CLI Command | Agent Skill | Division of Work |
|---|---|---|---|
| Self-update | `update` | — | Downloads latest binary from GitHub Releases. Only works with compiled binaries. |
| Version check | `version` / `--version` / `-V` | — | Prints current version. |
| Update nudge | (automatic) | — | Non-blocking check once per 24h on startup. Prints one-liner to stderr if newer version exists. |

### MCP Server

Any MCP-compatible AI agent gets workspace context without skills:

| Type | Name | Description |
|---|---|---|
| Resource | `orcha://services` | All service definitions |
| Resource | `orcha://presets` | Stack presets |
| Resource | `orcha://topology` | Dependency graph |
| Tool | `get_service_config` | Resolved config for a service |
| Tool | `get_blast_radius` | Impact analysis |
| Tool | `get_start_order` | Topological start order |
| Tool | `search_kb` | Search knowledge base |
| Tool | `get_workspace_summary` | Workspace overview |

## Summary

| Layer | Count | Role |
|---|---|---|
| CLI commands | 27 | Plumbing — scan, clone, start, stop, probe, list, update |
| Agent skills | 10 | Intelligence — analyze, decide, correlate, generate docs |
| MCP resources | 3 | Passive context for any AI agent |
| MCP tools | 5 | Active queries for any AI agent |
| Packages | 6 | Modular internals with clear dependency chain |

### Unused CLI Features

These CLI commands exist but have no agent skill wrapper yet:

- `verify api` — API contract probes (validates response status + keys)
- `verify flow` — Multi-step cross-service flow scenarios

These are candidates for future agent skills that could intelligently select which probes to run and interpret failures.
