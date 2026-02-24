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
### In Progress
### Review
### Done
- [x] Add native Tasks API convenience layer to build workflow #T1
- [x] Replace custom worktree shell commands with native isolation #T2
- [x] Add model routing to build workflow adapter resolution #T3
- [x] Update claude-code adapter to surface ADAPTER_MODEL in dispatch metadata #T4
- [x] Implement working Codex adapter #T5
- [x] Integration pass — verify build.md coherence after T1+T2+T3 (depends: #T1, #T2, #T3) #T6
- [x] Update INTERFACE.md and settings.json for v2.1 adapter landscape (depends: #T6) #T7
- [x] Document ROADMAP↔Tasks dual-track pattern #T8
- [x] Add Codex/OpenAI secret patterns to scrub-secrets.sh #T9
- [x] Add legacy note to preserve-sessions.sh #T10
- [x] Build live dashboard server (depends: #T7, #T8) #T11

## Feature: strategic-repositioning
### Draft
### Todo
### In Progress
### Review
- [~] Verification pass — terminology audit, governance term presence, @import check (depends: #T14, #T15, #T16, #T17, #T18) #T19
- [~] README.md — governance layer headline and "What It Is" opening #T14
- [~] CLAUDE.md — identity block update (Type, Stack, Workflow line) #T15
- [~] design-principles.md — replace intro with governance framing opener #T16
- [~] architecture.md — expand governance description with 3-mechanism bullets #T17
- [~] project-os-guide.md — title and intro block (version bump to 2.1) #T18
### Done

## Feature: agent-teams-spike
### Draft
- [ ] Spike: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 — assess compatibility and integration path (report at docs/specs/agent-teams-spike/spike-report.md) #T13
### Todo
### In Progress
### Review
### Done

## Backlog
<!-- Ideas that have been captured but not yet designed -->

## Completed
<!-- Moved here after /workflows:ship -->
