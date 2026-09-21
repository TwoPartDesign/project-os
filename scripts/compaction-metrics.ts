#!/usr/bin/env node
// scripts/compaction-metrics.ts — offline analysis of Claude Code transcript
// JSONL files, measuring what the configured auto-compaction constraint
// (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` x `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`)
// actually costs a long lead session.
//
// T189 answers three questions from a transcript: how long each compaction
// cycle runs and what it spends (per-cycle table), whether tool errors rise
// as context fills (error rate by context decile), and what a different
// threshold would have cost (threshold simulation). It also pins the
// configured fire point against the one the runtime actually used.
//
// Zero runtime dependencies: node:fs, node:path, and node:url (the ESM main
// check) only. Runs directly under node's TypeScript type stripping, no
// build step. The transcript path is always passed on the command line;
// nothing about `~/.claude/projects/` is hardcoded.
//
// A note on turn counting: one assistant API response is written to the
// transcript as several records, one per content block, each repeating the
// same `message.usage`. Summing every record multiplies input spend by the
// block count, so records sharing a response id are collapsed into one turn.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The four input/output token parts of one assistant response's usage. */
export type UsageParts = {
  /** `input_tokens` — uncached input billed at full rate. */
  uncached: number;
  /** `cache_read_input_tokens`. */
  cacheRead: number;
  /** `cache_creation_input_tokens`. */
  cacheCreate: number;
  /** `output_tokens`. */
  output: number;
};

/** One `compact_boundary` system record's metadata. */
export type BoundaryMarker = {
  trigger: string;
  preTokens: number;
  postTokens: number;
  timestamp: string;
};

/** One main-thread assistant turn (all content blocks of one API response). */
export type TurnRecord = {
  /** 0-based position in the transcript's main thread. */
  index: number;
  /** `message.id`, else `requestId`, else `uuid` — the response identity. */
  responseId: string;
  timestamp: string;
  /** `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. */
  context: number;
  usage: UsageParts;
  /** Count of `is_error: true` tool results attributed to this turn. */
  errors: number;
  /** The compaction boundary that fired immediately before this turn. */
  boundaryBefore: BoundaryMarker | null;
};

/** A run of turns between two compactions. */
export type Cycle = {
  index: number;
  turns: TurnRecord[];
  /** Context (or `compactMetadata.preTokens`) when this cycle was cut. */
  preTokens: number | null;
  /** Context the next cycle restarted at. */
  postTokens: number | null;
  /** How the cycle ended. */
  cutBy: "boundary" | "usage-drop" | "end";
};

/** Aggregate spend and context numbers for one cycle. */
export type CycleStats = {
  turns: number;
  peak: number;
  peakPct: number;
  cacheRead: number;
  cacheCreate: number;
  uncached: number;
  output: number;
  turnsOver200k: number;
};

/** One context-decile bucket of the tool-error rate. */
export type DecileStat = {
  decile: number;
  turns: number;
  errors: number;
  rate: number;
};

/** Projection of one hypothetical compaction threshold. */
export type ThresholdSim = {
  window: number;
  pct: number;
  threshold: number;
  postTokens: number;
  compactions: number;
  projectedCacheRead: number;
  projectedMeanContext: number;
};

/** Configured fire point against the ones the runtime actually used. */
export type PinResult = {
  configured: number;
  observedPreTokens: number[];
  observedLastContext: number[];
  gapTokens: number[];
};

/** Everything one run of the analysis produced. */
export type AnalysisResult = {
  files: string[];
  window: number;
  pct: number;
  configured: number;
  turns: number;
  cycles: Array<Cycle & { stats: CycleStats }>;
  deciles: DecileStat[];
  simulations: ThresholdSim[];
  pin: PinResult;
  totals: CycleStats & { meanContext: number; errors: number };
};

/** Options for `segmentCycles`. */
export type SegmentOptions = {
  /** Cut when context falls below this fraction of the previous turn's. */
  dropRatio?: number;
  /** Only cut on a drop when the previous turn was above this context. */
  minPrevContext?: number;
};

/** Context above which a turn is counted as an expensive turn. */
const OVER_CONTEXT = 200000;

/** Fallback post-compaction context when a transcript has no boundary. */
const DEFAULT_POST_TOKENS = 15000;

/** Default window and percentage, matching `.claude/settings.json` `env`. */
const DEFAULT_WINDOW = 350000;
const DEFAULT_PCT = 80;

/** Returns `true` for a main-thread (non sub-agent) transcript record. */
function isMainThread(rec: Record<string, unknown>): boolean {
  return rec.isSidechain !== true && rec.agentId === undefined;
}

/** Reads a record's numeric usage field, defaulting to 0. */
function num(usage: Record<string, unknown>, key: string): number {
  const v = usage[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Parses transcript lines into main-thread assistant turns.
 *
 * Lines that are not JSON are skipped, as are sub-agent (`isSidechain`)
 * records. Consecutive records sharing a response id are one turn — the
 * transcript writes one record per content block and repeats the usage on
 * each. A `compact_boundary` record attaches to the next turn as
 * `boundaryBefore`; `is_error` tool results attach to the turn whose
 * `tool_use` block they answer, falling back to the nearest preceding turn.
 */
export function parseTranscript(lines: string[]): TurnRecord[] {
  const turns: TurnRecord[] = [];
  const byToolUseId = new Map<string, TurnRecord>();
  let pendingBoundary: BoundaryMarker | null = null;
  let last: TurnRecord | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    if (!isMainThread(rec)) continue;

    if (rec.type === "system" && rec.subtype === "compact_boundary") {
      const meta = (rec.compactMetadata ?? {}) as Record<string, unknown>;
      pendingBoundary = {
        trigger: typeof meta.trigger === "string" ? meta.trigger : "unknown",
        preTokens: num(meta, "preTokens"),
        postTokens: num(meta, "postTokens"),
        timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
      };
      continue;
    }

    const message = (rec.message ?? {}) as Record<string, unknown>;

    if (rec.type === "assistant" && message.usage) {
      const usage = message.usage as Record<string, unknown>;
      // Never fall back to the per-record uuid: it would defeat the
      // per-response collapse and count every content block as a turn.
      const responseId = String(message.id ?? rec.requestId ?? `line-${i}`);
      let turn = last;
      if (!turn || turn.responseId !== responseId) {
        const parts: UsageParts = {
          uncached: num(usage, "input_tokens"),
          cacheRead: num(usage, "cache_read_input_tokens"),
          cacheCreate: num(usage, "cache_creation_input_tokens"),
          output: num(usage, "output_tokens"),
        };
        turn = {
          index: turns.length,
          responseId,
          timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
          context: parts.uncached + parts.cacheRead + parts.cacheCreate,
          usage: parts,
          errors: 0,
          boundaryBefore: pendingBoundary,
        };
        pendingBoundary = null;
        turns.push(turn);
        last = turn;
      }
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            block.type === "tool_use" &&
            typeof block.id === "string"
          ) {
            byToolUseId.set(block.id, turn);
          }
        }
      }
      continue;
    }

    if (rec.type === "user") {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || block.type !== "tool_result" || block.is_error !== true) {
          continue;
        }
        const id =
          typeof block.tool_use_id === "string" ? block.tool_use_id : "";
        const owner = byToolUseId.get(id) ?? last;
        if (owner) owner.errors += 1;
      }
    }
  }

  return turns;
}

/**
 * Collects every `compact_boundary` marker on the transcript's main thread,
 * including one that no turn follows.
 */
export function parseBoundaries(lines: string[]): BoundaryMarker[] {
  const out: BoundaryMarker[] = [];
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    if (!isMainThread(rec)) continue;
    if (rec.type !== "system" || rec.subtype !== "compact_boundary") continue;
    const meta = (rec.compactMetadata ?? {}) as Record<string, unknown>;
    out.push({
      trigger: typeof meta.trigger === "string" ? meta.trigger : "unknown",
      preTokens: num(meta, "preTokens"),
      postTokens: num(meta, "postTokens"),
      timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
    });
  }
  return out;
}

/**
 * Splits turns into compaction cycles.
 *
 * A cycle is cut at a `compact_boundary` marker, and — for transcripts that
 * predate those markers — when a turn's context falls below `dropRatio` of
 * the previous turn's while that previous turn was above `minPrevContext`.
 */
export function segmentCycles(
  turns: TurnRecord[],
  opts: SegmentOptions = {},
): Cycle[] {
  const dropRatio = opts.dropRatio ?? 0.5;
  const minPrevContext = opts.minPrevContext ?? 50000;
  const cycles: Cycle[] = [];
  let current: Cycle | null = null;

  for (const turn of turns) {
    const prev =
      current && current.turns.length > 0
        ? current.turns[current.turns.length - 1]
        : null;
    let cut: Cycle["cutBy"] | null = null;
    if (prev && turn.boundaryBefore) cut = "boundary";
    else if (
      prev &&
      prev.context > minPrevContext &&
      turn.context < prev.context * dropRatio
    ) {
      cut = "usage-drop";
    }

    if (cut && current && prev) {
      current.cutBy = cut;
      if (cut === "boundary" && turn.boundaryBefore) {
        current.preTokens = turn.boundaryBefore.preTokens;
        current.postTokens = turn.boundaryBefore.postTokens;
      } else {
        current.preTokens = prev.context;
        current.postTokens = turn.context;
      }
      current = null;
    }

    if (!current) {
      current = {
        index: cycles.length,
        turns: [],
        preTokens: null,
        postTokens: null,
        cutBy: "end",
      };
      cycles.push(current);
    }
    current.turns.push(turn);
  }

  return cycles;
}

/** Sums one cycle's context and spend numbers against the given window. */
export function cycleStats(cycle: Cycle, window: number): CycleStats {
  let peak = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let uncached = 0;
  let output = 0;
  let turnsOver200k = 0;
  for (const t of cycle.turns) {
    if (t.context > peak) peak = t.context;
    cacheRead += t.usage.cacheRead;
    cacheCreate += t.usage.cacheCreate;
    uncached += t.usage.uncached;
    output += t.usage.output;
    if (t.context > OVER_CONTEXT) turnsOver200k += 1;
  }
  return {
    turns: cycle.turns.length,
    peak,
    peakPct: window > 0 ? (peak / window) * 100 : 0,
    cacheRead,
    cacheCreate,
    uncached,
    output,
    turnsOver200k,
  };
}

/**
 * Buckets turns by `floor(context / window * 10)` (clamped to 9) and reports
 * the tool-error rate in each of the ten deciles.
 */
export function errorRateByDecile(
  turns: TurnRecord[],
  window: number,
): DecileStat[] {
  const buckets: DecileStat[] = [];
  for (let d = 0; d < 10; d++) {
    buckets.push({ decile: d, turns: 0, errors: 0, rate: 0 });
  }
  for (const t of turns) {
    const raw = window > 0 ? Math.floor((t.context / window) * 10) : 0;
    const d = Math.max(0, Math.min(9, raw));
    buckets[d].turns += 1;
    buckets[d].errors += t.errors;
  }
  for (const b of buckets) {
    b.rate = b.turns > 0 ? b.errors / b.turns : 0;
  }
  return buckets;
}

/**
 * Replays the observed per-turn context growth against a hypothetical
 * threshold, counting the compactions it would have fired.
 *
 * Projected cache-read is an approximation: the running context each turn
 * minus that turn's own uncached and cache-creation tokens, which assumes
 * everything else in the prompt was a cache hit.
 *
 * The replay ignores the transcript's real compactions: only positive
 * turn-to-turn growth is added, so the drop at a real boundary contributes
 * nothing and the post-compaction re-seed is never counted as new growth.
 * The only resets are the ones the simulated threshold itself fires.
 */
export function simulateThreshold(
  turns: TurnRecord[],
  opts: { window: number; pct: number; postTokens?: number },
): ThresholdSim {
  const window = opts.window;
  const pct = opts.pct;
  const postTokens = opts.postTokens ?? DEFAULT_POST_TOKENS;
  const threshold = (window * pct) / 100;

  let running = 0;
  let compactions = 0;
  let projectedCacheRead = 0;
  let contextSum = 0;
  let counted = 0;
  let prev: TurnRecord | null = null;

  for (const turn of turns) {
    const delta =
      prev === null ? turn.context : Math.max(0, turn.context - prev.context);
    running += delta;
    contextSum += running;
    counted += 1;
    projectedCacheRead += Math.max(
      0,
      running - turn.usage.uncached - turn.usage.cacheCreate,
    );
    if (running > threshold) {
      compactions += 1;
      running = postTokens;
    }
    prev = turn;
  }

  return {
    window,
    pct,
    threshold,
    postTokens,
    compactions,
    projectedCacheRead,
    projectedMeanContext: counted > 0 ? contextSum / counted : 0,
  };
}

/**
 * Pins the configured fire point (`window * pct / 100`) against each observed
 * compaction: the runtime's own `preTokens` and the last usage-based context
 * seen before the boundary.
 */
export function pinCompactionPoint(
  turns: TurnRecord[],
  boundaries: BoundaryMarker[],
  window: number,
  pct: number,
): PinResult {
  const configured = (window * pct) / 100;
  const observedPreTokens: number[] = [];
  const observedLastContext: number[] = [];
  const gapTokens: number[] = [];

  for (const b of boundaries) {
    observedPreTokens.push(b.preTokens);
    gapTokens.push(b.preTokens - configured);

    let lastContext = 0;
    const marked = turns.findIndex(
      (t) =>
        t.boundaryBefore !== null && t.boundaryBefore.timestamp === b.timestamp,
    );
    if (marked > 0) {
      lastContext = turns[marked - 1].context;
    } else {
      for (const t of turns) {
        if (b.timestamp && t.timestamp && t.timestamp > b.timestamp) break;
        lastContext = t.context;
      }
    }
    observedLastContext.push(lastContext);
  }

  return { configured, observedPreTokens, observedLastContext, gapTokens };
}

/** Lists the `*.jsonl` files a transcript path refers to. */
export function resolveTranscriptFiles(target: string): string[] {
  const abs = resolve(target);
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs)
      .filter((n) => n.endsWith(".jsonl"))
      .sort()
      .map((n) => join(abs, n));
  }
  return [abs];
}

/** Runs the full analysis over one file or directory of transcripts. */
export function analyze(
  target: string,
  opts: { window?: number; pct?: number } = {},
): AnalysisResult {
  const window = opts.window ?? DEFAULT_WINDOW;
  const pct = opts.pct ?? DEFAULT_PCT;
  const files = resolveTranscriptFiles(target);

  const allTurns: TurnRecord[] = [];
  const allBoundaries: BoundaryMarker[] = [];
  const cycles: Array<Cycle & { stats: CycleStats }> = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    const turns = parseTranscript(lines);
    allBoundaries.push(...parseBoundaries(lines));
    for (const cycle of segmentCycles(turns)) {
      cycles.push({
        ...cycle,
        index: cycles.length,
        stats: cycleStats(cycle, window),
      });
    }
    allTurns.push(...turns);
  }

  // A simulated compaction resets to the observed re-seed floor: the context
  // of the first turn after each real boundary (system prompt, tools,
  // CLAUDE.md and the summary), not the boundary's summary-only postTokens.
  const observedReseed = allTurns
    .filter((t) => t.boundaryBefore !== null)
    .map((t) => t.context)
    .filter((c) => c > 0);
  const postTokens =
    observedReseed.length > 0
      ? Math.round(
          observedReseed.reduce((a, b) => a + b, 0) / observedReseed.length,
        )
      : DEFAULT_POST_TOKENS;

  const simulations = [
    simulateThreshold(allTurns, { window, pct: 60, postTokens }),
    simulateThreshold(allTurns, { window, pct: 70, postTokens }),
    simulateThreshold(allTurns, { window, pct: 80, postTokens }),
    simulateThreshold(allTurns, { window: 200000, pct: 80, postTokens }),
  ];

  let cacheRead = 0;
  let cacheCreate = 0;
  let uncached = 0;
  let output = 0;
  let turnsOver200k = 0;
  let peak = 0;
  let contextSum = 0;
  let errors = 0;
  for (const t of allTurns) {
    cacheRead += t.usage.cacheRead;
    cacheCreate += t.usage.cacheCreate;
    uncached += t.usage.uncached;
    output += t.usage.output;
    errors += t.errors;
    contextSum += t.context;
    if (t.context > peak) peak = t.context;
    if (t.context > OVER_CONTEXT) turnsOver200k += 1;
  }

  return {
    files,
    window,
    pct,
    configured: (window * pct) / 100,
    turns: allTurns.length,
    cycles,
    deciles: errorRateByDecile(allTurns, window),
    simulations,
    pin: pinCompactionPoint(allTurns, allBoundaries, window, pct),
    totals: {
      turns: allTurns.length,
      peak,
      peakPct: window > 0 ? (peak / window) * 100 : 0,
      cacheRead,
      cacheCreate,
      uncached,
      output,
      turnsOver200k,
      meanContext: allTurns.length > 0 ? contextSum / allTurns.length : 0,
      errors,
    },
  };
}

/** Formats a number with thousands separators. */
function n(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

/** Renders an analysis result as the markdown tables the CLI prints. */
export function renderMarkdown(result: AnalysisResult): string {
  const out: string[] = [];
  out.push(
    `Window ${n(result.window)} x ${result.pct}% = configured fire point ${n(result.configured)}`,
  );
  out.push(
    `Turns ${n(result.turns)} across ${result.cycles.length} cycle(s), ${result.files.length} file(s)`,
  );
  out.push("");
  out.push("### Per cycle");
  out.push("");
  out.push(
    "| Cycle | Turns | Peak ctx | Peak % | >200k | Cache read | Cache create | Uncached | Output | Cut by | preTokens | postTokens |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of result.cycles) {
    out.push(
      `| ${c.index + 1} | ${c.stats.turns} | ${n(c.stats.peak)} | ${c.stats.peakPct.toFixed(1)}% | ${c.stats.turnsOver200k} | ${n(c.stats.cacheRead)} | ${n(c.stats.cacheCreate)} | ${n(c.stats.uncached)} | ${n(c.stats.output)} | ${c.cutBy} | ${c.preTokens === null ? "-" : n(c.preTokens)} | ${c.postTokens === null ? "-" : n(c.postTokens)} |`,
    );
  }
  const t = result.totals;
  out.push(
    `| all | ${t.turns} | ${n(t.peak)} | ${t.peakPct.toFixed(1)}% | ${t.turnsOver200k} | ${n(t.cacheRead)} | ${n(t.cacheCreate)} | ${n(t.uncached)} | ${n(t.output)} | - | - | - |`,
  );
  out.push("");
  out.push(
    `Mean context per turn: ${n(t.meanContext)}. Tool errors: ${t.errors}.`,
  );
  out.push("");
  out.push("### Tool-error rate by context decile");
  out.push("");
  out.push("| Decile | Context range | Turns | Errors | Rate |");
  out.push("|---|---|---|---|---|");
  for (const d of result.deciles) {
    const lo = (result.window / 10) * d.decile;
    const hi = (result.window / 10) * (d.decile + 1);
    const range = d.decile === 9 ? `${n(lo)}+` : `${n(lo)}-${n(hi)}`;
    out.push(
      `| ${d.decile} | ${range} | ${d.turns} | ${d.errors} | ${(d.rate * 100).toFixed(1)}% |`,
    );
  }
  out.push("");
  out.push("### Threshold simulation");
  out.push("");
  out.push(
    "| Window | Pct | Threshold | Compactions | Projected cache read | Projected mean ctx |",
  );
  out.push("|---|---|---|---|---|---|");
  for (const s of result.simulations) {
    out.push(
      `| ${n(s.window)} | ${s.pct}% | ${n(s.threshold)} | ${s.compactions} | ${n(s.projectedCacheRead)} | ${n(s.projectedMeanContext)} |`,
    );
  }
  out.push("");
  out.push("### Compaction point pin");
  out.push("");
  out.push(
    "| # | Configured | Observed preTokens | Gap | Last usage ctx before |",
  );
  out.push("|---|---|---|---|---|");
  for (let i = 0; i < result.pin.observedPreTokens.length; i++) {
    out.push(
      `| ${i + 1} | ${n(result.pin.configured)} | ${n(result.pin.observedPreTokens[i])} | ${result.pin.gapTokens[i] >= 0 ? "+" : ""}${n(result.pin.gapTokens[i])} | ${n(result.pin.observedLastContext[i])} |`,
    );
  }
  return out.join("\n");
}

/** Parsed CLI arguments. */
export type CliArgs = {
  target?: string;
  window: number;
  pct: number;
  json: boolean;
  unknown?: string;
};

/** Parses `argv` after the script name. */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    window: DEFAULT_WINDOW,
    pct: DEFAULT_PCT,
    json: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--window") args.window = Number(argv[++i]);
    else if (a === "--pct") args.pct = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a.startsWith("--")) args.unknown = args.unknown ?? a;
    else positionals.push(a);
  }
  args.target = positionals[0];
  return args;
}

/** Prints usage to stderr and exits 2. */
function usageAndExit(): never {
  process.stderr.write(
    "usage: node scripts/compaction-metrics.ts <transcript-file-or-dir> [--window N] [--pct N] [--json]\n",
  );
  process.exit(2);
}

/** CLI entry point: prints markdown tables, or the raw result with `--json`. */
function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.unknown || !args.target) usageAndExit();
  if (!(args.window > 0) || !(args.pct > 0) || args.pct > 100) usageAndExit();

  let result: AnalysisResult;
  try {
    result = analyze(args.target, { window: args.window, pct: args.pct });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`compaction-metrics: ${message}\n`);
    process.exit(2);
  }
  // No process.exit after the write: a piped stdout flushes asynchronously
  // and an explicit exit truncates anything past the pipe buffer.
  process.stdout.write(
    (args.json ? JSON.stringify(result, null, 2) : renderMarkdown(result)) +
      "\n",
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) main();
