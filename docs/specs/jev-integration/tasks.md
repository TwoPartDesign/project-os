# Tasks: Jev Integration
Created: 2026-09-20
Design: ./design.md
Total tasks: 11 (T178 to T188)
Parallelizable groups: 4

Task IDs match ROADMAP.md `#TN` IDs. #T177 (the brief placeholder) is
retired in ROADMAP.md and superseded by these tasks. Wave 1 (Groups 1 and 2)
ships the heuristic path and the scanner rule; wave 2 (Groups 3 and 4) adds
the Jev network path and the wiring. Nothing in any task flips
`project_os.jev.enabled` to `true`.

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

## Dependency Graph
T178 | T179 | T180 | T181 | T182            (Group 1, all independent)
T178 → T183;  T180 → T183                    (Group 2)
T179 → T184;  T182 → T184                    (Group 2)
T179 → T185;  T181 → T185;  T183 → T185      (Group 3)
T184 → T186;  T185 → T186                    (Group 3)
T186 → T187                                  (Group 4)
T187 → T188                                  (Group 4)

## Group 1 (parallel)

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

### T179: `decide.ts` core: types, config, heuristic backend, skeleton
- **Files**: `scripts/lib/decide.ts` (create), `tests/decide.test.ts` (create)
- **Pattern**: Config reading follows `scripts/knowledge-index.ts:120-145` (`JSON.parse` of `.claude/settings.json`, `settings.project_os?.jev`, per-field `??` defaults). Project root via `getProjectRoot()` from `scripts/lib/project-root.ts`. File header comment style as in `scripts/lib/policy.ts`.
- **Implementation**:
  - Export the types verbatim from design.md "Data Model": `NoulQuestion` (with optional `criteria: { true: string; false: string }`), `ChoiceQuestion`, `ScoreQuestion`, `Question`, `QuestionMap`, `NoulAnswer`, `ChoiceAnswer`, `ScoreAnswer`, `Answer`, `DeclineReason`, `DecisionResult`, `JevConfig`.
  - Export `const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"`.
  - Export `DEFAULT_JEV_CONFIG: JevConfig` = `{ enabled: false, model: "jev-latest", timeout_ms: 5000, max_body_tokens: 60000, thresholds: { duplicate_p: 0.85, out_of_scope_p: 0.80, severity_confidence: 0.80 } }`.
  - Export `readJevConfig(settingsPath?: string): JevConfig`. Missing file, unparseable JSON, or missing block returns defaults. `enabled` is `true` only if strictly boolean `true`. Numbers that fail `Number.isFinite` or are negative fall back per field. Thresholds outside `[0,1]` fall back.
  - Export `heuristicBackend(state: string, questions: QuestionMap): Record<string, Answer>`: `noul` → `{ type: "noul", noul: 0.5 }`; `choice` → first `Object.keys(criteria)` key, `probabilities` uniform over keys (each `1 / n`), `confidence: 0`; `score` → `score: Math.floor((criteria.length - 1) / 2)`, `probabilities` keyed by level index as strings, all `1 / n`, `confidence: 0`. Pure; no I/O.
  - Export `decide(state, questions, deps?)` with the `deps` shape from design.md "Key Interfaces". In this task it resolves the backend only: if `config.enabled !== true` → heuristic with `declined: "disabled"`; else if `!env.TYPESAFE_API_KEY` → heuristic with `declined: "no-key"`; else → heuristic with `declined: "network"` (placeholder until T185 replaces this branch; leave a comment `// T185: Jev path`). Always sets `redactions: 0`, `duration_ms` from `deps.now ?? Date.now`. Calls `deps.log?.("jev-declined", { consumer, reason, ...thresholdKv })` where `thresholdKv` is `threshold_duplicate_p`, `threshold_out_of_scope_p`, `threshold_severity_confidence` as decimal strings and `consumer` comes from `deps.consumer ?? "unknown"` (add `consumer?: string` to `deps`).
  - Export `defaultLogger(event, kv)`: `execFileSync("bash", [".claude/hooks/log-activity.sh", event, ...Object.entries(kv).map(([k, v]) => `${k}=${v}`)], { cwd: projectRoot, stdio: "ignore" })` inside `try/catch` that swallows every error. Never the default when `deps.log` is given.
- **Tests**:
  - `tests/decide.test.ts`:
    - Test: `readJevConfig_missingFile_returnsDefaults` — Setup: path to a non-existent file. Assert: `deepStrictEqual(result, DEFAULT_JEV_CONFIG)`. Expected: defaults.
    - Test: `readJevConfig_partialBlock_mergesDefaults` — Setup: temp settings with `{ "project_os": { "jev": { "timeout_ms": 250 } } }`. Assert: `timeout_ms === 250`, `enabled === false`, `thresholds.duplicate_p === 0.85`. Expected: merge.
    - Test: `readJevConfig_enabledNotBoolean_treatedAsFalse` — Setup: `"enabled": "true"`. Assert: `enabled === false`. Expected: strict boolean.
    - Test: `readJevConfig_thresholdOutOfRange_fallsBack` — Setup: `duplicate_p: 1.7`. Assert: `0.85`. Expected: fallback.
    - Test: `heuristicBackend_noul_returnsHalf` — Assert: `{ type: "noul", noul: 0.5 }`.
    - Test: `heuristicBackend_choice_returnsFirstKeyUniform` — Setup: criteria `{ a, b, c }`. Assert: `choice === "a"`, `probabilities.b` approximately `1/3` within `1e-9`, `confidence === 0`.
    - Test: `heuristicBackend_scoreFourLevels_returnsIndexOne` — Setup: `["LOW","MEDIUM","HIGH","CRITICAL"]`. Assert: `score === 1`.
    - Test: `decide_disabled_returnsHeuristicIdentically` — Setup: `config.enabled=false`, `env.TYPESAFE_API_KEY="k"`, `fetchImpl` that throws. Assert: `deepStrictEqual(result.answers, heuristicBackend(...))`, `backend === "heuristic"`, `declined === "disabled"`, fetch call count `0`. Expected: no network.
    - Test: `decide_noKey_returnsHeuristicIdentically` — Setup: enabled, `env: {}`. Assert: same three plus `declined === "no-key"`.
    - Test: `decide_logsDeclinedEventWithReasonAndThresholds` — Setup: spy `log`. Assert: one call, event `"jev-declined"`, `kv.reason === "no-key"`, `kv.threshold_duplicate_p === "0.85"`, `kv.consumer === "test"`. Expected: logged.
    - Test: `defaultLogger_bashMissing_doesNotThrow` — Setup: `PATH` emptied via `env` override in a child-process-free way is not possible, so instead call `defaultLogger` with a `cwd` pointing at an empty temp dir (no hook file). Assert: does not throw. Expected: swallowed.
- **Acceptance Criteria**:
  - [ ] `scripts/lib/decide.ts` exports everything listed and nothing reads `process.env` outside `decide()`
  - [ ] `node --test tests/decide.test.ts` passes with every test above
  - [ ] No `fetch` call exists in the file yet (grep `fetch(` returns nothing)
- **Size**: Medium
- **Status**: [?]

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

### T181: Settings block, permission entry, egress allowlist file
- **Files**: `.claude/settings.json` (modify: `permissions.allow` array and `project_os` object), `.claude/security/egress-allowlist.json` (create)
- **Pattern**: `project_os.context_filter` block at `.claude/settings.json` lines 108-120 for shape; `.claude/security/mcp-allowlist.json` for the allowlist file's field style.
- **Implementation**:
  - (Moved to T188 at build time: the `"Bash(node scripts/review-triage.ts*)"` permission fails `tests/shipped-settings.test.ts` until `scripts/new-project.sh` ships the script.)
  - Add to `project_os`, after `context_filter`: `"jev": { "enabled": false, "model": "jev-latest", "timeout_ms": 5000, "max_body_tokens": 60000, "thresholds": { "duplicate_p": 0.85, "out_of_scope_p": 0.8, "severity_confidence": 0.8 } }`.
  - Create `.claude/security/egress-allowlist.json` with exactly: `description` ("Allowlist of hosts that project scripts may send data to directly over HTTPS. Sibling of mcp-allowlist.json, which governs MCP servers only."), `approved_egress` → `"api.typesafe.ai"` → `{ "caller": "scripts/lib/decide.ts", "endpoint": "https://api.typesafe.ai/v1/systemone", "data_classes": ["finding.severity", "finding.reviewer", "finding.file", "finding.lines", "finding.issue", "finding.fix", "changed_files"], "guards": ["scrub+rescan", "key-denylist", "entropy>=4.0"], "risk_level": "low", "rationale": "Typed decisions over already-local review findings; no file contents or diffs; off by default.", "audit_date": "2026-09-20" }`, `blocked_capabilities: ["endpoint_override", "file_content_egress", "diff_egress"]`, `review_cadence: "monthly"`.
  - Keep JSON formatted as the existing files are (two-space indent). Do not reorder existing keys.
- **Tests**: none in this task (the allowlist-to-constant test lands in T185). Run `node --test tests/shipped-settings.test.ts` to confirm nothing there breaks.
- **Acceptance Criteria**:
  - [ ] `node -e` is not used; verify with `node --test tests/shipped-settings.test.ts` passing
  - [ ] `git diff .claude/settings.json` shows only the two additions
  - [ ] `.claude/security/egress-allowlist.json` parses and has the keys listed
- **Size**: Small
- **Status**: [?]

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

## Group 2 (after Group 1)

### T183: `egress-guard.ts` staging, scrub subprocess, positive re-scan, composition
- **Depends on**: T178, T180
- **Files**: `scripts/lib/egress-guard.ts` (modify: append), `tests/egress-guard.test.ts` (modify: append)
- **Pattern**: `execFileSync(argv[0], argv.slice(1), { stdio: "pipe" })` as in `scripts/maintain-draft.ts:257`. Copied-project-root tests as in `tests/security-scanner.test.ts` (copy `scripts/security-scanner.ts`, `scripts/lib/scan-rules.js`, `scripts/lib/project-root.ts`, `.claude/security/allowlist.json` into the temp root; the scanner resolves its root from its own location).
- **Implementation**:
  - Export `type GuardDeps = { projectRoot: string; egressDir?: string; scrubCmd?: (file: string) => { status: number }; scanCmd?: (file: string) => { status: number } }`.
  - Export `resolveEgressDir(projectRoot, egressDir = join(projectRoot, ".claude/logs/jev")): string | null`: `mkdirSync(dir, { recursive: true, mode: 0o700 })`; `realpathSync(dir)` must equal or start with `realpathSync(projectRoot) + sep`; return the real path or `null`.
  - Export `guardEgressFields(fields: string[], deps: GuardDeps): { fields: string[]; redactions: number } | { refused: "egress-dir-unsafe" | "scrub-failed" }`:
    1. `resolveEgressDir` → `null` ⇒ `{ refused: "egress-dir-unsafe" }`.
    2. Write `escapeField` of each field, one per line, to `egress-<pid>-<randomBytes(6).toString("hex")>.txt` with `writeFileSync(path, text, { flag: "wx", mode: 0o600 })`.
    3. `scrubCmd(path)` (default: `execFileSync("node", [join(projectRoot, "scripts/security-scanner.ts"), "scrub", path], { cwd: projectRoot, stdio: "pipe" })` wrapped to return `{ status }` and never throw). Its status is ignored.
    4. Re-read the file; split on `\n`; require line count `=== fields.length`; then `scanCmd(path)` (default: same but `["scan-files", "--quiet", path]`) must return `status === 0`. Any failure, missing file, or thrown error ⇒ `{ refused: "scrub-failed" }`.
    5. `unescapeField` each line, then `redactFields` (from T180). Return `{ fields, redactions }`.
    6. `finally`: `rmSync` with `force: true` on `path`, `path + ".tmp"`, `path + ".tmp.bak"`.
- **Tests**:
  - `tests/egress-guard.test.ts` (append):
    - Test: `guardEgressFields_realScrub_redactsKnownPatterns` — Setup: copied root; fields `["token ghp_" + 36 chars, "other"]`; real default commands. Assert: field 0 contains `[REDACTED:` and not the `ghp_` token; `redactions >= 0`; the egress dir is empty afterwards. Expected: scrubbed by the scanner.
    - Test: `guardEgressFields_bareSkToken_redactedByNewRule` — Setup: copied root; field `"sk-" + 40 high-entropy chars`. Assert: contains `[REDACTED:bare-sk-token]`. Expected: T178 rule fires end to end.
    - Test: `guardEgressFields_scrubExitsZeroButSecretRemains_refusesScrubFailed` — Setup: `scrubCmd` returns `{status: 0}` without touching the file; `scanCmd` returns `{status: 1}`. Assert: `refused === "scrub-failed"`. Expected: exit code not trusted.
    - Test: `guardEgressFields_scrubChangesLineCount_refusesScrubFailed` — Setup: `scrubCmd` rewrites the file with one fewer line; `scanCmd` returns 0. Assert: `refused === "scrub-failed"`.
    - Test: `guardEgressFields_scrubThrows_refusesAndCleansUp` — Setup: `scrubCmd` throws. Assert: `refused === "scrub-failed"`; no `egress-*` file, `.tmp`, or `.tmp.bak` remains in the dir.
    - Test: `guardEgressFields_egressDirSymlinkOutsideRoot_refusesEgressDirUnsafe` — Setup: temp root; `.claude/logs/jev` is a symlink to a sibling temp dir outside the root. Assert: `refused === "egress-dir-unsafe"`; the target dir has no new files. Expected: containment holds.
    - Test: `guardEgressFields_egressDirSymlinkToInRootSibling_proceeds` — Setup: symlink to `<root>/.claude/logs/jev-real`. Assert: not refused. Expected: in-bounds indirection allowed.
    - Test: `guardEgressFields_fieldWithNewline_roundTripsAndCountsLines` — Setup: field containing `\n`; stub commands succeed. Assert: returned field equals the input.
    - Test: `guardEgressFields_stagingFileMode_0600` — Setup: `scrubCmd` captures `statSync(file).mode & 0o777`. Assert: `0o600` (skip on `process.platform === "win32"` with a message).
- **Acceptance Criteria**:
  - [ ] Every refusal path is covered by a test naming the exact `refused` value
  - [ ] No staging file survives any test (asserted in the throw test and the real-scrub test)
  - [ ] `node --test tests/egress-guard.test.ts` passes
- **Size**: Medium
- **Status**: [?]

### T184: `review-triage.ts` heuristic path: parse, candidates, table, JSON, CLI
- **Depends on**: T179, T182
- **Files**: `scripts/review-triage.ts` (create), `tests/review-triage.test.ts` (create)
- **Pattern**: CLI shape and `parseArgs` as in `scripts/maintain-draft.ts:37-58`; `isMain` guard as in `scripts/knowledge-index.ts:1165-1166` so the module can be imported by tests without running the CLI. Markdown table escaping: replace `|` with `\|`.
- **Implementation**:
  - Types: `Finding = { id: string; reviewer: "architecture"|"security"|"tests"; severity: Severity; file: string; lines: string; issue: string; fix: string }`, `Candidates = { pairs: [string, string][]; scope: Record<string, "in_diff"|"adjacent"|"unrelated"> }`, `TriagedFinding` = `Finding` plus `duplicate_of: string|null`, `duplicate_p: number`, `in_scope`, `in_scope_p`, `calibrated_severity`, `severity_confidence`.
  - `parseFindings(text, reviewer)`: a finding line matches `/^(CRITICAL|HIGH|MEDIUM|LOW) \/ /`. Split at the first two ` / ` for severity and `file:lines`; split the remainder at its **last** ` / ` into issue and fix. `file:lines` splits at the last `:`; if no `:` then `lines = ""`. `id = <reviewer>-<1-based index>`. A line that starts with a severity word but yields fewer than four parts is skipped and `process.stderr.write` receives `review-triage: unparseable finding line: <line>\n`.
  - `heuristicCandidates(findings, changedFiles)`: pairs `(a, b)` with `a.id < b.id` where normalized file paths are equal and line ranges overlap or touch (parse `N` or `N-M`; empty means whole file, overlaps everything), **or** token Jaccard of the ISSUE texts (lowercased, split on non-alphanumerics, tokens of length 3+, prefix `DRIFT:`/`VULN:`/`ISSUE:` removed) is at or above `0.6`. Scope: `in_diff` if file is in `changedFiles`; else `adjacent` if any changed file has the same `dirname`; else `unrelated`.
  - `applyHeuristic(findings, c)`: `duplicate_of` = the lowest-id partner, `duplicate_p = 1`, `in_scope_p = 1`, `calibrated_severity = severity`, `severity_confidence = 0`.
  - `renderTable(rows)`: header `| id | sev | file:lines | scope | dup of | issue |`, cells escaped.
  - CLI `node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only]`: reads `<spec-dir>/review-raw/{architecture,security,tests}.md` (missing file = zero findings, warn on stderr), reads the changed-files list (one path per line, blank lines ignored), calls `decide(state="", questions={}, { consumer: "review-triage", config: readJevConfig() })` **only to obtain `backend`/`declined`** for the JSON header in this task, writes `<spec-dir>/review-triage.json` `{ feature: basename(specDir), advisory: true, backend, declined, redactions: 0, findings }`, prints the table unless `--json-only`. Exit `0`; exit `2` on bad arguments with the usage text.
- **Tests**:
  - `tests/review-triage.test.ts`:
    - Test: `parseFindings_threeReviewerPrefixes_extractsFields` — Setup: one `DRIFT:`, one `VULN:`, one `ISSUE:` line. Assert: for each, `severity`, `file`, `lines`, `issue` (starts with the prefix), `fix`, `reviewer`, `id` equal the expected literals.
    - Test: `parseFindings_slashInsideIssue_splitsAtLastSeparator` — Setup: `LOW / a.ts:1 / ISSUE: x / y / fix z`. Assert: `issue === "ISSUE: x / y"`, `fix === "fix z"`.
    - Test: `parseFindings_fileWithoutLines_linesEmpty` — Setup: `LOW / docs/x.md / DRIFT: a / b`. Assert: `file === "docs/x.md"`, `lines === ""`.
    - Test: `parseFindings_nonFindingLines_ignored` — Setup: `PASS:`, `CONCERN:`, prose. Assert: length `0`.
    - Test: `parseFindings_severityLineUnparseable_warnsWithLine` — Setup: `HIGH / only-two-parts`; capture stderr by injecting a `warn` function parameter (add optional `warn = (s) => process.stderr.write(s)`). Assert: warning contains `unparseable finding line: HIGH / only-two-parts`.
    - Test: `heuristicCandidates_sameFileOverlappingLines_pairsThem` — Setup: `a.ts:40-58` and `a.ts:41-57`. Assert: `pairs` deep-equals `[["architecture-1","security-1"]]`.
    - Test: `heuristicCandidates_jaccardBelowThreshold_noPair` — Setup: different files, unrelated text. Assert: `pairs.length === 0`.
    - Test: `heuristicCandidates_scope_inDiffAdjacentUnrelated` — Setup: changed `["scripts/alpha.ts"]`; findings at `scripts/alpha.ts`, `scripts/beta.ts`, `docs/x.md`. Assert: `in_diff`, `adjacent`, `unrelated`.
    - Test: `triage_fixture_heuristicBackend_marksTwoDuplicatesOneOutOfScope` — Setup: copy `tests/fixtures/review-raw/` into `<tmp>/docs/specs/fx/review-raw/`; run the CLI via `execFileSync("node", [...])` with `cwd` = tmp root and a settings file with `enabled:false`. Assert: JSON has `findings.length === 7`, `security-1.duplicate_of === "architecture-1"`, `tests-2.duplicate_of === "security-2"`, `security-3.in_scope === "unrelated"`, every other `in_scope !== "unrelated"`, `backend === "heuristic"`, `advisory === true`.
    - Test: `renderTable_pipeInIssueText_escaped` — Setup: issue `a|b`. Assert: the row contains `a\|b` and splits into exactly seven `|`-separated cells.
    - Test: `triage_writesOnlyInsideSpecDir` — Setup: as the fixture test; list every file under the tmp root before and after. Assert: the only new path is `docs/specs/fx/review-triage.json`.
- **Acceptance Criteria**:
  - [ ] Importing the module in a test does not execute the CLI
  - [ ] All fixture assertions above hold against `tests/fixtures/review-raw/`
  - [ ] `node --test tests/review-triage.test.ts` passes
- **Size**: Medium
- **Status**: [?]

## Group 3 (after Group 2)

### T185: `decide.ts` Jev backend: guard integration, fetch, validation, logging
- **Depends on**: T179, T181, T183
- **Files**: `scripts/lib/decide.ts` (modify: replace the `// T185: Jev path` branch), `tests/decide.test.ts` (modify: append)
- **Pattern**: Design.md "Request" and "Response validation" paragraphs are the spec. Guard call is `guardEgressFields` from `scripts/lib/egress-guard.ts`.
- **Implementation**:
  - Collect outbound fields in a fixed order: `state`, then for each question name in `Object.keys(questions)` order: `instructions`, then each criteria string (object values for `noul`/`choice`, array items for `score`). Call `guardEgressFields(fields, { projectRoot, egressDir: deps.egressDir, scrubCmd: deps.scrubCmd, scanCmd: deps.scanCmd })`. A `refused` result ⇒ heuristic with `declined` = that reason. Rebuild `state` and `questions` from the guarded fields in the same order (never from the originals).
  - Body `JSON.stringify({ state, model: config.model, questions })`. If `Math.ceil(body.length / 4) > config.max_body_tokens` ⇒ `declined: "too-large"`, no fetch.
  - `fetchImpl(JEV_ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body, redirect: "manual", signal: AbortSignal.timeout(config.timeout_ms) })`. Status `300-399` ⇒ `declined: "redirect"`. Other non-2xx ⇒ `declined: "http-<status>"`. `AbortError` (name check) ⇒ `"timeout"`. Any other rejection ⇒ `"network"`. Never include the error object or message anywhere in the result or log.
  - Parse JSON; validate per question exactly as design.md states. Accepted answers replace heuristic ones; any rejected answer sets `declined: "malformed-response"` while `backend` is `"jev"` if at least one answer was accepted, else `"heuristic"`.
  - `usage` copied only if both fields are finite numbers.
  - Log `jev-queried` with `consumer`, `questions` (count), `backend`, `redactions`, `input_tokens`, `output_tokens`, `duration_ms`, and the three threshold keys; on a decline log `jev-declined` with `reason` and the same keys minus usage.
  - Export nothing new except `collectOutboundFields(state, questions): string[]` and `rebuildFromFields(fields, questions): { state, questions }` for testability.
- **Tests**:
  - `tests/decide.test.ts` (append; stub `scrubCmd`/`scanCmd` to `{status:0}` and `egressDir` to a temp dir unless the test says otherwise):
    - Test: `decide_happyPath_returnsJevAnswersAndUsage` — Setup: `fetchImpl` resolves `new Response(JSON.stringify(<documented response with is_urgent noul 0.92, department choice technical 0.85, frustration score 1.6>), { status: 200 })`. Assert: `answers.is_urgent.noul === 0.92`, `answers.department.choice === "technical"`, `answers.frustration.score === 1.6`, `backend === "jev"`, `usage.input_tokens === 312`, `declined === undefined`.
    - Test: `decide_requestShape_matchesContract` — Setup: spy captures `url` and `init`. Assert: `url === JEV_ENDPOINT`, `init.method === "POST"`, `init.redirect === "manual"`, `init.signal instanceof AbortSignal`, `init.headers.Authorization === "Bearer k"`, `JSON.parse(init.body)` has keys exactly `state`, `model`, `questions`, `model === "jev-latest"`.
    - Test: `decide_networkError_returnsHeuristicIdentically` — Setup: fetch rejects with `new Error("boom k")`. Assert: answers deep-equal heuristic, `declined === "network"`, and the string `"boom"` appears in no logged value.
    - Test: `decide_timeout_declinesTimeout` — Setup: `timeout_ms: 10`; fetch returns a promise that rejects with an `AbortError`-named error when `init.signal` fires. Assert: `declined === "timeout"`, `duration_ms < 1000`.
    - Test: `decide_redirect_declinesAndDoesNotFollow` — Setup: `Response` status `302` with `Location`. Assert: `declined === "redirect"`, fetch call count `1`.
    - Test: `decide_http429_declinesHttp429` and `decide_http529_declinesHttp529`.
    - Test: `decide_malformedChoice_keepsHeuristicForThatQuestion` — Setup: `choice: "nope"`. Assert: that answer deep-equals heuristic, the other answers are Jev's, `declined === "malformed-response"`, `backend === "jev"`.
    - Test: `decide_probabilityOutOfRange_rejected` — Setup: `noul: 1.4`. Assert: heuristic answer for it.
    - Test: `decide_guardRefused_declinesWithGuardReason` — Setup: `scanCmd` returns `{status:1}`. Assert: `declined === "scrub-failed"`, fetch call count `0`.
    - Test: `decide_bodyBuiltFromGuardedFields` — Setup: state `privateKey=abcdefghij1234567890`; stubs succeed. Assert: request body contains `[REDACTED:key]` and not the value; `redactions === 1`.
    - Test: `decide_oversizedBody_declinesTooLarge` — Setup: `max_body_tokens: 10`, state of 100 chars. Assert: `declined === "too-large"`, fetch call count `0`.
    - Test: `decide_keyNeverInBodyLogsOrResult` — Setup: key `"SECRETKEY123"`; spy logger; happy path and network-error path. Assert: the key appears in `init.headers.Authorization` only; `JSON.stringify(result)` and every logged value do not contain it.
    - Test: `decide_logsQueriedEventWithMetadata` — Assert: event `jev-queried`, `kv.questions === "3"`, `kv.backend === "jev"`, `kv.input_tokens === "312"`, `kv.threshold_out_of_scope_p === "0.8"`, `kv.consumer === "test"`.
    - Test: `egressAllowlist_containsEndpointHostAndCaller` — Setup: read `.claude/security/egress-allowlist.json` from the repo. Assert: `approved_egress[new URL(JEV_ENDPOINT).host].caller === "scripts/lib/decide.ts"` and `.endpoint === JEV_ENDPOINT`.
    - Test: `collectOutboundFields_order_isStable` — Assert: exact array for a fixed question map.
- **Acceptance Criteria**:
  - [ ] `grep -n "fetch(" scripts/lib/decide.ts` shows exactly one call site
  - [ ] Every `DeclineReason` value except `"disabled"` and `"no-key"` (covered in T179) has a test naming it
  - [ ] `node --test tests/decide.test.ts` passes
- **Size**: Medium
- **Status**: [?]

### T186: `review-triage.ts` Jev path: questions, chunking, thresholds, scrubbed output, calibrate
- **Depends on**: T184, T185
- **Files**: `scripts/review-triage.ts` (modify), `tests/review-triage.test.ts` (modify: append)
- **Pattern**: design.md "Key Interfaces" consumer paragraphs.
- **Implementation**:
  - `pick(f)` returns `{ severity, reviewer, file, lines, issue, fix }` and is the only accessor `buildQuestions` uses.
  - `buildQuestions(findings, c, changedFiles): { state: string; questions: QuestionMap }[]`: `state` is a plain-text block: a `Changed files:` list, then one `Finding <id>:` block per finding with the six picked fields as `key: value` lines. Questions: per pair `dup_<a>__<b>` `noul` "Findings <a> and <b> report the same defect" with `criteria: { true: "Same defect, same location or same root cause", false: "Different defects" }`; per finding `scope_<id>` `choice` with criteria `in_diff`/`adjacent`/`unrelated` described; per finding `sev_<id>` `score` with `["LOW","MEDIUM","HIGH","CRITICAL"]`. Chunk by finding so `JSON.stringify(chunk).length <= 160000`; pairs go in the chunk of their lower-id member, whose state must include both findings' blocks.
  - `applyAnswers(findings, c, results, thresholds)`: for each pair, if `noul >= duplicate_p` set `duplicate_of` on the higher id to the lower id and `duplicate_p = noul`; else clear the heuristic pairing and set `duplicate_p = noul`. Scope: use Jev's `choice` only if `probabilities[choice] >= out_of_scope_p` when it is `unrelated`, otherwise keep the heuristic scope; always record `in_scope_p`. Severity: map `score` to a level by `Math.round(score - 0.5 + Number.EPSILON)` clamped to `[0,3]` (half rounds down); replace `calibrated_severity` only if `confidence >= severity_confidence`; always record `severity_confidence`. Results from the heuristic backend leave everything as T184 set it.
  - Output scrubbing: before writing `review-triage.json`, run every `issue` and `fix` through `guardEgressFields` (same deps as decide; on refusal, write the string `[WITHHELD:scrub-failed]` for that field) so the local artifact never carries text the wire would not. Set `redactions` in the header to the guard's count.
  - `--calibrate`: skip thresholds; print a table with columns `id`, `heuristic dup`, `jev dup p`, `heuristic scope`, `jev scope`, `jev scope p`, `severity`, `jev severity`, `jev conf`; exit 0. Also accept repeated positional `<review-md>` paths after `--calibrate` and parse them with `parseFindings(text, "mixed")`. After the table print a summary block (`findings`, `pairs`, `dup agreement`, `scope agreement`, `severity agreement`, each rate as `agreed/total`) and write `<spec-dir>/review-triage-calibration.json` = `{ generated_at, backend, sources: [<review-md paths or "review-raw">], findings, pairs, agreement: { dup: { agreed, total }, scope: { agreed, total }, severity: { agreed, total } }, thresholds, rows: [<the table rows as objects>] }`. "Agreement" means the Jev answer, with the configured thresholds applied, equals the heuristic answer; a disagreement is a decision Jev changed.
  - Lift record (added at build time, 2026-09-20 — the owner wants the performance increase both generated and recorded): compute `liftSummary(rows, thresholds): { dup_pairs, dup_changed, scope_changed, severity_changed }` (exported; counts of heuristic decisions the applied Jev answers changed) and write it as a `lift` key in the `review-triage.json` header (`null` on the heuristic path). Log one `review-triaged` event per run through a `log` dep (default `defaultLogger` from `scripts/lib/decide.ts`) with `feature`, `backend`, `findings`, `dup_pairs`, `dup_changed`, `scope_changed`, `severity_changed`, `redactions` — this is the durable per-review record that `/tools:metrics` aggregates.
  - CLI now calls `decide()` once per chunk with `consumer: "review-triage"` and the injected deps threaded from a small `deps` parameter on an exported `runTriage(specDir, changedFilesPath, deps)` so tests can inject `fetchImpl`.
- **Tests**:
  - `tests/review-triage.test.ts` (append):
    - Test: `buildQuestions_bodyContainsOnlyWhitelistedFields` — Setup: findings carry an extra `internalNote: "SECRETNOTE"` property. Assert: `JSON.stringify(chunks)` contains each of the six field names and does not contain `SECRETNOTE` or `internalNote`.
    - Test: `buildQuestions_questionNamesAndTypes_asSpecified` — Assert: for the fixture, keys `dup_architecture-1__security-1`, `scope_security-3`, `sev_tests-1` exist with the right `type` and criteria.
    - Test: `buildQuestions_manyFindings_chunksUnderLimit` — Setup: 300 synthetic findings with 200-char issues. Assert: every chunk's serialized length `<= 160000` and every pair's members share a chunk.
    - Test: `applyAnswers_dupAboveThreshold_merged_belowCleared` — Setup: two pairs with `noul` 0.9 and 0.5, threshold 0.85. Assert: first has `duplicate_of` set and `duplicate_p === 0.9`; second `duplicate_of === null`, `duplicate_p === 0.5`.
    - Test: `applyAnswers_scoreHalf_roundsDown` — Setup: `score: 1.5`, confidence 0.9. Assert: `calibrated_severity === "MEDIUM"`.
    - Test: `applyAnswers_lowConfidence_keepsOriginalSeverity` — Setup: `score: 3`, confidence 0.5. Assert: `calibrated_severity === severity`, `severity_confidence === 0.5`.
    - Test: `runTriage_fixture_jevStub_appliesThresholds` — Setup: copied root, settings `enabled:true`, `env.TYPESAFE_API_KEY="k"`, stub scrub/scan, `fetchImpl` returning answers built from the request (dup pairs 0.9 for A1/S1 and 0.5 for S2/Q2, scope `unrelated` at 0.95 for S3, everything else in_diff 0.9, all severities unchanged at confidence 0.9). Assert: `security-1.duplicate_of === "architecture-1"`, `tests-2.duplicate_of === null`, `security-3.in_scope === "unrelated"`, `backend === "jev"`.
    - Test: `runTriage_outputJson_isScrubbed_evenOnHeuristicPath` — Setup: `enabled:false`; real scrub via copied scanner. Assert: `review-triage.json` contains `[REDACTED:` and not the fixture's `ghp_` token; header `redactions >= 1`.
    - Test: `runTriage_calibrate_printsProbabilitiesWithoutApplying` — Setup: jev stub as above with `--calibrate`. Assert: stdout has a `jev dup p` column and `0.9`; no `review-triage.json` is written; `review-triage-calibration.json` is written with `agreement.dup.total === 2`, `agreement.dup.agreed === 1` (the 0.5 pair agrees with the heuristic's cleared pairing only if the heuristic paired it — assert the exact values the fixture produces and say which in a comment), and `rows.length === 7`.
    - Test: `runTriage_jevStub_recordsLiftInHeaderAndLog` — Setup: same jev stub as `runTriage_fixture_jevStub_appliesThresholds`, spy `log`. Assert: `review-triage.json` header `lift` deep-equals `{ dup_pairs: 2, dup_changed: <exact count>, scope_changed: <exact count>, severity_changed: 0 }` with the counts derived from the fixture and stated in a comment; one logged event named `review-triaged` with `kv.backend === "jev"` and `kv.severity_changed === "0"`.
    - Test: `runTriage_heuristicPath_liftIsNull` — Setup: `enabled:false`. Assert: header `lift === null`; the `review-triaged` event has `kv.backend === "heuristic"`.
- **Acceptance Criteria**:
  - [ ] `buildQuestions` reads findings only through `pick()` (grep shows no other property access on `Finding` objects in that function)
  - [ ] `node --test tests/review-triage.test.ts` passes, including the T184 tests unchanged
  - [ ] `grep -c "review-triaged" scripts/review-triage.ts` is at least 1 and `review-triage.json` carries a `lift` key on both backends
- **Size**: Medium
- **Status**: [?]

## Group 4 (after Group 3)

### T187: Wire the review workflow, document events
- **Depends on**: T186
- **Files**: `.claude/commands/workflows/review.md` (modify: Synthesis section at lines 184-199), `.claude/hooks/log-activity.sh` (modify: header comment lines 6-9), `.claude/commands/tools/metrics.md` (modify: after the activity-log example near line 63)
- **Pattern**: Existing numbered steps in the Synthesis section; existing event list style in the hook header.
- **Implementation**:
  - `review.md`: insert a step 0 before "1. Deduplicate": write each reviewer's raw report verbatim to `docs/specs/$ARGUMENTS/review-raw/architecture.md`, `security.md`, `tests.md`; write `git diff --name-only "${BASE}...HEAD"` to `docs/specs/$ARGUMENTS/review-raw/changed-files.txt`; run `node scripts/review-triage.ts "docs/specs/$ARGUMENTS" --changed-files "docs/specs/$ARGUMENTS/review-raw/changed-files.txt"`; state in one sentence that the printed table is advisory input to steps 1 to 3 and decides nothing. Renumber nothing else. Mention that `review-raw/` is under the gitignored spec directory.
  - `review.md` step 0 also says: when the table header shows `backend: jev`, quote its `lift` line (duplicates, scope, severity changed versus the heuristic) in the review report's summary so every review records what Jev changed.
  - `log-activity.sh`: add `jev-queried, jev-declined, review-triaged` to the `# Events:` comment.
  - `metrics.md`: add a short subsection "Jev decision events" listing the three events and their metadata keys — `jev-queried`/`jev-declined`: `consumer`, `questions`, `backend`, `redactions`, `input_tokens`, `output_tokens`, `duration_ms`, `reason`, `threshold_*`; `review-triaged`: `feature`, `backend`, `findings`, `dup_pairs`, `dup_changed`, `scope_changed`, `severity_changed`, `redactions` — with two grep examples: one counting queried vs declined, one summing `dup_changed`/`scope_changed`/`severity_changed` across `review-triaged` events (the running measure of Jev's lift over the heuristic). Point at `docs/specs/<feature>/review-triage-calibration.json` as the per-run calibration record and at the `Calibration record` table in `docs/knowledge/decisions.md` as where the measured lift is written down.
- **Tests**: none (prose). Run `bash tests/hook-smoke.sh` to confirm the hook comment edit changed nothing functional.
- **Acceptance Criteria**:
  - [ ] `review.md` Synthesis has a step 0 naming the exact command above and the word "advisory"
  - [ ] `grep -c 'jev-' .claude/hooks/log-activity.sh` is at least 1 and `grep -c 'review-triaged' .claude/commands/tools/metrics.md` is at least 1
  - [ ] `bash tests/hook-smoke.sh` passes
- **Size**: Small
- **Status**: [?]

### T188: Knowledge, decision record, manifest
- **Depends on**: T187
- **Files**: `docs/knowledge/architecture.md` (modify: Scripts table after the `dashboard.sh` row and the `lib/policy.ts` row; Security Scanning section), `docs/knowledge/decisions.md` (modify: append), `.claude/manifest.json` (regenerate)
- **Pattern**: Existing table rows; ADR format in `decisions.md` (Decision / Context / Alternatives Considered / Rationale).
- **Implementation**:
  - `architecture.md`: rows for `lib/decide.ts` (typed decision interface, heuristic default, opt-in Jev backend, sole outbound caller), `lib/egress-guard.ts` (scrub + re-scan + denylist + entropy guard for outbound text), `review-triage.ts` (advisory triage of reviewer findings). In Security Scanning, add the `bare-sk-token` rule note and an "Egress allowlist" bullet pointing at `.claude/security/egress-allowlist.json`.
  - `decisions.md`: append `## 2026-09-20 — Hosted Decision API (Jev) as an Optional Addon Behind a Local Heuristic` covering: endpoint constant; scrub-then-verify via subprocess because `cmdScrub` exits 0 on write failure; entropy floor for bare credentials; heuristic ships first, Jev gated on the calibration procedure and the key-shape check (copy both procedures from design.md Testing Strategy verbatim); alternatives rejected (SDK, TypeSafe skill, Claude backend in v1, PreToolUse consumer). End the ADR with a `### Calibration record` subsection: the exact command to generate it (`node scripts/review-triage.ts docs/specs/<feature> --changed-files docs/specs/<feature>/review-raw/changed-files.txt --calibrate docs/specs/<past>/review.md ...`), where the JSON lands (`docs/specs/<feature>/review-triage-calibration.json`), how the running lift is read back (`grep review-triaged .claude/logs/activity.jsonl`), and a table with columns `Date | Sources | Findings | Pairs | Dup agreement | Scope agreement | Severity agreement | Thresholds chosen | Lift (decisions changed) | Flag decision` holding one placeholder row that reads "not yet run — requires `TYPESAFE_API_KEY` and `enabled: true`". The owner's requirement (2026-09-20) is that the performance increase from Jev is both generated by the tooling and recorded here.
  - Ship the new scripts: add `"scripts/review-triage.ts"` to the quoted file list in `scripts/new-project.sh` next to the other `scripts/*.ts` entries (`scripts/lib/**` ships wholesale, so `decide.ts` and `egress-guard.ts` need no entry). Then add `"Bash(node scripts/review-triage.ts*)"` to `permissions.allow` in `.claude/settings.json` directly after `"Bash(node scripts/skill-ledger.ts*)"` — `tests/shipped-settings.test.ts` rejects a permission for a script `new-project.sh` does not copy, which is why this line was deferred from T181.
  - Run `bash scripts/generate-manifest.sh` and commit the regenerated `.claude/manifest.json`.
- **Tests**: none. Run `node scripts/system-map.ts report` and confirm no new HIGH finding names the three new scripts.
- **Acceptance Criteria**:
  - [ ] `.claude/manifest.json` lists `scripts/lib/decide.ts`, `scripts/lib/egress-guard.ts`, `scripts/review-triage.ts`, `.claude/security/egress-allowlist.json`
  - [ ] `node --test tests/shipped-settings.test.ts` passes with the `review-triage.ts` permission present
  - [ ] `node scripts/system-map.ts report` shows no new HIGH finding for the new files
  - [ ] `bash scripts/validate-roadmap.sh` passes
  - [ ] `grep -c 'Calibration record' docs/knowledge/decisions.md` is at least 1
- **Size**: Small
- **Status**: [?]
