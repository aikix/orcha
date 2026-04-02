---
description: "Generate KB document from recent merged PRs for a service"
argument-hint: "<service>"
---

Generate a knowledge base document summarizing recent merged PRs for a service and write it to the central `knowledge/` directory.

## Step 1: Check existing KB docs

```bash
orcha kb list $ARGUMENTS --json
```

See what's already documented. Avoid duplicating existing content.

## Step 2: Get recent merged PRs

```bash
orcha pr list --since 4w --json
```

Filter for PRs that:
- Belong to the target service repo
- Are MERGED
- Are not already covered by existing KB docs (check dates)

## Step 3: Read the PR diffs

For each significant merged PR (skip trivial dep bumps, CI config changes), run:

```bash
orcha pr context <pr-url> --json
```

Read the diff and PR description to understand what changed.

## Step 4: Generate the KB document

Write a markdown document that captures the **non-obvious knowledge** from these PRs:

```markdown
# <Service Name> — <Topic/Summary>

*Generated: YYYY-MM-DD | PRs: #N, #N, #N*

## Summary
1-2 sentence overview of what changed and why.

## Key Changes
- **[Change 1]**: What changed, why it matters, what to know when working with this code
- **[Change 2]**: ...

## Impact
- Which other services are affected
- What config or behavior changed
- Migration notes if any

## Context
Any background that helps future developers understand the decision.
```

**Focus on knowledge that isn't obvious from the code itself:**
- Why was this approach chosen over alternatives?
- What edge cases were discovered?
- What does this unblock or change for other services?

**Don't document:**
- Routine dependency bumps
- Code formatting changes
- Things already in the code's comments or README

## Step 5: Write the document

Write to `knowledge/<service-id>/YYYY-MM-DD-<slug>.md` in the workspace.

Create the directory if it doesn't exist.

## Step 6: Verify

```bash
orcha kb list $ARGUMENTS
```

Confirm the new doc appears. Report what was generated and which PRs it covers.
