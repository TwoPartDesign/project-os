---
description: "Guided product requirements document through Socratic discovery"
---

# PRD Creator

Guide the user through product thinking. WHAT and WHY, not HOW.

## Discovery (ask 2-3 at a time)

### Problem Space
- Who is this for? (Even "just me" — define the use case specifically)
- What's the current workaround? What's painful about it?
- What triggers the need? (What event makes someone reach for this?)

### Success
- If this works perfectly, what changes in your workflow?
- Walk me through the 30-second demo.
- What's the ONE thing this must do well?

### Scope
- What does v0.1 look like? (Smallest useful thing)
- What's explicitly NOT in v0.1?
- What would make you abandon this? (Time/complexity ceiling)

## Write PRD

Create `docs/prd/$ARGUMENTS.md`:

```
# PRD: [Name]

## One-Liner
[Single sentence: what and who]

## Problem
[Pain point, in user language]

## Solution
[High-level WHAT, not HOW]

## User Stories
- As [persona], I want [action] so that [benefit]

## Success Metrics
- [Metric]: [measurement]

## Scope
### v0.1 (MVP)
- [Must-have]

### v0.2 (If v0.1 works)
- [Nice-to-have]

### Out of Scope
- [Excluded]

## Constraints
- Time: [budget]
- Tech: [limits]

## Open Questions
- [Unresolved]
```

Add to ROADMAP.md under `### Ideas`.
