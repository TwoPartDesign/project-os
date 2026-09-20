# Memory: Jev integration shipped (2026-09-20)

- Shipped: jev-integration (#T178–#T188) on branch
  `claude/jev-integration-project-os-x9t11q`; review round 1 FAILED (1 HIGH,
  3 security MEDIUM), all fixed in-session, round 2 PASSED WITH NOTES; full
  suite 10/10, node suite 450/450; PR opened via the GitHub MCP tool (no
  `gh` in the remote session). Rider #T189 (compaction-gate) built on the
  same branch, `[~]`, awaiting its own review.
- Lessons:
  - A consumer that merges "answers" from several decision results must
    check each result's backend and its `rejected` list; a declined chunk's
    heuristic stubs look exactly like real answers. Fix shape: one accessor
    (`jevAnswers`) that filters, used by every consumer path.
  - The 4.0 bits/char entropy floor is unreachable for hex tokens
    (log2(16) = 4.0); any charset-blind entropy gate needs a per-charset
    branch or it silently passes every hex key.
  - Anything that honours an inline allow marker (`scan:allow`) must
    neutralize that marker in untrusted text before staging it for the
    scanner, or "verified clean" is vacuous for that line.
  - Running the shipped feature on its own review reports is the cheapest
    end-to-end check: the triage run showed the marker neutralization and
    entropy redaction working before the review record was written.
  - Review-fix workers on Opus at high effort closed three security
    findings in one pass (~117k tokens); the lead's direct edit closed the
    HIGH faster than a brief would have (under 100 lines across two files).
- Left for the user (review.md notes): system-map multi-line-import
  extractor gap, `runTriage`/`decide` length, `computeAgreement`
  duplication, `projectRoot` in `DecideDeps`, boundary tests, review-triage
  permission argv scope, PAT-shaped literal in a fixture.
