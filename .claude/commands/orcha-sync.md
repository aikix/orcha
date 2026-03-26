---
description: "Refresh agent knowledge: recent commits, PRs, workspace changes, and KB freshness"
---

Sync your understanding of what's been happening across the workspace.

## Step 1: Scan recent commits

```bash
orcha delta scan --since 1w --json
```

Note which repos had activity and which were quiet.

## Step 2: Scan recent PRs

```bash
orcha pr list --since 1w --json
```

Cross-reference with commits. PRs show what's in review/merged, commits show what landed on main.

## Step 3: Check KB freshness

```bash
orcha kb status --json
```

For each service with recent merged PRs, check if the KB is stale:
- **Stale**: service has merged PRs since last KB update (or no KB docs at all)
- **Fresh**: KB was updated after the latest merged PR
- **No activity**: no recent PRs, KB doesn't need updating

## Step 4: Summarize

Provide a concise summary:
- **Active repos** with commit counts and key changes
- **Open PRs** needing review (group by repo)
- **Recently merged** PRs (notable features/fixes)
- **Quiet repos** (no activity — just mention count, don't list each)
- **Cross-repo patterns** (e.g., "3 repos bumped shared-utils this week")
- **KB freshness**: which services have stale KB docs that should be updated

## Step 5: Offer KB update

If any services have stale KB, ask the user:

> "data-service has 3 merged PRs not covered by KB docs. Run /orcha-kb-update data-service?"

This keeps KB growing naturally as part of the daily workflow.
