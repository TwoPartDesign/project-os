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

## Feature: adaptive-memory

### Draft

### Todo
### In Progress
- [-] Tests + docs: observation parser tests, update architecture.md, patterns.md (depends: #T2, #T5, #T7) #T9
### Review
### Done
- [x] Auto-checkpoint: implement PreCompact hook that generates handoff YAML #T2
- [x] Auto-checkpoint: register hook in settings.json, add debounce logic (depends: #T2) #T3
- [x] Recency-weighted search: add access_count/last_accessed columns + migration #T4
- [x] Recency-weighted search: implement composite scoring formula (depends: #T4) #T5
- [x] Observation parser: implement 5-type regex extraction #T6
- [x] Observation parser: integrate into output-index.sh (depends: #T6) #T7
- [x] Search enhancement: add --type filter for observation types (depends: #T6) #T8

## Feature: security-scanner

### Draft
### Todo
### In Progress
### Review
### Done
- [x] Port gitleaks rule database + custom PII/privacy rules #T10
- [x] Create allowlist config + harden .gitignore #T11
- [x] Build scanner engine with all subcommands (depends: #T10, #T11) #T12
- [x] Create git hook installer wrapper (depends: #T12) #T13
- [x] Update scrub wrapper + session hook (depends: #T12) #T14
- [x] Ship workflow integration + documentation (depends: #T12) #T15
- [x] Integration testing + false-positive tuning (depends: #T13, #T14, #T15) #T16

## Backlog
<!-- Ideas that have been captured but not yet designed -->
- [?] Spike: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 — assess compatibility and integration path #T1

## Completed
<!-- Moved here after /workflows:ship -->
