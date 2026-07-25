---
type: knowledge
tags: [patterns, engineering, framework-reference]
description: Transferable engineering patterns learned building Project OS — reference material, not this project's established conventions
links: "[[patterns]]"
---

# Transferable Engineering Patterns (Framework Reference)

**What this file is.** These patterns were learned while building Project OS, but they are
general engineering guidance rather than framework trivia — they apply to any codebase with a
sanctioned writer, a generated artifact, a secret-bearing extractor, or a safety predicate.

**What this file is NOT.** It is **not** `docs/knowledge/patterns.md`. That file is
`@import`ed into `CLAUDE.md` as *this project's active conventions* and must contain only
patterns **this** project has actually established. This file is reference material: read it
when the situation arises, and if you adopt one of these patterns here, write your own entry in
`patterns.md` describing how it applies to this codebase.

Kept as a shipped reference rather than deleted because the guidance is durable and hard-won;
kept out of `patterns.md` because a convention nobody here established is not a convention.

---

### Sole-Writer Self-Enforcement

**When to Use**: When a CLI or module is documented as the *only* sanctioned path to mutate a sensitive artifact.

**Pattern**: The writer must enforce its own invariants (sanitize all inputs that reach the artifact), not rely on callers to pass clean data. Sanitize every field written, not just the obvious one. In Project OS, `maintain-draft.ts` originally sanitized `--title` but wrote `--fingerprint` raw; a newline in the fingerprint could break out of its HTML comment and forge a task line. The safety at the then-current call sites (bash tooling that strips newlines) was incidental, not guaranteed.

**Example**: One `sanitizeFingerprint()` applied before both the dedup match and the write, mirroring `sanitizeTitle()`. Regression test injects a newline-laden fingerprint and asserts no standalone forged record survives.

**Anti-pattern**: "The only caller today passes safe values, so the writer doesn't need to sanitize." Call sites change; a general-purpose writer outlives the assumptions of its first caller.

---

### Deterministic Artifact: Heal, Don't Block

**When to Use**: A committed artifact is fully generated from source (system maps, lockfiles, generated code) and can be regenerated at any time.

**Pattern**: On a pre-commit freshness check, if the artifact drifted, **regenerate it from the staged (index) content and re-stage it** — the commit proceeds with a correct artifact. Reserve hard commit failure for cases the machine genuinely can't resolve (generator crash, a scan finding in the regenerated output). Read inputs from the git index (`git show :<path>`), never the working tree, so a partially-staged commit produces an artifact describing exactly what's being committed.

**Anti-pattern**: Failing the commit and making the human regenerate by hand (the "generated — do not edit, now go regenerate" treadmill), or regenerating from the dirty working tree so the committed artifact describes uncommitted state.

---

### Denylist Before Emit

**When to Use**: Any extractor that surfaces config/key-value facts from arbitrary tool output (logs, JSON, env files) into a persisted or indexed artifact.

**Pattern**: **Normalize the key, then test it against a separator-free sensitive-name denylist** (`SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY|PRIVATEKEY|AUTH`, case-insensitive) *before* emitting the observation — never emit a value whose key matches, regardless of key format (env-var `KEY=value` or JSON `"key": "value"`) or casing convention. Stripping `_`/`-` from the key before matching is essential: a denylist of `API_KEY`/`PRIVATE_KEY` catches snake_case but silently misses camelCase (`apiKey`, `privateKey`) — exactly the JSON style most likely to carry a secret. The check happens once, at the point of emission, so every downstream caller inherits the guarantee for free. When in doubt, over-suppress: a missed observation never leaks; a missed secret does.

**Anti-pattern**: A denylist that assumes one key-casing convention (`API_KEY` only) — camelCase variants slip through. Or redacting at the *consumer* (indexer/dashboard) instead of the extractor — every future consumer has to remember the filter, and one that forgets leaks the secret into the search index or a UI.

---

### Mitigate Against the Platform's Real Surface, Not Its Defaults

**When to Use**: Any security mitigation that intercepts a platform mechanism (git hooks, config resolution, module loading, PATH lookup).

**Pattern**: Enumerate where the platform *actually* looks — not where it looks by default — and mitigate there. Resolve indirection the same way the platform does (`git rev-parse --git-path hooks`, which honors `core.hooksPath`, not `--git-dir` + `/hooks`); cover the full mechanism surface (all 20 git hook types fire on operations you perform, not just the two you install); and gate on markers you wrote, never on substrings an attacker's file can contain. When a read-only classifier reports what a mitigation will do (e.g. in a dry run), it must share the mitigation's own definition of scope — two hand-maintained lists WILL drift.

**Anti-pattern**: Testing a security control only with a naive payload at the default location; gating "already installed" on any string that user-controlled content can also contain; letting the report/dry-run classifier enumerate a different scope than the enforcement code.

---

### Invert Open-Ended Recognition Predicates to Closed Allowlists

**When to Use**: Any automated safety predicate that must decide "does this content contain something meaningful/live/dangerous?"

**Pattern**: A denylist of *recognized meaningful shapes* is an open-ended recognition problem — every enumeration has a shape it missed, and an adversarial pass will find it. Invert: define the **closed set of trivially-safe residue** (whitespace, punctuation, markdown syntax) and refuse anything outside it. The predicate becomes strictly narrower but sound; borderline cases fall back to the human-gated path, which is the correct failure direction for an unattended tier.

**Anti-pattern**: Patching a broken recognition denylist by adding the newly-found shape — it converges never; the class of misses survives every instance fix. Also: claiming "any word content" in docs when the implementation matches a narrower character class — keep predicate claims verbatim-accurate to the code.
