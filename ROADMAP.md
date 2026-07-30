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
- [x] skill-edit: design.md — reviewer must re-attack fixed conditions (applied c8f3d07 + dedupe 110092b) #T93
  <!-- maint-fp: skill-edit:.claude/commands/workflows/design.md:reattack-fixed-conditions -->
  <!-- proposal: docs/specs/skill-optimization-loop/skill-edits.md Proposal 1 -->
- [x] skill-edit: tests.md — security guards need in-bounds indirection fixtures (applied 97df368 + dedupe/mirror 110092b) #T94
  <!-- maint-fp: skill-edit:.claude/rules/tests.md:indirection-security-fixtures -->
  <!-- proposal: docs/specs/skill-optimization-loop/skill-edits.md Proposal 2 -->
- [x] Harden skill-apply entanglement residue check for non-ASCII word content + align lib doc-comment (applied e5b8a86-integration) #T95
  <!-- maint-fp: review-residual:skill-apply-lib:unicode-residue -->
  <!-- review.md r4 NOTES: [A-Za-z0-9] residue regex misses CJK/Cyrillic/fullwidth homoglyphs (LOW, needs prior compromise); doc-comment overclaims ASCII-only reality -->
- [x] skill-edit: reflect.md — add-op proposed text must not repeat the anchor (applied 1ec83b7) #T96
  <!-- maint-fp: skill-edit:.claude/commands/tools/reflect.md:add-op-anchor-duplication -->
  <!-- proposal: docs/specs/skill-optimization-loop/skill-edits.md Proposal 3 -->

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

## Feature: template-content-leakage

Spec: `docs/specs/template-content-leakage/` (brief + design DRAFT, 2026-07-24). `new-project.sh` seeds new projects by copying Project OS's own live knowledge vault, so every clone ships `docs/knowledge/{architecture,patterns,decisions,bugs,metrics}.md` and `.claude/rules/preferences.md` full of framework prose — and `CLAUDE.template.md` `@import`s two of them. Init cannot see it (no `[PLACEHOLDERS]` to match). Fix: a `templates/` seed tier (destination paths unchanged, so `generate-manifest.sh`/`update-project.sh` path lists hold), a write-once `seed_hashes` manifest block that survives `update-project.sh:599` regeneration, and a `template-residue` system-map finding that rides the existing `maintain.sh` map check for draft-only detection in already-cloned projects.

### Draft

### Todo
### In Progress
### Review
### Done
- [x] Author `templates/knowledge/*.md` + `templates/rules/preferences.md` seeds — derived by deleting entries from the live files, never rewritten; frontmatter and `## Format` blocks preserved #T97
- [x] `new-project.sh`: repoint `CONTENT_FILES` sources to `templates/`, add the five referenced-but-never-copied docs (`roadmap-format.md`, `windows-bash-scanner.md`, `design-principles.md`, `docs/product.md`, `docs/tech.md`), move `.claude/rules/preferences.md` to content class with a `copy_tree_safe` exclusion (depends: #T97) #T98
- [x] `generate-manifest.sh`: emit write-once `seed_hashes` per the four-rule resolution table; validate every carried-forward pair (`^[a-f0-9]{64}$`, key ∈ watched set) before emission (depends: #T97) #T99
- [x] `update-project.sh`: drop the six `docs/knowledge/*.md` entries from `TEMPLATE_FILES` — one-time seeds must never be offered as template updates (depends: #T99) #T100
- [x] `system-map-lib.ts`: `RESIDUE_WATCHED`, `hasUnfilledPlaceholders`, `findInitIncomplete`, `findTemplateResidue` + `Finding.kind` union extension (depends: #T99) #T101
- [x] `system-map.ts`: `sha256OfWorkingTreeFile` (raw bytes — must NOT use `normalizeContent`) + wire both finders, mutually exclusive on init state (depends: #T101) #T102
- [x] Test suite: residue/placeholder unit cases incl. path-traversal, in-scope-symlink, and prefix-collision guards; `generate-manifest` seed-hash cases; new-project smoke assertions; framework-repo no-residue canary (depends: #T101, #T102) #T103
- [x] `init.md`: Step 5b project-scoped architecture stub from collected answers (facts only, no speculation) + Step 11 residue verification + bold anti-requirement that init never regenerates the manifest (depends: #T102) #T104
- [x] ADR in `decisions.md` reclassifying `.claude/rules/preferences.md` from framework-authority to content class, + `patterns.md` entry "Ship Seeds, Not Live Content" (depends: #T98) #T105

## Feature: clone-run-defects

Spec: `docs/specs/template-content-leakage/` (defects C-G + one found while fixing C). Source: full clone → `/tools:init` → `/workflows:idea` → `/workflows:design` (2 adversarial rounds) → `/workflows:plan` (19 tasks) run on Power-Hour-Rhythm-Game, 2026-07-24. All framework-first — they affect every clone and every existing clone. Implementation is on branch `claude/template-content-leakage-4sxcm0` pending this gate.

### Draft

### Todo
### In Progress
### Review
### Done
- [x] C: pre-push hook generator guards `scan-diff` on `origin/$BRANCH` existing; falls back to a full tracked-file scan on first push (`security-scanner.ts`) #T106
- [x] D: `/workflows:idea` Step 1a derives + confirms a ≤40-char `FEATURE_SLUG`; design/plan/approve inherit it verbatim instead of re-deriving from prose #T107
- [x] E: `/tools:init` Step 5c writes per-subcommand toolchain `permissions.allow` entries from the detected stack — never bare interpreters, never publish/deploy verbs (depends: #T104) #T108
- [x] F: `/tools:init` Step 5d asks the `docs/specs` tracking question with "track specs" recommended, and states the policy in the report (depends: #T104) #T109
- [x] G: `/tools:init` Step 9 uses the Write tool + scratchpad instead of a `/tmp` heredoc; `.claude/rules/bash.md` drops `/tmp/` from its guidance and says why #T110
- [x] Ship `templates/knowledge/framework-patterns.md` as reference so the five transferable patterns survive the seed split without being asserted as a new project's conventions (depends: #T97) #T111
- [x] Rewrite the 11 `(?i:...)` inline-modifier regexes in `scripts/lib/scan-rules.js` to syntax valid on Node 22.18 — the declared `engines` minimum. Until then the whole rules module is a syntax error on Node 22, `install-hooks.sh` dies, and a project gets NO pre-commit secret scan and NO system-map heal while reporting only "Could not install git hooks". Loud diagnosis landed in `security-scanner.ts`; the rewrite needs its own `test-rules` validation pass (model: opus) #T112

## Feature: scanner-detection-gaps

Two pre-existing defects found while verifying #T112's rewrite. Both make named CRITICAL/HIGH rules silently detect nothing — the scanner reports "No findings" and looks healthy. Neither is caused by the Node-22 rewrite (both reproduce identically against the pre-rewrite file). Filed, not fixed: each is a security-tuning change that needs its own evidence and review round.

### Draft

### Todo
### In Progress
### Review
### Done
- [x] Entropy-gate audit: disabled the gate ONLY where it is provably non-functional. A capture drawn from an alphabet of size A over >= L chars has Shannon entropy bounded by min(log2 A, log2 L); where that ceiling sits under the rule's bar the rule can never fire, whatever the input. 22 rules were dead that way — hex-alphabet tokens cap at 4.09 bits against a 4.5 bar — including databricks-api-token (CRITICAL). REJECTED the broader version first: disabling the gate on all 86 structurally-anchored rules measurably LOST precision, making the padded placeholder `AKIA` + 16 identical chars fire as CRITICAL in three files. For aws-access-token the gate works after #T113 (real key 4.02 over a 3.89 bar fires; padded 0.47 does not), so removing a working discriminator is a regression, not a fix. Classifier also had to learn the second assignment form `[=:]` used by the hand-written custom rules — without it generic-api-key-custom was misclassified as anchored, i.e. the one rule whose high bar keeps ordinary prose from being reported as a secret. Verified: 4 revived rules fire on realistic hex tokens, repo-wide findings unchanged at the single pre-existing one #T116
- [x] CRITICAL-rule coverage: tests/critical-rules.test.ts pins all 20. Ten fire-tests prove a well-formed token of each documented shape actually matches; a structural test asserts no CRITICAL rule has a null regex except the documented pkcs12-file; another asserts none has an entropy gate its own token alphabet can never clear (the #T116 class, which is how databricks-api-token sat dead at CRITICAL); and the rule count is ratcheted so a new CRITICAL rule fails the suite until it gets a fixture. Fixtures are built by runtime concatenation — token-shaped literals in a committed file trip GitHub push protection, as #T114 discovered. Note `test-rules` still reports 11 passed / 222 warned: its cases must be inline literals in scan-rules.js, so that counter cannot improve without reintroducing the push-protection problem; the coverage lives in the node suite instead #T115
- [x] Restored detection for 21 of the 24 `regex: null` rules. No original existed to recover (null since the file's first commit), so each pattern is reconstructed from the service's documented token format and anchored on the literal prefix the rule already recorded in its own `keywords` (`PMAK-`, `SG.`, `lin_api_`, `pscale_tkn_`, `xkeysib-`, `fio-u-`, `dt0c01.`, ...). Asymmetric risk by design: a prefix anchor makes false positives near-impossible, while a slightly-off length or char class only yields a false negative — no worse than the 100% miss it replaces. Each restored rule ships positive + negative coverage in tests/scan-rules-restored.test.ts (22 cases), built by runtime concatenation rather than inline literals: committing token-shaped fixtures into scan-rules.js made GitHub push protection reject the push, flagging "Adobe Client Secret", "Authress Service Client Access Key" and "Doppler Personal Token" — independent confirmation the reconstructed formats are right, and a reason to stop committing the literals rather than bypass the check. `test-rules` therefore still reports 11 passed / 222 warned; the coverage lives in the node suite. Entropy gate disabled on the 19 strongly-anchored ones after a realistic-token probe showed `postman-api-token` still never fired — hex tokens cap at log2(16)=4.0 bits, permanently under the 4.5 bar, which would have shipped them dead on arrival exactly as #T113 described. Verified: all 12 probed rules fire on random realistic tokens, repo-wide false positives unchanged at the single pre-existing finding. 3 left null BY DECISION with explanatory comments — curl-auth-header (multi-line shell match), pkcs12-file (binary container; a line regex is the wrong mechanism), jwt-base64 (`ZXlK` is base64 of `eyJ`, in any base64 JSON). Ratchet in tests/scan-rules-node22.test.ts lowered 24 -> 3 #T114
- [x] Entropy gate made length-aware: the bar is now `min(configured, log2(len) * 0.9)`, capped at what a token of that length can actually deliver. Shannon entropy is bounded by log2(N), so the fixed 4.5-bit bar was unreachable for every token <= 22 chars and those rules detected nothing. Measured over 5000 random base62 tokens per length, miss rate: len 20 100% -> 18%, len 24 95.3% -> 18.8%; len >= 32 unchanged (32% at len 32, 2.2% at len 40, 0% at 64) because the length term reaches 4.5 there. Monotonically more permissive, so it can only add detections. The two keyword-proximity rules (generic-api-key, generic-api-key-custom) keep the strict absolute bar — at a global 0.9 ratio the capture "git-versioned" fired as a secret in two committed markdown files, and no single ratio separates that from a real 20-char AWS key. 10 tests in tests/entropy-threshold.test.ts #T113

## Feature: compaction-gate

### Draft
### Todo
### In Progress
### Review
### Done
- [x] Nudge delivery gated on the hook payload's agent identity rather than on the transcript tail. First of two findings in a review of the #T124 commit, confirmed before anything changed. Round 9 inferred "who is speaking" from the newest `usage`-bearing record, and inference cannot separate a sub-agent's own tool call from the main thread's `PostToolUse` for the *completed* `Task` — at that instant the sub-agent's last turn is the newest record either way — so the gate discarded a genuine main-thread firing. Round 9 named that consequence in its own hook comment and design text and accepted it as "one further turn" of delay, the same pattern as round 8 naming the mis-delivery and then fixing something else; the acceptance was wrong, because there is no guarantee of a further turn. If the resumed turn ends without another tool call, or auto-compaction fires first, no later `PostToolUse` delivers the nudge and the cycle is lost outright, with nothing to recover it — the marker logic has no notion of a nudge that was owed and never sent. `compact-suggest.sh` now extracts `agent_id` and exits when it differs from `session_id`: the main thread's tool-use context pins `agentId` to the session id while a sub-agent gets a distinct one, both values arrive in the same payload, and both keys precede `tool_input`, so first-match extraction is order-safe on the same argument the `tool_name` gate already relies on. Preferred over `agent_type == "main"` because that default is a configurable value in the CLI, so the literal string is not guaranteed. Reading the shipped CLI's hook-payload assembly also **answered #T124's stated open question**: `session_id` is resolved from the session independently of the agent, so sub-agent firings do share it. The tail heuristic survives only for payloads with no `agent_id` key at all, since reading absence as "main thread" would retire the guard silently on an older CLI; for the same reason the scan loop no longer stops early on a sidechain tail once identity is known — that tail is exactly the case needing the wider window. The identity exit sits below the ownership claim on purpose, so a sub-agent that writes a handoff still claims it. Five of nine new assertions verified to fail against the pre-fix hook. #T125
- [x] Age window applied to owned handoffs when no cycle marker exists. Second finding of the same review, confirmed before anything changed. `pre-compact.sh`'s ownership branch accepted any claimed path when no cycle marker existed, while the glob fallback applied `HANDOFF_MAX_AGE_MIN` — an asymmetry this project's own design doc had described twice as an accepted property. Reachable two ways: a session that wrote a handoff and then worked for hours before its first compaction, and a session resuming after `SessionEnd`. The second is a regression from #T124 itself, which kept `.compact-handoff-<sid>` past `SessionEnd` while `.compact-cycle-<sid>` is still deleted, so a claim that used to expire with the session now survives into an unwindowed branch. Because the loop keeps the last qualifying line, a stale entry did not merely add a candidate, it displaced a fresher one. Both branches now share one window and one tool (`find -maxdepth 0 -mmin` on the single path); where a cycle marker exists it still governs, being the stricter signal — "written since the last compaction" is what freshness means, so a long-running session's second compaction does not lose a handoff for being older than the window. Three of four new assertions verified to fail against the pre-fix hook. Tests 127 -> 140 assertions #T126
- [x] Nudge delivery gated on the main thread, checkpoint YAML made backslash-proof, and the cross-session handoff claim kept past SessionEnd. Three findings in a review of the #T123 commit, each confirmed before anything changed. (1) Round 8 named the mis-delivery in its own commit message — "a byte-proxy nudge raised mid-sidechain lands in the *sub-agent's* context while still spending the once-per-cycle marker" — and then fixed only the scan window, which made the hook *better* at finding a main-thread number to nudge on while a sub-agent was running, so the mis-delivery got more reliable rather than less. `hookSpecificOutput.additionalContext` is delivered to whichever agent made the tool call; a sub-agent can neither run `/tools:handoff` nor be compacted, and the marker it spends was the main thread's one nudge for the cycle. `compact-suggest.sh`'s awk now emits two fields — the newest main-thread token count *and* whether the newest `usage`-bearing record was a sidechain one — and the hook exits before nudging, and before the byte fallback, when it was. This reverses a round-8 assertion (`context_sidechainRunLongerThanScanWindow_stillMeasuresMainThread`) defended in the PR thread: the number is still measured correctly, but measuring it is not a reason to deliver on it. Cost is one turn, since PostToolUse for the `Task` itself fires after the sub-agent completes. Stated in the hook comment and the design as an open question: whether sub-agent hook firings share the main session's id could not be confirmed from a transcript containing no sidechain records at all (2203 records, 0 sidechain), so the fix was right either way but its severity unmeasured — **answered in #T125**, they do share it, which makes the marker spend the serious half of the bug. Splitting the awk's two fields exposed a live bug the same hour: `tr -cd '0-9'` over `"98800 0"` fused to `988000` and the hook reported context at 494% of the window, now pinned by assertion. (2) `pre-compact.sh` escaped `"` in ROADMAP-derived scalars but not `\`, the same defect class as #T123's C-quoting reached by a different route — reproduced against the pre-fix hook, where a task titled `Fix the C:\path parser` produced `while scanning a double-quoted scalar ... found unknown escape character 's'` and aborted the *document*, costing the next session the objective, the task list and the handoff pointer along with the offending line. One `yaml_escape` helper (backslash first, then quote, tab, newline) now covers every double-quoted scalar built from data the hook did not author, including the feature heading, which the review did not flag; the `|` block scalars are deliberately left raw and commented, since escaping there would put literal backslashes into the summarizer's instructions. (3) `session-end-cleanup.sh` deleted `.compact-handoff-<sid>` alongside the session-private markers, but that is the one record read *across* sessions — deleting it un-claims this session's handoffs the instant it exits, so a concurrent session's fallback glob forwards a `compact_instruction` written for someone else's task. The handoff outlives the session, so the record of its author has to as well; the 7-day prune already collected it, and a stale claim is the safe failure. Six of the fourteen new assertions verified to fail against the pre-fix hooks (121/127); five round-8 assertions removed because the delivery gate makes their expectations wrong. Tests 118 -> 127 assertions #T124
- [x] Ownership claims gated on write tools, token-scan window made sidechain-proof, and checkpoint paths made unquotable. Three findings in a review of the #T122 commit, each traced and confirmed before anything was changed. (1) `compact-suggest.sh` recorded a handoff claim from `tool_input.file_path` on *any* tool, but `Read` carries that field too — so `/tools:catchup`, the documented read path for the previous session's handoff, made the reader claim the author's file. Strictly worse than no tracking: the ownership branch in `pre-compact.sh` compares against the cycle marker instead of the 30-minute age window, and on a session's first compaction there is no cycle marker, so any age is accepted — the reader forwards a stale `compact_instruction` written for someone else's task, and the claim simultaneously hides that handoff from every other session's fallback glob. Claims now require `Write`/`Edit`/`MultiEdit`/`NotebookEdit`; `tool_name` is a top-level key serialized ahead of `tool_input`, so first-match extraction cannot be beaten by file contents (the transcript scan's ordering argument, run the other way). (2) The token scan read a fixed 60-line tail, which assumes a main-thread assistant record is always near the end; during a sub-agent run it is not — sidechain records are skipped by design and a long agent buries the real number under hundreds of them. The hook then fell through to the byte proxy, which is wrong in both directions, and a byte-proxy nudge raised mid-sidechain lands in the *sub-agent's* context while still spending the once-per-cycle marker, so the turn that needed it never sees one. The window now escalates 60 -> 600 -> 4000 lines and widens only when the cheap read returns nothing, so the normal case costs exactly what it did before; past 4000 the byte fallback still applies and is pinned by assertion rather than left implicit. (3) `pre-compact.sh` built `modified_files` from unquoted `--porcelain`, which C-quotes any non-ASCII path under the default `core.quotePath` — `café.txt` arrives as `"caf\303\251.txt"`, and `\3` is not a legal escape in a double-quoted YAML scalar, so one accented filename made the *whole* checkpoint unparseable, costing the session its objective and handoff pointer too. `core.quotePath=false` is insufficient (still escapes `"`, `\`, newline, tab); `-z` disables quoting outright, read via process substitution because `$( )` drops NUL bytes, with rename/copy handled as the two NUL-terminated records `-z` actually emits rather than an `old -> new` string. Six of the eleven new assertions verified to fail against the pre-fix hooks (112/118); the other five pin behaviour the rewrites could have broken. Tests 107 -> 118 assertions #T123 and the checkpoint's file list expanded to individual untracked files. Two findings in a review of the #T121 commit. (1) `compact-suggest.sh` took the *leftmost* `"usage"` key in a record, but `message.content` serializes before `message.usage` — confirmed by probe (`content@181 tool_use@200 usage@457`) — so a `tool_use` input carrying its own `usage` object would be measured instead of the context, and being small would silence the nudge at exactly the pressure it exists to report; the adjacent hole is a user record's `toolUseResult`, arbitrary JSON from an MCP server or a file read. The scan now walks to the last `"usage"` key and requires `type:assistant`, which is present on 635 of 635 records carrying a usage object. Recorded honestly in the hook comment that neither shape occurs in the transcript that motivated the finding (0 of 1571 records carry two `usage` keys; first-based and last-based both yield 125936) — they are structural guards against a silent failure, not fixes for an observed one. (2) `pre-compact.sh` built `modified_files` from `git status --porcelain`, which collapses a wholly untracked directory to a single `?? dir/` entry, so a session that had just built a new feature under a new directory handed the next session a directory name instead of the files it wrote; reproduced directly before changing anything. Now `--untracked-files=all`, with a `.gitignore` assertion pinning that ignored paths stay excluded. All five new behavioural assertions verified to fail against the pre-fix hooks. Tests 100 -> 107 assertions #T122
- [x] Handoff discovery correlated with the authoring session. PR review flagged that `pre-compact.sh` globbed `.claude/sessions/handoff-*.yaml` project-wide with no reference to `SESSION_ID`; reproduced against the round-5 hook — with two sessions sharing a checkout, the one compacting was handed the *other* session's `compact_instruction`, steering its summarizer to preserve context it does not have. The handoff document cannot carry its own session id (the model authoring it has no reliable way to learn one), but `compact-suggest.sh`'s PostToolUse payload carries `session_id` and `tool_input.file_path` together, so it now stamps `.compact-handoff-<sid>` on every write to a handoff path — before the once-per-cycle exit, since the handoff is written after the nudge. `pre-compact.sh` prefers that record (still subject to cycle freshness, so a previous cycle's handoff is not re-forwarded) and falls back to the newest handoff no *other* session has claimed, with newline-framed matching so a prefix-colliding path cannot exclude a legitimate one. The glob is kept rather than replaced: a handoff written by some means this chain cannot observe still gets forwarded. `session-end-cleanup.sh` removes and prunes the new marker. A second review round then caught that the record kept only the newest path per session, so a session that wrote two handoffs in one cycle left the earlier one looking unattributed and the other session's fallback forwarded it — the same leak one handoff further back; reproduced end-to-end through the real hooks (`claims recorded: 1 | forwarded to s1: SESSION TWO first instruction` before, `2 | <nothing>` after). The record is now append-only, one line per handoff, deduped against the last line so a handoff revised ten times costs one line; both readers consume every line, and own-claim selection takes the last line that still exists and is fresh. Tests 72 -> 94 assertions #T120
- [x] Handoff filenames made collision-resistant. Third finding of the same PR review, and the one ownership tracking structurally could not answer: `/tools:handoff` generated `handoff-$(date +%Y-%m-%d-%H%M).yaml`, so two sessions running it in the same minute wrote the *same path* — the second body destroying the first, and both `.compact-handoff-<sid>` records truthfully claiming it. Claims name paths; equal paths are indistinguishable no matter how many are tracked. Data loss is the worse half and is real independent of compaction. Names are now `handoff-YYYY-MM-DD-HHMMSS-$RANDOM.yaml`. Blast radius checked across every consumer of the name: all of them glob (`handoff-*.yaml`, or `handoff-2026-02-*.yaml` in `.claude/archive-sessions.sh`), so a longer suffix is transparent; the single real coupling was `pre-compact.sh`'s `sort`-based newest-candidate selection, which the token cannot perturb because it trails the full timestamp. That sort is now pinned to `LC_ALL=C` — glibc's UTF-8 collation weights punctuation weakly enough to rank a legacy `-1400.yaml` above a `-140030-42.yaml` written thirty seconds later. A session-id suffix stays unavailable for the reason recorded twice before: the authoring model cannot learn its own session id. Also corrected `handoff.md`'s stale claim that a 30-minute age window governs freshness — since #T119 that is only the first-compaction bootstrap. Tests 94 -> 100 assertions #T121
- [x] Replaced the transcript-bytes proxy with a measured token count instead of calibrating it — the assumption behind #T118 was disproved, not tuned. Assistant records in the transcript JSONL already carry `usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, which is the real context size in the same unit as `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; the byte proxy tracked a different quantity entirely (2,897,308 bytes against 106,432 actual tokens — 27 bytes/token, ~7x the normal ratio), so the nudge fired at ~53% of the window rather than the intended point. Reading the real number also lets the nudge threshold be derived (`COMPACT_PCT - 15`, floored at 20) instead of asserted, and bytes survive only as a fallback when no `usage` record is present. Same move applied to handoff freshness: the asserted 30-minute window became cycle-scoped via a `.compact-cycle-<sid>` marker, so a handoff counts iff it was written since the last compaction. Confirmed live in-session at exactly 60% of a 200000-token window. Third latent bug fixed: the `pre-compact.sh` FEATURE awk reset its match at every `## Feature:` heading, so an in-progress task in an earlier section was forgotten and `feature` came out `none`. Tests 45 -> 72 assertions. Supersedes #T118 #T119
- [x] Compaction Handoff Chain — auto-compaction at 75% of the window, a PostToolUse nudge that requires a model-authored handoff while the context to write one still exists, and the handoff's `compact_instruction` forwarded to the compaction summarizer via PreCompact stdout. Blocking was designed for three rounds and rejected on CLI verification: a `PreCompact` block reason reaches only a debug log and a reason-less notification, never Claude. Read-only system-map drift check, forwarded as a caveat — never healed. Fixed a pre-existing bug that had made every auto-checkpoint's `phase`/`feature`/`in_progress` fields inert. Spec `docs/specs/compaction-gate/`, tests `tests/compaction-hooks.sh` (45 assertions at the time; later entries carry the count forward). Implemented directly at the owner's direction; did not pass through `/pm:approve` #T117
<!-- #T118 (calibrate PROJECT_OS_COMPACT_NUDGE_BYTES) closed 2026-07-30 without being done: the byte proxy it proposed to calibrate was removed in #T119. ID #T118 is retired, never reused. -->


## Backlog
<!-- Ideas that have been captured but not yet designed -->
- [x] SOTA adoption — workflow ergonomics (RE-SCOPED 2026-07-17, SHIPPED same day): shipped `/goal` wave/MVP exit predicates + wave-handoff artifact + `tools:update --diff-upstream`. `tools:audit-knowledge` dropped (subsumed by self-maintenance maintain.sh/system-map); `tools:sota-scan` deferred as machine-local. Needs a short re-scoping design pass first. Revised plan: `.claude/plans/sota-adoption-2026-05.md` (see REVISED SCOPE block) #T34
<!-- #T1 (agent-teams experiment spike) retired 2026-07-12: agent teams shipped as a native Claude Code feature, obsoleting the CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS assessment. Draft a new idea via /workflows:idea if native agent-team adoption is worth exploring. ID #T1 is retired, never reused. -->

## Completed
<!-- Moved here after /workflows:ship -->
