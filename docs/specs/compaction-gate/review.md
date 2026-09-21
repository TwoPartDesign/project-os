# Review: compaction-gate (#T189 — compaction metrics)

Date: 2026-09-21
Scope: #T189 only (`scripts/compaction-metrics.ts`, `tests/compaction-metrics.test.ts`,
`docs/knowledge/compaction-metrics.md`, `.claude/commands/tools/metrics.md`
`### Compaction metrics`, `.claude/settings.json` permission line, manifest and
system-map regeneration). Spec: `tasks/T189/context.md` (five acceptance criteria).

## Sizing

Two reviewers plus the lead's own drift check, not the three-reviewer ship
gate: the diff is one script with a filesystem and CLI surface, so
`reviewer-security` ran on Opus (security and correctness together) and
`reviewer-tests` on Sonnet. The lead ran the drift check directly (five
criteria, all grep-checkable). Raw reports: `review-raw/security.md`,
`review-raw/tests.md`. Triage backend: heuristic (`review-triage.json`), no
Jev lift to quote.

## Result: GATE PASSED WITH NOTES

Both HIGH findings were verified against the source and fixed in this review
(each under twenty lines in one file, the lead's to make per
`.claude/rules/lead.md`). The knowledge doc was regenerated from the corrected
script. Full suite after the fixes: 10/10 suites pass (`gate.log`, 128 s);
`tests/compaction-metrics.test.ts` 11/11.

### 🚫 MUST FIX — verified and fixed here

- **security-1 (HIGH, verified)** `process.exit(0)` after `process.stdout.write`
  truncated piped `--json` output at the 64 KB pipe buffer — the exact usage
  `metrics.md` documents. Fixed: the explicit exit is gone; `main()` now
  returns and lets stdout flush.
- **security-2 (HIGH, verified)** `simulateThreshold` carried `running`
  across real compaction cycles, so each cycle's first turn stacked its full
  re-seed context on the previous cycle's total. The doc's threshold tables
  and its "validates itself" paragraph rested on that inflation (the
  reviewer's CONCERN 1 is correct: the 3 matched compactions were circular).
  Fixed: the replay ignores real boundaries and adds only positive
  turn-to-turn growth, so the only resets are the simulated ones; regression
  test `simulateThreshold_realBoundary_doesNotAddReseedContext` (three
  identical cycles → 2 compactions, the bug reported 3).
- **tests-1 (HIGH, verified gap)** no test for the same-response-id collapse.
  Added `parseTranscript_recordsSharingResponseId_collapseToOneTurn`.

### ⚠️ SHOULD FIX — fixed here (small, adjacent to the HIGHs)

- **security-3** `--window`/`--pct` now require `> 0` and `pct ≤ 100`.
- **security-4** the per-record `uuid` fallback is removed from the response-id
  chain (it defeated the collapse for records without `message.id`).
- **security-5 / tests-6** `main()` wraps `analyze()` in try/catch → stderr
  message, exit 2 (missing path, EISDIR).
- **security-6** the "reset at 86,783" table is now reproducible: `analyze()`
  derives the reset from the observed re-seed floor (first turn after each
  boundary), and the doc carries one table, not a hand-computed second one.
- **security-10** the doc no longer commits the host path and session UUID.
- **tests-2** CLI error paths: `cli_badWindow_exitsTwoWithUsage` covers a
  non-numeric `--window` (exit 2, usage) and a missing file (exit 2, message).

### ⚠️ SHOULD FIX — open, user decides

- **tests-3 / tests-7** empty transcript, no-assistant transcript, and
  multi-file directory merge are still untested.
- **tests-4** `pinCompactionPoint` timestamp-fallback branch untested;
  reviewer-security's CONCERN 2 (two boundaries sharing a timestamp resolve
  to the same turn; empty timestamp returns the last turn) is the same code.
- **tests-5** `analyze()` duplicates `cycleStats`' accumulation loop; extract
  a shared `sumUsage`.
- **security CONCERN 3** directory mode concatenates all files' turns for the
  replay and the pin. Documented in the doc's method notes; a per-file replay
  would be more honest for mixed sessions.

### 💡 CONSIDER

- **security-7** `Bash(node scripts/compaction-metrics.ts*)` is a prefix
  wildcard. It matches the form every other script uses in
  `.claude/settings.json` (lines 62-71); narrowing is a repo-wide policy call,
  not this task's.
- **security-8** whole-file `readFileSync` + `split("\n")`; stream if a
  transcript ever approaches 512 MB.
- **security-9** `responseId` echoed verbatim in `--json`; validate against
  `/^[A-Za-z0-9_-]+$/` if the JSON is ever consumed by anything but a human.
- **security-11** `isMainThread` also requires `agentId === undefined`, which
  the spec does not.
- **tests-8 / tests-9 / tests-10** `renderMarkdown` per-table helpers,
  named constants for the decile count and simulation percentages, split the
  bundled `segmentCycles` fallback test.
- **security CONCERN 4** CLAUDE.md says the compact-suggest nudge fires at
  60%; the code fires at 65% (`COMPACT_PCT - 15`). Instruction-file change —
  noted here for the ship reflection, not made in review.

### ✅ PASSED

- Drift (lead): all five acceptance criteria hold — CLI runs offline with
  `--window/--pct/--json` (305 turns / 6 cycles on the live transcript);
  tests use per-test `mkdtemp`; knowledge doc exists; `### Compaction metrics`
  present in `metrics.md`; no orphan-script or TODO/FIXME finding.
- Security: no secrets, no `eval`/`child_process`/dynamic import, no prototype
  pollution, malformed lines handled, markdown output carries numbers only
  (no prompt content leaks into the committed doc), decile edges correct,
  block collapse survives interleaved tool results.
- Quality: JSON.parse guarded per line, docstrings on every export, per-test
  `mkdtemp`, concrete assertions.

## What the corrected numbers changed

The recommendation moved from "keep 350k/80%, lowering is strictly a loss"
to "keep the window; 80% stays the default, 70% is the spend-first option":
the corrected replay says 70% buys ~18% cache read for one extra compaction
per ~300 turns, on a projection with 8% calibration error against the
session's billed total. One session is not enough to act on that; the doc
says so.
