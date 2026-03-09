---
description: "Transform a PRD into trackable tasks in ROADMAP.md"
---

# Epic Breakdown

## Input

Read `docs/prd/$ARGUMENTS.md`. If missing:
> "No PRD found. Run `/pm:prd $ARGUMENTS` first."

## Process

For each v0.1 scope item:
1. Single task or needs decomposition?
2. Estimate: S (hours), M (half-day), L (full day), XL (split it)
3. Dependencies between tasks
4. Priority: P0-P3

## Output

Add to ROADMAP.md under the relevant feature section. Use `[?]` draft markers and `#TN` IDs (increment from the last used ID). Tasks created here still require `/pm:approve` before building:

```
## Epic: [Feature Name]
Source: docs/prd/$ARGUMENTS.md

[?] #T1 P0 — [Task 1] (S) — no deps
[?] #T2 P0 — [Task 2] (M) — no deps
[?] #T3 P1 — [Task 3] (M) — depends on #T1
[?] #T4 P2 — [Task 4] (S) — depends on #T2, #T3
```

> "Epic: [N] tasks added as drafts. Run `/pm:approve` to approve tasks for building, or `/workflows:idea [feature]` to go through the full spec pipeline first."
