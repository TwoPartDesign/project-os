# Roadmap

**Format spec**: See `docs/knowledge/roadmap-format.md` for complete marker legend, `#TN` ID rules, dependency syntax, and state transitions.

## Legend (Quick Reference)
- `[?]` Draft (pending approval)
- `[ ]` Todo (approved, ready for work)
- `[-]` In Progress
- `[~]` Review (awaiting review)
- `[>]` Competing (multiple implementations racing)
- `[x]` Done
- `[!]` Blocked

### Dependency Syntax
Tasks use `#TN` IDs. Dependencies declared inline: `(depends: #T1, #T2)`.

### Feature Sections
Each feature groups tasks by lifecycle phase:

```
## Feature: <name>
### Draft
- [?] Task description #TN
- [?] Task description (depends: #TN) #TN+1
### Todo
### In Progress
### Review
### Done
```

## Feature: native-foundations
### Draft
### Todo
- [~] Add native Tasks API convenience layer to build workflow #T1
- [~] Replace custom worktree shell commands with native isolation #T2
- [~] Add model routing to build workflow adapter resolution #T3
- [~] Update claude-code adapter to surface ADAPTER_MODEL in dispatch metadata #T4
- [~] Implement working Codex adapter #T5
- [~] Integration pass — verify build.md coherence after T1+T2+T3 (depends: #T1, #T2, #T3) #T6
- [~] Update INTERFACE.md and settings.json for v2.1 adapter landscape (depends: #T6) #T7
- [~] Document ROADMAP↔Tasks dual-track pattern #T8
- [~] Add Codex/OpenAI secret patterns to scrub-secrets.sh #T9
- [~] Add legacy note to preserve-sessions.sh #T10
- [~] Build live dashboard server (depends: #T7, #T8) #T11
### In Progress
### Review
### Done

## Backlog
<!-- Ideas that have been captured but not yet designed -->
- [ ] Strategic repositioning — update README, CLAUDE.md, guide, design-principles for "governance layer" positioning
- [ ] Agent Teams spike — 2hr time-boxed investigation of CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

## Completed
<!-- Moved here after /workflows:ship -->
