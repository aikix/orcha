# Agent Skills

Orcha is agent-first. Skills are the primary interface — they chain CLI commands with agent intelligence to accomplish complex workflows that neither could do alone.

## Design Philosophy

**CLI = plumbing.** Mechanical operations: clone, start, stop, health check, list, write files. Deterministic, fast, `--json` output.

**Agent = intelligence.** Read code, infer intent, analyze changes, make decisions, generate config. Non-deterministic, context-aware, creative.

**Skill = orchestration.** A markdown file that tells the agent what CLI commands to run, what files to read, and what decisions to make. The skill is the glue.

## How Skills Work

### Claude Code
Skills live in `.claude/commands/` as markdown files with frontmatter:

```markdown
---
description: "One-line description"
argument-hint: "<arg>"
---

Instructions for the agent...
```

Invoke with `/skill-name <args>` in Claude Code.

### Cursor Agent
Skills live in `.cursor/skills/<name>/SKILL.md`:

```markdown
---
name: skill-name
description: "Description. Agent auto-invokes when context matches."
---

Instructions for the agent...
```

## Available Skills

### `/orcha-init <org-url> [workspace-dir]`

**What it does:** Full workspace initialization from a GitHub org URL.

**Why agent-first matters:** A regex scanner gets ports wrong (Redis 6379 for an API service), misses runtime dependencies, and can't infer profiles. The agent reads `config/default.cjs`, server entry points, and docker-compose files to get it right.

**Flow:**
1. `orcha init <url> [dir] --json` → structured diff (present/missing/local-only)
2. Agent presents diff, asks user which missing repos to clone
3. `orcha clone <url> <repos> --workspace <dir>` → clone selected repos
4. Agent reads source code of each service repo
5. Agent generates `orcha.config.yaml` with accurate ports, health paths, deps, profiles
6. Agent validates: no broken deps, no port conflicts

### `/orcha-check` (planned)

**What it does:** One-shot health assessment of the workspace.

**Flow:**
1. `orcha doctor --json` → binary checks + service health
2. `orcha status --json` → running services
3. `orcha verify stack --json` → health check results
4. Agent summarizes: what's healthy, what's down, what needs attention

### `/orcha-sync` (planned)

**What it does:** Refresh agent knowledge from the workspace.

**Flow:**
1. `orcha delta scan --since 1w --json` → recent commits across repos
2. `orcha delta summarize --since 1w --json` → structured change summary
3. `orcha pr list --since 1w --json` → open/merged PRs
4. Agent summarizes: what changed, what's in flight, what needs review

### `/orcha-pr-review <url>` (planned)

**What it does:** AI-powered PR review with full context.

**Flow:**
1. `orcha pr context <url> --json` → diff, comments, checks, related files
2. Agent reads the diff + surrounding code
3. Agent analyzes: correctness, security, tests, blast radius
4. Agent delivers verdict: APPROVE / REQUEST CHANGES with specific feedback

### `/orcha-debug <service>` (planned)

**What it does:** Deep diagnostic when a service is failing.

**Flow:**
1. `orcha inspect config <service> --json` → resolved config
2. `orcha logs <service> 100 --json` → recent logs
3. `orcha graph <service> --json` → dependency tree
4. `orcha verify api <service> --json` → endpoint checks
5. Agent reads logs, correlates with config and deps
6. Agent delivers: root cause hypothesis + recommended fix

## Writing Custom Skills

### Pattern

```markdown
---
description: "What it does in one line"
argument-hint: "<args>"
---

Step 1: Run `orcha <command> --json` to get structured data.

Step 2: Read specific files based on the data.

Step 3: Use your judgment to [analyze/generate/decide].

Step 4: Run `orcha <command>` to apply the result.

Step 5: Verify and report.
```

### Guidelines

- **Always use `--json`** for CLI commands the agent parses
- **Read actual source code** — don't rely on CLI output alone
- **Ask the user** when there's ambiguity — don't guess
- **Report structured results** — summary table, not walls of text
- **Chain commands** — small composable steps, not one mega-command
