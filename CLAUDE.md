# CLAUDE.md — Orcha

Agent-first multi-repo orchestration tool. CLI does plumbing, agents do thinking.

## Project Structure

```
orcha/
├── apps/cli/src/index.ts          # CLI entry point
├── packages/
│   ├── service-definitions/       # Types only (ServiceDefinition, OrchaConfig)
│   ├── config-loader/             # Reads orcha.config.yaml (35 tests)
│   └── discovery/                 # Org scan, repo analysis, config generation
├── .claude/commands/              # Agent skills for Claude Code
├── .cursor/skills/                # Agent skills for Cursor
└── docs/                          # Documentation
```

## Development Commands

```bash
bun install
bun run test                       # Run all tests (Bun test runner)
bun run typecheck                  # Typecheck all packages via Turborepo
bun run dev:cli -- <command>       # Run CLI in dev mode
bun link                           # Install `orcha` globally from source
```

## Key Design Principle

**Agent-first:** Every CLI command supports `--json` for structured output. Agent skills (`.claude/commands/*.md`) are the primary user interface. Skills chain CLI commands with code reading and reasoning.

**Config over code:** Service definitions live in `orcha.config.yaml` (team workspace), not in this repo. This repo is the generic framework — zero team-specific data.

## Package Dependencies

```
@orcha/cli → @orcha/discovery → @orcha/service-definitions
                              → yaml
           → @orcha/config-loader → @orcha/service-definitions
                                  → yaml
```

## Testing

- Config-loader: `bun test packages/config-loader/` (35 tests)
- Uses `bun:test` (describe/test/expect)
- Fixtures in `packages/config-loader/src/__fixtures__/`

## When Adding New Features

1. Types go in `@orcha/service-definitions`
2. Config reading goes in `@orcha/config-loader`
3. CLI commands go in `apps/cli/src/index.ts`
4. Agent skills go in `.claude/commands/` and `.cursor/skills/`
5. All commands must support `--json`
6. Write tests for any new package logic
