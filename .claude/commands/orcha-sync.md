---
description: "Refresh agent knowledge: recent commits, PRs, and workspace changes"
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

## Step 3: Summarize

Provide a concise summary:
- **Active repos** with commit counts and key changes
- **Open PRs** needing review (group by repo)
- **Recently merged** PRs (notable features/fixes)
- **Quiet repos** (no activity — just mention count, don't list each)
- **Cross-repo patterns** (e.g., "3 repos bumped trust-mcp this week", "security dependency PRs open in 4 repos")

If there are significant changes (>10 commits or cross-repo coordinated PRs), suggest the user review specific PRs or changes.

Keep it brief — this is a status update, not an essay.
