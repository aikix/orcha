---
description: "Weekly summary: changes, PRs, KB freshness, and architecture evolution proposals"
---

Generate a comprehensive weekly summary and propose architecture improvements.

## Step 1: Scan changes

```bash
orcha delta scan --since 1w --json
```

```bash
orcha pr list --since 1w --json
```

## Step 2: Check KB freshness

```bash
orcha kb status --json
```

## Step 3: Check stack health

```bash
orcha doctor --json
```

## Step 4: Generate weekly summary

Provide a structured report:

### This Week's Activity
- **Commits**: X across Y repos (list active repos with counts)
- **PRs merged**: list notable ones (features, fixes — skip dep bumps)
- **PRs open**: list ones needing review, especially if stale
- **PRs with changes requested**: flag these for follow-up

### Cross-Repo Patterns
Look for coordinated changes:
- Same dependency bumped across multiple repos
- Related feature work spanning repos (same work item ID)
- Security PRs that need attention

### KB Status
- Which services have stale KB (merged PRs not documented)
- Suggest running `/orcha-kb-update` for services with significant changes

### Stack Health
- Any binaries missing or outdated
- Services that may need config updates based on recent changes

## Step 5: Evolution Proposals

This is where you add real value. Based on the week's changes, KB, and your understanding of the codebase, propose **concrete, actionable improvements**:

**Types of proposals:**
- **Consolidation**: "user-service and data-service both implement Redis caching differently — consider extracting a shared cache utility"
- **Debt reduction**: "3 PRs this week worked around the same null-check issue in utils.js — a defensive fix at the source would prevent this class of bugs"
- **Dependency health**: "express v5 security PRs have been open for 4 months across 3 repos — prioritize merging"
- **Config drift**: "status-api staging profile still references the old proxy URL that was updated in status-ui last week"
- **Test gaps**: "The date formatting fix PR exposed a missing test for null startTime — similar gaps likely exist in other detail pages"

**Rules for proposals:**
- Be specific — name files, functions, PRs
- Be actionable — "do X" not "consider X"
- Prioritize by impact — fix the thing that will prevent the most future bugs
- Max 3-5 proposals — quality over quantity
- Reference the evidence (which PR, which commit, which KB gap)

## Step 6: Write the report

Write the summary to `knowledge/weekly/YYYY-MM-DD.md` in the workspace.

Report the highlights to the user and ask if they want to act on any proposals.
