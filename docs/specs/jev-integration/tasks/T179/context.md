# Task T179 context

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
