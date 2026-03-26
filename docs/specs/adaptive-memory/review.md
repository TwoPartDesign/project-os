---
feature: adaptive-memory
date: 2026-03-25
reviewers: 3 (drift, security, quality) x 2 rounds
gate: PASSED WITH NOTES
---

# Review: adaptive-memory (Round 2)

## Gate Decision: PASSED WITH NOTES

All CRITICAL/HIGH issues from Round 1 and Round 2 have been fixed. 7/8 tasks pass review (T9 still in progress).

## Round 2 Fixes Applied

1. **CRITICAL (fixed)**: `cmdIndexObservations` now unwraps `ParseResult.observations` — observations persist correctly
2. **MEDIUM (fixed)**: pre-compact.sh YAML values now double-quoted with escaped internals
3. **LOW (fixed)**: `--obs-type` added to search usage string
4. **LOW (fixed)**: `observationType` normalized to lowercase

## Round 1 Fixes (from rebuild)

1. **HIGH (fixed)**: T7 — `output-index.sh` now calls `index-observations` to persist observations
2. **HIGH (fixed)**: T8 — `--obs-type` flag with conditional `INNER JOIN observation_meta` in cmdSearch
3. **MEDIUM (fixed)**: Trap uses cleanup function for proper OBS_FILE reference
4. **MEDIUM (fixed)**: `recency_halflife_days` exposed in settings.json
5. **MEDIUM (fixed)**: Sensitive key denylist in observation-parser.ts

## Remaining Notes (non-blocking)

- observation-parser.ts: Duplicated sequential regex pattern across extractFileRelationships and extractDependencyChains
- observation-parser.ts: Import lines generate both file-relationship and dependency-chain observations (by design)
- knowledge-index.ts: SQL param ordering is correct but fragile (positional ? binding)
- knowledge-index.ts: cmdIndexVault opens DB N*2 times in loop (performance, not correctness)
- observation-parser.ts: sensitivePatterns could be broader (add PASSPHRASE, JWT, SIGNING_KEY)
- pre-compact.sh: `| head -1` after awk that already `exit`s is redundant

## Task Status

| Task | Gate | Notes |
|------|------|-------|
| T2 | PASS | PreCompact hook with debounce, YAML output, additionalContext |
| T3 | PASS | Hook wired in settings.json, handoff.md documented |
| T4 | PASS | Schema migration, access tracking columns |
| T5 | PASS | Composite scoring formula matches spec |
| T6 | PASS | All 5 observation types, dedup, 100-cap, sensitive key denylist |
| T7 | PASS | Observations persisted via index-observations call |
| T8 | PASS | --obs-type filter with conditional JOIN, case-insensitive |
| T9 | IN PROGRESS | Tests + docs (not reviewed) |
