# Task T185 context

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
