---
type: knowledge
tags: [patterns, conventions]
description: Established code patterns and conventions discovered during development
links: "[[decisions]], [[architecture]]"
date: "2026-07-12"
---

# Established Patterns

## Format
Each entry: Pattern Name, When to Use, Example, Anti-pattern to Avoid

---

<!-- Entries get appended here as patterns are discovered during build and review -->

### ROADMAP↔Tasks Dual-Track

**When to Use**: During `/workflows:build` when orchestrating parallel sub-agents.

**Pattern**: ROADMAP.md is the authoritative, git-versioned governance record for task state. Native Tasks (TaskCreate/TaskUpdate/TaskList) are the runtime scheduling engine — dependencies (`addBlockedBy`) determine what dispatches next. Each time a dispatch batch drains, re-derive state from ROADMAP.md markers as a consistency check.

**Example**:
- Build start: parse ROADMAP.md → create native Tasks with addBlockedBy from `(depends:)` clauses
- On dispatch: ROADMAP `[ ]`→`[-]` + TaskUpdate(status: "in_progress")
- On completion: ROADMAP `[-]`→`[~]` + TaskUpdate(status: "completed") — dependents unblock automatically
- Batch drain: re-read ROADMAP.md markers, cross-check against TaskList

**Anti-pattern**: Treating native Tasks as the source of truth. If TaskCreate fails or Tasks drift from ROADMAP markers, the build falls back to scheduling from ROADMAP.md markers and `(depends:)` clauses alone.

---

### Schema Contract Across File Boundaries

**When to Use**: When a producer (parser, API, hook) outputs data consumed by another module.

**Pattern**: Verify the output schema of the producer matches the input expectations of the consumer at integration time. A wrapper object (`{observations: [...]}`) vs. a bare array (`[...]`) is a common mismatch that silently fails when the consumer's validation rejects the input.

**Example**:
- `observation-parser.ts` outputs `ParseResult {observations: [...], raw_line_count, observation_count}`
- `cmdIndexObservations` originally expected a bare `ObservationEntry[]` array
- Fix: unwrap `parsed.observations` before validation

**Anti-pattern**: Testing producer and consumer in isolation without an integration test that pipes real output through the full chain.

---

### Security Scanning Gate

**When to Use**: Before any git commit, push, or PR creation.

**Pattern**: Defense-in-depth scanning at three layers: pre-commit hook blocks staged secrets via `scan-staged`, pre-push hook scans the full diff via `scan-diff`, and the ship workflow runs `scan-diff $BASE` as step 1.5. Inline `// scan:allow` suppresses intentional false positives. The allowlist at `.claude/security/allowlist.json` configures path ignores and stopwords.

**Example**:
- Pre-commit: `node scripts/security-scanner.ts scan-staged` — blocks `ghp_*`, `sk-ant-*`, PII in docs
- Ship workflow step 1.5: `node scripts/security-scanner.ts scan-diff origin/master` — catches anything that slipped through
- False positive: add `// scan:allow` on the line, or add the pattern to allowlist stopwords

**Anti-pattern**: Relying solely on `.gitignore` to prevent secret leakage. Using `--no-verify` to bypass hooks without the ship workflow as a backup safety net.

---

### Sole-Writer Self-Enforcement

**When to Use**: When a CLI or module is documented as the *only* sanctioned path to mutate a sensitive artifact (e.g. `maintain-draft.ts` is the only writer the autonomous loop may use to touch ROADMAP.md).

**Pattern**: The writer must enforce its own invariants (sanitize all inputs that reach the artifact), not rely on callers to pass clean data. Sanitize every field written, not just the obvious one — `maintain-draft.ts` originally sanitized `--title` but wrote `--fingerprint` raw; a newline in the fingerprint could break out of its HTML comment and forge a task line. The safety at the current call sites (bash tooling that strips newlines) was incidental, not guaranteed.

**Example**: `sanitizeFingerprint()` applied once before both the dedup match and the write, mirroring `sanitizeTitle()`. Regression test injects a newline-laden fingerprint and asserts no standalone forged task line survives.

**Anti-pattern**: "The only caller today passes safe values, so the writer doesn't need to sanitize." Call sites change; a general-purpose writer outlives the assumptions of its first caller.

---

### Deterministic Artifact: Heal, Don't Block

**When to Use**: A committed artifact is fully generated from source (system maps, lockfiles, generated code) and can be regenerated at any time.

**Pattern**: On a pre-commit freshness check, if the artifact drifted, **regenerate it from the staged (index) content and re-stage it** — the commit proceeds with a correct artifact. Reserve hard commit failure for cases the machine genuinely can't resolve (generator crash, a scan finding in the regenerated output). Read inputs from the git index (`git show :<path>`), never the working tree, so a partially-staged commit produces an artifact describing exactly what's being committed.

**Example**: `system-map.ts precommit` re-hashes inputs from the index; on drift it regenerates `docs/maps/*`, `git add docs/maps`, runs a scoped scan on the healed files, exits 0. Only a generator or scan error exits 1.

**Anti-pattern**: Failing the commit and making the human regenerate by hand (the "generated — do not edit, now go regenerate" treadmill), or regenerating from the dirty working tree so the committed artifact describes uncommitted state.

---

### Denylist Before Emit

**When to Use**: Any extractor that surfaces config/key-value facts from arbitrary tool output (logs, JSON, env files) into a persisted or indexed artifact.

**Pattern**: **Normalize the key, then test it against a separator-free sensitive-name denylist** (`SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY|PRIVATEKEY|AUTH`, case-insensitive) *before* emitting the observation — never emit a value whose key matches, regardless of key format (env-var `KEY=value` or JSON `"key": "value"`) or casing convention. Stripping `_`/`-` from the key before matching is essential: a denylist of `API_KEY`/`PRIVATE_KEY` catches snake_case but silently misses camelCase (`apiKey`, `privateKey`) — exactly the JSON style most likely to carry a secret. The check happens once, at the point of emission, so every downstream caller inherits the guarantee for free. When in doubt, over-suppress: a missed observation never leaks; a missed secret does.

**Example**: `extractConfigKeys()` in `scripts/observation-parser.ts` runs `isSensitiveKey(key)` = `sensitivePatterns.test(key.replace(/[_-]/g, ""))` for both the env-var and JSON code paths and `continue`s past a match without pushing an observation. `tests/observation-parser.test.ts` asserts the raw secret values never appear anywhere in the serialized output for snake_case (`extractConfigKeys_envAndJsonSecrets_excludedFromOutput`) AND camelCase (`extractConfigKeys_camelCaseSecretKeys_excludedFromOutput`) keys — not merely that the observation count is low.

**Anti-pattern**: A denylist that assumes one key-casing convention (`API_KEY` only) — camelCase variants slip through. Or redacting at the *consumer* (indexer/dashboard) instead of the extractor — every future consumer has to remember the filter, and one that forgets leaks the secret into the search index or a UI.

---

### Mitigate Against the Platform's Real Surface, Not Its Defaults

**When to Use**: Any security mitigation that intercepts a platform mechanism (git hooks, config resolution, module loading, PATH lookup).

**Pattern**: Enumerate where the platform *actually* looks — not where it looks by default — and mitigate there. Resolve indirection the same way the platform does (`git rev-parse --git-path hooks`, which honors `core.hooksPath`, not `--git-dir` + `/hooks`); cover the full mechanism surface (all 20 git hook types fire on operations you perform, not just the two you install); and gate on markers you wrote, never on substrings an attacker's file can contain. When a read-only classifier reports what a mitigation will do (e.g. in a dry run), it must share the mitigation's own definition of scope — two hand-maintained lists WILL drift.

**Example**: adopt-existing-project review round 1: three independent quarantine bypasses — a spoofable substring gate (`grep "scan-staged"` matched a hostile hook's comment), `core.hooksPath` redirecting git away from the quarantined directory, and unquarantined `commit-msg`/`post-commit` hooks firing on the adopt commit. All three passed the original tests, which only exercised a naive `echo` hook at the default path. Fixed with marker-exact gating, `--git-path` resolution, the full 20-name quarantine, and canary-file regression tests (hook writes a file if executed; assert absent).

**Anti-pattern**: Testing a security control only with a naive payload at the default location; gating "already installed" on any string that user-controlled content can also contain; letting the report/dry-run classifier enumerate a different scope than the enforcement code.

---

### Invert Open-Ended Recognition Predicates to Closed Allowlists

**When to Use**: Any automated safety predicate that must decide "does this content contain something meaningful/live/dangerous?" — e.g. "does this line carry another live reference?", "is this output free of secrets?".

**Pattern**: A denylist of *recognized meaningful shapes* is an open-ended recognition problem — every enumeration has a shape it missed, and an adversarial pass will find it. Invert: define the **closed set of trivially-safe residue** (whitespace, punctuation, markdown syntax) and refuse anything outside it. The predicate becomes strictly narrower but sound; borderline cases fall back to the human-gated path, which is the correct failure direction for an unattended tier.

**Example**: skill-apply's auto-tier entanglement check went through two broken denylist generations (5 path prefixes → broken by `bin/critical-tool.sh`, reproduced end-to-end) before being inverted in round 3: a dead-ref-bearing line is auto-removable only if excising the ref leaves residue with no `[A-Za-z0-9]` at all. The adversarial verifier then held it under Unicode, boundary, and syntax-smuggling attack (one LOW ASCII-scope residual, filed as #T95).

**Anti-pattern**: Patching a broken recognition denylist by adding the newly-found shape — it converges never; the class of misses survives every instance fix. Also: claiming "any word content" in docs when the implementation matches a narrower character class — keep predicate claims verbatim-accurate to the code.
