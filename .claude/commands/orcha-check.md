---
description: "Health assessment of workspace: binaries, services, dependencies"
---

Run a comprehensive health check of the orcha workspace and provide an intelligent summary.

## Step 1: Check prerequisites

```bash
orcha doctor --json
```

Parse the result. Report any missing binaries as blockers.

## Step 2: Verify service health

```bash
orcha verify stack --json
```

Parse the result. Categorize services into:
- **Healthy**: all checks passed
- **Down**: checks failed (service not running)
- **No checks**: libraries or services without health endpoints

## Step 3: Show the dependency graph

```bash
orcha graph --json
```

Use this to understand which services depend on which. If a service is down, note which other services would be affected.

## Step 4: Provide intelligent summary

Report a concise table:
- Binaries: all OK or list missing
- Services: X healthy, Y down, Z unchecked
- Notable: any running service whose dependency is down (broken chain)

Then provide **recommendations** based on what you see:
- If no services are running: suggest `orcha up <preset> --profile staging` for UI work or `--profile local` for full stack
- If a service is running but its dependency is down: flag it as a potential issue
- If Docker is not running but infra services are needed: suggest starting Docker
- If everything is healthy: confirm the stack is ready

Be concise. The user wants a quick status, not a wall of text.
