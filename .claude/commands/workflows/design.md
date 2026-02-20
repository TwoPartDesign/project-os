---
description: "Transform a brief into a grounded technical design with adversarial self-review"
---

# Phase 2: Technical Design

You are acting as a systems architect. Your job is to produce a design document grounded in first principles, verified against the actual codebase, and stress-tested before approval.

## Input
Read the brief at `docs/specs/$ARGUMENTS/brief.md`.
Read `docs/knowledge/architecture.md` for current system design.
Read `docs/knowledge/patterns.md` for established conventions.
Read `docs/knowledge/decisions.md` for past ADRs that may apply.

## Step 1: First-Principles Analysis

For each constraint in the brief:
1. Classify as HARD (non-negotiable) or SOFT (preference, can flex)
2. Flag any soft constraints being treated as hard — these limit the solution space unnecessarily
3. Verify each constraint is still true by checking the actual codebase

For the proposed solution:
1. Reconstruct the approach from only validated truths — not assumptions
2. Identify the 2-3 alternative approaches you considered and why this one wins
3. List every assumption and mark each as VERIFIED (checked code/docs) or UNVERIFIED

## Step 2: Design Document

Create `docs/specs/$ARGUMENTS/design.md`:

```markdown
# Design: [Feature Name]
Created: [date]
Status: DRAFT
Brief: ./brief.md

## Architecture Decision
[The chosen approach and WHY — not just what]

## Alternatives Considered
| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| [Alt 1]  |      |      |         |
| [Alt 2]  |      |      |         |

## Constraint Analysis
| Constraint | Type | Verified | Notes |
|------------|------|----------|-------|
| [C1]       | HARD | ✅/❌    |       |

## Assumptions
| Assumption | Status | Evidence |
|------------|--------|----------|
| [A1]       | VERIFIED/UNVERIFIED | [file:line or doc link] |

## Technical Approach
### Data Model
[If applicable]

### Key Interfaces
[Function signatures, API shapes]

### File Changes
[Which files will be created/modified, with purpose]

### Dependencies
[New deps needed — each must be justified]

## Testing Strategy
[What tests will verify this works — defined NOW, not after build]

## Security Considerations
[Attack vectors, data exposure, auth requirements]

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [R1] |           |        |            |
```

## Step 3: Self-Adversarial Review

Before presenting to the user, spawn a reviewer sub-agent with this prompt:

"You are a critical code reviewer. Read the design at docs/specs/$ARGUMENTS/design.md. Your job is to find flaws. Check:
1. Are any UNVERIFIED assumptions load-bearing? Flag them.
2. Does the approach conflict with patterns in docs/knowledge/patterns.md?
3. Are there security gaps in the Security Considerations section?
4. Is the testing strategy sufficient to catch regressions?
5. Are there simpler alternatives the designer missed?
Output a list of findings ranked by severity (CRITICAL > HIGH > MEDIUM > LOW). For each finding, include a specific recommendation."

## Step 4: Iterate or Approve

Present the design AND the review findings to the user.
If there are CRITICAL or HIGH findings, suggest specific revisions.
The user decides whether to iterate or approve.

When approved, update the design status to APPROVED and tell the user:
"Design approved. Run `/workflows:plan $ARGUMENTS` to decompose into tasks."
