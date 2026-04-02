---
description: "Full new developer onboarding: prereqs, workspace init, stack startup, seed data, and orientation"
argument-hint: "[github-org-url | workspace-dir]"
---

Take a new developer from zero to productive in one command. This skill chains together prerequisite checks, workspace init, stack startup, data seeding, and orientation.

## Step 1: Check prerequisites

```bash
orcha doctor --json
```

Parse the result. If any required binaries are missing, provide install instructions:
- **bun**: `curl -fsSL https://bun.sh/install | bash`
- **docker**: Download from https://www.docker.com/products/docker-desktop/
- **gh**: `brew install gh` then `gh auth login`

If critical binaries are missing (bun, gh), stop and ask the user to install them first. Docker is only needed for `--profile local` (full stack); staging profiles work without it.

## Step 2: Initialize workspace

Check if `orcha.config.yaml` exists in the workspace:

```bash
ls orcha.config.yaml 2>/dev/null
```

**If no config exists:** Run `/orcha-init` with the provided arguments to scan, clone, analyze, and generate config. Follow all steps in that skill.

**If config already exists:** Skip to Step 3. The workspace is already initialized.

## Step 3: Start the stack

Determine the default startup target from config:

```bash
orcha list presets --json
```

Start with the staging profile (no Docker needed — best for first-time setup):

```bash
orcha up <default-preset> --profile staging --json
```

If staging profile doesn't exist, try local:

```bash
orcha up <default-preset> --profile local --json
```

Parse the result. Report which services started and which failed.

If any service failed:
- Check if it's a Docker dependency and Docker isn't running
- Check if a port is already in use
- Suggest running `/orcha-debug <service>` for the failed service

## Step 4: Verify health

```bash
orcha verify stack --json
```

Report the health status. All services should be healthy after Step 3.

## Step 5: Seed test data (if available)

```bash
orcha seed --json
```

If fixtures are defined, run them. Report which succeeded and which failed. If no fixtures are defined, skip this step silently.

## Step 6: Orientation

Show the developer their workspace:

```bash
orcha list services --json
orcha list presets --json
orcha kb status --json
```

Present a concise orientation:

### Your Workspace
- **Services**: list all services with their URLs and health status
- **Presets**: available presets and what they start
- **Profiles**: available profiles (local, staging, dev) and what each does
- **KB**: how many knowledge docs exist, which services are documented

### Daily Commands
| What | Command |
|------|---------|
| Check health | `/orcha-check` |
| Stay current | `/orcha-sync` |
| Debug a failure | `/orcha-debug <service>` |
| Review a PR | `/orcha-pr-review <url>` |
| Start stack | `orcha up <preset> --profile <name>` |
| Stop everything | `orcha down` |

### Next Steps
- Browse KB docs: `orcha kb list` to see available documentation
- If KB is empty, suggest: "Run `/orcha-kb-baseline` to generate docs from source code"
- Bookmark this workspace for future sessions

Be concise. The user just wants to start coding, not read documentation.
