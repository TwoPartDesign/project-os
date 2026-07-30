---
description: "Capture full session state for handoff to next session or agent"
---

# Session Handoff

Capture the current session's state so the next session (or another agent) can resume seamlessly.

## When to use
- Context window approaching 70%+ usage
- When `compact-suggest.sh` injects a context-pressure notice — write the handoff
  then, not later; compaction discards what a later handoff would have described
- End of a working session
- Before switching to a different task
- Before handing work to Codex or another agent

## Auto-checkpoints

A PreCompact hook automatically generates checkpoint files before context compaction.
These are saved as `.claude/sessions/auto-checkpoint-*.yaml` and follow the same schema
as manual handoffs. Use `/tools:catchup` to resume from either type.

Auto-checkpoints are filesystem-derived — ROADMAP markers and `git status`. They
cannot record why anything was decided. Manual handoffs via this command capture
that richer context (decisions, blockers, context notes) and remain the only way
those survive compaction.

## How `compact_instruction` is used

`pre-compact.sh` reads the newest handoff written in the last 30 minutes, extracts
its `compact_instruction` block, and prints it on stdout. The runtime forwards
PreCompact stdout to the compaction summarizer as custom instructions — so this
field is what steers what compaction keeps.

This makes `compact_instruction` **mandatory**, not decorative:

- Write it as instructions **to the summarizer**, not notes to a human. "Preserve
  the exact awk extraction in pre-compact.sh:78-82 and the reason `git diff` was
  rejected for `git status --porcelain`" — not "worked on hooks today".
- Name the files, functions, and line ranges that must survive verbatim.
- Name what is safe to drop (exploration that went nowhere, superseded attempts).
- Leaving the template placeholder text in place is treated as absent — the hook
  rejects it and the summarizer gets no guidance.
- Freshness is judged per compaction cycle: a handoff written before this
  session's last compaction is ignored, however recently. The 30-minute age
  window (`PROJECT_OS_HANDOFF_MAX_AGE_MIN`) applies only to a session's first
  compaction, when there is no cycle marker to compare against yet.

## Create Handoff File

Generate `.claude/sessions/handoff-$(date +%Y-%m-%d-%H%M%S)-$RANDOM.yaml` with:

Evaluate that whole expression in one shell call — do not compose the name by
hand. Seconds and the random token are what keep two sessions sharing this
checkout from writing the same path: at minute granularity, two `/tools:handoff`
runs in the same minute produced one filename, so the second write silently
destroyed the first and `pre-compact.sh` forwarded whichever body survived to
both sessions' summarizers. The token goes **after** the full timestamp so
lexical order stays chronological — `pre-compact.sh` selects the newest
candidate with `sort`, not with `find -printf`.

```yaml
timestamp: [ISO 8601]
phase: [idea|design|plan|build|review|ship|ad-hoc]
feature: [feature name if applicable, "none" if ad-hoc]

objective: |
  [1-2 sentences: what you were trying to accomplish]

progress:
  completed:
    - description: [what was done]
      files: [file:line-range]
    - description: [what was done]
      files: [file:line-range]
  in_progress:
    - description: [what's partially done]
      files: [file:line-range]
      state: [where exactly you left off]

decisions:
  - decision: [what was decided]
    rationale: [why]
    alternatives_rejected: [what else was considered]

modified_files:
  - path: [file path]
    focus_range: [start_line-end_line]
    change_type: [created|modified|deleted]
    summary: [one-line description of change]

blockers:
  - issue: [description]
    attempted: [what you tried]
    suggested_next: [what to try next]

next_steps:
  - priority: 1
    action: [specific next action]
    context: [what the next session needs to know]
  - priority: 2
    action: [specific next action]

context_notes: |
  [Anything important that would be lost without explicit capture.
   Gotchas discovered, edge cases found, things that almost worked, etc.]

# REQUIRED. Forwarded verbatim to the compaction summarizer by pre-compact.sh.
# Two-space indent on every line — the hook's block-scalar extraction strips
# exactly that. Replace the placeholder; unfilled placeholder text is rejected.
compact_instruction: |
  [A /compact instruction tuned to the current task, e.g.:
   "Focus on the auth middleware refactor in src/middleware/auth.ts.
   Preserve verbatim: the token-rotation logic at auth.ts:120-168 and the
   reason httpOnly cookies were chosen over localStorage. Tests in
   tests/middleware/auth.test.ts need the mock session store pattern.
   Safe to drop: the abandoned Redis-backed session experiment."]
```

## Also do:
1. Save a summary to `docs/memory/` for cross-agent persistence
2. Stage the handoff file: `git add .claude/sessions/`
3. Report: "Session captured. Resume with `/tools:catchup`"
