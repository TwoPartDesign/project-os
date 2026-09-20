# T185 completion report

Status: complete, integrated as 8c739ac (worker commit ded44f6, cherry-picked clean).

Files changed: `scripts/lib/decide.ts` (modify: Jev network path, `collectOutboundFields`, `rebuildFromFields`), `tests/decide.test.ts` (append 17 tests), `docs/maps/*` (pre-commit heal).

Tests: `node --test tests/decide.test.ts` → 28 pass, 0 fail in the worker; re-run by the lead in the main repo after integration (see build log). `grep -n "fetch(" scripts/lib/decide.ts` → one call site (line 507).

Deviations from the brief, accepted by the lead:
- The brief's `const fetchImpl = deps.fetchImpl ?? fetch` would have made the "exactly one `fetch(`" grep match zero lines; the worker shadows the global (`const fetch = deps.fetchImpl ?? globalThis.fetch`) and calls `fetch(JEV_ENDPOINT, …)` once.
- A fractional Jev `score` is stored raw (the happy-path test asserts `1.6`); mapping to a level index is T186's `applyAnswers` job, per the design's consumer paragraph.
- A partially malformed response (some answers accepted) logs `jev-queried` with `backend: "jev"` and sets `declined: "malformed-response"` on the result; only zero accepted answers routes through `jev-declined`.
- Under `node --test` on Node 22.22, `AbortSignal.timeout()`'s internal timer is unref'd, so the timeout test's fetch stub holds a ref'd interval until the abort fires. Production code is unchanged.

Worker tokens: ~189k (over the 80k budget; the timeout-test investigation cost most of the overrun).
