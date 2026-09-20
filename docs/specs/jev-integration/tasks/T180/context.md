# Task T180 context

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

### T180: `egress-guard.ts` pure redactions: field escaping, key-name denylist, entropy floor
- **Files**: `scripts/lib/egress-guard.ts` (create), `tests/egress-guard.test.ts` (create)
- **Pattern**: The denylist regex is ported verbatim from `isSensitiveKey` in `scripts/observation-parser.ts` (read it; keep the character-for-character source). Shannon entropy per character as in `scripts/security-scanner.ts` (`shannonEntropy` or equivalent near line 280); reimplement locally, do not import the scanner.
- **Implementation**:
  - Export `SENSITIVE_KEY_RE` (the ported regex) and `isSensitiveKey(key: string): boolean` = `SENSITIVE_KEY_RE.test(key.replace(/[_-]/g, ""))`.
  - Export `escapeField(s: string): string` replacing `\\` → `\\\\`, `\n` → `\\n`, `\r` → `\\r`; export `unescapeField` as its exact inverse. Round-trip must be identity.
  - Export `redactSensitivePairs(line: string): { line: string; count: number }`: find `key=value` and `"key": "value"` / `"key": value` pairs where key matches `[A-Za-z0-9_.-]+` and value is the run up to whitespace, `,`, `;`, or closing quote; if `isSensitiveKey(key)`, replace the value with `[REDACTED:key]`. Prose words are never touched.
  - Export `shannonEntropy(s: string): number` (bits per character).
  - Export `redactHighEntropyTokens(line: string, minLen = 24, minEntropy = 4.0): { line: string; count: number }`: tokens matching `/[A-Za-z0-9_\-\/+=]{24,}/g` with entropy at or above `minEntropy` become `[REDACTED:entropy]`. Tokens already inside a `[REDACTED:...]` marker are skipped.
  - Export `redactFields(fields: string[]): { fields: string[]; redactions: number }` applying both redactions to each field in order (pairs, then entropy).
- **Tests**:
  - `tests/egress-guard.test.ts`:
    - Test: `isSensitiveKey_matchesObservationParserOnFixture` — Setup: twelve keys: `api_key`, `apiKey`, `PRIVATE-KEY`, `authToken`, `password`, `credentials` (hits) and `apiVersion`, `authorName`, `keyboard`, `tokenizer_mode`, `file`, `severity` (misses). Assert: each returns the listed boolean, and the regex `source` string equals the one exported from `scripts/observation-parser.ts` (import it if exported; otherwise read the file and extract with a regex and assert equality). Expected: parity.
    - Test: `escapeField_roundTrip_identity` — Setup: string with `\n`, `\r`, `\\`, and a literal `\\n`. Assert: `unescapeField(escapeField(s)) === s` and `escapeField(s)` contains no raw newline.
    - Test: `redactSensitivePairs_envStyle_redactsValue` — Setup: `privateKey=abcdefghij1234567890 rest`. Assert: line equals `privateKey=[REDACTED:key] rest`, count `1`.
    - Test: `redactSensitivePairs_jsonStyle_redactsValue` — Setup: `"api_key": "zzz", "file": "x"`. Assert: `"api_key": "[REDACTED:key]", "file": "x"`, count `1`.
    - Test: `redactSensitivePairs_proseAuthentication_untouched` — Setup: `missing authentication on the endpoint`. Assert: unchanged, count `0`.
    - Test: `redactHighEntropyTokens_base64Like40Chars_redacted` — Setup: a fixed 40-char string with entropy above 4.0. Assert: `[REDACTED:entropy]`, count `1`.
    - Test: `redactHighEntropyTokens_lowEntropyPath_untouched` — Setup: `scripts/lib/scan-rules.js/scan-rules.js` (low entropy, 24+ chars). Assert: unchanged, count `0`.
    - Test: `redactHighEntropyTokens_gitSha_redactedAccepted` — Setup: a 40-hex SHA with entropy at or above 4.0 (choose one and assert its entropy first). Assert: redacted. Expected: documented over-redaction.
    - Test: `redactHighEntropyTokens_alreadyRedacted_notDoubleWrapped` — Setup: `[REDACTED:bare-sk-token]`. Assert: unchanged.
    - Test: `redactFields_countsAcrossFields` — Setup: two fields each with one hit. Assert: `redactions === 2`.
- **Acceptance Criteria**:
  - [ ] No import from `security-scanner.ts` or `observation-parser.ts` at runtime (the parity test may read the file)
  - [ ] `node --test tests/egress-guard.test.ts` passes
- **Size**: Medium
- **Status**: [?]
