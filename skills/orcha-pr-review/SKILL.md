---
description: "AI-powered PR review with full context and blast radius analysis"
argument-hint: "<pr-url>"
---

Review a pull request by extracting its full context, reading the affected code, and delivering a structured verdict.

## Step 1: Extract PR context

```bash
orcha pr context $ARGUMENTS --json
```

Parse the JSON. You now have: title, body, author, state, diff, files changed, reviews, comments, additions/deletions.

## Step 2: Read the diff

The `diff` field contains the full unified diff. Read it carefully, focusing on:
- **Logic changes** (not just rename/formatting)
- **New code paths** that could have edge cases
- **Deleted code** that might break callers
- **Test coverage** — are new code paths tested?

## Step 3: Trace blast radius

For each significantly changed file, check the `files` list and consider:
- Is this a shared utility? Who else imports it?
- Is this a config change? What environments does it affect?
- Is this a UI component? What pages render it?
- Is this an API change? What clients call it?

If the repo is local, read related files to understand the impact:
- For a changed function: grep for callers
- For a changed component: check which pages use it
- For a config change: check what reads it

## Step 4: Analyze

Evaluate the PR on these dimensions:

### Correctness
- Does the logic do what the PR description claims?
- Are there edge cases the author missed?
- Are null/undefined values handled?

### Security
- Any user input flowing to dangerous sinks (SQL, exec, innerHTML)?
- Secrets, tokens, or credentials exposed?
- Auth/authorization changes?

### Tests
- Are new code paths covered by tests?
- Do existing tests still make sense after the change?
- Are snapshot updates reasonable?

### Style & Maintainability
- Is the code readable?
- Are there unnecessary complexity additions?
- Does it follow the project's existing patterns?

## Step 5: Deliver verdict

Structure your review as:

**Verdict: APPROVE / REQUEST CHANGES / COMMENT**

**Summary:** 1-2 sentence overview of what the PR does and whether it's ready.

**Findings:** (if any)
- 🔴 **Blocker:** [description] — must fix before merge
- 🟡 **Suggestion:** [description] — would improve but not blocking
- 🟢 **Nice:** [description] — good pattern worth noting

**Blast radius:** Which services/pages/users are affected by this change.

Keep findings focused on substance, not nitpicks. If the PR is clean, say so briefly.
