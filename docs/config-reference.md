# Config Reference: `orcha.config.yaml`

Complete schema reference for the orcha workspace configuration file.

## Location

`orcha.config.yaml` lives at the root of your team workspace. Orcha finds it by:

1. `ORCHA_CONFIG` env var (explicit path)
2. Walking up from the current directory

Local overrides can be placed in `orcha.config.local.yaml` (gitignore this).

## Variable Interpolation

Use `${workspace.root}` in string values — it resolves to the directory containing `orcha.config.yaml`.

```yaml
repoPath: "${workspace.root}/my-service"  # → /Users/you/Workspace/team/my-service
```

## Top-Level Schema

```yaml
version: 1                    # Schema version (always 1 for now)

workspace:
  name: "team-name"           # Human-readable workspace name

github:                       # Optional: GitHub org for PR/delta commands
  host: "github.com"          # or your GitHub Enterprise host
  org: "org-name"

services: { ... }             # Service definitions (see below)
aliases: { ... }              # Short names for services
presets: { ... }              # Named service groups
fixtures: [ ... ]             # Seed data definitions
flows: [ ... ]                # E2E flow scenarios
externalScripts: [ ... ]      # External verification scripts
defaults: { ... }             # CLI default targets
onboard: { ... }              # Setup configuration
```

## Service Definition

```yaml
services:
  my-service:
    id: my-service                          # Unique identifier
    label: "My Service"                     # Display name
    kind: service                           # service | infra | library
    ownerServiceId: parent-service          # Optional: infra owner
    repoPath: "${workspace.root}/my-service"
    workingDirectory: "${workspace.root}/my-service"

    runtime:
      type: script                          # script | compose
      command: { bin: npm, args: [run, dev] }
      # OR for compose:
      # type: compose
      # composeFile: "./docker-compose.yml"
      # projectName: "orcha-my-service"
      # services: [redis]

    localUrl: "http://localhost:3000"
    healthChecks:
      - name: health
        url: "http://localhost:3000/health"
        expectedStatus: 200

    dependencies: [redis, other-service]    # Runtime dependencies (started first)
    referenceDeps: [some-library]           # Awareness only, not started
    runtimeModes: [local, remote, mock]

    env:                                    # Environment variables
      PORT: "3000"
      NODE_CONFIG: '{"http":{"port":3000}}'
    nodeConfig:                             # Structured config (for display/merge)
      http: { port: 3000 }

    defaultProfile: local                   # Default profile if none specified
    profiles:
      local:
        description: "Full local stack"
        dependencies: [redis, database]
        env: { ... }
      staging:
        description: "Against staging APIs"
        env: { NODE_CONFIG: '{"api":{"url":"https://staging.example.com"}}' }

    postStartDelayMs: 2000                  # Optional: wait after start
    postStartCommands:                      # Optional: run after health check
      - { bin: npm, args: [run, "db:setup"] }

    verification:
      api:
        - id: health
          label: "Health check"
          kind: api
          method: GET
          url: "http://localhost:3000/health"
          expectedStatus: 200
      data: []
```

### Service Kinds

| Kind | Description |
|---|---|
| `service` | Application service with HTTP endpoint |
| `infra` | Infrastructure (Redis, DynamoDB, Postgres) — started via Docker Compose |
| `library` | npm package, no runtime — tracked for dependency awareness |

### Runtime Types

| Type | When to use |
|---|---|
| `script` | Application services started via `npm run dev`, `npm start`, etc. |
| `compose` | Infrastructure started via `docker compose up` |

### Profiles

Profiles override the base service definition when selected via `--profile`. Overrides are **merged**, not replaced:
- `dependencies`: replaced entirely
- `env`: merged (NODE_CONFIG is deep-merged)
- `nodeConfig`: deep-merged
- `healthChecks`: replaced entirely

## Presets

Named groups of top-level services. Dependencies are resolved automatically.

```yaml
presets:
  core:
    description: "Core development stack"
    services: [web-ui]        # Just list the top-level service(s)
                               # Dependencies (api, db, redis) start automatically
  api-only:
    description: "API without UI"
    services: [api-service]
```

## Fixtures

Seed data for local development.

```yaml
fixtures:
  - id: seed-user
    label: "Create test user"
    targetService: api-service
    method: POST
    url: "http://localhost:3000/api/users"
    headers: { x-api-key: test-key }
    body: { name: test, email: test@example.com }
    expectedStatus: 201
    dependsOn: [other-fixture]    # Optional: run order
```

## Flows

End-to-end verification scenarios.

```yaml
flows:
  - id: user-onboarding
    label: "User onboarding flow"
    description: "Create user, verify profile"
    requiredServices: [api-service, user-service]
    steps:
      - id: create-user
        label: "POST create user"
        method: POST
        url: "http://localhost:3000/api/users"
        body: { name: test }
        expectedStatus: 201
        captureAs: userId          # Save response for later steps
      - id: verify-profile
        label: "GET user profile"
        method: GET
        url: "http://localhost:3000/api/users/${userId}"
        expectedStatus: 200
        expectKeys: [name, email]
        delayBeforeMs: 1000        # Wait for async processing
```

## Aliases

Short names for services.

```yaml
aliases:
  redis: user-service-redis
  db: admin-api-postgres
```

## Defaults

CLI fallback targets when no argument is provided.

```yaml
defaults:
  upTarget: "core"                    # orcha up (no args) → orcha up core
  verifyApiService: "api-service"     # orcha verify api (no args)
  verifyFlowScenario: "user-flow"    # orcha verify flow (no args)
```

## Onboard

Workspace setup configuration.

```yaml
onboard:
  binaries: [bun, docker, gh]        # Required binaries to check
  skills: [orcha-init, orcha-check]   # Agent skills to install
```
