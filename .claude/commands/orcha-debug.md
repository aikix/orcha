---
description: "Deep diagnostic when a service is failing — root cause + fix"
argument-hint: "<service>"
---

Diagnose why a service is failing. Gather data from multiple sources, correlate, and provide a root cause hypothesis with a recommended fix.

## Step 1: Gather config and dependencies

```bash
orcha inspect config $ARGUMENTS --json
```

```bash
orcha graph $ARGUMENTS --json
```

Understand: what port, what dependencies, what profile, what env vars.

## Step 2: Check health of the service and its dependencies

```bash
orcha verify stack --json
```

Parse the results. Is the target service down? Are any of its dependencies down? A common root cause is a dependency being unhealthy.

## Step 3: Read logs

```bash
orcha logs $ARGUMENTS 100
```

If logs exist, read them carefully. Look for:
- Stack traces / exceptions
- "ECONNREFUSED" — dependency not reachable
- "EADDRINUSE" — port conflict
- "EACCES" — permission issues
- Timeout errors
- Config validation errors
- Auth/token failures

If no logs (compose service), suggest:
```bash
docker compose -p orcha-<service> logs --tail 100
```

## Step 4: Read service source code if needed

If the error points to a specific file or config issue, read the actual source:
- Config files: `config/default.cjs`, `config/development.cjs`
- Server entry point: `server/main.js`, `src/index.ts`, `src/app.js`
- The specific file mentioned in the stack trace

## Step 5: Check KB for known issues

```bash
orcha kb list $ARGUMENTS --json
```

If KB docs exist for this service, read them — they may document known issues, troubleshooting steps, or environment requirements.

## Step 6: Diagnose

Based on all gathered data, provide:

### Root Cause
One clear statement of what's wrong and why.

### Evidence
- Which logs/errors support this diagnosis
- Which dependency state confirms it
- Which config setting is the issue

### Recommended Fix
Specific, actionable steps. Not "check the config" but "change port from X to Y in config/local.cjs" or "start Redis with `docker run -d -p 6379:6379 redis`".

### Prevention
If applicable, what would prevent this from happening again (e.g., add a health check, fix a missing null guard, add a dependency to the preset).

Be direct. The user has a broken service and wants it fixed, not a lecture.
