# Memory: compaction-gate (#T189) reviewed and shipped (2026-09-21)

- Shipped: `scripts/compaction-metrics.ts` + `docs/knowledge/compaction-metrics.md`
  on branch `claude/jev-integration-project-os-x9t11q` (rider on the merged
  jev-integration branch; its own PR after PR #2). Review: two reviewers
  (security on Opus, tests on Sonnet) plus the lead's drift check; PASSED
  WITH NOTES after two verified HIGHs were fixed in review. Full suite
  10/10, test file 8 → 11.
- Decision: keep 350k / 80%; never narrow the window; 70% is the spend-first
  option to revisit after a second session's data. ADR in decisions.md.
- Lessons:
  - A "the simulation reproduces the real count" claim is only validation
    when the compared number is independent of the code under test. Here
    the match came from the bug itself (re-seed context stacked across real
    cycles); the reviewer's CONCERN line, not its HIGH line, carried the
    decisive evidence. Read CONCERNs as claims to verify, not as colour.
  - A replay of "what if the threshold were X" must ignore the transcript's
    real compactions (add only positive turn-to-turn growth) and reset only
    when the simulated threshold fires — to the observed re-seed floor
    (~88k here: system prompt, tools, CLAUDE.md, summary), not the
    boundary's summary-only `postTokens` (12-19k).
  - Never `process.exit()` after `process.stdout.write()` in a Node CLI whose
    output is piped: stdout flushes asynchronously and everything past the
    64 KB pipe buffer is dropped with exit 0. Let `main()` return.
  - A live transcript keeps growing while its session runs; two CLI runs a
    minute apart differ in the tail cycle. Snapshot once and cite that run.
  - Tool-error deciles count permission-classifier denials as errors; a
    closing phase with several denied commands shows up as a quality spike
    in whichever decile it lands in. Attribute before concluding.
  - Both HIGHs were under twenty lines each; fixing them as lead inside the
    review cost far less than a rebuild cycle would have. Recording the
    substitution in review.md is what keeps that honest.
- Left for the user (review.md notes): empty/multi-file transcript tests,
  `pinCompactionPoint` timestamp fallback, `analyze()`/`cycleStats`
  duplication, per-file replay in directory mode, prefix-wildcard
  permission form, CLAUDE.md's 60% nudge figure (hook fires at 65%).
- Reflection drafts filed and approved by the owner the same session: #T192
  (sized pass + lead drift check may stand in for the ship gate, applied
  a2617de), #T193 (cross-validate a circularity CONCERN like a HIGH, applied
  d02419f). PR #3 merged to master; session moves local from here.
