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

## Feature: audit-remediation

Source: `docs/audits/2026-07-11-staleness-audit.md`. Tasks are grouped by file ownership so waves stay conflict-free; dependencies exist only where two tasks must edit the same file.

<!-- Dependency graph (wave view):
  Wave 1 (parallel): T17 T18 T19 T21 T22 T23 T24 T25 T28 T29 T32
  Wave 2 (parallel): T20 (after T18) | T26 (after T19, T25) | T27 (after T24) | T31 (after T23)
  Wave 3:            T30 (after T20)
-->

### Draft

### Todo
<!-- P0 — security & correctness -->
- [~] Fix MCP validation hooks: exit code 2 (or additionalContext JSON) so warnings reach the model, remove dead set -e error branch, absolute allowlist path via PROJECT_ROOT, truncate to a copy instead of mutating input (post-mcp-validate.sh, validate-mcp-output.sh) #T17
- [~] Harden settings.json permissions: scope Bash allows to specific subcommands, drop blanket sed/awk/find/npx grants, replace single-string rm deny with restrictive allow posture #T18
- [~] Fix Codex adapter isolation contradiction: document that danger-full-access runs unisolated (or actually isolate it); reconcile INTERFACE.md mitigation claims with codex.sh supports_isolation=false #T19
<!-- P1 — model routing refresh -->
- [~] Modernize settings.json runtime config: CLAUDE_CODE_SUBAGENT_MODEL to current model ID, verify/remove CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, add effortLevel + fallbackModel, replace Write|Edit|MultiEdit matchers with Write|Edit (depends: #T18) #T20
- [~] Update tier tables in set-models.md + init.md to Claude 5 lineup (fable-5/sonnet-5/opus-4-8/haiku-4-5); delete inert CLAUDE_ORCHESTRATION_MODEL and the models.env shell-sourcing mechanism in favor of settings.json #T21
- [~] Rewrite escalation.md ladder for current model lineup (haiku-4-5 → sonnet-5 → opus-4-8 → fable-5) or make it tier-agnostic; keep retry-cap rules #T22
- [~] Docs model-routing sweep: fix Haiku-vs-Sonnet sub-agent contradiction and stale 5x-output/4x-Haiku pricing claims in CLAUDE.md, CLAUDE.template.md, README.md, project-os-guide.md, design-principles.md, architecture.md #T23
<!-- P2 — orchestration modernization -->
- [~] Add YAML frontmatter (name, description) to all four .claude/skills/*/SKILL.md files per current skills format #T24
- [~] Modernize build/ship orchestration to native primitives: native worktree isolation (retire preserve-sessions.sh + worktree-recovery pattern in patterns.md), native Task dependencies instead of manual wave computation (retire unblocked-tasks.sh), drop agent-rules sha256 caching (build.md, ship.md) #T25
- [~] Collapse adapter layer: delete no-op claude-code.sh and dead aider/amp/gemini stubs, dispatch default path natively with per-agent model + worktree isolation, refresh codex.sh defaults (o4-mini is stale) or retire it (depends: #T19, #T25) #T26
- [ ] Deduplicate skills vs commands: session-management ↔ handoff/catchup, spec-driven-dev ↔ workflows:*, and the three overlapping research fan-out specs (idea.md, research.md, researcher.md) — one canonical home each (depends: #T24) #T27
<!-- P3 — hygiene -->
- [ ] Unify manifest + sync lists: regenerate manifest.json, align generate-manifest.sh/update-project.sh/new-project.sh file lists, add missing observation-parser.ts + security-scanner.ts + scan-rules.js + pre-compact.sh entries #T28
- [-] Define TS runtime contract: package.json with engines pin (Node >=22.18) and test script for tests/*.test.ts, Node-version guard in hooks/_common.sh so hooks degrade loudly instead of silently #T29
- [-] Log hygiene: rotation/size caps for activity.jsonl + tool-failures.log + format-errors.log, SessionEnd hook to clean per-session .tool-count files, register in settings.json (depends: #T20) #T30
- [ ] Reconcile status docs: CHANGELOG v2.1/v2.2 entries, PROJECT_STATUS refresh, move shipped features to Completed, resolve stale #T9 and #T1 spike (agent teams now native), fix vault frontmatter dates, component counts, web-fetch leftovers (metrics block + extracted-repo URL in decisions.md), fill live placeholders (CLAUDE.md Owner, preferences.md) (depends: #T23) #T31
- [~] Verify current security-scanner behavior and gut or Windows-gate .claude/rules/bash.md (218 lines loaded every session on a Linux repo) #T32
### In Progress
### Review
### Done

## Backlog
<!-- Ideas that have been captured but not yet designed -->
- [?] Spike: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 — assess compatibility and integration path #T1

## Completed
<!-- Moved here after /workflows:ship -->
