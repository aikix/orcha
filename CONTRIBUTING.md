# Contributing to Orcha

Thanks for your interest in contributing! Orcha is an agent-first orchestration tool for multi-repo microservice architectures.

## Getting Started

```bash
git clone https://github.com/aikix/orcha.git && cd orcha
bun install
bun link    # makes `orcha` available globally, running from source
```

**Prerequisites:** [Bun](https://bun.sh/) v1.3+, [GitHub CLI](https://cli.github.com/)

## Development Workflow

```bash
bun run dev:cli -- <command>       # Run CLI in dev mode
bun test packages/config-loader/   # Run tests for a package
bun run test                       # Run all tests via Turborepo
bun run typecheck                  # Typecheck all packages
```

After `bun link`, any code changes take effect immediately — no rebuild needed.

## Architecture

Monorepo with Bun workspaces + Turborepo. See [CLAUDE.md](CLAUDE.md) for full architecture details.

```
@orcha/cli                → CLI commands (apps/cli/src/index.ts)
@orcha/orchestrator       → Service lifecycle (start, stop, health gating)
@orcha/discovery          → Org scan, repo analysis, config generation
@orcha/config-loader      → Reads orcha.config.yaml, profiles, interpolation
@orcha/service-definitions → TypeScript types only
@orcha/mcp-server         → MCP resources + tools
```

## Adding a Feature

Follow the dependency chain — types first, CLI last:

1. **Types** → `packages/service-definitions/`
2. **Config reading** → `packages/config-loader/` (with tests)
3. **Process management** → `packages/orchestrator/`
4. **CLI command** → `apps/cli/src/index.ts` (must support `--json`)
5. **Agent skill** → `.claude/commands/`

## Testing

- Uses `bun:test` (`describe`/`test`/`expect`)
- Config-loader: 35 tests with fixtures in `packages/config-loader/src/__fixtures__/`
- Discovery: 19 tests for dependency detection, config generation
- Run a single file: `bun test packages/config-loader/src/loader.test.ts`

## Commit Conventions

This project uses [conventional commits](https://www.conventionalcommits.org/) with [semantic-release](https://semantic-release.gitbook.io/). Your commit messages determine versioning:

- `feat: ...` → minor version bump
- `fix: ...` → patch version bump
- `feat!: ...` or `BREAKING CHANGE:` → major version bump
- `chore:`, `docs:`, `refactor:`, `test:` → no release

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes with tests where appropriate
3. Ensure `bun run test` and `bun run typecheck` pass
4. Open a PR against `main` with a clear description of what and why
5. CI will run tests automatically

## Reporting Issues

Open an issue on [GitHub Issues](https://github.com/aikix/orcha/issues). Include:
- What you were trying to do
- What happened vs. what you expected
- Your environment (OS, Bun version, relevant config)

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
