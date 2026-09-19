# Brief: Jev Integration
Created: 2026-09-19
Status: DRAFT

## Problem

Project OS spends its most expensive resource, lead-model context and output
tokens, on a class of decisions that are cheap, repetitive, and well-specified:
"are these two reviewer findings the same finding", "is this finding inside the
diff's scope", "does this draft task need the judgment tier". Today those are
either made by the lead reading prose, or not made at all (the `(model:)`
annotation is defined in `docs/knowledge/roadmap-format.md` and consumed by
`/workflows:build`, but nothing emits it at plan time).

TypeSafe AI's Jev is a hosted model that answers exactly this shape of
question: it takes program state plus a map of typed questions and returns one
typed answer per question with calibrated probabilities. It does not generate
text and cannot write files, so it is not a coding agent, not a rung on the
model ladder, and not an adapter. It is a decision primitive for the
deterministic layer.

## Proposed Solution

Add a **decision interface** to `scripts/lib/` with two backends: a local
heuristic (default, offline, zero-dependency) and Jev (optional, opt-in via
`project_os.jev.enabled` in `.claude/settings.json` plus a `TYPESAFE_API_KEY`
in the environment). The Jev backend is a raw Node `fetch` to
`POST https://api.typesafe.ai/v1/systemone`; no SDK. One module owns the
outbound call and scrubs every field it sends. Every decision is logged to the
JSONL activity log with its probability so thresholds can be audited and tuned.

The first consumer is **review-finding triage** in `/workflows:review`: a
Node step that takes the three reviewers' structured `SEVERITY / FILE:LINES /
ISSUE / FIX` lines and returns, per finding, a duplicate-of pointer, an
in-scope probability, and a calibrated severity, so the lead reads a
de-duplicated, ordered list instead of three raw reports. Output is advisory
and lands only in the lead's context, never in ROADMAP.md or any canonical
artifact.

A plan-time dispatch-tier advisor is a documented follow-on that shares the
same plumbing. A PreToolUse deny-only risk signal is explicitly deferred (see
Non-Goals and Research Findings).

## Success Criteria

- [ ] `scripts/lib/decide.ts` exposes `decide(state, questions)` returning
      typed answers; with `TYPESAFE_API_KEY` unset, `project_os.jev.enabled`
      false, or the network down, it returns the local-heuristic answer and
      never throws. A test proves each of those three degradation paths
      produces identical output to the heuristic run alone.
- [ ] The Jev backend sends nothing that `scripts/scrub-secrets.sh` would
      redact: a test feeds a finding containing a fake credential through the
      triage step and asserts the request body the backend would send has it
      redacted.
- [ ] `/workflows:review` synthesis consumes the triage output: on a fixture
      of three reviewer reports with two known duplicates and one
      out-of-scope finding, the step marks exactly those, and the lead's
      cross-validation list is shorter by that count.
- [ ] Every Jev call and every degradation emits a `jev-queried` or
      `jev-declined` event through `.claude/hooks/log-activity.sh` carrying
      question names, probabilities, and the applied threshold.
- [ ] `node scripts/security-scanner.ts scan-files` flags a bare
      `sk-[A-Za-z0-9]{20,}` token with no adjacent key-name (today it prints
      "No findings."; see Research Findings, confirmed 2026-09-19). This lands
      before any code that reads `TYPESAFE_API_KEY`.
- [ ] The core scaffold, pre-commit, pre-push, and ship all pass with Jev
      disabled and with no network. Nothing on those paths calls the backend.

## Constraints

- Hard: **optional addon, never core.** Same carve-out as
  `scripts/dashboard-server.ts` in `docs/knowledge/design-principles.md`
  ("the core scaffold remains bash+markdown only"). Off by default.
- Hard: **no runtime npm dependency.** `@typesafe-ai/sdk` v0.6.0 declares zero
  transitive deps, but it is still a `package.json` runtime dependency and
  the decisions log has rejected smaller ones (gitleaks binary, MCP SDK).
  Raw `fetch` on Node >=22.18 is sufficient per the official API reference.
- Hard: **sole writer, scrub before emit.** One module makes the outbound
  call and runs the same redaction the secret scanner applies to every field
  of `state` and `questions` (pattern: Sole-Writer Self-Enforcement, Denylist
  Before Emit). No other script may hold the key or call the endpoint.
- Hard: **the key lives in the environment.** Never in `.claude/settings.json`
  (committed) or any file the scanner could miss. The scanner gap above is a
  prerequisite, not a follow-up.
- Hard: **advisory only in v1.** No Jev answer writes to ROADMAP.md, the
  handoff, the knowledge vault, or any gate. The lead remains the decider;
  "reviewer findings are claims too" applies to triage output equally.
- Hard: **fail open to today's behaviour.** Timeout, 4xx, 5xx, missing key,
  and disabled flag all resolve to the heuristic answer with a logged
  `jev-declined` event. No path may block a tool call, commit, or review.
- Soft: one batched call per triage run (all questions in one request; the
  vendor documents batching as roughly 10x cheaper and faster than separate
  calls). Keep the request under 32k tokens for `state` plus the longest
  question, 64k total.
- Soft: thresholds live under `project_os.jev` in settings, shaped like the
  existing `context_filter` block, and are read the way
  `scripts/knowledge-index.ts` reads that block (corrected by the design:
  `scripts/lib/policy.ts` reads the maintenance YAML, not settings).

## Non-Goals

- Jev as a model-ladder rung, a `(model:)` target, or a `/tools:set-models`
  tier. It cannot implement or review.
- A Jev adapter under `.claude/agents/adapters/`. The adapter contract is
  "execute a task and hand back files"; Jev cannot satisfy it.
- Secret-scanner false-positive triage via Jev. That would send candidate
  credentials to a third party to decide whether they are credentials. The
  scanner stays offline and deterministic.
- A PreToolUse deny-only risk signal (candidate (c) in the research). It is
  the highest-value site but conflicts with the "Invert Open-Ended
  Recognition Predicates to Closed Allowlists" pattern, its host hook
  (`docs/proposals/pre-tool-approve-hook.md`) is a proposal that is not
  installed, and it would add a network round trip to every Bash call.
  Revisit only after that hook ships and a decision record settles whether a
  probabilistic deny signal is compatible with the pattern.
- Writing `(model: opus)` annotations into ROADMAP.md from a Jev answer. A
  remote string reaching a ROADMAP line is the forged-task-line hazard the
  Sole-Writer pattern documents; `validate-roadmap.sh` does not validate
  `(model:)` today. The dispatch-tier advisor, if built, prints a suggestion
  for the lead and writes nothing.
- Cloudflare Workers AI or Vercel AI Gateway routes. They change auth and
  halve the context window; only worth it inside those platforms.

## Research Findings

Two researchers ran in parallel (internal reuse, external options). Combined
sub-agent spend: about 216k tokens.

**API contract (verified on docs.typesafe.ai/api and models.md).**
`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`,
JSON body `{ state, model, questions }` where `questions` is a named map and
each question has `type: "noul" | "choice" | "score"`, `instructions`, and
`criteria` (an object for `noul` and `choice`, an ordered array of level
labels for `score`). Answers come back keyed by the same names:
`noul` returns `{ type, noul }` (a bare probability, no `confidence` field);
`choice` returns `{ type, choice, probabilities, confidence }`; `score`
returns `{ type, score, legend, probabilities, confidence }` with a
fractional score. `usage.input_tokens` and `usage.output_tokens` are
returned. Model IDs: `jev-1.13.0`, aliases `jev-latest`, `jev-preview`.
Limits: 64k tokens per request, 32k for `state` plus the longest question,
250k tokens/s, 1,200 req/min. Errors: 401, 422 (a GitHub issue reports 400
for malformed questions; handle both), 429, 529. Pricing: $0.042 per million
input tokens, output free. Per-decision cost at ~600 input tokens is about
$0.000025, versus roughly $0.0015 for a Sonnet structured-output call.

**Third-party only (unverified on an official page).** 70 to 500 ms latency;
255-option cap on `choice`; 2 to 10 levels on `score`; `Retry-After` header
semantics on 429.

**Availability is contradictory.** The launch blog says early access behind a
waitlist and West Coast only; `docs.typesafe.ai/models.md` reads as general
availability with limits that "can change without notice". Whether a key can
be obtained on demand is unknown.

**Data handling.** `docs.typesafe.ai/legal.md` indexes a no-training
commitment and zero-data-retention for enterprise customers only. Assume
inputs are retained by default for a solo account. Reviewer findings carry
file paths and code excerpts; the brief treats those as sendable only after
scrubbing, and the design must name the data classes that may leave the
machine.

**No prior art in the repo.** Zero hits for `typesafe`, `jev`, `systemone`,
or `noul` across all markdown, JSON, TypeScript, and shell files. No decision
record covers a hosted decision API.

**Where each candidate consumer would live.**

- Review triage: `.claude/commands/workflows/review.md` steps 1 to 3 of the
  synthesis section (deduplicate, cross-validate, cost-benefit) are lead
  prose over structured one-line findings. Node is available, it is not a
  git hook, and offline is not required. This is the safest first consumer:
  it writes to nothing canonical.
- Dispatch-tier advisor: a new step in `.claude/commands/workflows/plan.md`
  after the `validate-roadmap.sh` call. The `(model:)` annotation is
  currently never emitted at plan time. The internal researcher rated this
  the weakest site: the lead already has the full task text in context and
  the decision is cheap. Kept as a follow-on because the plumbing is shared.
- PreToolUse deny signal: would slot into the proposed pre-tool-approve hook
  between its hard-deny block and its no-opinion block. Bash-only,
  jq-dependent, not installed, and on the path of every Bash call. Deferred.

**Reusable plumbing.** `.claude/hooks/log-activity.sh` (JSONL append with
`json_escape` and flock); the `project_os.context_filter` settings block as
the shape to copy; `scripts/lib/policy.ts` flag readers;
`scripts/scrub-secrets.sh` and the scanner's `scrub` subcommand for outbound
redaction; the Context7 security-wrapper pattern (`.claude/security/
mcp-allowlist.json` plus a validating hook) as the precedent for a pinned,
domain-allowlisted, read-only external integration. Note that allowlist file
lists environment-variable access under blocked capabilities, and Jev needs
one variable; the design must carve that out explicitly.

**Confirmed scanner gap (probe run 2026-09-19).** A file containing only
`sk-abcdef0123456789abcdef0123456789abcdef01` scanned with
`node scripts/security-scanner.ts scan-files` returned "No findings." The
primary OpenAI rule requires the `T3BlbkFJ` infix and the generic rules need
an adjacent key-ish name; only the Node-unavailable fallback path in
`scrub-secrets.sh` catches a bare `sk-` token. A TypeSafe key pasted alone
into a file would pass pre-commit. Filed as a prerequisite draft.

**Alternatives considered.** A Claude structured-output call needs no new
vendor or key and works today, at roughly 30 to 60 times Jev's per-decision
cost and 1 to 3 s latency; it can still return a plausible wrong label. A
pure local heuristic is free and offline but brittle on paraphrase. The
decision-interface shape keeps the backend choice reversible: the heuristic
is the default, and Jev or Claude are optional upgrades behind it.

## Open Questions

- Can a key be obtained now? If not, the design should ship the interface,
  the heuristic backend, the tests, and the scanner fix, with the Jev backend
  stubbed behind the flag until access exists.
- What data classes may be sent? Proposed: finding text and severity yes;
  file paths yes; code excerpts only after scrub; diffs no. The design must
  state this and the scrub step must enforce it.
- Thresholds: what probability marks a duplicate, an out-of-scope finding, or
  a severity change? Proposed initial values and a calibration procedure
  against 20 real findings from past reviews (`docs/specs/*/review.md`).
- Should the Claude backend be built in v1 as a second network option, or
  left as a documented extension point?
- Does the Context7 allowlist file become the home for Jev's domain and
  capability declaration, or does Jev get its own file under
  `.claude/security/`?
- TypeSafe publishes a drop-in Claude Code skill (`docs.typesafe.ai/
  agent-skill.md`). Evaluate whether it is a faster integration path or an
  unvetted dependency; default is to hand-write the client under the
  sole-writer constraint.
- Which log-activity event schema fields carry probabilities without
  breaking `tools:metrics` queries?
