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

125 tests across 4 packages. All tests use `bun:test` (`describe`/`test`/`expect`).

| Package | Tests | What's covered |
|---------|-------|---------------|
| config-loader | 35 | Config loading, profile resolution, fixtures, flows |
| discovery | 42 | Dependency detection, config generation, org inference, repo analysis |
| orchestrator | 17 | State management, topological sort |
| CLI | 31 | Pure utilities, format helpers, subprocess integration |

### Running Tests

```bash
bun run test                       # All tests via Turborepo
bun run typecheck                  # Typecheck all packages
bun test packages/config-loader/   # Single package
bun test apps/cli/src/utils.test.ts  # Single file
```

### Writing Tests

- **Fixture config:** `packages/config-loader/src/__fixtures__/basic.orcha.config.yaml` — 3 services (redis, api-service, web-ui) with presets, fixtures, flows. Set `ORCHA_CONFIG` env var to use it.
- **Test isolation:** Call `resetConfig()` from `@orcha/config-loader` in `beforeEach`/`afterEach` to clear cached config between tests.
- **Discovery fixtures:** `packages/discovery/src/__fixtures__/` has 5 repo-like directories (Node.js, Python, Go, Docker, library) for `analyzeRepo` testing.
- **CLI pure logic:** Extract testable functions to `apps/cli/src/utils.ts`. Test via direct import.
- **CLI commands:** Test via subprocess (`bun apps/cli/src/index.ts ...args --json`) with `ORCHA_CONFIG` set to fixture.

### Coverage

Coverage is tracked via [Codecov](https://codecov.io/gh/aikix/orcha). The CI uploads per-package lcov reports on every PR.

- **Project target:** Don't regress from current baseline
- **Patch target:** 80% — new code in PRs should be well-tested
- **Excluded from coverage:** I/O-heavy modules (`orchestrator/src/index.ts`, `apps/cli/src/index.ts`), MCP server, type-only packages

## CI Pipeline

Every PR to `main` runs two parallel checks (both required to merge):

| Check | What it does |
|-------|-------------|
| **build** | `bun run typecheck` — catches type errors across all packages |
| **test** | Runs all 125 tests with coverage, uploads to Codecov |

### Release Pipeline

Pushing to `main` triggers [semantic-release](https://semantic-release.gitbook.io/) which:
1. Analyzes commit messages since the last release
2. Determines the version bump (or skips if no release-worthy commits)
3. Builds platform binaries (Linux x64, macOS ARM64, macOS Intel)
4. Creates a GitHub Release with binaries attached
5. Updates `package.json` and `CHANGELOG.md` via a `chore(release)` commit

## Commit Conventions

This project uses [conventional commits](https://www.conventionalcommits.org/). Your commit messages determine versioning:

```bash
feat: add new command              # → minor version bump (1.0.0 → 1.1.0)
fix: handle null port              # → patch version bump (1.0.0 → 1.0.1)
feat!: rename config key           # → major version bump (1.0.0 → 2.0.0)
```

**No release triggered:**
```bash
chore: update deps                 # infrastructure, dependencies
ci: add coverage upload            # CI/CD pipeline changes
docs: fix typo in README           # documentation only
refactor: simplify loader logic    # code restructuring, no behavior change
test: add orchestrator tests       # test-only changes
```

> **Important:** Use `ci:` for CI/CD workflow changes and `chore:` for build/infra changes. Using `fix:` or `feat:` on non-code changes will trigger an unnecessary release.

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes with tests where appropriate
3. Ensure `bun run test` and `bun run typecheck` pass locally
4. Open a PR against `main` with a clear description of what and why
5. CI runs both `build` and `test` checks automatically
6. Codecov comments on the PR with coverage diff
7. After review and approval, squash-merge into `main`
8. Semantic-release handles versioning and publishing automatically

## Reporting Issues

Open an issue on [GitHub Issues](https://github.com/aikix/orcha/issues). Include:
- What you were trying to do
- What happened vs. what you expected
- Your environment (OS, Bun version, relevant config)

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
