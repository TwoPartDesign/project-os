# Task T178 context

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

### T178: Scanner rule for a bare `sk-` token
- **Files**: `scripts/lib/scan-rules.js` (modify: append one rule to the `=== Generic Secret (custom) ===` section near line 2546), `tests/security-scanner.test.ts` (modify: append three cases)
- **Pattern**: Follow `generic-api-key-custom` at `scan-rules.js:2547-2565` for the rule object shape (`id`, `description`, `category`, `regex`, `keywords`, `severity`, `entropy`, `allowlist`, `testCases`). Follow the existing `scan-files` cases in `tests/security-scanner.test.ts` for driving the CLI against a temp file inside a copied project root.
- **Implementation**:
  - Add rule `id: "bare-sk-token"`, `description: "Bare sk- prefixed API token with no vendor infix and no adjacent key name"`, `category: "api-key"`, `regex: /\bsk-(?!ant-|proj-|svcacct-|admin-)[A-Za-z0-9_-]{24,}\b/`, `keywords: ["sk-"]`, `severity: "MEDIUM"`, `entropy: true`, `allowlist: { regexes: [/example/i, /placeholder/i, /xxx/i], paths: [], stopwords: [] }`.
  - `testCases`: positive `sk-` followed by 40 mixed-case alphanumerics with entropy above 4.5; negative `sk-example-token-placeholder`; negative `sk-ant-` followed by 40 alphanumerics (must not match this rule); negative `sk-abc` (too short). Use the same `testCases` shape as neighbouring custom rules.
  - Do not change any other rule.
- **Tests**:
  - `tests/security-scanner.test.ts`:
    - Test: `scanFiles_bareSkToken_flagged` — Setup: temp copied root with `scripts/lib/scan-rules.js`, `scripts/security-scanner.ts`, `.claude/security/allowlist.json`; write `probe.txt` containing only `sk-` plus a fixed 40-char high-entropy string; run `scan-files --format json probe.txt`. Assert: exit code `1`, one finding, `ruleId === "bare-sk-token"`. Expected: flagged.
    - Test: `scanFiles_anthropicShapedKey_notFlaggedByBareRule` — Setup: same, file contains `sk-ant-` plus 40 chars. Assert: no finding has `ruleId === "bare-sk-token"`. Expected: only the vendor rule fires, if any.
    - Test: `scanFiles_skPlaceholder_notFlagged` — Setup: file contains `sk-example-placeholder-token-000000`. Assert: exit code `0`, zero findings. Expected: allowlisted.
  - `node scripts/security-scanner.ts test-rules` must still pass.
- **Acceptance Criteria**:
  - [ ] The 2026-09-19 probe (file containing only `sk-` plus 40 alphanumerics) now reports one `bare-sk-token` finding
  - [ ] `test-rules` passes with the new inline cases
  - [ ] `node --test tests/security-scanner.test.ts` passes
- **Size**: Small
- **Status**: [?]
