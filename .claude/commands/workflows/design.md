---
description: "Transform a brief into a grounded technical design with adversarial self-review"
---

# Phase 2: Technical Design

You are acting as a systems architect. Your job is to produce a design document grounded in first principles, verified against the actual codebase, and stress-tested before approval.

## Input
`$ARGUMENTS` is the **feature slug** that `/workflows:idea` derived and confirmed in its Step 1a
(lowercase, hyphens, ≤40 chars). Use it verbatim as a path segment — do **not** re-derive a slug
from it, and do not accept free prose here. If `docs/specs/$ARGUMENTS/` does not exist, list the
directories under `docs/specs/` and ask which one was meant rather than creating a new path from
prose.

Read the brief at `docs/specs/$ARGUMENTS/brief.md`.
Read `docs/knowledge/architecture.md` for current system design.
Read `docs/knowledge/patterns.md` for established conventions.
Route `docs/knowledge/decisions.md` by section — do not read it whole (it is ~66 KB):
1. Grep its headings: `Grep(pattern: "^## ", path: "docs/knowledge/decisions.md", output_mode: "content")`. Each ADR is one `## <date> — <title>` section.
2. Compare the headings against the brief's topic, constraints, and the files it will touch. Pick the entries that plausibly apply.
3. Read only those entries: Grep with `-A` context from the matching heading, or Read with `offset`/`limit` bounded by the next `## ` line.
Record the ADR headings you opened (and any you ruled out on a close call) so the design's Architecture Decision can cite or deliberately depart from each.

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

Before spawning the reviewer, read `.claude/rules/bash.md` and `.claude/rules/lead.md` and extract the full content of each one's `## Agent Rules` section (everything after that heading). Store the bash rules as `BASH_AGENT_RULES` and the lead rules as `LEAD_AGENT_RULES` — substitute them into the reviewer prompt where indicated below.

**Spawn contract:** the reviewer is a **registered roster agent dispatched by name**. If the named agent type is unknown, halt with the escalation message "Retry cap reached on dispatch. Blocker: agent <name> not registered. Suggested next: run tests/agent-roster.test.ts." Never fall back to `general-purpose` or any agent not in the roster — the reviewer would silently land on the env-var model tier instead of the roster tier.

Before presenting to the user, spawn a reviewer sub-agent with this prompt:

```
Agent(
  subagent_type: "reviewer-architecture",
  prompt: <the prompt below>
)
```

"You are a critical code reviewer. Read the design at `<main-repo absolute path>/docs/specs/$ARGUMENTS/design.md` (docs/specs is gitignored; worktrees cannot see it). Your job is to find flaws. Check:
1. Are any UNVERIFIED assumptions load-bearing? Flag them.
2. Does the approach conflict with patterns in docs/knowledge/patterns.md or the conventions in `<main-repo absolute path>/CLAUDE.md` (you run with `omitClaudeMd: true`, so read it from that absolute path)?
2a. ADR-conflict check: grep the `^## ` headings of docs/knowledge/decisions.md, open every ADR whose topic touches this design, and flag any place the design contradicts or silently reverses a recorded decision (cite the ADR heading). A deliberate departure must say so in the design's Architecture Decision.
3. Are there security gaps in the Security Considerations section?
4. Is the testing strategy sufficient to catch regressions?
5. Are there simpler alternatives the designer missed?
6. For every finding from a PRIOR review round that was closed by adding a condition, check, or guard: attack the fixed condition itself. A fix is a fresh attack surface, not a settled matter — ask what inputs satisfy the new check while still violating the property it exists to protect.
Output format — one line per finding:
`SEVERITY / FILE:LINES / ISSUE / FIX`
Severity is one of CRITICAL, HIGH, MEDIUM, LOW. Report everything; the designer filters. After the findings, add the ranked list of findings ordered CRITICAL > HIGH > MEDIUM > LOW.

BASH COMMAND RULES:
[BASH_AGENT_RULES]

AGENT RULES:
[LEAD_AGENT_RULES]"

## Step 4: Iterate or Approve

Present the design AND the review findings to the user.
If there are CRITICAL or HIGH findings, suggest specific revisions.
The user decides whether to iterate or approve.

When approved, update the design status to APPROVED and tell the user:
"Design approved. Run `/workflows:plan $ARGUMENTS` to decompose into tasks."
