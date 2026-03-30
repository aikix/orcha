# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Orcha

Agent-first multi-repo orchestration tool. CLI does plumbing (clone, scan, start, stop), agents do thinking (analyze code, infer config, review PRs, debug services). Every CLI command supports `--json` for structured agent consumption.

**Config over code:** Service definitions live in `orcha.config.yaml` in the team workspace, not in this repo. This repo is the generic framework — zero team-specific data.

## Development Commands

```bash
bun install                        # Install dependencies
bun run test                       # Run all tests via Turborepo
bun run typecheck                  # Typecheck all packages via Turborepo
bun run dev:cli -- <command>       # Run CLI in dev mode (e.g. bun run dev:cli -- doctor --json)
bun link                           # Install `orcha` globally from source
bun test packages/config-loader/   # Run tests for a single package
bun build apps/cli/src/index.ts --compile --outfile dist/orcha  # Build binary
```

## Architecture

Monorepo using Bun workspaces + Turborepo. All packages use `bun:test` and TypeScript with ESM (`"type": "module"`).

### Package dependency chain

```
@orcha/cli (apps/cli/src/index.ts)
  → @orcha/orchestrator   (service lifecycle: start, stop, health gating, process state)
  → @orcha/discovery      (org scan, repo analysis, dependency detection, config generation)
  → @orcha/config-loader  (reads orcha.config.yaml, resolves profiles, interpolates variables)
  → @orcha/service-definitions  (TypeScript types only: ServiceDefinition, OrchaConfig, etc.)
```

### Key architectural patterns

- **CLI is a single file** — `apps/cli/src/index.ts` contains all commands as functions dispatched via a switch statement. No framework (no commander/yargs).
- **Config loader is the single source of truth** — `@orcha/config-loader` caches the parsed config and exposes typed accessors (`getServiceDefinition`, `resolveServiceDefinition`, `listPresets`, etc.). The loader walks up from cwd to find `orcha.config.yaml`, with `ORCHA_CONFIG` env var as override.
- **Profile resolution** — `resolveServiceDefinition(id, profile)` merges base service definition with profile overrides (env, nodeConfig, dependencies, healthChecks). Profiles like `staging` swap dependency wiring without changing code.
- **Orchestrator manages state** — `@orcha/orchestrator` uses a JSON state file (`.orcha/state.json` in the workspace) to track running processes. It does topological sort for dependency-ordered startup and health-gating before proceeding to dependents.
- **Agent skills are the primary interface** — `.claude/commands/*.md` and `.cursor/skills/` contain agent skills that chain CLI commands with code reading and reasoning. Skills are more important than the CLI for end users.

### Config resolution flow

1. `loader.ts` finds `orcha.config.yaml` by walking up from cwd
2. Optionally deep-merges `orcha.config.local.yaml` (for local overrides, gitignored)
3. Interpolates `${workspace.root}` in all string values
4. Normalizes service definitions (fills defaults for healthChecks, env, verification, etc.)
5. Result is cached — `resetConfig()` clears the cache (used in tests)

## When Adding Features

1. Types → `@orcha/service-definitions` (pure types, no logic)
2. Config reading → `@orcha/config-loader` (with tests)
3. Process management → `@orcha/orchestrator`
4. CLI commands → `apps/cli/src/index.ts` (must support `--json`)
5. Agent skills → `.claude/commands/` and `.cursor/skills/`
6. All CLI output must have a `--json` path for agent consumption

## Testing

- Uses `bun:test` (`describe`/`test`/`expect`)
- Config-loader has 35+ tests with fixtures in `packages/config-loader/src/__fixtures__/`
- Discovery has 19 tests (dependency detection, config generation, org inference)
- Run a single test file: `bun test packages/config-loader/src/loader.test.ts`
- `resetConfig()` must be called between tests that load different fixture configs

## Commits & Releases

Uses semantic-release with conventional commits. Commit messages determine versioning:
- `feat:` → minor bump, `fix:` → patch bump, `feat!:` or `BREAKING CHANGE:` → major bump
- `chore:`, `docs:`, `refactor:`, `test:` → no release
- Pushing to `main` triggers automatic release with compiled binaries
