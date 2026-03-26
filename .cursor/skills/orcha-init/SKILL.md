---
name: orcha-init
description: "Agent-powered workspace init from a GitHub org URL. Scans repos, reads source code, generates accurate orcha.config.yaml."
---

Initialize an orcha workspace by scanning a GitHub org and generating a complete `orcha.config.yaml`. You are the intelligence layer — the CLI provides raw data, you provide accurate analysis.

## Workflow

1. **Scan**: Run `orcha scan <org-url> --all --json` to get structured repo data.
2. **Select**: Present repos to user, suggest excluding templates/CI/tooling repos.
3. **Clone**: Run `orcha clone <org-url> <selected-repos> --workspace <dir>` for repos not yet local.
4. **Analyze**: READ the actual source files in each repo — `config/default.cjs`, server entry points, `docker-compose.yml`, README — to determine correct ports, health endpoints, runtime dependencies, and profiles.
5. **Generate**: Write a complete `orcha.config.yaml` with accurate service definitions, presets, and profiles.
6. **Validate**: Check YAML syntax, dependency references, port conflicts.

## Key analysis points per repo

- **Ports**: Read `config/default.cjs` for `http.port`. Ignore Redis/Prometheus ports.
- **Health**: Read server entry point for health route paths.
- **Dependencies**: Read config files for URL references to other services.
- **Profiles**: Read environment-specific config files for staging/dev overrides.
- **Infra**: Identify Redis/DynamoDB/Postgres from docker-compose files.

Use `orcha scan --json` for the raw data, then read source files for the intelligence layer.
