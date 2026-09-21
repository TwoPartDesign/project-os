# Compaction Metrics — Does the 350k / 80% Constraint Help or Hurt?

Measured 2026-09-21 from one long lead session's transcript (session
`696f7242`, 305 main-thread turns, 5 auto-compactions). Aggregate numbers
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

The tables below are the verbatim output of the first command against the
session's `<slug>/<session>.jsonl` transcript. Flags: `--window N`,
`--pct N`, `--json`. A transcript keeps growing while its session runs, so
two runs minutes apart differ in the tail cycle.

## Per cycle

| Cycle | Turns | Peak ctx | Peak % | >200k | Cache read | Cache create | Uncached | Output | Cut by | preTokens | postTokens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 49 | 262,446 | 75.0% | 19 | 8,343,253 | 282,791 | 1,182 | 107,454 | boundary | 292,984 | 12,817 |
| 2 | 65 | 263,224 | 75.2% | 41 | 12,663,154 | 210,278 | 1,548 | 75,242 | boundary | 265,505 | 16,408 |
| 3 | 51 | 260,938 | 74.6% | 33 | 10,063,605 | 220,627 | 1,282 | 74,038 | boundary | 271,197 | 15,725 |
| 4 | 53 | 260,528 | 74.4% | 13 | 7,736,956 | 291,815 | 1,316 | 71,874 | boundary | 264,184 | 15,976 |
| 5 | 65 | 263,887 | 75.4% | 26 | 11,178,129 | 373,807 | 1,782 | 64,513 | boundary | 268,768 | 19,503 |
| 6 | 22 | 130,057 | 37.2% | 0 | 2,439,325 | 91,355 | 614 | 14,711 | end | - | - |
| all | 305 | 263,887 | 75.4% | 132 | 52,424,422 | 1,470,673 | 7,724 | 407,832 | - | - | - |

Mean context per turn: 176,731. Tool errors: 15. 132 of 305 turns (43%) ran
above 200k. Cache read is 97% of all input tokens; uncached input is 7,724
tokens for the whole session — context length, not fresh input, is the spend.

**Turn counting.** One assistant API response is written to the transcript as
several records, one per content block, each repeating the same
`message.usage`. The script collapses records sharing a response id into one
turn; summing every record would multiply input spend by roughly 3x.

## Tool-error rate by context decile

| Decile | Context range | Turns | Errors | Rate |
|---|---|---|---|---|
| 0 | 0-35,000 | 0 | 0 | 0.0% |
| 1 | 35,000-70,000 | 0 | 0 | 0.0% |
| 2 | 70,000-105,000 | 33 | 1 | 3.0% |
| 3 | 105,000-140,000 | 82 | 2 | 2.4% |
| 4 | 140,000-175,000 | 37 | 1 | 2.7% |
| 5 | 175,000-210,000 | 30 | 1 | 3.3% |
| 6 | 210,000-245,000 | 78 | 9 | 11.5% |
| 7 | 245,000-280,000 | 45 | 1 | 2.2% |
| 8 | 280,000-315,000 | 0 | 0 | 0.0% |
| 9 | 315,000+ | 0 | 0 | 0.0% |

Sparse: 15 failed tool results in 305 turns (4.9% overall). The one spike,
decile 6 at 11.5%, is the session's closing phase, where the auto-mode
permission classifier denied a run of worktree removals, a force push, and a
commit script; those are permission denials, not model errors, and they
account for most of the 9. Decile 7, the fullest 45 turns, sits at 2.2%.
There is no measured quality penalty for running deep in the window — but
with 15 events, several of them not the model's, the table cannot rule a
small one out either.

## Threshold simulation

Replays the observed per-turn context growth against a hypothetical fire
point. The replay ignores the transcript's real compactions: only positive
turn-to-turn growth is added, so a real boundary's drop contributes nothing
and the post-compaction re-seed is never counted as new growth; the only
resets are the ones the simulated threshold fires. Projected cache read is
an approximation: the running context each turn minus that turn's own
uncached and cache-creation tokens, i.e. it assumes everything else in the
prompt was a cache hit.

A simulated compaction resets to the observed **re-seed floor**, the context
of the first turn after each real boundary (system prompt, tool definitions,
CLAUDE.md and the summary). This session's floor is 88,466 — not the 12-19k
summary the boundary's `postTokens` reports. The script derives it from the
transcript, so the table is reproducible from the command above.

| Window | Pct | Threshold | Compactions | Projected cache read | Projected mean ctx |
|---|---|---|---|---|---|
| 350,000 | 60% | 210,000 | 7 | 44,263,341 | 149,922 |
| 350,000 | 70% | 245,000 | 5 | 46,122,248 | 155,872 |
| 350,000 | 80% | 280,000 | 4 | 56,580,400 | 190,233 |
| 200,000 | 80% | 160,000 | 11 | 37,184,153 | 126,638 |

Calibration against the session itself: at the configured 350k/80% the replay
fires 4 compactions and projects 56.6M cache read; the session actually
compacted 5 times and billed 52.4M. The 8% over-projection and the missing
compaction have one cause — the runtime fires around 263k (75%), not the
configured 280k (see the pin below), so the replay runs each cycle ~17k
longer than reality did.

Observed compaction latency for the first three boundaries: 85,847 / 88,616 /
69,550 ms — a mean of 81 seconds of wall clock per compaction, during which
the lead does nothing.

## Compaction point pin

| # | Configured | Observed preTokens | Gap | Last usage ctx before |
|---|---|---|---|---|
| 1 | 280,000 | 292,984 | +12,984 | 262,446 |
| 2 | 280,000 | 265,505 | -14,495 | 263,224 |
| 3 | 280,000 | 271,197 | -8,803 | 260,938 |
| 4 | 280,000 | 264,184 | -15,816 | 260,528 |
| 5 | 280,000 | 268,768 | -11,232 | 263,887 |

The runtime's own `preTokens` scatters ±5% around the configured 280,000
(84% / 76% / 77% / 75% / 77% of the window), so the fire point is a soft
target, not a hard one. More useful: the last *usage-based* context before
each boundary is 260,528-263,887 — a remarkably tight 263k ceiling, 75% of
the window. `preTokens` counts roughly 5-30k the billed prompt does not.

## Recommendation: keep the window at 350,000; 80% stays the default

Never narrow the window: 200k/80% is the worst trade on the table, seven
extra compactions (about 9.5 minutes of dead wall clock) for a 34% cache-read
saving, and it turns every long build into a chain of handoffs.

The percentage is a real trade, not a free lunch in either direction. The
hypothesis behind this measurement — that context length rather than
compaction count drives input spend — is confirmed: cache read is 52.4M of
53.9M input tokens, mean context is 176,731 against 7,724 uncached tokens for
the entire session. Against the corrected replay, dropping to 70% buys an 18%
cache-read saving (56.6M → 46.1M) for one extra compaction per ~300 turns,
about 81 seconds; dropping to 60% buys 22% (→ 44.3M) for three extra
compactions and three more context handoffs. The quality side of the gate
shows nothing to defend against once the classifier denials are set aside.

Keep 80% by default: the constraint is barely binding as configured (the
session's real ceiling was 263k, never 280k), the 70% fire point at 245k sits
inside the range the session already works in, and one session is not enough
to trust an 18% figure built on an 8%-error projection. If a future session
needs the spend cut, lower the percentage to 70 and never the window; revisit
after a second session's transcript confirms or refutes the saving.

## Method notes

- Sub-agent turns (`isSidechain: true` / `agentId`) are excluded throughout;
  these are lead-context numbers only.
- Cycles are cut at `compact_boundary` records, with a fallback cut when a
  turn's context falls below 50% of the previous turn's and that previous
  turn was above 50,000 (for transcripts without boundary records).
- Tool errors are `tool_result` blocks with `is_error: true`, attributed to
  the turn whose `tool_use` id they answer. Permission denials count as
  errors; read the decile table with that in mind.
- In directory mode the replay and the pin run over all files' turns
  concatenated in sorted-file order; per-cycle stats are per file.
- Source: `scripts/compaction-metrics.ts`, tests in
  `tests/compaction-metrics.test.ts`. Task #T189.
