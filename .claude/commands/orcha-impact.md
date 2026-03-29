---
description: "Blast radius analysis: what breaks if a service changes or goes down"
argument-hint: "<service>"
---

Analyze the blast radius of changes to a service. Shows which other services, verification probes, and flow scenarios would be affected.

## Step 1: Get the impact analysis

```bash
orcha impact $ARGUMENTS --json
```

Parse the JSON. It contains:
- `service` — the target service ID
- `directDependents[]` — services that list this service in their dependencies
- `transitiveDependents[]` — services affected through the dependency chain
- `affectedProbes[]` — verification probes that would break
- `affectedFlows[]` — flow scenarios that involve this service
- `totalBlastRadius` — total count of affected services

## Step 2: Read the dependency graph for context

```bash
orcha graph $ARGUMENTS --json
```

Understand the target service's own dependencies — what it depends on and what depends on it.

## Step 3: Check current health

```bash
orcha verify stack --json
```

Are any of the affected services currently running? If the target service goes down, which running services would be impacted?

## Step 4: Present the analysis

Structure the response as:

### Blast Radius: <service name>

**Direct dependents** (will break immediately):
- List each with its kind and why it depends on this service

**Transitive dependents** (affected through chain):
- List each with the dependency path (A → B → target)

**Affected verification probes** (will fail):
- List each probe with the URL it checks

**Affected flow scenarios** (will break):
- List each flow with which step would fail

### Risk Assessment
- **High risk** if 3+ direct dependents or critical services affected
- **Medium risk** if 1-2 direct dependents
- **Low risk** if no dependents (leaf service)

### Recommendations
- If making breaking API changes: list which dependents need coordinated updates
- If taking the service down for maintenance: suggest which services to stop first
- If the service is already down: suggest starting it with `orcha up <service>`

Be concise and actionable. The developer wants to know "is it safe to change this?" not a lecture on dependency management.
