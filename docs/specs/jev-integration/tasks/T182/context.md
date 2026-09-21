# Task T182 context

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

### T182: Review-report fixtures
- **Files**: `tests/fixtures/review-raw/architecture.md` (create), `tests/fixtures/review-raw/security.md` (create), `tests/fixtures/review-raw/tests.md` (create), `tests/fixtures/review-raw/changed-files.txt` (create)
- **Pattern**: Finding-line format from `.claude/commands/workflows/review.md:96-97` (`DRIFT:`), `:139-140` (`VULN:`), `:170-171` (`ISSUE:`), plus the `PASS:`, `UNPLANNED:`, `CONCERN:`, `SUGGESTION:` trailer lines each reviewer emits.
- **Implementation**:
  - `changed-files.txt`: three lines: `scripts/alpha.ts`, `scripts/lib/beta.ts`, `tests/alpha.test.ts`.
  - `architecture.md`: two findings. A1 `HIGH / scripts/alpha.ts:40-58 / DRIFT: task required retry cap of 2, code retries 3 times / set MAX_RETRIES to 2`. A2 `LOW / docs/knowledge/gamma.md:5 / DRIFT: doc says 3 hooks, there are 4 / update the count`. Then one `UNPLANNED:` line and one `PASS:` line.
  - `security.md`: three findings. S1 `HIGH / scripts/alpha.ts:41-57 / VULN: retry loop re-sends credentials on every attempt, 3 attempts instead of the 2 the spec allows / cap retries at 2 and clear the header` (planted duplicate of A1: same file, overlapping lines). S2 `MEDIUM / scripts/lib/beta.ts:12 / VULN: path joined with user input, no containment check / resolve and assert startsWith(root + "/")` (contains no slash issue). S3 `LOW / scripts/unrelated/delta.sh:3 / VULN: unquoted $VAR in echo / quote it` (planted out-of-scope: not in changed files, no sibling changed). Then one `CONCERN:` and one `PASS:` line.
  - `tests.md`: two findings. Q1 `MEDIUM / tests/alpha.test.ts:10-30 / ISSUE: shared beforeEach mutates fixture across cases / build the fixture per test` . Q2 `LOW / scripts/lib/beta.ts:12 / ISSUE: joinPath() has no containment guard and no docstring / add a guard and a docstring` (planted duplicate of S2: same file and line; ISSUE text shares tokens "containment"). Q2's FIX contains no ` / `; Q1's ISSUE contains ` / ` once: change Q1's ISSUE to `ISSUE: shared beforeEach mutates fixture / state across cases`. Then one `SUGGESTION:` and one `PASS:` line.
  - One finding in `security.md` (S2's FIX) must contain a `ghp_` followed by 36 lowercase alphanumerics inside backticks, e.g. `...startsWith(root + "/"); never log tokens like \`ghp_...\``, so T186's scrubbed-output test has a planted secret. Because `tests/fixtures/**` is path-ignored by `.claude/security/allowlist.json`, this does not trip pre-commit.
- **Tests**: none; consumed by T184 and T186.
- **Acceptance Criteria**:
  - [ ] Exactly seven finding lines across the three files, matching `^(CRITICAL|HIGH|MEDIUM|LOW) / `
  - [ ] Two planted duplicate pairs (A1/S1, S2/Q2), one planted out-of-scope finding (S3), one ISSUE with ` / ` (Q1), one planted `ghp_` token (S2)
  - [ ] `git status` shows the four files as the only additions
- **Size**: Small
- **Status**: [?]
