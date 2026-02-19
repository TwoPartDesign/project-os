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

Update ROADMAP.md under `### Queued`:

```
## Epic: [Feature Name]
Source: docs/prd/$ARGUMENTS.md

[ ] P0 — [Task 1] (S) — no deps
[ ] P0 — [Task 2] (M) — no deps
[ ] P1 — [Task 3] (M) — depends on Task 1
[ ] P2 — [Task 4] (S) — depends on Task 2, 3
```

> "Epic: [N] tasks. Run `/workflows:idea [task]` for the spec pipeline, or tackle (S) tasks directly."
