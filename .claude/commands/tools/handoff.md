---
description: "Capture full session state for handoff to next session or agent"
---

# Session Handoff

Capture the current session's state so the next session (or another agent) can resume seamlessly.

## When to use
- Context window approaching 70%+ usage
- End of a working session
- Before switching to a different task
- Before handing work to Codex or another agent

## Create Handoff File

Generate `.claude/sessions/handoff-$(date +%Y-%m-%d-%H%M).yaml` with:

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

compact_instruction: |
  [A /compact instruction tuned to the current task, e.g.:
   "Focus on the auth middleware refactor in src/middleware/auth.ts.
   Key context: we're switching from JWT to session tokens. Tests in
   tests/middleware/auth.test.ts need the mock session store pattern."]
```

## Also do:
1. Save a summary to `docs/memory/` for cross-agent persistence
2. Stage the handoff file: `git add .claude/sessions/`
3. Report: "Session captured. Resume with `/tools:catchup`"
