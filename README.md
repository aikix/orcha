# Orcha

**Your AI agent's workspace brain.**

Orcha is an agent-first orchestration tool for multi-repo microservice architectures. It gives AI coding agents (Claude Code, Cursor, Windsurf) structured knowledge about your services, dependencies, health, and history — so they stop guessing and start being productive from the first prompt.

```bash
# One command to set up everything
/orcha-onboard https://github.com/your-org

# Your agent now knows: services, ports, dependencies, health, profiles, history
```

## Why Orcha?

| Without Orcha | With Orcha |
|---|---|
| Agent re-discovers workspace topology every session | Agent knows your services, deps, and topology instantly |
| New developer takes 2 days to set up locally | `/orcha-onboard` → productive in 15 minutes |
| "Which services depend on this?" → ask a human | `/orcha-impact api-service` → concrete answer |
| PR review misses cross-service breakage | `/orcha-pr-review` traces blast radius across repos |
| Service goes down, nobody notices | `orcha watch --restart` auto-recovers |

## Install

**Quick install** (pre-built binary):
```bash
curl -fsSL https://raw.githubusercontent.com/aikix/orcha/main/install.sh | bash
```

**From source** (requires [Bun](https://bun.sh/)):
```bash
git clone https://github.com/aikix/orcha.git && cd orcha
bun install && bun link
```

**Prerequisites:**
- [Bun](https://bun.sh/) v1.2+ — Runtime & package manager
- [GitHub CLI](https://cli.github.com/) — Org scanning, PR workflows
- [Docker](https://www.docker.com/) — Infrastructure services (optional for staging profiles)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Cursor](https://cursor.com/) — Agent skills

## Quick Start

### 1. Initialize your workspace

**New developer? Use the full onboarding:**
```bash
/orcha-onboard https://github.com/your-org
```
This checks prerequisites, clones repos, reads source code to generate config, starts services, seeds test data, and gives you an orientation.

**Already have repos cloned?**
```bash
/orcha-init ~/Workspace/myteam
```
Scans your local repos, infers the GitHub org from git remotes, and generates `orcha.config.yaml`.

**Just want the CLI?**
```bash
orcha init https://github.com/your-org ~/Workspace/myteam
```

### 2. Start your stack

```bash
orcha up core --profile staging     # UI + staging APIs (no Docker needed)
orcha up core --profile local       # Full local stack with infra
```

### 3. Work with your agent

```bash
/orcha-check                        # "Is everything healthy?"
/orcha-impact api-service           # "What breaks if I change this?"
/orcha-pr-review <pr-url>           # "Is this PR safe to merge?"
/orcha-debug user-service           # "Why is this service failing?"
/orcha-sync                         # "What changed this week?"
```

## Features

### Workspace Management
| Command | What it does |
|---|---|
| `orcha init [org-url \| dir]` | Scan GitHub org or local workspace, generate config |
| `orcha up [preset] --profile <name>` | Start services with dependency resolution + health gating |
| `orcha down [service]` | Stop services gracefully (SIGTERM → SIGKILL) |
| `orcha status` | Show running services with health state |
| `orcha watch [--restart]` | Continuous health monitoring, auto-restart on failure |
| `orcha doctor` | Check prerequisites + service health |
| `orcha impact <service>` | Blast radius: dependents, affected probes, affected flows |
| `orcha graph [preset]` | Dependency graph visualization |

### Verification
| Command | What it does |
|---|---|
| `orcha verify stack` | Health check all services (HTTP/TCP probes) |
| `orcha verify api [service]` | API contract probes (status + response keys) |
| `orcha verify flow [scenario]` | Multi-step cross-service flow scenarios |
| `orcha seed [fixture...]` | Insert test data via HTTP with dependency ordering |

### Code Intelligence
| Command | What it does |
|---|---|
| `orcha pr list --since 2w` | PRs across all repos via GitHub CLI |
| `orcha pr context <pr-url>` | Full PR context: diff, comments, reviews, files |
| `orcha delta scan --since 1w` | Local git commits across repos (bot commits grouped) |
| `orcha kb list [service]` | Knowledge base documents per service |
| `orcha kb status` | KB freshness per service |

### Agent Skills (10)
| Skill | Purpose |
|---|---|
| `/orcha-onboard` | Full new developer onboarding (prereqs → init → start → seed → orient) |
| `/orcha-init` | Workspace init from GitHub org URL or local directory |
| `/orcha-check` | Health assessment: binaries, services, dependency chains |
| `/orcha-impact` | Blast radius analysis: what breaks if a service changes |
| `/orcha-pr-review` | AI-powered PR review with cross-service impact analysis |
| `/orcha-debug` | Root cause diagnosis: config, deps, logs, KB, fix recommendation |
| `/orcha-sync` | Refresh knowledge: commits, PRs, KB freshness |
| `/orcha-weekly` | Weekly summary with architecture evolution proposals |
| `/orcha-kb-baseline` | Generate baseline KB docs from source code |
| `/orcha-kb-update` | Update KB from recent merged PRs |

### MCP Server
Any MCP-compatible AI agent gets workspace context automatically:

```json
{ "mcpServers": { "orcha": { "command": "bun", "args": ["packages/mcp-server/src/index.ts"] } } }
```

**Resources:** `orcha://services`, `orcha://presets`, `orcha://topology`

**Tools:** `get_service_config`, `get_blast_radius`, `get_start_order`, `search_kb`, `get_workspace_summary`

## Config: `orcha.config.yaml`

Declarative workspace config. Generated by `/orcha-init`, customized by the team, version controlled.

```yaml
version: 1
workspace:
  name: "my-team"
github:
  host: "github.com"
  org: "my-org"
services:
  api-service:
    id: api-service
    label: "API Service"
    kind: service                              # service | infra | library
    repoPath: "${workspace.root}/api-service"
    runtime:
      type: script
      command: { bin: npm, args: [run, dev] }
    localUrl: "http://localhost:3000"
    healthChecks:
      - { name: health, url: "http://localhost:3000/health", expectedStatus: 200 }
    dependencies: [redis]                      # started before this service
    profiles:
      staging:
        description: "Against staging APIs"
        env: { API_URL: "https://staging.example.com" }
        dependencies: []                       # no local infra needed
presets:
  core:
    description: "Core development stack"
    services: [web-ui]                         # deps resolved automatically
defaults:
  upTarget: "core"
```

See [docs/config-reference.md](docs/config-reference.md) for the full schema.

## Multi-Language Support

Orcha discovers and manages services in any language:

| Language | Detection | Port Discovery |
|---|---|---|
| **Node.js / TypeScript** | `package.json`, `tsconfig.json` | `config/default.cjs`, Dockerfile EXPOSE |
| **Python** | `pyproject.toml`, `requirements.txt` | Flask `app.run()`, FastAPI/Uvicorn, env defaults |
| **Go** | `go.mod` | `http.ListenAndServe`, gin, echo, fiber |
| **Any** | `Dockerfile`, `docker-compose.yml` | EXPOSE, port mappings |

## Architecture

```
orcha (generic framework)        Team Workspace
├── @orcha/service-definitions   ├── orcha.config.yaml     ← team config
├── @orcha/config-loader         ├── .orcha/state/          ← runtime state
├── @orcha/discovery             ├── knowledge/             ← KB docs
├── @orcha/orchestrator          ├── service-a/             ← repos
├── @orcha/mcp-server            ├── service-b/
├── apps/cli                     └── ...
└── .claude/commands/            ← agent skills
```

**Design principles:**
- **Agent-first** — `--json` on every command. Agent skills are the primary interface.
- **Config over code** — Topology is YAML, not hardcoded. Zero team-specific data in Orcha.
- **Profiles over flags** — `--profile staging` swaps the entire dependency graph.

## Development

```bash
bun install                        # Install dependencies
bun run dev:cli -- <command>       # Run CLI in dev mode
bun test packages/config-loader/   # Run tests (58 total across packages)
bun link                           # Install globally from source
```

## Status

All core features are implemented and working. Orcha is ready for early adopter teams.

| Area | Status |
|---|---|
| Config loading | ✅ 35+ tests |
| Discovery (Node.js, Python, Go) | ✅ Org URL + local workspace |
| Stack management | ✅ up/down/status/watch/doctor |
| Verification | ✅ stack/api/flow/seed |
| Code intelligence | ✅ PR/delta/KB |
| MCP server | ✅ Resources + tools |
| Agent skills | ✅ 10 skills |
| CLI output | ✅ Colors, summaries, --brief, --json |
| CI/CD | ✅ GitHub Actions (test + release) |

## License

MIT
