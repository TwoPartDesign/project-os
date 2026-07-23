# Feature Metrics

Track per-feature implementation metrics. Updated by `/workflows:ship` and queryable via `/tools:metrics`.

## Template

```markdown
### Feature: <name>
- **Duration**: start → end (total days)
- **Tasks**: N total, N completed, N blocked
- **Waves**: N waves (from /workflows:build)
- **Revisions**: N review cycles before pass
- **First-pass review rate**: N% (tasks passing review on first attempt)
- **Compete usage**: N tasks used /workflows:compete
- **Model split**: N% Haiku, N% Sonnet, N% Opus
- **Lines changed**: +N / -N
- **PR**: #N (if applicable)
```

## Completed Features

<!-- Entries added by /workflows:ship -->

### Feature: skill-optimization-loop

- **Duration**: 2026-07-22 → 2026-07-23 (2 days: remote idea capture → local design/plan/build/review/ship; interrupted once by monthly spend limit, resumed clean)
- **Tasks**: 14 planned (#T79-#T92) + 3 in-flight loop outputs (#T93-#T95), all completed, 0 blocked at ship
- **Waves**: 4 dispatch batches (9+2+2+1), 4 concurrent sonnet worktree agents; + 3 rebuild rounds (opus)
- **Revisions**: design 2 adversarial rounds (13 findings, incl. the C1 smuggling CRITICAL); implementation 1 full 3-reviewer round + 3 fix rounds + 4 fix-attacking verification passes (r1 FAIL 2 HIGH → r2 FAIL 6 reproduced HIGH → r3 FAIL 1 reproduced HIGH → r4 PASS)
- **First-pass review rate**: 12/14 tasks untouched by rebuilds; the entire fix burden concentrated in skill-apply.ts/skill-apply-lib.ts (#T89/#T90) — the highest-authority new surface, as expected
- **Compete usage**: 0
- **Model split**: orchestration Fable 5; implementation sonnet; rebuild fixes + all reviewers/verifiers opus; #T95 sonnet
- **Lines changed**: +5565 / -208 (34 files, 25 commits vs pre-feature master)
- **Tests**: node suite 153 → 205 (52 new incl. 31-case skill-apply CLI suite with hardlink/junction/oracle-closure/porcelain-empty shapes); smoke 143/0
- **Notable**: verification-by-execution was the story — every post-r1 finding was empirically reproduced, and every fix round was then attacked as a fresh surface (the loop's own #T93 lesson, practiced before it was approved). Denylist→allowlist predicate inversion became a patterns.md entry after two broken denylist generations. The loop dogfooded itself end-to-end in its own ship cycle: review-fail reflection filed #T93/#T94, staged-apply applied them (surfacing an add-op anchor-duplication authoring trap, fixed + ship-reflected), retire-in-place dedup held across triggers.
- **PR**: none (committed to master; framework repo)

### Feature: adopt-existing-project

- **Duration**: 2026-07-17 (single day, single session, fully autonomous idea→ship; ship gate + task approval human-confirmed)
- **Tasks**: 12 total (#T64 umbrella + #T65-#T75), 12 completed, 0 blocked
- **Waves**: 4 dispatch batches (B1: T65|T66|T67|T68|T69 parallel; B2: T70|T72|T73; B3: T71; B4: T74→T75) + 1 rebuild wave (3 fix agents)
- **Revisions**: design 3 adversarial rounds (REJECT→REJECT→APPROVE-WITH-REVISIONS); implementation 2 review cycles (r1 FAILED: 2 CRITICAL + 2 HIGH hook-quarantine/symlink bypasses, all fixed; r2 PASSED, 1 MEDIUM note fixed in-cycle)
- **First-pass review rate**: 6/11 tasks untouched by rebuild (T65, T67, T68, T72, T73, T75); 5 rebuilt (T66, T69-T71, T74)
- **Compete usage**: 0
- **Model split**: orchestration Fable 5; implementation sub-agents Sonnet 5; rebuild fix agents + all reviewers Opus 4.8
- **Lines changed**: +2728 / -258 (20 files vs origin/master)
- **Tests**: smoke suite 127→607 lines (29→143 assertions incl. 10 canary-based security-regression scenarios); detect-stack 6-test node suite; full node suite 128/128
- **Notable**: review r1 found 3 independent hook-quarantine bypasses that all passed the original tests (spoofable marker substring, core.hooksPath evasion, unquarantined hook types) → new patterns.md entry "Mitigate Against the Platform's Real Surface, Not Its Defaults"; follow-up #T76 filed (narrow blanket scripts/* permission allows)
- **PR**: none (committed to master; framework repo)

### Feature: self-maintenance

- **Duration**: 2026-07-16 (single day, multi-session, largely autonomous)
- **Tasks**: 9 total (T46 umbrella + T47-T54; +T45 prerequisite), 9 completed, 0 blocked
- **Waves**: 4 batches (B1: T47|T48|T49|T54 parallel worktrees; B2: T50; B3: T52 then T51 serialized; B4: T53)
- **Revisions**: 1 review cycle — 3 HIGH found, all verified + fixed in-cycle (GATE PASSED WITH NOTES)
- **First-pass review rate**: 8/8 tasks passed; 3 cross-cutting HIGH findings fixed at the gate, not per-task rebuilds
- **Compete usage**: 0
- **Model split**: orchestration Fable 5; all implementation + review sub-agents Sonnet 5 (design review + 3 review reviewers on Opus 4.8)
- **Lines changed**: +5183 / -86 (30 files, incl. T45 prerequisite)
- **Adversarial passes**: 1 design review (12 findings resolved pre-build) + 3-reviewer implementation review (drift/security/quality)
- **Self-validation**: the maintenance loop's first real run surfaced genuine drift (9 manifest gaps, 104 stale files, 12 recurring failures) — the feature exercised itself during build/review
- **PR**: none (committed to master; framework repo)

### Feature: web-fetch

> **Historical**: the web-fetch MCP server code was extracted from this repo to a standalone repository in commit `d2f7cec` (2026-04-08). Metrics retained for the record; the code no longer lives here.

- **Duration**: 2026-04-06 (single day, multi-session)
- **Tasks**: 10 total (T18-T27), 10 completed, 0 blocked
- **Waves**: 4 (W1: T19-T23 parallel; W2: T24; W3: T25; W4: T26,T27 parallel)
- **Revisions**: 2 review cycles (Round 1 failed on 2 MUST FIX + 5 SHOULD FIX; Round 2 passed with notes, all addressed)
- **First-pass review rate**: 90% (9/10 tasks passed first review; T24 required rebuild)
- **Compete usage**: 0 tasks
- **Model split**: Haiku (sub-agents), Opus orchestration + review
- **Lines changed**: +5573 / -1 across 29 files
- **Commits**: 14 (12 feature, 2 fix)
- **Key findings**:
  - Module-level singletons initialized at import time bypass config — lazy-init on first use instead
  - `redirect: "follow"` in Node fetch skips application-layer SSRF validation on redirect targets — must use `redirect: "manual"` with per-hop validation
  - `[\s\S]*?` regex patterns cause catastrophic backtracking on adversarial HTML — bound with `{0,N}` quantifier
  - Mutable loop state (`currentUrl`) that bleeds across retry iterations weakens security guarantees — reset to original value on each attempt
  - DNS rebinding is inherent to application-layer SSRF defense without custom resolvers — document as known limitation
  - Spike-validated 95% avg token reduction with zero-dep custom extractor (target was 80%)
  - Quality cascade (`extractionConfidence` field) enables autonomous detection of poor extraction with auto-fallback to raw mode

### Feature: security-scanner
- **Duration**: 2026-04-03 → 2026-04-05 (3 days, multi-session)
- **Tasks**: 7 total (T10-T16), 7 completed, 0 blocked
- **Waves**: 4 (W1: T10,T11 parallel; W2: T12; W3: T13,T14,T15 parallel; W4: T16)
- **Revisions**: 1 review cycle (GATE PASSED WITH NOTES, 3 SHOULD FIX, 7 CONSIDER)
- **First-pass review rate**: 100% (7/7 tasks passed review, all SHOULD FIX addressed post-gate)
- **Compete usage**: 0 tasks
- **Model split**: Haiku (sub-agents), Opus orchestration + review
- **Lines changed**: +3837 / -52 across 18 files
- **Commits**: 5 (4 feature, 1 docs)
- **Key findings**:
  - ES2024 regex inline modifiers `(?i:...)` work in Node 22+ V8 — two reviewers flagged as crash risk, verified false
  - Worktree isolation doesn't work for drift detection on untracked files — reviewer sees only committed state
  - Test data in rule files (SSNs, credit cards, API key patterns) must be path-allowlisted to avoid self-detection
  - gitleaks PCRE→JS port: 24/233 rules have null regex (PCRE features without JS equivalent), handled as SKIP
  - Shannon entropy filtering correctly rejects low-entropy synthetic test keys — not a bug, a feature

### Feature: adaptive-memory
- **Duration**: 2026-03-25 → 2026-03-26 (1.5 days, single session)
- **Tasks**: 8 total (T2-T9), 7 completed, 0 blocked, 1 in-progress (T9 tests+docs)
- **Waves**: 3 (W1: T2,T4,T6 parallel; W2: T3,T5,T7,T8 parallel; W3: T9)
- **Revisions**: 2 review cycles (Round 1 failed T7+T8, rebuild fixed, Round 2 passed) + 1 Codex review
- **First-pass review rate**: 75% (6/8 tasks passed first review; T7,T8 required rebuild)
- **Compete usage**: 0 tasks
- **Model split**: 100% Sonnet (sub-agents), Opus orchestration
- **Lines changed**: +972 / -34 across 8 files
- **Commits**: 4 (3 feature, 1 docs)
- **Key findings**:
  - Worktree agents don't always persist changes — some worktrees get cleaned up before changes can be committed; copy files to main repo immediately after agent completion
  - ParseResult wrapper objects vs bare arrays — schema mismatches between producer (parser outputs `{observations:[...]}`) and consumer (indexer expects `[...]`) are easy to miss across file boundaries
  - FTS5 `ORDER BY rank DESC` is wrong — FTS5 rank is negative (more negative = better), so default ASC ordering gives best-first results. Pre-existing bug caught by Codex review.
  - Path traversal guards reject legitimate temp files — `/tmp/` paths from mktemp are outside project root, so guards silently block hook operations. Need to distinguish security-sensitive paths from hook-internal temp files.
  - Sensitive key denylist (`SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH`) prevents credential capture in observation parser

### Feature: context-filtering
- **Duration**: 2026-03-03 (single day, multi-session)
- **Tasks**: 8 total, 8 completed, 0 blocked
- **Waves**: 3 (W1: T20, W2: T21, W3: T22-T27 parallel)
- **Revisions**: 1 review cycle + 1 Codex review (GATE PASSED WITH NOTES, 6 SHOULD FIX, 6 CONSIDER)
- **First-pass review rate**: 100% (8/8 tasks passed, all fixes applied post-review)
- **Compete usage**: 0 tasks
- **Model split**: 100% Haiku (sub-agents), Opus orchestration
- **Lines changed**: +1497 / -12 across 17 files
- **Commits**: 9 (8 feature, 1 docs)
- **Key findings**:
  - Codex caught a CRITICAL `const` redeclaration bug that the adversarial review missed — introduced during fix application, not original build
  - `execSync` with template literals is a command injection vector; `execFileSync` with array args is the correct pattern
  - Node 22.16+ `node:sqlite` provides FTS5 with zero npm dependencies
  - PostToolUse hooks cannot modify tool output (advisory only) — this shaped the entire hook architecture

### Feature: strategic-repositioning
- **Duration**: 2026-02-24 (single day, single session)
- **Tasks**: 6 total, 6 completed, 0 blocked
- **Waves**: 2 (Wave 1: T14–T18 parallel, Wave 2: T19 verification)
- **Revisions**: 1 review cycle (passed on first attempt — GATE PASSED WITH NOTES)
- **First-pass review rate**: 100% (6/6 tasks passed)
- **Compete usage**: 0 tasks
- **Model split**: 100% Haiku (sub-agents), Sonnet orchestration
- **Lines changed**: +43 / -19 across 7 files (including ship commit)
- **Commits**: 7 (5 implementation, 1 tracking/verification, 1 ship)
- **Key finding**: T15 fallback path triggered — `grep "Type: Personal"` matched 9 files across scripts/docs, so `Identity:` was added as new field rather than replacing `Type:`. Unique target strings in edit tasks must be scoped to the exact file, not repo-wide patterns.

### Feature: native-foundations (v2.1)
- **Duration**: 2026-02-24 (single day, multi-session)
- **Tasks**: 11 total, 11 completed, 0 blocked
- **Waves**: 4 (W1: T1-T5+T8-T10, W2: T6, W3: T7, W4: T11)
- **Revisions**: 2 review cycles (Round 1 failed on 1 MUST FIX, Round 2 passed)
- **First-pass review rate**: 91% (10/11 tasks passed first review)
- **Compete usage**: 0 tasks
- **Model split**: 100% Haiku (sub-agents), Opus orchestration
- **Lines changed**: +539 / -52 across 14 files
- **Commits**: 12 (9 feature, 2 fix, 1 docs)
- **Key finding**: AI-generated CDN versions/SRI hashes must be verified against npm registry

### Feature: dashboard-kanban (v2.3-dev)
- **Duration**: 2026-07-16 (single session, autonomous via /workflows:mvp — also the mvp e2e smoke test #T38)
- **Tasks**: 5 total (T40-T44), 5 completed, 0 blocked
- **Batches**: 3 (B1: T40|T44, B2: T41, B3: T42|T43) — dependency-scheduled, ROADMAP-marker fallback (native TaskCreate unavailable in session)
- **Revisions**: 3 review rounds (R1: quadratic annotation regex → auto-rebuild; R2: pre-existing whitespace-flood vector → MVP 2-attempt hard stop, user authorized R3; R3: fix + orchestrator found/fixed a third vector in dep extraction → PASSED)
- **First-pass review rate**: 80% (4/5 tasks untouched by revisions; all revisions in T40's parser)
- **Model split**: Sonnet sub-agents (5 impl + 1 rebuild + 1 fix), Opus reviewers (security + design + re-verify), Fable orchestration
- **Lines changed**: +531 / -38 across 8 files (d5bad24..HEAD)
- **Tests**: 15 dashboard (4 ReDoS regression) + 15 hook + 4 scanner — all passing
- **Key findings**: (1) adversarial review earned its cost — three quadratic parse vectors found, two pre-existing in shipped code; (2) index-based parsing with anchored small-slice validation beats regex cleverness for attacker-influenceable text; (3) reviewer claims must be cross-validated — a codex review's 2 findings were empirically refuted earlier the same day, while the opus reviewer's ReDoS finding was empirically confirmed
