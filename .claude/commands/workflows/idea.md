---
description: "Capture a rough idea, research feasibility, output a structured brief"
---

# Phase 1: Idea Capture & Research

You are acting as a product strategist and technical researcher. Your job is to transform a fuzzy idea into a structured brief that can feed the design phase.

## Step 1: Extract the idea

Read the user's input: $ARGUMENTS

### Step 1a: Derive the feature slug — DO THIS BEFORE CREATING ANY PATH

`$ARGUMENTS` is free prose. It is **never** safe to use as a directory name. A realistic
invocation produced a 150-character directory containing spaces, parentheses, commas, and an
em-dash; with the per-task context directories `/workflows:plan` creates underneath
(`docs/specs/<slug>/tasks/T13/context.md`), that pushes against `MAX_PATH` on Windows and
forces every downstream reference to be quoted.

Derive `FEATURE_SLUG` from `$ARGUMENTS`:

1. Lowercase.
2. Replace every run of non-alphanumeric characters with a single `-`.
3. Collapse repeated `-`; trim leading/trailing `-`.
4. Truncate to **40 characters max**, then trim any trailing `-`.
5. If the result is empty, ask the user to name the feature.

Example: `"Add a per-song difficulty curve (easy/medium/hard), tuned by BPM — see PRD §4"`
becomes `add-a-per-song-difficulty-curve-easy-med`.

Then **confirm before creating anything**:

> Feature slug: `add-a-per-song-difficulty-curve-easy-med`
> Spec directory will be `docs/specs/add-a-per-song-difficulty-curve-easy-med/`.
> Press Enter to accept, or type a different slug (lowercase, hyphens only).

Use the confirmed value as `FEATURE_SLUG` for the rest of this command. Every path below uses
`FEATURE_SLUG`, never `$ARGUMENTS`. The ROADMAP feature section heading and the display name in
the brief keep the user's original prose — only *paths and the ROADMAP section key* use the slug.

**Downstream commands inherit this slug; they must not re-derive it.** `/workflows:design`,
`/workflows:plan`, `/pm:approve`, and `/workflows:build` all take the slug as their argument.
Tell the user the exact next command with the slug already substituted.

If the input is vague, ask AT MOST 3 clarifying questions covering:
- What problem does this solve for you personally?
- What does "done" look like — what's the minimum viable version?
- Are there any hard constraints (tech stack, timeline, dependencies)?

Do NOT over-interview. If the idea is clear enough, skip to Step 2.

## Step 2: Parallel research (sub-agents)

Run the parallel research protocol from `/tools:research` with up to 2 agents. That command defines the fan-out mechanics: agent dispatch via the researcher role spec, the `BASH_AGENT_RULES` injection from `.claude/rules/bash.md`, and the per-agent output format. Do not restate them here.

For a feasibility brief, use these two questions:

**Question 1 (internal reuse)**: "Search the project's existing codebase and docs/knowledge/ for anything related to [topic]. Also check docs/memory/ for past decisions on similar problems. Report: what exists, what can be reused, what conflicts."

**Question 2 (external options)**: "Search for existing solutions, libraries, or approaches to [problem]. Check if the project's current stack has native support. Report: 3 options ranked by simplicity, with tradeoffs."

If a Context7 MCP is available, agents should use it for library doc verification.
If not, agents should note any library claims that need manual verification.

Skip `/tools:research`'s own synthesis step — synthesize agent findings into the brief (Step 3) instead.

## Step 3: Synthesize into brief

Create `docs/specs/$FEATURE_SLUG/brief.md` (using the slug confirmed in Step 1a, never raw `$ARGUMENTS`) with this structure:

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

Add a draft entry to ROADMAP.md under the appropriate feature section. The section key is the
**slug**, so `/pm:approve <slug>` and `/workflows:build <slug>` can find it:
```
## Feature: $FEATURE_SLUG
### Draft
- [?] [Feature Name] — Brief created, awaiting design #T<next_available_id>
```
Use the next available `#TN` ID (check existing tasks to avoid conflicts).

Save a memory entry to `docs/memory/` summarizing the idea and key decisions.

Tell the user, with the slug already substituted so it can be copy-pasted:
"Brief created at `docs/specs/$FEATURE_SLUG/brief.md`. Run `/workflows:design $FEATURE_SLUG` when ready to proceed."
