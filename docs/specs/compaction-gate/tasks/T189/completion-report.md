# T189 Completion Report

**Task**: Measure whether the 350k-window / 80% compaction constraint helps or
hurts the Fable session (cost, quality, compaction count).
**Agent**: implementer (judgment tier, `(model: opus)` annotation)
**Result**: complete — landed via cherry-pick f135812; manifest entries added
by the lead in the integration commit.

## Files changed

- `scripts/compaction-metrics.ts` (new, 720 lines) — parses a session
  transcript, segments compaction cycles, computes per-cycle stats,
  tool-error rate by context decile, threshold simulation, and pins the
  compaction point.
- `tests/compaction-metrics.test.ts` (new) — 8 tests covering parse,
  segment, stats, decile, simulate, pin.
- `docs/knowledge/compaction-metrics.md` (new) — measured results and the
  recommendation (keep 350,000 / 80%).
- `.claude/commands/tools/metrics.md` — `### Compaction metrics` section.
- `.claude/settings.json` — permission `Bash(node scripts/compaction-metrics.ts*)`.
- `scripts/generate-manifest.sh`, `scripts/new-project.sh`,
  `.claude/manifest.json` — ship the new script (lead integration).

## Tests

`node --test tests/compaction-metrics.test.ts` — 8 pass, 0 fail.

## Assumptions and deviations

- Transcript records are written once per content block with usage
  repeated; the script collapses by response id (204 real turns, not 486).
- The brief's simulate fixture ("20 turns × 20000") cannot yield zero
  compactions at 80%; the test uses 13 turns instead.
- Recommendation: keep the window and percentage. Lowering to 70% is a
  strict loss (3% cache-read saving for two extra compactions); 60% saves
  30% at three extra handoffs; narrowing the window is the worst trade.
