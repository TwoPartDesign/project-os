# Session Management Protocol

**Trigger**: User says "handoff", "done", "end session", "switching", or context usage appears high.

## Auto-Handoff Triggers

Run `/tools:handoff` automatically when:
1. User explicitly says they're done or switching tasks
2. A major phase completes (design approved, build finished, review passed)
3. Conversation exceeds ~30 exchanges

## Context Conservation
- Use `/compact` proactively with targeted instructions when context feels heavy
- Between unrelated tasks, suggest `/clear` for a fresh window
- Load ONLY spec sections relevant to the current phase

## Memory Hygiene at Session End
- [ ] Decisions → `.claude/knowledge/decisions.md`
- [ ] Patterns → `.claude/knowledge/patterns.md`
- [ ] Bugs → `.claude/knowledge/bugs.md`
- [ ] ROADMAP.md reflects current status
- [ ] Handoff file written if WIP exists
