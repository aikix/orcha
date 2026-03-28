---
description: "Agent-powered workspace init from a GitHub org URL or existing local workspace"
argument-hint: "[github-org-url | workspace-dir]"
---

Initialize an orcha workspace by scanning either a GitHub org or an existing local workspace, then generating a complete `orcha.config.yaml`.

**Three use cases:**
- **New team member (org URL)**: `orcha init https://github.com/my-org` — scans org, clones repos, generates config
- **Existing workspace (org URL + dir)**: `orcha init https://github.com/my-org ~/Workspace/team` — diffs org against what's already cloned
- **Existing workspace (local only)**: `orcha init ~/Workspace/team` or `orcha init .` — scans local repos, no GitHub API needed

## Detect the mode

Look at `$ARGUMENTS`:
- If it contains a URL (github.com, git., http://): **org URL mode** — go to Step 1A
- If it's a local path or empty: **local mode** — go to Step 1B

---

## Step 1A: Org URL mode — Diff remote org vs local workspace

Run the init command to see what's present, missing, and local-only:

```bash
orcha init $ARGUMENTS --json
```

Parse the JSON. It contains:
- `diff[]` — each repo with status: `present` (already cloned), `missing` (in org but not local), `local-only` (local dir not in org)
- `summary` — counts for present/missing/localOnly
- `workspaceDir` — the resolved workspace path

### Present the diff to the user

Show a clear table:
- **Present**: repos already in the workspace (ready to analyze)
- **Missing**: repos in the org that need cloning — ask user which to include
- **Local-only**: dirs not in the org (other projects, tools) — note but ignore

Suggest **excluding** repos that look like:
- Templates (name contains "template")
- CI/CD config (renovate, sfci, pipeline repos)
- Deployment addons (stagger, caps)
- Orcha/Milo itself (the orchestration tool)

Ask the user to confirm which missing repos to clone. Default: all non-template, non-CI repos.

### Clone missing repos

For repos the user selected, clone them:

```bash
orcha clone <org-url> <repo1> <repo2> ... --workspace <workspace-dir>
```

Then proceed to **Step 2: Deep analysis**.

---

## Step 1B: Local mode — Scan existing workspace

Run the init command pointing at the local directory:

```bash
orcha init $ARGUMENTS --json
```

Parse the JSON. It contains:
- `mode: "local"` — confirms local scanning mode
- `repos[]` — each discovered repo with classification, ports, language
- `orgUrl` — inferred GitHub org from git remotes (may be null)
- `dependencies` — detected cross-repo dependencies
- `summary` — counts of services/infra/libraries

Show the user what was found:
- How many repos were scanned
- Classification breakdown (services, infra, libraries)
- Whether a GitHub org was inferred from git remotes

Then proceed to **Step 2: Deep analysis**.

---

## Step 2: Deep analysis — READ THE CODE

For each service repo in the workspace (both previously present and newly cloned), **read the actual source files**:

### Ports
- Read `config/default.cjs` or `config/default.js` — find `http.port` or `port` setting. This is the primary HTTP port.
- Read `Dockerfile` — check `EXPOSE` for production port.
- **Ignore** Redis (6379), Prometheus (15xxx), DynamoDB (8000) ports — those are infra.

### Health endpoints
- Read `server/main.js`, `src/index.ts`, `app.js` — look for health routes (`/health`, `/v1/health`, `/healthz`).
- Check the route handler to confirm it returns 200.

### Runtime dependencies
- Read `config/default.cjs` — look for URL references to other services (e.g., `userServiceAPI.url`, `statusAPI.url`).
- Read env vars / `NODE_CONFIG` — these reveal service-to-service connections.
- Read `docker-compose.yml` — `depends_on` shows infra dependencies.

### Profiles (local/staging/dev)
- Read `config/development.cjs`, `config/staging.cjs` — environment-specific overrides.
- Identify remote API URLs for staging/dev profiles.
- Look for `NODE_TLS_REJECT_UNAUTHORIZED=0` indicating proxy connections.

### Start command
- Read `package.json` scripts — pick the best dev command (`dev`, `start:dev`, `start-dev`).
- Check if it uses `concurrently`, `nodemon`, `vite`, etc.

### Infra services
- If repo has `docker-compose.yml` with Redis/DynamoDB/Postgres — these are infra dependencies.
- Determine which application service owns each infra service.

## Step 3: Generate orcha.config.yaml

Write a complete `orcha.config.yaml` in the workspace directory with:

- Accurate ports from source code analysis
- Correct health check paths
- Real runtime dependencies (not just npm links)
- Profiles for local/staging/dev with actual remote URLs
- Sensible presets based on the dependency graph
- Correct start commands per service
- GitHub org info (if available — from org URL or inferred from git remotes)

```yaml
version: 1
workspace:
  name: "<org-name or workspace-dir-name>"
github:                          # omit if no org info available
  host: "<host>"
  org: "<org>"
services:
  <service-id>:
    id: <service-id>
    label: "<Human Readable Name>"
    kind: service
    repoPath: "${workspace.root}/<repo-name>"
    workingDirectory: "${workspace.root}/<repo-name>"
    runtime:
      type: script
      command: { bin: npm, args: [run, dev] }
    localUrl: "http://localhost:<correct-port>"
    healthChecks:
      - { name: health, url: "http://localhost:<port>/<path>", expectedStatus: 200 }
    dependencies: [<runtime-deps>]
    runtimeModes: [local, remote]
    env:
      NODE_CONFIG: '<config-json>'
    profiles:
      staging:
        description: "Against staging APIs"
        env: { NODE_CONFIG: '<staging-overrides>' }
    verification:
      api:
        - { id: health, label: "Health", kind: api, method: GET, url: "...", expectedStatus: 200 }
      data: []
presets:
  core:
    description: "Core stack"
    services: [<top-level-ui>]
defaults:
  upTarget: "core"
onboard:
  binaries: [bun, docker, gh]
  skills: [orcha-init]
```

## Step 4: Validate

- YAML syntax is valid
- All dependency references resolve to existing service IDs
- All preset service references exist
- No port conflicts between services
- Health check URLs match service ports

Report summary: services configured, dependency graph, presets, and any items needing manual review.

## Step 5: Generate baseline KB

Ask the user if they'd like to generate baseline knowledge base documents for all services. If yes, run `/orcha-kb-baseline` to create architectural reference docs for each service. This gives the workspace immediate context without relying on PR history.
