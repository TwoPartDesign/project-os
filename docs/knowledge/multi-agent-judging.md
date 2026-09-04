---
type: knowledge
tags: [agents, review, evaluation, bias, routing]
description: Evidence-backed rules for building multi-agent judge panels and model routers in this repo
links: "[[patterns]], [[design-principles]], [[architecture]]"
date: "2026-08-01"
---

# Multi-Agent Judging & Model Routing

External evidence governing how this repo fans work out to multiple agents and how it decides which
model gets which job. Recorded separately from `patterns.md` because these are **findings from
outside the codebase**, not conventions discovered while shipping it — `patterns.md` entries cite
shipped code, and these predate any implementation.

Full research trail (local, gitignored): `docs/research/llm-council-and-model-routing.md`.

---

## R1 — Judge panels rank once. They never debate.

Multi-agent *debate* amplifies judge bias sharply after the first round and sustains it through
subsequent rounds; single-pass *meta-judge* configurations resist that amplification. Debiasing
methods recover some of debate's loss but add little to meta-judge — so this is not fixable by
better prompting.

**Rule**: any panel where N agents evaluate the same artefact collects **one** ranking pass and
stops. No rebuttals, no second rounds, no "reviewers respond to each other's findings".

**Enforcement, not intention**: reviewers may see the candidate artefacts; they must never see
another reviewer's *ranking*. Assert this in a test against the assembled prompt text — a prompt
that structurally cannot contain a peer ranking is the only durable guarantee that nobody
"improves" the panel into a debate later.

Source: [Judging with Many Minds — arXiv:2505.19477](https://arxiv.org/abs/2505.19477).

---

## R2 — Anonymize to stop sycophancy, not narcissism.

Removing identity markers so agents cannot distinguish self from peer reduces two failures:
sycophancy (uncritically adopting peer views) and self-bias (clinging to one's own output).
Measured result: **sycophancy is far more common than self-bias.**

**Rule**: the failure mode to design against is convergence on the most confident-sounding
response, not models favouring themselves. Force each reviewer to cite a specific, checkable reason
for its top choice — a ranking with no falsifiable justification is a vote for tone.

**Implementation note**: anonymization must be structural. Generate labels in one function and the
label→author mapping in another, and never pass the mapping to the prompt assembler. A promise in
prompt text that the model "does not know" who wrote what is not a mechanism.

Source: [When Identity Skews Debate — arXiv:2510.07517](https://arxiv.org/abs/2510.07517).

---

## R3 — Bias mitigation is mechanical. Shuffle, don't ask nicely.

Judge bias decomposes into position, verbosity, self-preference, format, and calibration drift.
Self-preference alone contributes roughly 10–25% uniform bias and is invisible unless specifically
probed. The mitigation that survives production is shuffling candidate order.

**Rule**: permute candidate order **per reviewer**, deterministically seeded (never `Math.random`
— it breaks reproducibility and this repo's determinism posture). Instructing a model to "ignore
ordering" is not a mitigation.

**Corollary**: scoring rubrics must weight. An unweighted sum across axes lets a cosmetic axis
outvote correctness — exactly the defect found in `compete-review.md:52-62`, where an
implementation could lose on Correctness and still win on total. Gate on the axis that matters:
below-threshold correctness cannot place first regardless of other scores.

Source: [Future AGI — LLM-judge bias mitigation
(2026)](https://futureagi.com/blog/evaluating-llm-judge-bias-mitigation-2026/).

---

## R4 — This repo's router is already the right kind. The gap is coverage.

Production routing is rule-based, semantic, or predictive, usually layered with a cascade (cheap
model first, escalate on a failed confidence check). Project OS already has two of these:

| Production pattern | Where it lives here |
|---|---|
| Rule-based routing | `(model:)` / `(agent:)` annotations, resolved at `build.md:68-97` |
| Cascade | `.claude/rules/escalation.md` — 2 consecutive failures → escalate one rung; downshift after |

**Rule**: do not build a learned or semantic router. Predictive routing needs a per-task quality
label to train on; `log-activity.sh` records none, and task volume is tens per week. Revisit only
if outcome labels start being logged.

**The actual defect**: annotations are honoured only on the build path. Every judgement path
(`review`, `compete`, `research`, `design` Step 3) spawns sub-agents that inherit
`CLAUDE_CODE_SUBAGENT_MODEL: sonnet` — a model monoculture in exactly the places where diverse
opinions are the point. Extend annotation resolution to those spawn points before considering
anything more sophisticated.

**Resolved 2026-09-04**: the roster is registered and every judgement path spawns a named agent
whose tier lives in frontmatter; the monoculture note above is historical.

Sources: [Redis — LLM router architecture](https://redis.io/blog/llm-router-architecture-best-practices/) ·
[LLM routing and model cascades](https://tianpan.co/blog/2025-11-03-llm-routing-model-cascades).

---

## R5 — Model diversity available on this machine (verified 2026-08-01)

`command -v codex gemini llm ollama cursor-agent` returns **`codex` only**. A multi-vendor council
in the style of [karpathy/llm-council](https://github.com/karpathy/llm-council) (gpt-5.1 /
gemini-3-pro / claude-sonnet / grok-4) is not reachable without OpenRouter and an API key, which
collides with the never-commit-secrets hard rule.

Diversity axes that cost nothing to adopt:

1. **Claude model ladder** — `sonnet`/`opus`/`fable` via the Agent tool's `model`
   parameter. Different scale and training, same vendor.
2. **OpenAI via `scripts/codex-review.sh --mode read-only`** — a genuine cross-vendor voice with no
   write access and no worktree. Stricter than the `codex.sh` adapter's `danger-full-access`
   execute path.

**Caveat on (2)**: `-s read-only` has been observed blocking PowerShell/rg on Windows. A Codex
panel member must receive a self-contained prompt with artefacts inlined — never be asked to
explore the repo.

**Caveat on both**: including a Codex member transmits repo source to a third party. That is a
trust-boundary crossing the Claude-only paths do not have; it must be opt-in per invocation with
disclosure of what is being sent, not a silent default.
