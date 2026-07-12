---
name: session-management
description: Auto-save protocol for ending or switching sessions — runs /tools:handoff, conserves context, and files decisions, patterns, and bugs into the knowledge vault. Use when the user says handoff, done, or end session, when a major phase completes, or when context usage grows high.
---

# Session Management Protocol

This skill is a trigger/router. The step-by-step save protocol (handoff YAML schema, memory persistence, git staging) lives in `/tools:handoff`; the restore protocol lives in `/tools:catchup`. Do not restate them — invoke them.

## When to Fire → Which Command

| Situation | Action |
|---|---|
| User says "handoff", "done", "end session", or "switching" | Run `/tools:handoff` |
| Major phase completes (design approved, build finished, review passed) | Run `/tools:handoff` |
| Context usage high (~70%+ window, or conversation exceeds ~30 exchanges) | Run `/tools:handoff`, then conserve context (below) |
| Before handing work to Codex or another agent | Run `/tools:handoff` |
| New session resuming prior work | Run `/tools:catchup` |

## Context Conservation
- Use `/compact` proactively with targeted instructions when context feels heavy
- Between unrelated tasks, suggest `/clear` for a fresh window
- Load ONLY spec sections relevant to the current phase

## Memory Hygiene at Session End
In addition to the handoff file that `/tools:handoff` creates, file session learnings into the knowledge vault:
- [ ] Decisions → `docs/knowledge/decisions.md`
- [ ] Patterns → `docs/knowledge/patterns.md`
- [ ] Bugs → `docs/knowledge/bugs.md`
- [ ] ROADMAP.md reflects current status
- [ ] Handoff file written if WIP exists (via `/tools:handoff`)
