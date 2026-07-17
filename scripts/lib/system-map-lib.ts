// system-map-lib.ts — Pure-function helpers for building/auditing a "system map"
// graph of Project OS's own hooks, commands, skills, scripts, libs and config.
// ES module, native TS (Node >=22.18 type-stripping): type-only syntax, no enums/namespaces.
//
// LINEAR-PARSE MANDATE: every text-scanning function here is line-by-line with
// bounded, anchored regexes (single quantifier over a negated/positive character
// class, never `.+` or nested quantifiers) or plain indexOf/startsWith/includes
// string ops. See scripts/lib/dashboard-render.ts's parseRoadmap docstring for
// the exact catastrophic-backtracking shapes this guards against (annotation
// repeats, whitespace floods, nested-token bombs) — the same discipline applies
// here so a hostile or merely huge markdown/JSON file can never freeze the
// system-map build.

import { createHash } from "node:crypto";
import { posix } from "node:path";

// ==========================================================================
// Content normalization + hashing
// ==========================================================================

/**
 * Normalizes line endings and trailing-newline shape so identical logical
 * content hashes identically regardless of the authoring machine's line-ending
 * convention. Converts `\r\n` and lone `\r` to `\n`, then collapses any run of
 * trailing newlines to exactly one. The empty string is returned unchanged
 * (it has no "trailing newline" to normalize). ALL content must pass through
 * this function before being hashed (sha256) or line-parsed by the other
 * functions in this module.
 */
export function normalizeContent(s: string): string {
  if (s.length === 0) return "";
  const unified = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = unified.replace(/\n+$/, "");
  return trimmed + "\n";
}

/**
 * Returns the lowercase hex SHA-256 digest of `s`. Callers must pass content
 * that has already gone through {@link normalizeContent} so hashes are stable
 * across machines with different line-ending conventions.
 */
export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

// ==========================================================================
// Types
// ==========================================================================

/**
 * A node in the system map graph: one physical artifact (hook, slash command,
 * skill, script, library module, or config file). `id` is a stable, caller-
 * assigned identifier by convention `<kindPrefix>_<path-derived-slug>` (e.g.
 * `h_pre_compact` for a hook, `s_maintain` for a script) — this module does
 * not assign ids, it only consumes them, so callers must keep the convention
 * consistent across a build for edges to resolve correctly.
 */
export interface MapNode {
  id: string;
  kind: "hook" | "command" | "skill" | "script" | "lib" | "config";
  path: string;
}

/**
 * A directed edge in the system map graph: `from` references/depends on `to`.
 * `kind` records how the reference was established — `wires` (a config file's
 * hooks block wiring a hook), `sources` (a shell script sourcing a lib),
 * `references` (a doc/markdown mentioning a script), or `imports` (a TS module
 * importing another).
 */
export interface MapEdge {
  from: string;
  to: string;
  kind: "wires" | "sources" | "references" | "imports";
}

/** A single audit finding produced by one of the `find*` functions below. */
export interface Finding {
  severity: "HIGH" | "MEDIUM" | "LOW";
  kind: "unwired-hook" | "orphan-script" | "dangling-ref" | "manifest-gap" | "bloat";
  subject: string;
  detail: string;
}

// ==========================================================================
// Extraction
// ==========================================================================

const HOOK_PATH_RE = /\.claude\/hooks\/[A-Za-z0-9_.-]+\.sh/g;

/**
 * Parses `.claude/settings.json` text and returns every `.claude/hooks/<name>.sh`
 * path string found anywhere inside the `hooks` object, at any nesting depth of
 * arrays/objects, sorted and deduplicated. Uses JSON.parse (not regex) to walk
 * the structure, so the recursion is bounded by the JSON's own nesting — no
 * scanning regex is run over the raw text. Callers are expected to turn each
 * returned path into a `wires` edge from the config's node id to the hook's
 * node id.
 */
export function extractHookWiring(settingsJsonText: string): string[] {
  const data: unknown = JSON.parse(settingsJsonText);
  const found = new Set<string>();
  const hooksObj =
    data && typeof data === "object" ? (data as Record<string, unknown>).hooks : undefined;

  const walk = (val: unknown): void => {
    if (typeof val === "string") {
      const matches = val.match(HOOK_PATH_RE);
      if (matches) for (const m of matches) found.add(m);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) walk(item);
      return;
    }
    if (val && typeof val === "object") {
      for (const key of Object.keys(val as Record<string, unknown>)) {
        walk((val as Record<string, unknown>)[key]);
      }
    }
  };
  walk(hooksObj);
  return Array.from(found).sort();
}

const PATH_TOKEN_RE = /^[A-Za-z0-9_.\/-]+/;

/**
 * Scans `segment` (a single fenced-code line or the text inside one pair of
 * inline backticks) for script/hook invocation patterns and adds any found
 * path tokens to `targets`. Uses indexOf to locate each recognized prefix,
 * then a bounded, non-backtracking anchored regex (`^[A-Za-z0-9_./-]+`) to
 * extract the path token that follows — never a single regex scanning the
 * whole segment.
 */
function scanSegmentForRefs(segment: string, targets: Set<string>): void {
  scanPrefix(segment, "bash scripts/", "bash ".length, targets);
  scanPrefix(segment, "node scripts/", "node ".length, targets);
  scanPrefix(segment, "scripts/lib/", 0, targets);
  scanPrefix(segment, ".claude/hooks/", 0, targets);
}

/** Finds every occurrence of `needle` in `segment` and captures the path token starting `pathOffset` chars after each match start. */
function scanPrefix(segment: string, needle: string, pathOffset: number, targets: Set<string>): void {
  let from = 0;
  for (;;) {
    const idx = segment.indexOf(needle, from);
    if (idx < 0) break;
    const rest = segment.slice(idx + pathOffset);
    const m = PATH_TOKEN_RE.exec(rest);
    if (m) targets.add(m[0]);
    from = idx + needle.length;
  }
}

/**
 * Scans markdown text line-by-line for script/hook invocation references,
 * tracking fenced-code-block state (toggled by any line whose trimmed start
 * is ``` ```) so prose is ignored. A reference is recognized when a
 * recognized pattern (`bash scripts/<x>.sh`, `node scripts/<x>.ts`,
 * `scripts/lib/<x>`, `.claude/hooks/<x>.sh`) occurs either inside a fenced
 * code block, or inside a pair of inline backticks on a non-fenced line.
 * Plain prose mentions (no backticks, not fenced) are never matched. Returns
 * unique targets sorted ascending. `sourcePath` is accepted for interface
 * symmetry with {@link extractImports} but is not currently used.
 */
export function extractScriptRefs(mdText: string, sourcePath: string): { target: string }[] {
  void sourcePath;
  const targets = new Set<string>();
  let inFence = false;
  for (const line of normalizeContent(mdText).split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      scanSegmentForRefs(line, targets);
      continue;
    }
    // Non-fenced line: only scan text inside paired inline backticks.
    let pos = 0;
    for (;;) {
      const open = line.indexOf("`", pos);
      if (open < 0) break;
      const close = line.indexOf("`", open + 1);
      if (close < 0) break;
      scanSegmentForRefs(line.slice(open + 1, close), targets);
      pos = close + 1;
    }
  }
  return Array.from(targets).sort().map((target) => ({ target }));
}

const TS_IMPORT_RE = /^import\s[^'"]*\sfrom\s+['"](\.\.?\/[^'"]+)['"]\s*;?\s*$/;

/** Extracts relative TS imports (resolved to repo-relative paths) from a `.ts` source's text. */
function extractTsImports(text: string, sourcePath: string): { target: string }[] {
  const dir = posix.dirname(sourcePath);
  const targets = new Set<string>();
  for (const rawLine of normalizeContent(text).split("\n")) {
    const line = rawLine.trim();
    const m = TS_IMPORT_RE.exec(line);
    if (!m) continue;
    const resolved = posix.normalize(posix.join(dir, m[1]));
    targets.add(resolved);
  }
  return Array.from(targets).sort().map((target) => ({ target }));
}

/** Extracts `source`/`. `-sourced `lib/json.sh` and `_common.sh` references from a `.sh` source's text. */
function extractShImports(text: string): { target: string }[] {
  const targets = new Set<string>();
  for (const rawLine of normalizeContent(text).split("\n")) {
    const line = rawLine.trim();
    if (!(line.startsWith("source ") || line.startsWith(". "))) continue;
    if (line.includes("lib/json.sh")) targets.add("scripts/lib/json.sh");
    if (line.includes("_common.sh")) targets.add(".claude/hooks/_common.sh");
  }
  return Array.from(targets).sort().map((target) => ({ target }));
}

/**
 * Extracts import/source dependencies from a source file's text, dispatching
 * on `sourcePath`'s extension. For `.ts` sources: lines matching a relative
 * `import ... from "./x"` / `"../y"` (anchored, non-backtracking regex per
 * line), resolved against `sourcePath`'s directory into a forward-slashed,
 * repo-relative path via `node:path`'s posix module (platform-independent
 * regardless of host OS). Package/absolute imports (no leading `./` or `../`)
 * are ignored. For `.sh` sources: lines whose trimmed form starts with
 * `source ` or `. ` and mention `lib/json.sh` or `_common.sh` resolve to the
 * fixed targets `scripts/lib/json.sh` / `.claude/hooks/_common.sh`
 * respectively (the actual on-disk relative path in shell is not statically
 * resolvable in general, e.g. `$(dirname "$0")/...`, so this is a
 * name-based match, not a path computation). Any other extension returns `[]`.
 */
export function extractImports(text: string, sourcePath: string): { target: string }[] {
  if (sourcePath.endsWith(".ts")) return extractTsImports(text, sourcePath);
  if (sourcePath.endsWith(".sh")) return extractShImports(text);
  return [];
}

// ==========================================================================
// Graph
// ==========================================================================

/** The system map graph: nodes/edges plus id-indexed incoming/outgoing edge lookups. */
export interface SystemMapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  incoming: Map<string, MapEdge[]>;
  outgoing: Map<string, MapEdge[]>;
}

/**
 * Builds a {@link SystemMapGraph} from a flat node and edge list, indexing
 * edges by both endpoints for O(1) lookup. Every node id is pre-seeded with
 * empty incoming/outgoing arrays so `graph.incoming.get(id)` is never
 * undefined for a known node; edges whose endpoint isn't in `nodes` still get
 * an entry lazily (see {@link findDanglingRefs} for detecting that case).
 */
export function buildGraph(nodes: MapNode[], edges: MapEdge[]): SystemMapGraph {
  const incoming = new Map<string, MapEdge[]>();
  const outgoing = new Map<string, MapEdge[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push(e);
  }
  return { nodes, edges, incoming, outgoing };
}

/**
 * Counts the number of unique nodes that transitively depend on `nodeId` —
 * i.e. nodes reachable from `nodeId` by repeatedly following incoming edges
 * (an edge `{from, to}` means `from` depends on `to`, so walking `to`'s
 * incoming edges yields its direct dependents). Plain breadth-first
 * traversal with a visited set; no scoring or weighting.
 */
export function dependents(graph: SystemMapGraph, nodeId: string): number {
  const visited = new Set<string>();
  const queue: string[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const inc = graph.incoming.get(current) || [];
    for (const e of inc) {
      if (!visited.has(e.from)) {
        visited.add(e.from);
        queue.push(e.from);
      }
    }
  }
  return visited.size;
}

// ==========================================================================
// Findings
// ==========================================================================

/**
 * Flags every `kind: "hook"` node with zero incoming edges of ANY kind as a
 * HIGH finding — a hook script that is neither wired into
 * `.claude/settings.json`'s `hooks` block (`wires` edge) nor invoked from a
 * command/skill/script (`references` edge) will silently never run.
 * Command-invoked hooks (e.g. log-activity.sh, notify-phase-change.sh) are
 * legitimate and must NOT be flagged — any incoming edge counts as wired,
 * not just `wires` (orchestrator fix after first real-repo run, 2026-07-16).
 * NOTE: `.claude/hooks/_common.sh` is a sourced library, not an invoked hook,
 * and must be classified `kind: "lib"` by the caller when building nodes.
 */
export function findUnwiredHooks(graph: SystemMapGraph): Finding[] {
  const findings: Finding[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "hook") continue;
    const wired = (graph.incoming.get(n.id) || []).length > 0;
    if (!wired) {
      findings.push({
        severity: "HIGH",
        kind: "unwired-hook",
        subject: n.id,
        detail: `Hook ${n.path} has no incoming edges — not wired in .claude/settings.json and not invoked by any command, skill, or script.`,
      });
    }
  }
  return findings;
}

/**
 * Flags every `kind: "script"` node with zero incoming edges of any kind
 * (nothing on disk references it) as a MEDIUM finding, unless its id or path
 * appears in `allowlist` (for intentionally standalone/entry-point scripts).
 */
export function findOrphanScripts(graph: SystemMapGraph, allowlist: string[]): Finding[] {
  const allow = new Set(allowlist);
  const findings: Finding[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "script") continue;
    if (allow.has(n.id) || allow.has(n.path)) continue;
    const inc = graph.incoming.get(n.id) || [];
    if (inc.length === 0) {
      findings.push({
        severity: "MEDIUM",
        kind: "orphan-script",
        subject: n.id,
        detail: `Script ${n.path} has no incoming references and is not in the orphan allowlist.`,
      });
    }
  }
  return findings;
}

/**
 * Flags every edge whose `to` endpoint has no matching node in `nodes` as a
 * HIGH finding — a reference/import/wire that points at a file the graph
 * doesn't know about (deleted, renamed, or never existed).
 */
export function findDanglingRefs(nodes: MapNode[], edges: MapEdge[]): Finding[] {
  const ids = new Set(nodes.map((n) => n.id));
  const findings: Finding[] = [];
  for (const e of edges) {
    if (!ids.has(e.to)) {
      findings.push({
        severity: "HIGH",
        kind: "dangling-ref",
        subject: e.from,
        detail: `Edge ${e.kind} from ${e.from} points to missing node ${e.to}.`,
      });
    }
  }
  return findings;
}

/**
 * Parses a manifest JSON text (expected shape `{ files: { "<path>": ... } }`)
 * and flags every node whose path starts with `scripts/`, `.claude/hooks/`,
 * `.claude/commands/`, or `.claude/skills/` but is missing from the
 * manifest's `files` keys, as a MEDIUM finding.
 */
export function findManifestGaps(manifestJsonText: string, nodes: MapNode[]): Finding[] {
  const manifest: unknown = JSON.parse(manifestJsonText);
  const files =
    manifest && typeof manifest === "object"
      ? (manifest as Record<string, unknown>).files
      : undefined;
  const fileKeys = new Set(
    files && typeof files === "object" ? Object.keys(files as Record<string, unknown>) : [],
  );
  const trackedPrefixes = ["scripts/", ".claude/hooks/", ".claude/commands/", ".claude/skills/"];
  const findings: Finding[] = [];
  for (const n of nodes) {
    if (!trackedPrefixes.some((p) => n.path.startsWith(p))) continue;
    if (!fileKeys.has(n.path)) {
      findings.push({
        severity: "MEDIUM",
        kind: "manifest-gap",
        subject: n.id,
        detail: `${n.path} is missing from the manifest's files map.`,
      });
    }
  }
  return findings;
}

/**
 * Flags every file whose content length, divided by 4 and rounded up (a
 * coarse chars-per-token estimate), exceeds `warnTokens`, as a LOW finding.
 */
export function findBloat(files: { path: string; content: string }[], warnTokens: number): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const estimate = Math.ceil(f.content.length / 4);
    if (estimate > warnTokens) {
      findings.push({
        severity: "LOW",
        kind: "bloat",
        subject: f.path,
        detail: `${f.path} is approximately ${estimate} tokens, exceeding the ${warnTokens}-token warn threshold.`,
      });
    }
  }
  return findings;
}
