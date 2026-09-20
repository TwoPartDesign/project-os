# Compaction Metrics — Does the 350k / 80% Constraint Help or Hurt?

Measured 2026-09-20 from one long lead session's transcript (session
`696f7242`, 204 main-thread turns, 3 auto-compactions). Aggregate numbers
only — no transcript message content is reproduced here.

Configured constraint (`.claude/settings.json` `env`):
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` = 350000,
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` = 80, so the configured fire point is
**280,000**. The PostToolUse nudge (`.claude/hooks/compact-suggest.sh`) fires
at 65% = 227,500.

## Regenerating

```bash
node scripts/compaction-metrics.ts ~/.claude/projects/<slug>/<session>.jsonl
node scripts/compaction-metrics.ts ~/.claude/projects/<slug>/ --json
```

The tables below are the verbatim output of the first command against
`~/.claude/projects/-home-user-project-os/696f7242-0a63-51a0-b689-466df7a7fc6f.jsonl`.
Flags: `--window N`, `--pct N`, `--json`.

## Per cycle

| Cycle | Turns | Peak ctx | Peak % | >200k | Cache read | Cache create | Uncached | Output | Cut by | preTokens | postTokens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 49 | 262,446 | 75.0% | 19 | 8,343,253 | 282,791 | 1,182 | 107,454 | boundary | 292,984 | 12,817 |
| 2 | 65 | 263,224 | 75.2% | 41 | 12,663,154 | 210,278 | 1,548 | 75,242 | boundary | 265,505 | 16,408 |
| 3 | 51 | 260,938 | 74.6% | 33 | 10,063,605 | 220,627 | 1,282 | 74,038 | boundary | 271,197 | 15,725 |
| 4 | 39 | 186,647 | 53.3% | 0 | 4,649,620 | 217,934 | 1,044 | 36,595 | end | - | - |
| all | 204 | 263,224 | 75.2% | 93 | 35,719,632 | 931,630 | 5,056 | 293,329 | - | - | - |

Mean context per turn: 179,688. Tool errors: 7. 93 of 204 turns (46%) ran
above 200k. Cache read is 97% of all input tokens; uncached input is 5,056
tokens for the whole session — context length, not fresh input, is the spend.

**Turn counting.** One assistant API response is written to the transcript as
several records, one per content block, each repeating the same
`message.usage` (this session: 690 records, 204 responses). The script
collapses records sharing a response id into one turn; summing every record
would have multiplied input spend by about 3.4x.

## Tool-error rate by context decile

| Decile | Context range | Turns | Errors | Rate |
|---|---|---|---|---|
| 0 | 0-35,000 | 0 | 0 | 0.0% |
| 1 | 35,000-70,000 | 0 | 0 | 0.0% |
| 2 | 70,000-105,000 | 18 | 1 | 5.6% |
| 3 | 105,000-140,000 | 55 | 2 | 3.6% |
| 4 | 140,000-175,000 | 27 | 1 | 3.7% |
| 5 | 175,000-210,000 | 17 | 1 | 5.9% |
| 6 | 210,000-245,000 | 52 | 1 | 1.9% |
| 7 | 245,000-280,000 | 35 | 1 | 2.9% |
| 8 | 280,000-315,000 | 0 | 0 | 0.0% |
| 9 | 315,000+ | 0 | 0 | 0.0% |

Sparse: 7 failed tool results in 204 turns (3.4% overall). The two fullest
occupied deciles (6 and 7, 87 turns above 210k) have the *lowest* rates,
1.9% and 2.9%. There is no measured quality penalty for running deep in the
window — but with 7 events the table cannot rule a small one out either.

## Threshold simulation

Replays the observed per-turn context growth against a hypothetical fire
point. Projected cache read is an approximation: the running context each
turn minus that turn's own uncached and cache-creation tokens, i.e. it
assumes everything else in the prompt was a cache hit.

The reset size matters more than anything else in this table. The script's
default resets a simulated compaction to the mean boundary `postTokens`
(15,000 — the summary), but the session's cycles actually restart at
**72,952 / 83,076 / 89,230 / 88,043**: the first call after a compaction
re-seeds the system prompt, tool definitions, CLAUDE.md and the summary.
Both runs are given; the 86,783 floor is the honest one.

Reset at the summary size (15,000 — script default):

| Window | Pct | Threshold | Compactions | Projected cache read | Projected mean ctx |
|---|---|---|---|---|---|
| 350,000 | 60% | 210,000 | 4 | 21,521,943 | 109,923 |
| 350,000 | 70% | 245,000 | 4 | 25,605,492 | 130,109 |
| 350,000 | 80% | 280,000 | 3 | 26,940,938 | 136,460 |
| 200,000 | 80% | 160,000 | 5 | 16,563,155 | 85,615 |

Reset at the observed re-seed floor (86,783):

| Window | Pct | Threshold | Compactions | Projected cache read | Projected mean ctx |
|---|---|---|---|---|---|
| 350,000 | 60% | 210,000 | 6 | 25,653,468 | 130,344 |
| 350,000 | 70% | 245,000 | 5 | 35,426,080 | 178,249 |
| 350,000 | 80% | 280,000 | 3 | 36,574,518 | 183,878 |
| 200,000 | 80% | 160,000 | 10 | 24,861,744 | 126,463 |

The second table validates itself: at the configured 350k/80% it reproduces
3 compactions (the session's actual count) and 36.6M projected cache read
against 35.7M actually billed, a 2% error.

Observed compaction latency: 85,847 / 88,616 / 69,550 ms — a mean of 81
seconds of wall clock per compaction, during which the lead does nothing.

## Compaction point pin

| # | Configured | Observed preTokens | Gap | Last usage ctx before |
|---|---|---|---|---|
| 1 | 280,000 | 292,984 | +12,984 | 262,446 |
| 2 | 280,000 | 265,505 | -14,495 | 263,224 |
| 3 | 280,000 | 271,197 | -8,803 | 260,938 |

The runtime's own `preTokens` scatters ±5% around the configured 280,000
(84% / 76% / 77% of the window), so the fire point is a soft target, not a
hard one. More useful: the last *usage-based* context before each boundary
is 262,446 / 263,224 / 260,938 — a remarkably tight 263k ceiling, 75% of the
window. `preTokens` counts roughly 10-30k the billed prompt does not.

## Recommendation: keep 350,000 / 80%

Keep the window and the percentage where they are. The hypothesis behind
this measurement — that context length rather than compaction count drives
input spend, so a lower threshold buys a materially cheaper session for a
few extra handoffs — is half right and half wrong. It is right that length
dominates: cache read is 35.7M of 36.7M input tokens, and mean context is
179,688 against 5,056 uncached tokens for the entire session. It is wrong
that lowering the threshold is close to free, because a compaction does not
return the session to the 15k summary; it returns it to the ~86,783-token
re-seed floor measured above, and it costs 81 seconds. With that floor, the
honest simulation says dropping to 70% buys a 3% cache-read saving
(36.6M → 35.4M) for two extra compactions and ~2.7 minutes — strictly a
loss; dropping to 60% buys 30% (36.6M → 25.7M) for three extra compactions
and three more context handoffs; and narrowing the window to 200k buys about
the same 32% for *seven* extra compactions, which is the worst trade on the
table and rules out touching the window. Meanwhile the quality side of the
gate shows nothing to defend against: the 87 turns above 210k carry a 2.3%
tool-error rate against 4.3% across the 117 turns below it. The constraint is also barely binding
as configured — the session's real ceiling was 263k (75%), never 280k — so
lowering the percentage to 70 would mostly move the fire point into the
range the session already occupies, where it converts working context into
summarization latency. If a future session genuinely needs the spend cut,
lower the percentage to 60 and never the window; on the evidence here, do
neither.

## Method notes

- Sub-agent turns (`isSidechain: true` / `agentId`) are excluded throughout;
  these are lead-context numbers only.
- Cycles are cut at `compact_boundary` records, with a fallback cut when a
  turn's context falls below 50% of the previous turn's and that previous
  turn was above 50,000 (for transcripts without boundary records).
- Tool errors are `tool_result` blocks with `is_error: true`, attributed to
  the turn whose `tool_use` id they answer.
- Source: `scripts/compaction-metrics.ts`, tests in
  `tests/compaction-metrics.test.ts`. Task #T189.
