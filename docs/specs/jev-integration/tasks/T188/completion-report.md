# T188 completion report

Status: complete, integrated as 3a0bf7d (worker commit 64474a8, cherry-picked clean).

Files changed: `docs/knowledge/architecture.md` (rows for `lib/decide.ts`, `lib/egress-guard.ts`, `review-triage.ts`; rule count 233→234 in the table and the Security Scanning bullet; two new Security Scanning bullets for the egress allowlist and egress guard), `docs/knowledge/decisions.md` (ADR "2026-09-20 — Hosted Decision API (Jev) as an Optional Addon Behind a Local Heuristic" with `### Key-shape check at issuance`, `### Calibration procedure`, `### Calibration record` table with the placeholder row), `scripts/new-project.sh` (ships `scripts/review-triage.ts`), `.claude/settings.json` (permission `Bash(node scripts/review-triage.ts*)`), `scripts/generate-manifest.sh` (see deviation), `.claude/manifest.json` (regenerated), `docs/maps/*` (pre-commit heal).

Tests: worker ran `node --test tests/shipped-settings.test.ts` → 4/4 pass. Lead re-verified: `grep` finds `review-triage.ts` in manifest, new-project.sh, settings.json, generate-manifest.sh, architecture.md; manifest lists `scripts/lib/decide.ts`, `scripts/lib/egress-guard.ts`, `.claude/security/egress-allowlist.json`; `Calibration record` appears 3 times in decisions.md; `node scripts/system-map.ts report` shows no HIGH and no finding naming the new files (the pre-existing MEDIUM orphan-script findings are unrelated). Lead read the full ADR and architecture diff directly (text-shaped). Full suite run as the final gate (see wave-4 handoff).

Assumptions: none.

Deviation (accepted): the worker added `"scripts/review-triage.ts"` to the hardcoded `TEMPLATE_SCRIPTS` array in `scripts/generate-manifest.sh`, a file outside the task's list. That array, not `new-project.sh`, decides which top-level scripts the manifest hashes, so the acceptance gate (`review-triage.ts` present in the manifest) was unreachable without it. One line, in scope of the gate's intent.

Worker tokens: ~111k.
