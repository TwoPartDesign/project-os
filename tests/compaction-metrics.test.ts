// tests/compaction-metrics.test.ts
// Unit tests for scripts/compaction-metrics.ts (transcript compaction
// analysis). Pure functions are exercised by direct import against
// transcript lines built inline per test; the CLI is exercised against a
// per-test mkdtemp fixture directory — no shared state, no shared beforeEach.

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  parseTranscript,
  parseBoundaries,
  segmentCycles,
  cycleStats,
  errorRateByDecile,
  simulateThreshold,
  pinCompactionPoint,
  type TurnRecord,
} from "../scripts/compaction-metrics.ts";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/compaction-metrics.ts",
);

/** Builds one main-thread assistant record line with the given usage. */
function assistantLine(opts: {
  id: string;
  input?: number;
  cacheRead?: number;
  cacheCreate?: number;
  output?: number;
  timestamp?: string;
  toolUseId?: string;
}): string {
  const content = opts.toolUseId
    ? [{ type: "tool_use", id: opts.toolUseId, name: "Read", input: {} }]
    : [{ type: "text", text: "x" }];
  return JSON.stringify({
    type: "assistant",
    isSidechain: false,
    uuid: opts.id,
    requestId: opts.id,
    timestamp: opts.timestamp ?? "2026-09-20T00:00:00.000Z",
    message: {
      id: opts.id,
      role: "assistant",
      content,
      usage: {
        input_tokens: opts.input ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheCreate ?? 0,
        output_tokens: opts.output ?? 0,
      },
    },
  });
}

/** Builds an assistant record line whose context sums to `context`. */
function ctxLine(id: string, context: number, timestamp?: string): string {
  return assistantLine({ id, cacheRead: context, timestamp });
}

/** Builds one `compact_boundary` system record line. */
function boundaryLine(
  preTokens: number,
  postTokens: number,
  timestamp = "2026-09-20T00:30:00.000Z",
): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    isSidechain: false,
    compactMetadata: {
      trigger: "auto",
      preTokens,
      postTokens,
      cumulativeDroppedTokens: preTokens - postTokens,
      durationMs: 80000,
    },
    timestamp,
  });
}

/** Builds a user record line carrying one failed tool result. */
function toolErrorLine(toolUseId: string): string {
  return JSON.stringify({
    type: "user",
    isSidechain: false,
    uuid: `err-${toolUseId}`,
    timestamp: "2026-09-20T00:00:05.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          is_error: true,
          content: "boom",
        },
      ],
    },
  });
}

/** Builds a turn list straight from contexts, bypassing the parser. */
function turnsFromContexts(contexts: number[]): TurnRecord[] {
  return contexts.map((context, index) => ({
    index,
    responseId: `r${index}`,
    timestamp: `2026-09-20T00:00:${String(index).padStart(2, "0")}.000Z`,
    context,
    usage: { uncached: 0, cacheRead: context, cacheCreate: 0, output: 0 },
    errors: 0,
    boundaryBefore: null,
  }));
}

describe("compaction-metrics", () => {
  it("parseTranscript_recordsSharingResponseId_collapseToOneTurn", () => {
    const usage = { input: 2, cacheRead: 90159, cacheCreate: 424, output: 4 };
    const lines = [
      assistantLine({ id: "a1", ...usage, toolUseId: "tu-1" }),
      assistantLine({ id: "a1", ...usage }),
      assistantLine({ id: "a1", ...usage, toolUseId: "tu-2" }),
      toolErrorLine("tu-2"),
      assistantLine({ id: "a2", ...usage }),
    ];

    const turns = parseTranscript(lines);

    strictEqual(turns.length, 2);
    strictEqual(turns[0].responseId, "a1");
    strictEqual(turns[0].context, 2 + 90159 + 424);
    strictEqual(turns[0].usage.cacheRead, 90159);
    strictEqual(turns[0].errors, 1);
    strictEqual(turns[1].responseId, "a2");
    strictEqual(turns[1].index, 1);
  });

  it("parseTranscript_skipsSidechainAndNonJson_returnsLeadTurnsOnly", () => {
    const sidechain = JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId: "sub-1",
      uuid: "s1",
      message: {
        id: "s1",
        role: "assistant",
        content: [{ type: "text", text: "sub" }],
        usage: {
          input_tokens: 5,
          cache_read_input_tokens: 999999,
          cache_creation_input_tokens: 7,
          output_tokens: 3,
        },
      },
    });
    const lines = [
      "not json at all {",
      sidechain,
      assistantLine({
        id: "a1",
        input: 2,
        cacheRead: 90159,
        cacheCreate: 424,
        output: 4,
      }),
      assistantLine({
        id: "a2",
        input: 3,
        cacheRead: 120000,
        cacheCreate: 1000,
        output: 40,
        toolUseId: "tu-2",
      }),
      toolErrorLine("tu-2"),
    ];

    const turns = parseTranscript(lines);

    strictEqual(turns.length, 2);
    strictEqual(turns[0].responseId, "a1");
    strictEqual(turns[0].context, 2 + 90159 + 424);
    strictEqual(turns[0].errors, 0);
    strictEqual(turns[1].context, 3 + 120000 + 1000);
    strictEqual(turns[1].errors, 1);
    deepStrictEqual(turns[1].usage, {
      uncached: 3,
      cacheRead: 120000,
      cacheCreate: 1000,
      output: 40,
    });
  });

  it("segmentCycles_boundaryRecord_splitsAtBoundary", () => {
    const lines = [
      ctxLine("a1", 100000),
      ctxLine("a2", 180000),
      ctxLine("a3", 260000),
      boundaryLine(292984, 12817),
      ctxLine("a4", 70000),
      ctxLine("a5", 90000),
    ];

    const turns = parseTranscript(lines);
    const cycles = segmentCycles(turns);

    strictEqual(cycles.length, 2);
    strictEqual(cycles[0].turns.length, 3);
    strictEqual(cycles[1].turns.length, 2);
    strictEqual(cycles[0].preTokens, 292984);
    strictEqual(cycles[0].postTokens, 12817);
    strictEqual(cycles[0].cutBy, "boundary");
    strictEqual(cycles[1].cutBy, "end");
  });

  it("segmentCycles_usageDropFallback_splitsWithoutBoundary", () => {
    const dropping = segmentCycles(
      turnsFromContexts([60000, 120000, 20000, 30000]),
    );
    strictEqual(dropping.length, 2);
    strictEqual(dropping[0].turns.length, 2);
    strictEqual(dropping[1].turns.length, 2);
    strictEqual(dropping[0].cutBy, "usage-drop");
    strictEqual(dropping[0].preTokens, 120000);
    strictEqual(dropping[0].postTokens, 20000);

    const belowFloor = segmentCycles(turnsFromContexts([40000, 10000]));
    strictEqual(belowFloor.length, 1);
    strictEqual(belowFloor[0].turns.length, 2);
    strictEqual(belowFloor[0].cutBy, "end");
  });

  it("cycleStats_sumsUsageAndCountsOver200k", () => {
    const lines = [
      assistantLine({
        id: "a1",
        input: 2,
        cacheRead: 140000,
        cacheCreate: 9998,
        output: 500,
      }),
      assistantLine({
        id: "a2",
        input: 4,
        cacheRead: 245000,
        cacheCreate: 4996,
        output: 700,
      }),
    ];
    const cycles = segmentCycles(parseTranscript(lines));
    strictEqual(cycles.length, 1);

    const stats = cycleStats(cycles[0], 350000);

    strictEqual(stats.turns, 2);
    strictEqual(stats.peak, 250000);
    strictEqual(stats.peakPct, (250000 / 350000) * 100);
    strictEqual(stats.cacheRead, 385000);
    strictEqual(stats.cacheCreate, 14994);
    strictEqual(stats.uncached, 6);
    strictEqual(stats.output, 1200);
    strictEqual(stats.turnsOver200k, 1);
  });

  it("errorRateByDecile_bucketsByContextOverWindow", () => {
    const lines = [
      assistantLine({ id: "a1", cacheRead: 5000 }),
      assistantLine({ id: "a2", cacheRead: 95000, toolUseId: "tu-2" }),
      toolErrorLine("tu-2"),
      assistantLine({ id: "a3", cacheRead: 150000, toolUseId: "tu-3" }),
      toolErrorLine("tu-3"),
    ];
    const turns = parseTranscript(lines);

    const deciles = errorRateByDecile(turns, 100000);

    strictEqual(deciles.length, 10);
    strictEqual(deciles[0].turns, 1);
    strictEqual(deciles[0].errors, 0);
    strictEqual(deciles[0].rate, 0);
    strictEqual(deciles[9].turns, 2);
    strictEqual(deciles[9].errors, 2);
    strictEqual(deciles[9].rate, 1);
    strictEqual(deciles[5].turns, 0);
    strictEqual(deciles[5].rate, 0);
  });

  it("simulateThreshold_lowerPct_moreCompactionsLessCacheRead", () => {
    // One cycle growing 20000 per turn for 13 turns: contexts 20000..260000,
    // which stays under the 280000 fire point of a 350000-token window at 80%.
    const contexts: number[] = [];
    for (let i = 1; i <= 13; i++) contexts.push(i * 20000);
    const turns = turnsFromContexts(contexts);

    const high = simulateThreshold(turns, {
      window: 350000,
      pct: 80,
      postTokens: 15000,
    });
    const low = simulateThreshold(turns, {
      window: 350000,
      pct: 30,
      postTokens: 15000,
    });

    strictEqual(high.threshold, 280000);
    strictEqual(high.compactions, 0);
    // Running context 20000,40000,...,260000; nothing crosses 280000, so
    // projected cache read is 20000 * (1+2+...+13) = 20000 * 91.
    strictEqual(high.projectedCacheRead, 1820000);

    // At 105000: running crosses on turn 6 (120000) and again on turn 11
    // (15000 + 5*20000 = 115000), so exactly 2 compactions, and the running
    // series is 20/40/60/80/100/120 then 35/55/75/95/115 then 35/55 (k).
    strictEqual(low.threshold, 105000);
    strictEqual(low.compactions, 2);
    strictEqual(low.projectedCacheRead, 885000);
    strictEqual(low.projectedCacheRead < high.projectedCacheRead, true);
  });

  it("simulateThreshold_realBoundary_doesNotAddReseedContext", () => {
    // Three real cycles, each climbing 100000..260000 in 20000 steps and
    // then compacting back to an 86000 re-seed. Under a 280000 fire point
    // the replay must treat the re-seed as already-present context, not as
    // new growth stacked on the previous cycle's running total.
    const climb = (): number[] => {
      const out: number[] = [];
      for (let c = 100000; c <= 260000; c += 20000) out.push(c);
      return out;
    };
    const contexts = [...climb(), 86000, ...climb(), 86000, ...climb()];
    const turns = turnsFromContexts(contexts);

    const sim = simulateThreshold(turns, {
      window: 350000,
      pct: 80,
      postTokens: 86000,
    });

    // Running: 100k..260k, drop adds 0, 86k→100k adds 14k (274k), 120k adds
    // 20k (294k > 280k: fire 1, reset 86k), then 106k..226k, drop 0, 240k,
    // 260k, 280k, 300k (fire 2, reset 86k), 106k..186k. Exactly 2 — the
    // stacked-re-seed bug reported 3 here.
    strictEqual(sim.threshold, 280000);
    strictEqual(sim.compactions, 2);
  });

  it("cli_badWindow_exitsTwoWithUsage", () => {
    const dir = mkdtempSync(join(tmpdir(), "compaction-metrics-cli-"));
    try {
      writeFileSync(join(dir, "s.jsonl"), ctxLine("a1", 1000) + "\n", "utf8");
      const res = spawnSync("node", [SCRIPT, dir, "--window", "abc"], {
        encoding: "utf8",
      });
      strictEqual(res.status, 2);
      strictEqual(res.stderr.startsWith("usage: node scripts/"), true);

      const missing = spawnSync("node", [SCRIPT, join(dir, "nope.jsonl")], {
        encoding: "utf8",
      });
      strictEqual(missing.status, 2);
      strictEqual(missing.stderr.startsWith("compaction-metrics: "), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pinCompactionPoint_reportsGapAgainstConfigured", () => {
    const lines = [
      ctxLine("a1", 120000, "2026-09-20T00:00:00.000Z"),
      ctxLine("a2", 263000, "2026-09-20T00:20:00.000Z"),
      boundaryLine(292984, 12817, "2026-09-20T00:30:00.000Z"),
      ctxLine("a3", 80000, "2026-09-20T00:40:00.000Z"),
    ];
    const turns = parseTranscript(lines);
    const boundaries = parseBoundaries(lines);
    strictEqual(boundaries.length, 1);

    const pin = pinCompactionPoint(turns, boundaries, 350000, 80);

    strictEqual(pin.configured, 280000);
    deepStrictEqual(pin.observedPreTokens, [292984]);
    deepStrictEqual(pin.gapTokens, [12984]);
    deepStrictEqual(pin.observedLastContext, [263000]);
  });

  it("cli_jsonFlag_printsParseableResult", () => {
    const dir = mkdtempSync(join(tmpdir(), "compaction-metrics-cli-"));
    try {
      writeFileSync(
        join(dir, "session.jsonl"),
        [
          ctxLine("a1", 100000),
          "not json",
          ctxLine("a2", 150000),
          ctxLine("a3", 200000),
        ].join("\n") + "\n",
        "utf8",
      );

      const stdout = execFileSync("node", [SCRIPT, dir, "--json"], {
        encoding: "utf8",
      });
      const result = JSON.parse(stdout);

      strictEqual(result.cycles.length, 1);
      strictEqual(result.cycles[0].stats.turns, 3);
      strictEqual(result.turns, 3);
      strictEqual(result.window, 350000);
      strictEqual(result.configured, 280000);
      strictEqual(result.files.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
