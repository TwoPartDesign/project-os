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
- [x] Tests + docs: observation parser tests (32 cases, all 5 extractors + secret denylist), architecture.md + patterns.md updated. Testing surfaced + fixed a real denylist gap: camelCase secret keys (apiKey/privateKey) slipped past the underscored API_KEY/PRIVATE_KEY patterns — now separator-normalized before matching (depends: #T2, #T5, #T7) #T9
  <!-- Re-statused 2026-07-12: was marked In Progress since 2026-03 with no work landed (tests/observation-parser.test.ts never created). Honest state: approved, not started. -->
### In Progress
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
### In Progress
### Review
### Done
<!-- Follow-ups completed 2026-07-16 (autonomous session, verified via scanner-smoke + hook-smoke suites) -->
- [x] Fix invalid regex in scripts/lib/scan-rules.js: the atlassian rule uses inline-modifier group (?-i:) unsupported by Node 22 V8 — security-scanner test-rules errors; audit other rules for the same construct and add a test-rules invocation to CI/smoke (found during #T29) #T33
- [x] Fix MCP large-response warning: post-mcp-validate.sh size-warning branch echoes to stderr with exit 0 so it never reaches the model — same silent-warning class #T17 fixed elsewhere; also correct validate-mcp-output.sh's new docstring, which claims it is part of the live hook chain (it is not wired in settings.json) #T35
- [x] Fix pre-commit security hook on deleted files: scan-staged path emits "fatal: path does not exist" for every staged deletion (observed during audit-remediation merge) — skip deleted paths when building the scan list #T36
- [x] Fix knowledge-index.ts path guard on Windows: separator/case mismatch in startsWith(projectRoot) — replaced with relative()-based isWithinRoot() helper at all 3 guard sites; index-vault verified working (57 files/700 chunks), traversal rejection re-verified, 7 regression tests added (fixed 2026-07-16 as self-maintenance prerequisite) #T45
<!-- Reviewed 2026-07-16: 4-way adversarial review (P0 security / model routing / orchestration modernization / hygiene) verified all 16 tasks; review fixes applied in the merge and its follow-up commit. -->
<!-- P0 — security & correctness -->
- [x] Fix MCP validation hooks: exit code 2 (or additionalContext JSON) so warnings reach the model, remove dead set -e error branch, absolute allowlist path via PROJECT_ROOT, truncate to a copy instead of mutating input (post-mcp-validate.sh, validate-mcp-output.sh) #T17
- [x] Harden settings.json permissions: scope Bash allows to specific subcommands, drop blanket sed/awk/find/npx grants, replace single-string rm deny with restrictive allow posture #T18
- [x] Fix Codex adapter isolation contradiction: document that danger-full-access runs unisolated (or actually isolate it); reconcile INTERFACE.md mitigation claims with codex.sh supports_isolation=false #T19
<!-- P1 — model routing refresh -->
- [x] Modernize settings.json runtime config: CLAUDE_CODE_SUBAGENT_MODEL to current model ID, verify/remove CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, add effortLevel + fallbackModel, replace Write|Edit|MultiEdit matchers with Write|Edit (depends: #T18) #T20
- [x] Update tier tables in set-models.md + init.md to Claude 5 lineup (fable-5/sonnet-5/opus-4-8/haiku-4-5); delete inert CLAUDE_ORCHESTRATION_MODEL and the models.env shell-sourcing mechanism in favor of settings.json #T21
- [x] Rewrite escalation.md ladder for current model lineup (haiku-4-5 → sonnet-5 → opus-4-8 → fable-5) or make it tier-agnostic; keep retry-cap rules #T22
- [x] Docs model-routing sweep: fix Haiku-vs-Sonnet sub-agent contradiction and stale 5x-output/4x-Haiku pricing claims in CLAUDE.md, CLAUDE.template.md, README.md, project-os-guide.md, design-principles.md, architecture.md #T23
<!-- P2 — orchestration modernization -->
- [x] Add YAML frontmatter (name, description) to all four .claude/skills/*/SKILL.md files per current skills format #T24
- [x] Modernize build/ship orchestration to native primitives: native worktree isolation (retire preserve-sessions.sh + worktree-recovery pattern in patterns.md), native Task dependencies instead of manual wave computation (retire unblocked-tasks.sh), drop agent-rules sha256 caching (build.md, ship.md) #T25
- [x] Collapse adapter layer: delete no-op claude-code.sh and dead aider/amp/gemini stubs, dispatch default path natively with per-agent model + worktree isolation, refresh codex.sh defaults (o4-mini is stale) or retire it (depends: #T19, #T25) #T26
- [x] Deduplicate skills vs commands: session-management ↔ handoff/catchup, spec-driven-dev ↔ workflows:*, and the three overlapping research fan-out specs (idea.md, research.md, researcher.md) — one canonical home each (depends: #T24) #T27
<!-- P3 — hygiene -->
- [x] Unify manifest + sync lists: regenerate manifest.json, align generate-manifest.sh/update-project.sh/new-project.sh file lists, add missing observation-parser.ts + security-scanner.ts + scan-rules.js + pre-compact.sh entries #T28
- [x] Define TS runtime contract: package.json with engines pin (Node >=22.18) and test script for tests/*.test.ts, Node-version guard in hooks/_common.sh so hooks degrade loudly instead of silently #T29
- [x] Log hygiene: rotation/size caps for activity.jsonl + tool-failures.log + format-errors.log, SessionEnd hook to clean per-session .tool-count files, register in settings.json (depends: #T20) #T30
- [x] Reconcile status docs: CHANGELOG v2.1/v2.2 entries, PROJECT_STATUS refresh, move shipped features to Completed, resolve stale #T9 and #T1 spike (agent teams now native), fix vault frontmatter dates, component counts, web-fetch leftovers (metrics block + extracted-repo URL in decisions.md), fill live placeholders (CLAUDE.md Owner, preferences.md) (depends: #T23) #T31
- [x] Verify current security-scanner behavior and gut or Windows-gate .claude/rules/bash.md (218 lines loaded every session on a Linux repo) #T32

## Feature: post-audit-followups

### Todo
### Done
- [x] Dashboard Kanban board tab: columns per lifecycle phase (Draft, Todo, WIP, Review, Done, Blocked), driven through /workflows:mvp (design → plan → build → review) — shipped 2026-07-16 (see Feature: dashboard-kanban, T40-T44) #T37
- [x] Smoke-test /workflows:mvp end-to-end with a real feature — satisfied by executing #T37 via mvp: full lifecycle exercised incl. auto-rebuild on review failure and the 2-attempt hard stop (depends: #T37) #T38
- [x] Live-test scripts/codex-review.sh with a real review (created 2026-03-10, never exercised) — ran 2026-07-16 against the T33/T35/T36 diff in read-only mode: wrapper worked end-to-end (18.5KB prompt+diff, gpt-5.4, clean exit); its 2 findings were empirically refuted (old (?-i:) groups were already case-sensitive) #T39

## Feature: dashboard-kanban

Spec: `docs/specs/dashboard-kanban/` (brief, design APPROVED 2026-07-16, tasks). Umbrella: #T37.

### Draft
### Todo
<!-- Shipped 2026-07-16 via /workflows:mvp autonomous run (also the mvp e2e smoke test #T38). Review: 3 rounds; 3 quadratic parse vectors fixed (3d23d35, 5e46574) — 1 introduced+caught by the gate, 2 pre-existing. -->
- [x] Extract scripts/lib/dashboard-render.ts (parseRoadmap, esc, marker maps) + annotation-tolerant task regex (model/agent suffixes) #T40
  <!-- GATE PASSED attempt 3 (user-authorized). -->

- [x] renderKanban() in lib + /api/kanban route in dashboard-server.ts (depends: #T40) #T41
- [x] Tab UI in getPage(): Overview|Board nav, view wrappers, kanban CSS, toggle JS (depends: #T41) #T42
- [x] Unit test suite tests/dashboard-render.test.ts + dashboard-smoke.sh wrapper (depends: #T41) #T43
- [x] Docs: dashboard.md + architecture.md endpoint updates; document (model:) annotation in roadmap-format.md #T44
### In Progress
### Review
### Done

## Feature: self-maintenance

Spec: `docs/specs/self-maintenance/` (brief DRAFT rev 2, 2026-07-16 — corpus-mined via 4-agent digest sweep, see research.md). Framework-portable: scored system maps + pre-commit auto-heal + governed maintenance loop + dream pass (absorbs `.claude/plans/cryptic-napping-sonnet.md`). Depends on #T45 fix for the knowledge-index staleness leg.

### Draft
- [x] self-maintenance umbrella — design APPROVED 2026-07-16 (1 adversarial round, 12 findings resolved); tracks feature completion at ship #T46
- [x] system-map-lib.ts: extractors (hook wiring, script refs, imports), graph + findings (unwired/orphan/dangling/manifest-gap/bloat, dependent counts), CRLF-normalized hashing + unit tests #T47
- [x] maintain-draft.ts: governed ROADMAP draft filing — next-ID via dashboard-render parseRoadmap, fixed-string fingerprint dedup, snapshot/validate/restore + tests #T48
- [x] Dream pass: /tools:dream + /tools:dream-accept commands, dream-accept.sh (allowlist timestamp, swap marker + recovery), volatility tiers/provenance/contradiction-flagging + smoke test #T49
- [x] system-map.ts CLI: generate/check/report/precommit (git-index reads, scoped scan after heal), first committed docs/maps artifacts + smoke tests incl. partial-staging + CRLF (depends: #T47) #T50
- [x] Template sync: pre-commit template map step, 3 hardcoded script lists updated (generate-manifest/new-project/update-project), post-apply check --heal, hooks reinstalled, manifest regenerated (depends: #T50) #T51
- [x] maintain.sh loop: mkdir lock, validated policy file, 5 checks (map/staleness/failures/consolidation/search-miss), draft cap, ledger + inline rotation, --dry-run, maintain.md command doc + smoke suite (depends: #T48, #T50, #T54) #T52
- [x] Search-miss instrumentation: knowledge-index.ts search logging (JSONL + rotation, never breaks search) + tests — feeds maintain.sh recall-gap check; adopted from second memory spec review #T54
- [x] Docs: CLAUDE.md map reference, architecture.md self-maintenance section + tables, README bullet; map check green after edits (depends: #T49, #T51, #T52) #T53

### Todo
### In Progress
### Review
### Done

## Feature: follow-ups

Small quality items surfaced during self-maintenance / #T9 reviews (2026-07-17). Approved as a batch.

### Todo
- [x] observation-parser: fix duplicate stack-trace emission (stack line merged into error obs AND emitted standalone) — dedupe merged lines #T55
- [x] observation-parser: reconcile parseObservations return type with the exported ParseResult ({observations, raw_line_count, observation_count}) — return it or drop the unused type #T56
- [x] observation-parser: config-key regex `[a-zA-Z_]+` skips digit-bearing keys (s3Key, oauth2Token) — widen the key charset so they're extracted (denylist still applies) #T57
- [x] maintain.sh: redact secret-shaped substrings from search-query text before it enters a committed maintenance draft #T58
- [x] system-map: document the bloat-input exclusion from .maps.lock (CLAUDE.md/docs/knowledge not hashed → bloat findings can go stale) as a deliberate choice in code + decisions.md #T59
- [x] Cosmetics: substitute the unit name for the literal `[unit]_` prefix in maintain-draft.test.ts names; extract magic numbers (lock staleness, rotation size, title/fingerprint caps) to named constants #T60
### In Progress
### Review
### Done

## Feature: maintenance-inbox
<!-- Drafts filed autonomously by scripts/maintain.sh — promote via /pm:approve -->

### Draft
- [x] Review stale knowledge: 4 files past 90d — 1 drift fixed (design-principles Bun→Node), 3 clean, all validated + clocks reset #T61
  <!-- maint-fp: stale:docs/knowledge/design-principles.md,docs/knowledge/kv.md,docs/knowledge/metrics.md,docs/knowledge/roadmap-format.md -->
- [x] Investigate recurring Bash failures (14 since start) — VERDICT: noise, all 15 correlate with active dev commits (scanner friction); actionable signal defined for future runs (bugs.md 2026-07-17) #T62
  <!-- maint-fp: failures:Bash:14 -->
- [x] Run /tools:dream — staged 2026-07-17-1605 (13 memory + 14 session files → 4 topic files, 0 unresolved contradictions, 2 pattern promotions proposed); ACCEPTED 2026-07-18 (orchestrator removed the 13 consumed sources by hand — see #T77) #T63
- [x] dream-accept.sh true swap: manifest.yaml memory_files consumed post-archive (cmp-guarded removals under the recovery marker; missing manifest → additive-only warning); dream.md pins the schema; smoke 17→25 assertions (9694193) #T77
  <!-- maint-fp: dream:12:14 -->
- [?] skill-edit: design.md — reviewer must re-attack fixed conditions #T93
  <!-- maint-fp: skill-edit:.claude/commands/workflows/design.md:reattack-fixed-conditions -->
  <!-- proposal: docs/specs/skill-optimization-loop/skill-edits.md Proposal 1 -->
- [?] skill-edit: tests.md — security guards need in-bounds indirection fixtures #T94
  <!-- maint-fp: skill-edit:.claude/rules/tests.md:indirection-security-fixtures -->
  <!-- proposal: docs/specs/skill-optimization-loop/skill-edits.md Proposal 2 -->
- [?] Harden skill-apply entanglement residue check for non-ASCII word content + align lib doc-comment #T95
  <!-- maint-fp: review-residual:skill-apply-lib:unicode-residue -->
  <!-- review.md r4 NOTES: [A-Za-z0-9] residue regex misses CJK/Cyrillic/fullwidth homoglyphs (LOW, needs prior compromise); doc-comment overclaims ASCII-only reality -->

### Todo

### In Progress

### Review

### Done

## Feature: adopt-existing-project

Spec: `docs/specs/adopt-existing-project/` (brief DRAFT 2026-07-17). In-place `--adopt` mode for `/tools:new-project` + `new-project.sh` (Case E detection, non-destructive scaffold into existing codebases, git-aware) plus deterministic stack detection (`detect-stack.ts` manifest+lockfile tier, extension-census fallback) shared with `/tools:init`.

### Draft
- [x] adopt-existing-project umbrella — SHIPPED 2026-07-17: design 3 adversarial rounds, build 11/11 in 4 batches, review r1 FAILED (2 CRITICAL + 2 HIGH hook-quarantine/symlink bypasses) → rebuild → r2 PASSED; 143-assertion smoke suite #T64
- [x] Narrow template settings.json blanket allows to enumerated template script names — 3 blanket entries → 37 per-script (call-site audit, no sanctioned form dropped); adopt ADR residual risk closed; sync duty recorded in ADR (7199f15) #T76
- [x] detect-stack.ts: deterministic stack detection (manifest+lockfile tiers, JSON out, never executes repo code) + 6 unit tests #T65
- [x] Hook-quarantine chain: security-scanner install-hooks --no-chain (.pre-adopt rename, no chaining) + install-hooks.sh arg passthrough + setup.sh --adopt (rebuilt r1: marker gate, --git-path hooks, 20-name quarantine) #T66
- [x] update-project.sh --local-upstream <dir>: offline upstream source, short-circuits gh entirely, classifier untouched; + detect-stack sync-list entry #T67
- [x] generate-manifest.sh: hash <path>.upstream when present (prevents SAFE_UPDATE clobber of user files post-adopt); + detect-stack in TEMPLATE_SCRIPTS #T68
- [x] new-project.sh adopt skeleton: --adopt/--dry-run/--allow-nested args, pre-flight (manifest refusal, symlink scan, nested-repo, worktree warning), DRY_RUN mutation guard (rebuilt r1: recursive symlink pre-flight) #T69
- [x] new-project.sh copy engine: copy_safe two-class policy (.upstream/.pre-adopt), orphan sweep with exclusion rule, .obsidian guard, CLAUDE.md temp-file sed (depends: #T69) (rebuilt r1: symlink-aware sweep, optional-template exemption) #T70
- [x] new-project.sh finish: gitignore marker-block merge, setup --adopt + manifest invocation, report-before-commit, pathspec-only commit (depends: #T70, #T66, #T68) (rebuilt r1: scoped chmod, setup-failure abort) #T71
- [x] tools/new-project.md: Case E adopt flow (dry-run plan → confirm → run → detect-stack summary), manifest.json as the Project OS marker (depends: #T69) #T72
- [x] tools/init.md Step 1b: detect-stack.ts as single source for manifest-derived fields + extension-census fallback + 3-way conflict rule (depends: #T65) #T73
- [x] Smoke-test adopt scenarios: hostile+legit seeded fixture, 143-assertion suite incl. real-classifier manifest safety via --local-upstream (depends: #T71, #T67) (rebuilt r1: spoof/commit-msg/hooksPath/symlink/chmod security-regression scenarios) #T74
- [x] Docs: ADR (two-class policy, gitignore block, manifest rule, hook quarantine, residual risks) + architecture.md updates (depends: #T74) #T75

### Todo
### In Progress
### Review
### Done

## Feature: skill-optimization-loop

Spec: `docs/specs/skill-optimization-loop/` (design APPROVED rev 4, 2026-07-22, after 2 adversarial rounds). Lift of microsoft/SkillOpt's loop shape, owner-expanded: `/tools:reflect` fired from ship + review-FAIL + rebuild files ≤3 bounded `[?]` skill-edit drafts via `maintain-draft.ts`; tiered apply — staged apply on `/pm:approve` via `skill-apply.ts`, plus a six-condition deterministic auto-apply class (map-verified dead-ref fixes; policy-gated, ack-drafted, revertible); rejection ledger (`skill-ledger.ts`, `docs/knowledge/`) feeds future reflections. No SkillOpt dependency.

### Draft
### Todo
### In Progress
### Review
### Done
- [x] Shared policy reader scripts/lib/policy.ts + tests #T79
- [x] skill-ledger.ts sanitizing rejection-ledger writer + tests #T80
- [x] skill-apply-lib.ts proposal parser + anchored ops + tests #T81
- [x] Seed docs/knowledge/skill-edit-rejections.md ledger #T82
- [x] /tools:reflect shared reflection command doc #T83
- [x] ship.md reflection call site + Post-Ship numbering heal #T84
- [x] review.md + rebuild.md call sites + rebuild-triggered instrumentation #T85
- [x] approve.md skill-edit gate: display, staged apply, ack, reject-to-ledger #T86
- [x] maintain-draft.test.ts skill-edit formats + retired-line and cross-trigger dedup #T87
- [x] system-map-lib pathToId export + rules bloat + policy refactor (depends: #T79) #T88
- [x] skill-apply.ts CLI standard tier (depends: #T81) #T89
- [x] skill-apply --auto six-condition class (3 hardening rounds, r4 verify PASS) (depends: #T79, #T88, #T89) #T90
- [x] Policy key, permissions entries, template sync lists (depends: #T79, #T80, #T89) #T91
- [x] architecture.md + tiered draft-only-autonomy ADR (depends: #T90, #T91) #T92
- [x] skill-optimization-loop — Brief created, awaiting design (retired: superseded by #T79-#T92 after design APPROVED) #T78

## Backlog
<!-- Ideas that have been captured but not yet designed -->
- [x] SOTA adoption — workflow ergonomics (RE-SCOPED 2026-07-17, SHIPPED same day): shipped `/goal` wave/MVP exit predicates + wave-handoff artifact + `tools:update --diff-upstream`. `tools:audit-knowledge` dropped (subsumed by self-maintenance maintain.sh/system-map); `tools:sota-scan` deferred as machine-local. Needs a short re-scoping design pass first. Revised plan: `.claude/plans/sota-adoption-2026-05.md` (see REVISED SCOPE block) #T34
<!-- #T1 (agent-teams experiment spike) retired 2026-07-12: agent teams shipped as a native Claude Code feature, obsoleting the CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS assessment. Draft a new idea via /workflows:idea if native agent-team adoption is worth exploring. ID #T1 is retired, never reused. -->

## Completed
<!-- Moved here after /workflows:ship -->
