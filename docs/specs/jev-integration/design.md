# Design: Jev Integration
Created: 2026-09-19
Updated: 2026-09-19 (round 1 review folded in)
Status: DRAFT
Brief: ./brief.md

## Architecture Decision

Add a **decision interface** (`scripts/lib/decide.ts`) with two backends and
one consumer, plus the scanner rule the brief names as a prerequisite. Ship
the heuristic path first; enable Jev in this repo only after a measured
lift on a calibration set.

- **Interface**: `decide(state, questions, deps)` takes a string of program
  state and a named map of typed questions (`noul`, `choice`, `score`) and
  returns one typed answer per question, plus a `backend` tag and a
  `declined` reason when the network backend was not used. The heuristic
  backend is always present and synchronous. The Jev backend is selected
  only when `project_os.jev.enabled` is `true` in `.claude/settings.json`
  **and** `TYPESAFE_API_KEY` is set in the environment. Every failure path
  (disabled, no key, egress-guard failure, timeout, redirect, HTTP error,
  malformed response) returns the heuristic answer and never throws.
- **Consumer**: `scripts/review-triage.ts`, a Node CLI the lead runs during
  `/workflows:review` synthesis. It reads the three reviewer reports the
  lead has persisted under `docs/specs/<feature>/review-raw/`, parses the
  `SEVERITY / FILE:LINES / ISSUE / FIX` lines, asks the decision interface
  three question families (duplicate-of, in-scope, calibrated severity), and
  writes `review-triage.json` plus a markdown table to stdout. It writes to
  nothing canonical.
- **Egress control**: the Jev backend is the sole outbound caller. Before
  serializing a request it runs every outbound text field through a
  three-stage guard (scanner scrub with positive re-scan verification,
  key-name denylist redaction, context-free entropy redaction), builds the
  body only from a fixed field whitelist, refuses redirects, and pins the
  endpoint as a constant. `.claude/security/egress-allowlist.json` records
  the host, caller, data classes, and audit date; a test ties the constant
  to the file.
- **Audit**: every call and every decline emits a `jev-queried` or
  `jev-declined` event through `.claude/hooks/log-activity.sh`, carrying
  question count, backend, decline reason, redaction count, usage, and the
  thresholds applied.

Why this shape. The brief's hard constraints (optional addon, zero runtime
deps, sole writer, fail open, advisory only) are all satisfied by keeping
the backend behind an interface whose default implementation needs no
network. That makes the Jev-versus-Claude-versus-heuristic question
reversible and lets the interface, tests, consumer, and scanner rule ship
even if a Jev key cannot be obtained. Review triage is the first consumer
because its inputs are already structured one-liners, its output only
shortens what the lead reads, and it has no path into ROADMAP.md or any
gate. Shipping the heuristic first also answers the reviewer's fair
challenge that the design never quantified Jev's marginal value: the
calibration procedure below produces that number before the flag flips.

## Alternatives Considered

| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| `@typesafe-ai/sdk` v0.6.0 as the client | Retries, typed errors, `choice()` helpers; zero transitive deps | Still a `package.json` runtime dependency; two smaller deps were rejected on that ground (decisions 2026-04-04, 2026-04-06) | Raw `fetch` on Node 22 covers the documented contract in about forty lines |
| TypeSafe's published Claude Code skill (`docs.typesafe.ai/agent-skill.md`) | Fastest path to a working call | It is prose loaded into the lead's context that teaches the lead to call the API ad hoc; that bypasses the sole-writer module, the egress guards, and the audit log, and it is unvetted third-party instruction content | Rejected; the client is hand-written under the sole-writer constraint |
| Claude structured-output backend in v1 | No new vendor or key; works today | 30 to 60x the per-decision cost; 1 to 3 s latency; can return a plausible wrong label; adds a second egress path to secure | Documented extension point behind the same interface; not built in v1 |
| Triage inside the lead's prose (status quo) | No code | The lead spends Fable tokens on dedupe and scope, which are mechanical; no audit trail of what was merged | This is the cost the feature exists to remove |
| Heuristic dedupe only, no network backend ever | Zero egress surface | Brittle on paraphrase; no calibrated severity | This is wave 1 of this design; Jev is wave 2, gated on measured lift |
| Import the scanner's `scanContent` for in-process scrub | No subprocess, no temp file | `security-scanner.ts` calls `main()` unconditionally at module load (line 1496), so importing it runs the CLI; exporting the engine is a scanner refactor outside this feature | Subprocess scrub via a temp file, verified by a positive re-scan |
| Configurable endpoint in settings | Lets a user route through a gateway | A settings edit becomes an exfiltration path for every scrubbed finding | Endpoint is a constant; host recorded in the egress allowlist |
| PreToolUse deny signal as first consumer | Highest value site | Conflicts with the closed-allowlist pattern; host hook is an uninstalled proposal; network call on every Bash command | Deferred per the brief's non-goals |

## Constraint Analysis

| Constraint | Type | Verified | Notes |
|------------|------|----------|-------|
| Optional addon, never core; off by default | HARD | ✅ | `design-principles.md:170-172` names `dashboard-server.ts` as the sanctioned carve-out; `settings.json` `project_os` block is where optional features already declare `enabled` (`context_filter.enabled`, read at `knowledge-index.ts:125-139`) |
| No runtime npm dependency | HARD | ✅ | `package.json` has no `dependencies` key; Node engine `>=22.18` ships global `fetch` |
| Sole writer, scrub before emit | HARD | ✅ | Pattern text at `patterns.md:78-86` and `:102-110`; scrub engine reachable only via CLI (`security-scanner.ts:887-955`, `main()` at `:1496`), so the sole writer shells out and verifies the result itself |
| Key lives in the environment only | HARD | ✅ | `settings.json` is committed; `.claude/logs/` is gitignored (`.gitignore:14`); the key is read from `process.env` inside the backend and never copied into config, logs, temp files, or error strings |
| Advisory only in v1 | HARD | ✅ | Triage output lands in `docs/specs/<feature>/` (gitignored, `.gitignore:20`) and stdout; `review.md` synthesis steps 1 to 3 (`review.md:186-190`) are lead prose that will read it, not act on it mechanically |
| Fail open to today's behaviour | HARD | ✅ | Heuristic backend is the default return on every error branch; nothing in `install-hooks.sh`, `.git/hooks/pre-commit`, or `/workflows:ship` calls the interface (internal research, 2026-09-19) |
| Scanner flags the key format before any code reads the key | HARD | ⚠️ partial | Probe 2026-09-19: `scan-files` on a file containing only `sk-` plus 40 alphanumerics printed "No findings."; `openai-api-key` (`scan-rules.js:1620`) requires the `T3BlbkFJ` infix; `generic-api-key` (`:824`) and `generic-api-key-custom` (`:2551`) require an adjacent key-ish name. The new `bare-sk-token` rule closes the documented `sk-` shape. Because the vendor's exact format is unverified (A12), enabling the flag in any repo is gated on a **key-shape check** at issuance (see Testing Strategy), and the egress entropy guard protects the outbound path regardless of format |
| One batched call per triage run, under the vendor limits | SOFT | ✅ | Limits verified on `docs.typesafe.ai/models.md` by the external researcher; consumer chunks at an estimated 40k tokens per body, backend declines above an estimated 60k |
| Thresholds under `project_os.jev`, read through `scripts/lib/policy.ts` | SOFT | ❌ | **Brief error.** `policy.ts` reads `.claude/maintenance-policy.yaml` (`policy.ts:30`), not `settings.json`. The design reads `project_os.jev` with `JSON.parse` exactly as `knowledge-index.ts:125-139` reads `context_filter`. The soft constraint was mis-stated, not violated; the brief line is corrected |
| Windows compatibility of subprocess calls | SOFT | ✅ | Precedent: `maintain-draft.ts:257` runs `bash scripts/validate-roadmap.sh` through `execFileSync` with an argv array; the same shape is used here |
| `mcp-allowlist.json` blocks environment-variable access, unlisted network domains, and subprocess execution | HARD (scope check) | ✅ | That file's `description` scopes it to "approved external MCP servers"; `decide.ts` is a script, not an MCP server, and is not governed by it. The brief asked for an explicit carve-out: `egress-allowlist.json` is the sibling file for direct HTTP callers, mirrors the same fields, and declares its own `blocked_capabilities` (`endpoint_override`, `file_content_egress`, `diff_egress`). `mcp-allowlist.json` is left untouched and gains no exception |

No soft constraint is being treated as hard. The one mis-stated constraint
above narrows nothing once corrected.

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| A1: Reviewer findings arrive as single lines matching `^(CRITICAL\|HIGH\|MEDIUM\|LOW) / .+ / .+ / .+$` | VERIFIED | `review.md:96-97`, `:139-140`, `:170-171` specify the format for all three reviewers; ISSUE field prefixes `DRIFT:`, `VULN:`, `ISSUE:` identify the source reviewer. ISSUE and FIX are free prose and may themselves contain ` / `; see the parse rule |
| A2: The lead can persist each reviewer's raw report to disk before synthesis | VERIFIED | The lead already writes `docs/specs/<f>/review.md` (`review.md:200`); reports are Agent tool results in the lead's context |
| A3: `security-scanner.ts scrub <file>` redacts in place, refuses paths outside the project root, and **exits 0 even when it could not write** | VERIFIED | `cmdScrub` at `security-scanner.ts:887-955`: read failure `continue`s (`:907-912`), write failure logs and leaves the original in place (`:941-951`), `process.exit(0)` at `:954`. `validatePath` at `:472-483` has no `realpath` step. Hence the positive re-scan and the directory containment check in this design |
| A4: `.claude/logs/` is gitignored and writable | VERIFIED | `.gitignore:14`; `log-activity.sh:22` does `mkdir -p` on it |
| A5: `log-activity.sh` accepts arbitrary `key=value` metadata and JSON-escapes values as strings | VERIFIED | `log-activity.sh:37-65`; all metadata values are strings, so probabilities are logged as decimal strings and `tools:metrics` grep queries work unchanged |
| A6: Node's global `fetch` supports `AbortSignal.timeout` and `redirect: "manual"` | VERIFIED | Node 22 (engine floor 22.18); WHATWG fetch options |
| A7: Jev request body is `{ state, model, questions }` with `type: "noul"\|"choice"\|"score"`; `criteria` is optional for `noul` (keys `"true"`/`"false"` when present), an object for `choice`, an ordered array for `score`; answers keyed by question name with `noul` / `choice`+`probabilities`+`confidence` / `score`+`legend`+`probabilities`+`confidence`; `usage.input_tokens`/`output_tokens`; errors 401, 422, 429, 529 | VERIFIED | `docs.typesafe.ai/api`, fetched by the designer 2026-09-19 |
| A8: A TypeSafe key can be obtained now | UNVERIFIED | Launch blog says waitlist; models page reads as GA. Not load-bearing: wave 1 ships without it |
| A9: Malformed questions return 422 (docs) or 400 (GitHub issue) | UNVERIFIED | Both codes are handled identically as a decline |
| A10: Node `fetch` reaches `api.typesafe.ai` without proxy configuration on the owner's machine | UNVERIFIED | No other script in the repo makes an outbound HTTP call (grep 2026-09-19). Node's fetch ignores `HTTPS_PROXY`. A proxied environment declines with `reason=network`, which is the fail-open path |
| A11: `bash` is on PATH when a Node script runs on Windows | VERIFIED by precedent | `maintain-draft.ts:257`; `scrub-secrets.sh` delegation |
| A12: The `sk-` prefix is TypeSafe's key format | UNVERIFIED, **load-bearing for pre-commit protection only** | Third-party guide only. Mitigated by the key-shape check at issuance (a gate, not an assumption) and by the egress entropy guard, which is format-agnostic |
| A13: `.claude/manifest.json` hashes every shipped script and `update-project.sh` uses it to ship files downstream | VERIFIED | `manifest.json:106`, `:118` list `scripts/maintain-draft.ts` and `scripts/lib/policy.ts`; new scripts must be added by `bash scripts/generate-manifest.sh` in the same change |

## Technical Approach

### Data Model

```ts
// scripts/lib/decide.ts
export type NoulQuestion   = { type: "noul";   instructions: string; criteria?: { true: string; false: string } };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type ScoreQuestion  = { type: "score";  instructions: string; criteria: string[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionMap = Record<string, Question>;

export type NoulAnswer   = { type: "noul";   noul: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer  = { type: "score";  score: number; probabilities: Record<string, number>; confidence: number };
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DeclineReason =
  | "disabled" | "no-key" | "egress-dir-unsafe" | "scrub-failed" | "too-large"
  | "timeout" | "network" | "redirect" | `http-${number}` | "malformed-response";

export type DecisionResult = {
  answers: Record<string, Answer>;
  backend: "heuristic" | "jev";
  declined?: DeclineReason;        // set only when Jev was eligible and not used, or a response was partially rejected
  redactions: number;              // fields or tokens redacted by the egress guard (0 on the heuristic path)
  usage?: { input_tokens: number; output_tokens: number };
  duration_ms: number;
};

export type JevConfig = {
  enabled: boolean;                // default false
  model: string;                   // default "jev-latest"
  timeout_ms: number;              // default 5000
  max_body_tokens: number;         // default 60000; estimated as serialized chars / 4; hard decline above
  thresholds: {
    duplicate_p: number;           // default 0.85 (initial; see Calibration)
    out_of_scope_p: number;        // default 0.80
    severity_confidence: number;   // default 0.80
  };
};

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";   // constant, never configurable
```

`review-triage.json` (consumer output; every text field is the **scrubbed**
value, the same one that would go out on the wire):

```json
{
  "feature": "<slug>",
  "advisory": true,
  "backend": "heuristic|jev",
  "declined": "no-key",
  "redactions": 0,
  "findings": [
    {
      "id": "security-3",
      "reviewer": "security",
      "severity": "HIGH",
      "file": "scripts/foo.ts",
      "lines": "12-20",
      "issue": "VULN: ...",
      "fix": "...",
      "duplicate_of": "architecture-1",
      "duplicate_p": 0.93,
      "in_scope": "in_diff|adjacent|unrelated",
      "in_scope_p": 0.97,
      "calibrated_severity": "HIGH",
      "severity_confidence": 0.71
    }
  ]
}
```

### Key Interfaces

```ts
// scripts/lib/decide.ts
export function readJevConfig(settingsPath?: string): JevConfig;
export function heuristicBackend(state: string, questions: QuestionMap): Record<string, Answer>;
export function guardEgressFields(fields: string[], deps): Promise<{ fields: string[]; redactions: number } | null>;  // null = refuse
export function decide(
  state: string,
  questions: QuestionMap,
  deps?: {
    config?: JevConfig;
    env?: Record<string, string | undefined>;   // defaults to process.env
    fetchImpl?: typeof fetch;                   // injected in tests
    scrubCmd?: (file: string) => { status: number };       // defaults to execFileSync node security-scanner.ts scrub
    scanCmd?:  (file: string) => { status: number };       // defaults to execFileSync node security-scanner.ts scan-files --quiet
    egressDir?: string;                         // defaults to <projectRoot>/.claude/logs/jev
    log?: (event: string, kv: Record<string, string>) => void;
    now?: () => number;
  },
): Promise<DecisionResult>;
```

**Egress guard** (`guardEgressFields`), applied to every outbound text field
(the `state` string and every `instructions` and `criteria` string) **before**
JSON serialization, so line-oriented scrubbing never touches JSON syntax:

1. **Directory containment.** `mkdirSync(egressDir, { recursive: true, mode: 0o700 })`, then `realpathSync(egressDir)` must be inside `realpathSync(projectRoot)` (separator-anchored). A symlinked or relocated directory declines with `egress-dir-unsafe`. This covers the `realpath` gap in the scanner's own `validatePath`.
2. **Staging file.** One field per line, with `\n`, `\r`, and `\\` escaped so the line count equals the field count. Created with `flag: "wx"`, `mode: 0o600`, unique name `egress-<pid>-<random>.txt`.
3. **Scrub.** `node scripts/security-scanner.ts scrub <file>` via `execFileSync` argv. Its exit code is **not** trusted (A3).
4. **Positive verification.** Re-read the file. Decline `scrub-failed` unless all of: the file exists and is readable; its line count equals the field count; `node scripts/security-scanner.ts scan-files --quiet <file>` exits 0. This is what makes the guard fail-closed regardless of `cmdScrub`'s exit semantics.
5. **Key-name denylist (redact, not refuse).** For each line, find `key=value` and `"key": "value"` pairs; normalize the key by stripping `_` and `-`; if it matches `SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY|PRIVATEKEY|AUTH` (case-insensitive), replace the value with `[REDACTED:key]`. Applied to keys, never to prose, so "authentication" in a finding's text does not trip it. The regex is ported from `observation-parser.ts` and a test asserts both sources agree on a fixture.
6. **Context-free entropy floor.** Any token matching `[A-Za-z0-9_\-/+=]{24,}` with Shannon entropy at or above 4.0 bits per character is replaced with `[REDACTED:entropy]`. This catches a bare credential with no prefix and no adjacent key name, the class neither scanner rule covers. Over-redaction of a git SHA or a hash is accepted; the pattern's rule is "a missed observation never leaks; a missed secret does".
7. **Cleanup.** `finally` removes `<file>`, `<file>.tmp`, and `<file>.tmp.bak` (the scanner's own temp and backup names, `security-scanner.ts:936-951`).

Redaction count from steps 5 and 6 is returned and logged.

**Request.** Body is built **only** from the guarded fields: `{ state, model, questions }`. `fetchImpl(JEV_ENDPOINT, { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body, redirect: "manual", signal: AbortSignal.timeout(timeout_ms) })`. Before the call, if `Math.ceil(body.length / 4) > max_body_tokens`, decline `too-large`. A 3xx status declines `redirect`. Any non-2xx declines `http-<status>`. An abort declines `timeout`; any other rejection declines `network`. Error objects are never logged or rethrown; they are mapped to the reason and dropped.

**Response validation.** Parse JSON; require `answers` to be an object. For each question name: the answer's `type` must equal the question's; `noul` must be a finite number in `[0,1]`; `choice` must be one of the question's criteria keys with `probabilities` keyed by exactly those keys and `confidence` in `[0,1]`; `score` must be a finite number in `[0, criteria.length - 1]`. A question whose answer fails keeps its heuristic answer, and the result carries `declined: "malformed-response"` while `backend` stays `"jev"` for the accepted ones.

**Heuristic backend** (deterministic, documented in the file header): `noul` returns `0.5`; `choice` returns the first criteria key with uniform probabilities and confidence `0`; `score` returns level index `Math.floor((n - 1) / 2)` (for `["LOW","MEDIUM","HIGH","CRITICAL"]` that is `MEDIUM`) with confidence `0`. Consumers own anything smarter, so the backend stays a pure contract stub. Fractional scores from Jev map to a level by rounding half down to the nearest index.

```ts
// scripts/review-triage.ts (CLI)
// node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only] [--calibrate]
export function parseFindings(text: string, reviewer: string): Finding[];
export function heuristicCandidates(findings: Finding[], changedFiles: string[]): Candidates;
export function buildQuestions(findings: Finding[], c: Candidates, changedFiles: string[]): { state: string; questions: QuestionMap }[];  // chunked
export function applyAnswers(findings: Finding[], c: Candidates, r: DecisionResult[], t: JevConfig["thresholds"]): TriagedFinding[];
export function renderTable(rows: TriagedFinding[]): string;
```

- **Parse rule.** A finding line is one that starts with `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW` followed by ` / `. Fields one and two are taken at the first two ` / ` separators; the remainder is split at its **last** ` / ` into ISSUE and FIX. A ` / ` inside ISSUE is therefore preserved; a ` / ` inside FIX is mis-split, which is documented as the accepted ambiguity of the format and covered by a test that pins the rule. A report with at least one line starting with a severity word but zero parsed findings warns on stderr with the first such line.
- **Field whitelist.** `buildQuestions` reads exactly `severity`, `reviewer`, `file`, `lines`, `issue`, `fix` from each finding plus the changed-file path list, through a `pick()` helper; nothing else on the `Finding` object can reach the body. A test serializes a body and asserts the set of distinct field names embedded in `state` equals that whitelist. `issue` and `fix` are prose and are the reason the three content guards exist; file contents, diffs, completion reports, and the design are never read by this script.
- `heuristicCandidates` produces duplicate candidate pairs (same normalized file and overlapping or adjacent line ranges, or token Jaccard on ISSUE text at or above 0.6), an in-scope guess (`in_diff` if `file` is in the changed-files list, else `adjacent` if a sibling in the same directory is, else `unrelated`), and severity passthrough. With the heuristic backend these are the final answers.
- `buildQuestions` asks one `noul` per candidate pair ("finding A and finding B report the same defect"), one `choice` per finding for scope (`in_diff` / `adjacent` / `unrelated`, with the changed-file list in `state`), and one `score` per finding with criteria `["LOW","MEDIUM","HIGH","CRITICAL"]`. Questions are chunked by finding so each serialized body stays under an estimated 40k tokens; the backend's 60k hard decline is a backstop the consumer should never hit.
- `applyAnswers` replaces a heuristic value with the Jev value only above the matching threshold and keeps the original severity in the row alongside the calibrated one.
- `--calibrate` runs the pipeline on one or more past `review.md` files, applies no thresholds, and prints every probability next to the heuristic answer, for the procedure in Testing Strategy.

### File Changes

| File | Change | Purpose |
|------|--------|---------|
| `scripts/lib/decide.ts` | create | Interface, config reader, heuristic backend, egress guard, Jev backend, logging shim |
| `scripts/review-triage.ts` | create | Consumer CLI: parse reports, build questions, apply answers, emit scrubbed JSON and table |
| `scripts/lib/scan-rules.js` | modify (custom section) | New `bare-sk-token` rule: `/\bsk-(?!ant-|proj-|svcacct-|admin-)[A-Za-z0-9_-]{24,}\b/`, `entropy: true`, severity MEDIUM, allowlist regexes for `example`, `placeholder`, `xxx`, with positive and negative `testCases` (the earlier `live_`/`test_` lookaheads were dead: Stripe keys use `sk_live_`) |
| `.claude/settings.json` | modify | Add `project_os.jev` block (`enabled: false`, defaults as in `JevConfig`); add `Bash(node scripts/review-triage.ts*)` to `permissions.allow` |
| `.claude/security/egress-allowlist.json` | create | `{ "description": "...direct HTTP callers...", "approved_egress": { "api.typesafe.ai": { "caller": "scripts/lib/decide.ts", "data_classes": ["finding.severity","finding.reviewer","finding.file","finding.lines","finding.issue","finding.fix","changed_files"], "guards": ["scrub+rescan","key-denylist","entropy>=4.0"], "rationale": ..., "audit_date": "2026-09-19" } }, "blocked_capabilities": ["endpoint_override","file_content_egress","diff_egress"], "review_cadence": "monthly" }` |
| `.claude/manifest.json` | regenerate via `bash scripts/generate-manifest.sh` | Ships the two new scripts and the allowlist downstream through `update-project.sh` |
| `.claude/commands/workflows/review.md` | modify | Synthesis gains a step 0: write each reviewer's report to `docs/specs/<f>/review-raw/<reviewer>.md`, write `git diff --name-only <BASE>...HEAD` to `review-raw/changed-files.txt`, run `node scripts/review-triage.ts docs/specs/<f> --changed-files docs/specs/<f>/review-raw/changed-files.txt`, and use the table as input to steps 1 to 3; wording states the table is advisory |
| `.claude/hooks/log-activity.sh` | modify (comment only) | Add `jev-queried`, `jev-declined` to the documented event list |
| `.claude/commands/tools/metrics.md` | modify | Document the two events and their metadata keys |
| `docs/knowledge/architecture.md` | modify | Scripts table rows for `decide.ts` and `review-triage.ts`; Security Scanning section gains the egress allowlist and the new rule |
| `docs/knowledge/decisions.md` | modify | ADR: hosted decision API as an optional addon; endpoint constant; scrub-then-verify via subprocess; heuristic-first with measured lift |
| `docs/specs/jev-integration/brief.md` | modify (one line) | Correct the `policy.ts` reference to the settings-block pattern |
| `tests/decide.test.ts` | create | See Testing Strategy |
| `tests/review-triage.test.ts` | create | See Testing Strategy |
| `tests/fixtures/review-raw/` | create | Three reviewer reports with two planted duplicates, one out-of-scope finding, one ISSUE containing ` / `, plus a changed-files list; path is already scanner-ignored (`allowlist.json` `tests/fixtures/**`) |
| `tests/security-scanner.test.ts` | modify | Add `scan-files` cases for the new rule |
| `docs/maps/system-map.md` | regenerated by pre-commit | Never hand-edited |

### Dependencies

None added. `fetch`, `AbortSignal.timeout`, `node:fs`, `node:path`,
`node:child_process`, `node:os`, `node:crypto` are all in Node 22.

## Testing Strategy

All unit tests use `node:test`, one fixture per test, no shared `beforeEach`,
runnable in isolation, named `[unit]_[scenario]_[expected]`. External
dependencies (fetch, the two scanner subprocesses, the logger, the clock)
are injected; internal modules are not mocked. Tests that need a project
root build a throwaway copy under the OS temp directory (pattern: Test
Behaviour in a Copied Project Root) so no test touches this repo's
`.claude/logs/` or `docs/specs/`.

`tests/decide.test.ts`:

- `decide_disabled_returnsHeuristicIdentically`: config `enabled:false`, key set, fetch stub that throws if called. Asserts `deepStrictEqual(result.answers, heuristicBackend(state, questions))`, `backend === "heuristic"`, `declined === "disabled"`, fetch call count `0`.
- `decide_noKey_returnsHeuristicIdentically`: same three assertions with `declined === "no-key"`.
- `decide_networkError_returnsHeuristicIdentically`: fetch rejects; same three assertions with `declined === "network"`.
- `decide_timeout_declinesTimeout`: fetch honours the abort signal; `timeout_ms: 10`; asserts `declined === "timeout"`, `duration_ms < 1000`.
- `decide_redirect_declinesAndSendsNothingFurther`: fetch resolves status 302 with a `Location` header; asserts `declined === "redirect"`, fetch call count `1`.
- `decide_http429_declinesHttp429` and `decide_http529_declinesHttp529`.
- `decide_requestUsesManualRedirectAndTimeoutSignal`: spy on the `init` argument; asserts `init.redirect === "manual"` and `init.signal` is an `AbortSignal`.
- `decide_malformedChoice_keepsHeuristicForThatQuestion`: response `choice` outside criteria; asserts that answer deep-equals the heuristic one, the other answers are Jev's, `declined === "malformed-response"`.
- `decide_happyPath_returnsJevAnswersAndUsage`: documented response shape (A7); asserts each answer field, `backend === "jev"`, `usage.input_tokens === 312`.
- `decide_scrubRedactsKnownPatternsBeforeSend`: state contains an `sk-ant-` shaped token and a `ghp_` shaped token; real scrub and scan subprocesses against the copied root; spy fetch captures the body; asserts the body contains `[REDACTED:anthropic` and `[REDACTED:github`, and neither raw token. Also serves as the end-to-end test of the subprocess path.
- `decide_bareSkToken_redactedByNewRule`: state contains `sk-` plus 40 alphanumerics; same setup; asserts `[REDACTED:bare-sk-token]` in the body.
- `decide_bareHighEntropyToken_redactedByEntropyGuard`: state contains a 40-character base64-looking token with no prefix and no key name; scanner subprocesses stubbed to succeed without changing the file; asserts `[REDACTED:entropy]` in the body and `redactions === 1`.
- `decide_lowEntropyLongToken_notRedacted`: a 40-character path-like token of low entropy; asserts it survives.
- `decide_denylistKey_redactsValueNotRefuses`: state contains `privateKey: abcdefghij1234567890` and the prose word "authorization"; asserts the value is `[REDACTED:key]`, the prose word survives, fetch was called once, `redactions === 1`.
- `decide_denylistRegex_matchesObservationParser`: asserts the exported denylist regex source equals the one in `scripts/observation-parser.ts` on a fixture of twelve keys (six hits, six misses).
- `decide_scrubExitsZeroButFileUnchangedWithFinding_declinesScrubFailed`: scrub stub returns status 0 and leaves a known secret in place; real scan stub returns non-zero; asserts `declined === "scrub-failed"`, fetch call count `0`.
- `decide_scrubChangesLineCount_declinesScrubFailed`: scrub stub deletes a line; asserts `declined === "scrub-failed"`.
- `decide_scrubSubprocessNonZero_declinesScrubFailed`.
- `decide_egressDirIsSymlinkOutsideRoot_declinesEgressDirUnsafe`: in the copied root, `.claude/logs/jev` is a symlink to a directory outside the root; asserts `declined === "egress-dir-unsafe"`, no file created at the target.
- `decide_egressDirIsSymlinkToInRootSibling_proceeds`: symlink to `.claude/logs/jev-real` inside the root; asserts the call proceeds (in-bounds indirection case per `tests.md`).
- `decide_stagingFilesRemoved_evenOnFailure`: scrub stub throws; asserts the staging file, `.tmp`, and `.tmp.bak` are all absent afterwards.
- `decide_keyNeverInBodyLogsOrErrors`: happy path and a rejecting path whose error message echoes the request; spy logger collects every value; asserts the key appears only in the `Authorization` header and in no logged value, no result field, and no thrown error.
- `decide_oversizedBody_declinesTooLarge`: body over `max_body_tokens * 4` chars; asserts `declined === "too-large"`, fetch call count `0`.
- `decide_logsQueriedEventWithMetadata`: spy logger; asserts event `jev-queried` with keys `consumer`, `questions`, `backend`, `redactions`, `input_tokens`, `output_tokens`, `duration_ms`, `threshold_duplicate_p`, `threshold_out_of_scope_p`, `threshold_severity_confidence`, and specific values for `questions` and `redactions`.
- `decide_logsDeclinedEventWithReason`: asserts event `jev-declined` with `reason === "no-key"` and the same threshold keys.
- `readJevConfig_missingBlock_returnsDefaults`, `readJevConfig_partialBlock_mergesDefaults`, `readJevConfig_enabledNotBoolean_treatedAsFalse`.
- `egressAllowlist_containsEndpointHostAndCaller`: reads `.claude/security/egress-allowlist.json`; asserts `new URL(JEV_ENDPOINT).host` is a key and its `caller` is `scripts/lib/decide.ts`.

`tests/review-triage.test.ts`:

- `parseFindings_threeReviewerPrefixes_extractsFields`: one line each of `DRIFT:`, `VULN:`, `ISSUE:`; asserts severity, file, lines, issue, fix, reviewer.
- `parseFindings_slashInsideIssue_preserved`: ISSUE contains ` / `; asserts issue and fix split at the last separator.
- `parseFindings_nonFindingLines_ignored`: `PASS:`, `CONCERN:`, prose; asserts zero findings.
- `parseFindings_severityLineUnparseable_warnsOnStderr`: asserts the warning text names the line.
- `heuristicCandidates_sameFileOverlappingLines_pairsThem`, `heuristicCandidates_jaccardBelowThreshold_noPair`.
- `heuristicCandidates_fileInChangedList_inDiff`, `_siblingChanged_adjacent`, `_unrelated`.
- `buildQuestions_bodyContainsOnlyWhitelistedFields`: findings carry an extra `internalNote` property; asserts the serialized state contains every whitelisted field name and not `internalNote`.
- `buildQuestions_manyFindings_chunksUnderLimit`: 300 synthetic findings; asserts every chunk's serialized length is under 160k chars.
- `triage_fixture_heuristicBackend_marksTwoDuplicatesOneOutOfScope`: runs the CLI on the fixture in a copied root with `enabled:false`; asserts exactly the two planted `duplicate_of` values, the one `unrelated`, `backend === "heuristic"`, `advisory === true`.
- `triage_fixture_jevBackendStub_appliesThresholds`: injected fetch returns one duplicate at p 0.9 and one at p 0.5; asserts only the first is merged and the original severity is retained beside the calibrated one.
- `triage_outputJson_isScrubbed`: a fixture finding quotes a `ghp_` token; asserts `review-triage.json` contains `[REDACTED:` and not the token, even on the heuristic path.
- `triage_writesOnlyInsideSpecDir`: copied root; snapshot every file path under the root before and after; asserts the only additions are `docs/specs/<f>/review-triage.json` and that `.claude/logs/jev/` is empty.
- `renderTable_pipeInIssueText_escaped`: asserts the table stays five columns.

Scanner:

- The new rule's inline `testCases` run under the existing `test-rules` subcommand (already invoked by `install-hooks.sh`).
- `tests/security-scanner.test.ts` gains `scanFiles_bareSkToken_flagged` (reproduces the 2026-09-19 probe; asserts one finding with `ruleId === "bare-sk-token"`), `scanFiles_anthropicKey_notFlaggedByBareRule` (asserts the `sk-ant-` finding's `ruleId` is not `bare-sk-token`), and `scanFiles_skExamplePlaceholder_notFlagged`.

**Key-shape check at issuance** (a gate, not a test): before `enabled` is
set to `true` in any repo, write a synthetic token with the same prefix,
length, and character class as the issued key into a throwaway file and run
`node scripts/security-scanner.ts scan-files` on it. If it is not flagged,
add or adjust a rule first. Recorded in `decisions.md` when it is done.

**Calibration procedure** (before `enabled` flips in this repo): run
`node scripts/review-triage.ts --calibrate` over at least twenty findings
drawn from `docs/specs/adaptive-memory/review.md` and the next two live
reviews; compare the heuristic and Jev answers to the lead's final
disposition in each `review.md`; choose thresholds that give zero false
merges on that set; record the thresholds, the agreement rates, and the
measured lift over the heuristic in `decisions.md`. If the lift is not
material, the flag stays off and the interface remains a tested extension
point.

Gate: `bash tests/run-all.sh --fast` locally; the lead runs the full suite once per wave.

## Security Considerations

- **Key handling.** Read from `process.env.TYPESAFE_API_KEY` inside the Jev backend only. Never written to config, the activity log, `review-triage.json`, staging files, or thrown errors. Error objects from `fetch` are reduced to a `DeclineReason` and dropped.
- **Egress content.** Field-level whitelist enforced at construction (`pick()` plus a test), then three content guards over the prose fields before serialization: scanner scrub verified by a positive re-scan, key-name denylist redaction, and a context-free entropy floor. The scanner's two generic rules and the prefix rules cannot see a bare credential with no key name and no known prefix; the entropy floor exists for exactly that class. Any guard failure refuses the send. Refusal is fail-open for the workflow and fail-closed for egress.
- **Staging file.** Under `.claude/logs/jev/` (gitignored), directory created `0o700`, realpath-contained in the project root before any write, file created `wx` with `0o600`. The scanner's own `.tmp` and `.tmp.bak` names are removed in `finally`. Because the directory is `0o700`, the scanner's rename-over-original at default umask does not widen access.
- **Endpoint pinning and redirects.** `JEV_ENDPOINT` is an exported constant; settings can toggle, time out, and set thresholds; they cannot redirect. `redirect: "manual"` and a decline on any 3xx mean the body is sent to exactly one host. The egress allowlist file records that host and a test ties the two.
- **Subprocess hygiene.** All `execFileSync` calls use argv arrays; no shell string interpolation; the staging path is generated, never user-supplied.
- **Untrusted response.** Answers are validated against the question map (type, criteria membership, numeric range) before use. Response strings never reach a shell, a markdown heading, or ROADMAP.md; the rendered table escapes `|`.
- **Sole-writer on the local artifact.** `review-triage.json` is written only from the guarded field values, so the gitignored artifact never holds text the wire would not have carried, even when the network path was not taken.
- **Data retention at the vendor.** Zero-data-retention is enterprise-only per `docs.typesafe.ai/legal.md`. The design assumes retention. The content classes exported are the same ones `review.md` records in the repo; nothing leaves that is not already written to disk locally, and the guards remove what should not have been written there either.
- **Rate limits.** One request per chunk per triage run, well under 1,200 req/min. No retry loop in v1; a 429 or 529 declines.
- **`mcp-allowlist.json` scope.** Unchanged. It governs MCP servers; `decide.ts` is governed by `egress-allowlist.json`, which declares its own blocked capabilities.
- **Threat not mitigated.** A compromised `.claude/settings.json` can flip `enabled`; it cannot change the destination or the content classes. Committed settings are reviewed in the diff like any other file.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No Jev key obtainable (A8) | Medium | Low | Wave 1 ships and is tested with an injected fetch; the flag stays off |
| Vendor key format is not `sk-` (A12) | Medium | Medium for pre-commit, low for egress | Key-shape check at issuance gates `enabled`; entropy guard is format-agnostic |
| Heuristic dedupe merges two distinct findings | Medium | Medium | Advisory only; the table shows `duplicate_of` and `duplicate_p` so the lead can override; cross-validation of CRITICAL/HIGH is unchanged |
| Jev severity calibration disagrees with reviewers and the lead trusts it | Low | Medium | Replacement only above `severity_confidence`; original severity kept in the row; cross-validation still applies to CRITICAL/HIGH |
| Entropy guard over-redacts hashes and SHAs in findings | Medium | Low | Accepted by pattern ("over-suppress"); the local table still shows the original line in `review-raw/` for the lead |
| Scrub subprocess and re-scan add latency | High | Low | Two spawns per triage run, well under a second; same delegation `scrub-secrets.sh` already does |
| New scanner rule causes false positives in prose | Low | Low | 24-char floor, entropy check, allowlist regexes, `tests/fixtures/**` already path-ignored |
| Node fetch ignores `HTTPS_PROXY` (A10) | Medium in CI, low on the owner's machine | Low | Declines with `reason=network`; documented; no proxy plumbing in v1 |
| Reviewer report format drifts and `parseFindings` misses lines | Low | Medium | Parser pinned by tests on all three prefixes and the slash rule; unparseable severity lines warn on stderr |
| Triage output is mistaken for a gate decision | Low | High | `review.md` wording states it feeds steps 1 to 3 only; JSON carries `"advisory": true`; nothing consumes it mechanically |
| Downstream projects receive `review.md` step 0 without the scripts | Low | Medium | Manifest regenerated in the same change; `update-project.sh` ships by manifest |
