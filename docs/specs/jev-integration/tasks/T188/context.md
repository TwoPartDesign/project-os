# Task T188 context

Feature: jev-integration
Source: ../../tasks.md
Design: ../../design.md

Common rules for every task:
- Tests use `node:test`, one fixture per test, no shared `beforeEach`,
  names `[unit]_[scenario]_[expected]`, specific-value assertions, error
  message content asserted. Any test needing a project root copies the
  needed files into a `mkdtempSync` directory and never touches this repo's
  `.claude/logs/` or `docs/specs/`.
- All `execFileSync` calls take argv arrays. No shell strings.
- Every exported function has a docstring.
- No runtime npm dependency. Node `>=22.18` only.
- Run only the suite covering the file you changed:
  `node --test tests/<name>.test.ts`.

### T188: Knowledge, decision record, manifest
- **Depends on**: T187
- **Files**: `docs/knowledge/architecture.md` (modify: Scripts table after the `dashboard.sh` row and the `lib/policy.ts` row; Security Scanning section), `docs/knowledge/decisions.md` (modify: append), `.claude/manifest.json` (regenerate)
- **Pattern**: Existing table rows; ADR format in `decisions.md` (Decision / Context / Alternatives Considered / Rationale).
- **Implementation**:
  - `architecture.md`: rows for `lib/decide.ts` (typed decision interface, heuristic default, opt-in Jev backend, sole outbound caller), `lib/egress-guard.ts` (scrub + re-scan + denylist + entropy guard for outbound text), `review-triage.ts` (advisory triage of reviewer findings). In Security Scanning, add the `bare-sk-token` rule note and an "Egress allowlist" bullet pointing at `.claude/security/egress-allowlist.json`.
  - `decisions.md`: append `## 2026-09-20 — Hosted Decision API (Jev) as an Optional Addon Behind a Local Heuristic` covering: endpoint constant; scrub-then-verify via subprocess because `cmdScrub` exits 0 on write failure; entropy floor for bare credentials; heuristic ships first, Jev gated on the calibration procedure and the key-shape check (copy both procedures from design.md Testing Strategy verbatim); alternatives rejected (SDK, TypeSafe skill, Claude backend in v1, PreToolUse consumer).
  - Run `bash scripts/generate-manifest.sh` and commit the regenerated `.claude/manifest.json`.
- **Tests**: none. Run `node scripts/system-map.ts report` and confirm no new HIGH finding names the three new scripts.
- **Acceptance Criteria**:
  - [ ] `.claude/manifest.json` lists `scripts/lib/decide.ts`, `scripts/lib/egress-guard.ts`, `scripts/review-triage.ts`, `.claude/security/egress-allowlist.json`
  - [ ] `node scripts/system-map.ts report` shows no new HIGH finding for the new files
  - [ ] `bash scripts/validate-roadmap.sh` passes
- **Size**: Small
- **Status**: [?]
