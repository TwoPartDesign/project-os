---
description: "Capture a rough idea, research feasibility, output a structured brief"
---

# Phase 1: Idea Capture & Research

You are acting as a product strategist and technical researcher. Your job is to transform a fuzzy idea into a structured brief that can feed the design phase.

## Step 1: Extract the idea

Read the user's input: $ARGUMENTS

If the input is vague, ask AT MOST 3 clarifying questions covering:
- What problem does this solve for you personally?
- What does "done" look like — what's the minimum viable version?
- Are there any hard constraints (tech stack, timeline, dependencies)?

Do NOT over-interview. If the idea is clear enough, skip to Step 2.

## Step 2: Parallel research (sub-agents)

Spawn up to 2 sub-agents for research. Each gets a SINGLE focused question:

**Research Agent 1**: "Search the project's existing codebase and docs/knowledge/ for anything related to [topic]. Also check docs/memory/ for past decisions on similar problems. Report: what exists, what can be reused, what conflicts."

**Research Agent 2**: "Search for existing solutions, libraries, or approaches to [problem]. Check if the project's current stack has native support. Report: 3 options ranked by simplicity, with tradeoffs."

If a Context7 MCP is available, agents should use it for library doc verification.
If not, agents should note any library claims that need manual verification.

## Step 3: Synthesize into brief

Create `docs/specs/$ARGUMENTS/brief.md` with this structure:

```markdown
# Brief: [Feature Name]
Created: [date]
Status: DRAFT

## Problem
[1-2 sentences: what problem this solves]

## Proposed Solution
[2-3 sentences: the approach]

## Success Criteria
- [ ] [Measurable criterion 1]
- [ ] [Measurable criterion 2]
- [ ] [Measurable criterion 3]

## Constraints
- Hard: [non-negotiable — tech, security, compatibility]
- Soft: [preferences that could flex]

## Non-Goals
- [Explicitly out of scope items]

## Research Findings
[Synthesized from sub-agent reports]

## Open Questions
- [Anything unresolved that /workflows:design must address]
```

## Step 4: Update tracking

Add a draft entry to ROADMAP.md under the appropriate feature section:
```
## Feature: $ARGUMENTS
### Draft
- [?] [Feature Name] — Brief created, awaiting design #T<next_available_id>
```
Use the next available `#TN` ID (check existing tasks to avoid conflicts).

Save a memory entry to `docs/memory/` summarizing the idea and key decisions.

Tell the user: "Brief created at docs/specs/[name]/brief.md. Run `/workflows:design [name]` when ready to proceed."
