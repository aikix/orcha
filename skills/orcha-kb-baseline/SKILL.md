---
description: "Generate baseline KB for all services after workspace init"
argument-hint: "[workspace-dir]"
---

Generate baseline knowledge base documents for all services in the workspace. This is designed to run after `/orcha-init` to bootstrap KB with architectural context — not PR history.

## Step 1: Load the workspace config

```bash
orcha config show --json
```

Parse to get the list of services and their `repoPath` values. If no config exists yet, abort and tell the user to run `/orcha-init` first.

## Step 2: Check existing KB

```bash
orcha kb list --json
```

Skip any service that already has a baseline doc (filename contains `baseline`).

## Step 3: For each service, read key source files

For every service without a baseline KB, read the following files from its repo (skip files that don't exist):

1. **README.md** — purpose, setup instructions, context
2. **package.json** — name, scripts, key dependencies
3. **config/default.cjs** or **config/default.js** — ports, URLs, feature flags
4. **docker-compose.yml** — infra dependencies (Redis, DynamoDB, Postgres, etc.)
5. **Dockerfile** — runtime, exposed ports, build steps
6. **src/index.ts** or **server/main.js** or **app.js** — entry point, route setup, middleware
7. **tsconfig.json** — TypeScript config if present (indicates TS project)

Also glance at the top-level directory structure (`ls`) to understand the repo layout.

## Step 4: Generate baseline KB document

For each service, write a document capturing what a new developer needs to know:

```markdown
# <Service Name> — Baseline

*Generated: YYYY-MM-DD | Source: code analysis*

## Purpose
1-2 sentences: what this service does and who uses it.

## Tech Stack
- Runtime: Node.js XX / Bun / etc.
- Framework: Express / Vite / React / etc.
- Language: TypeScript / JavaScript
- Key libraries: (only notable ones — ORM, queue client, auth, etc.)

## Architecture
- Entry point: `path/to/main`
- How requests flow (API routes, middleware chain, etc.)
- Key patterns (event-driven, queue-based, proxy, aggregator, etc.)

## Configuration
- Default port: XXXX
- Config files: `config/default.cjs`, etc.
- Key environment variables and what they control

## Dependencies
- **Services**: which other services this talks to (with URLs from config)
- **Infrastructure**: Redis, DynamoDB, SQS, Postgres, etc.

## Development
- Install: `npm install` / `yarn install` / `bun install`
- Dev server: `npm run dev` / the correct script
- Test: `npm test` (unit), `npm run test:integration`, etc.
- Build: `npm run build`

## Directory Structure
Brief overview of the repo layout and what lives where.

## Gotchas
Anything non-obvious discovered during analysis:
- Unusual config patterns
- Services that must be running for this to work
- Known quirks (e.g., TLS settings, timezone requirements)
```

**Guidelines:**
- Only document what you actually found in the code — don't guess or assume
- Keep it factual and concise — this is a reference doc, not prose
- If a section has nothing useful, omit it rather than writing filler
- Focus on things that save a developer time when they first encounter this service

## Step 5: Write the documents

Write each baseline to: `knowledge/<service-id>/baseline.md`

Create the directory if needed.

## Step 6: Summary

```bash
orcha kb list
```

Report:
- How many baseline docs were generated
- Which services were skipped (already had baseline)
- Any services that were hard to analyze (no README, unusual structure, etc.)
