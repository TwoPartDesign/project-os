#!/usr/bin/env node
// scripts/system-map.ts — CLI over scripts/lib/system-map-lib.ts.
//
// Deterministically extracts the framework wiring graph (settings.json ->
// hooks, hooks -> _common.sh, commands/skills -> scripts, scripts -> libs,
// manifest coverage) into docs/maps/, with a readiness report (orphans,
// unwired hooks, dangling refs, manifest gaps, bloat).
//
// Usage: node scripts/system-map.ts <command> [args...]
// Commands:
//   generate            build docs/maps/{system-map.md,module-graph.mmd,.maps.lock}
//   check [--heal]      re-hash inputs vs .maps.lock; drift exits 3 (or heals)
//   report [--json]     print readiness findings
//   precommit           heal from the git INDEX (not working tree), stage docs/maps
//
// ES module, native TS (Node >=22.18 type-stripping): type-only syntax, no
// enums/namespaces. Zero npm deps: node:fs/path/child_process/url only.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  normalizeContent,
  sha256,
  extractHookWiring,
  extractScriptRefs,
  extractImports,
  buildGraph,
  dependents,
  findUnwiredHooks,
  findOrphanScripts,
  findDanglingRefs,
  findManifestGaps,
  findBloat,
} from "./lib/system-map-lib.ts";
import type { MapNode, MapEdge, SystemMapGraph, Finding } from "./lib/system-map-lib.ts";
import { getProjectRoot } from "./lib/project-root.ts";

type Kind = MapNode["kind"];

/** Scripts a human intentionally left with no incoming references (entry points). */
const ORPHAN_ALLOWLIST = [
  "scripts/new-project.sh",
  "scripts/update-project.sh",
  "scripts/install-global-commands.sh",
];

/** Fallback bloat-warning threshold (tokens) when `.claude/maintenance-policy.yaml` is absent or malformed. */
const DEFAULT_BLOAT_WARN_TOKENS = 2500;

const KIND_ORDER: Kind[] = ["command", "config", "hook", "lib", "script", "skill"];
const KIND_PREFIX: Record<Kind, string> = {
  hook: "h",
  command: "c",
  skill: "sk",
  script: "s",
  lib: "l",
  config: "cfg",
};

// ==========================================================================
// Project root
// ==========================================================================


// ==========================================================================
// Classification (path -> kind, path -> id) — single source of truth used by
// both node construction and the precommit/git-index discovery filter.
// ==========================================================================

/**
 * Classifies a repo-relative, forward-slash path into a graph node `kind`,
 * or returns `null` if the path falls outside the discovery set. This is
 * the sole authority for "is this path in scope" — both the working-tree
 * walkers and the git-index `ls-files` filter delegate to it, so the two
 * discovery modes can never disagree about what counts as an input.
 */
function classify(path: string): Kind | null {
  if (path === ".claude/settings.json" || path === ".claude/manifest.json") return "config";
  if (path === ".claude/hooks/_common.sh") return "lib";
  if (path.startsWith(".claude/hooks/") && path.endsWith(".sh")) {
    if (!path.slice(".claude/hooks/".length).includes("/")) return "hook";
    return null;
  }
  if (path.startsWith(".claude/commands/") && path.endsWith(".md")) return "command";
  if (path.startsWith(".claude/skills/") && path.endsWith(".md")) return "skill";
  if (path.startsWith("scripts/lib/")) {
    if (!path.slice("scripts/lib/".length).includes("/")) return "lib";
    return null;
  }
  if (path.startsWith("scripts/") && (path.endsWith(".sh") || path.endsWith(".ts"))) {
    if (!path.slice("scripts/".length).includes("/")) return "script";
    return null;
  }
  if (path.startsWith("tests/")) {
    if (!path.slice("tests/".length).includes("/")) return "script";
    return null;
  }
  return null;
}

/** Strips the kind's canonical directory prefix and file extension, then slugifies what remains. */
function slugify(kind: Kind, path: string): string {
  let rest: string;
  switch (kind) {
    case "hook":
      rest = path.slice(".claude/hooks/".length);
      break;
    case "command":
      rest = path.slice(".claude/commands/".length);
      break;
    case "skill":
      rest = path.slice(".claude/skills/".length);
      break;
    case "config":
      rest = path.slice(".claude/".length);
      break;
    case "lib":
      rest =
        path === ".claude/hooks/_common.sh"
          ? path.slice(".claude/hooks/".length)
          : path.slice("scripts/lib/".length);
      break;
    case "script":
      rest = path.startsWith("scripts/") ? path.slice("scripts/".length) : path.slice("tests/".length);
      break;
  }
  const noExt = rest.replace(/\.[^./]+$/, "");
  const slug = noExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug : "root";
}

/** Assigns the stable, caller-side node id `<kindPrefix>_<path-derived-slug>` (e.g. `h_pre_compact`). */
function idFor(kind: Kind, path: string): string {
  return `${KIND_PREFIX[kind]}_${slugify(kind, path)}`;
}

/** Replaces every character Mermaid can't use in a bare node id (used only for rendering, never for graph identity). */
function mermaidSafeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

// ==========================================================================
// Content sources — working tree (generate/check/report) vs git index (precommit)
// ==========================================================================

/** Uniform read/discover interface so `build()` never knows which source it's reading from. */
interface ContentSource {
  /** Sorted, repo-relative, forward-slash paths of every in-scope input. */
  discover(): string[];
  /** Normalized file content, or `null` if the path doesn't exist in this source. */
  readInput(path: string): string | null;
  /** Sorted, repo-relative `.md` file paths directly inside `dirPath` (non-recursive). */
  listDir(dirPath: string): string[];
}

/** Reads inputs from the on-disk working tree, via targeted (non-recursive except commands/skills) directory walks. */
function workingTreeSource(root: string): ContentSource {
  const abs = (p: string) => resolve(root, p);

  function addFlat(dir: string, exts: string[] | null, results: Set<string>): void {
    const full = abs(dir);
    if (!existsSync(full)) return;
    for (const ent of readdirSync(full, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (exts && !exts.some((e) => ent.name.endsWith(e))) continue;
      results.add(`${dir}/${ent.name}`);
    }
  }

  function addRecursive(dir: string, exts: string[], results: Set<string>): void {
    const full = abs(dir);
    if (!existsSync(full)) return;
    const stack: string[] = [dir];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const ent of readdirSync(abs(cur), { withFileTypes: true })) {
        const rel = `${cur}/${ent.name}`;
        if (ent.isDirectory()) {
          stack.push(rel);
          continue;
        }
        if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) results.add(rel);
      }
    }
  }

  return {
    discover(): string[] {
      const results = new Set<string>();
      for (const f of [".claude/settings.json", ".claude/manifest.json"]) {
        if (existsSync(abs(f))) results.add(f);
      }
      addFlat(".claude/hooks", [".sh"], results);
      addFlat("scripts", [".sh", ".ts"], results);
      addFlat("scripts/lib", null, results);
      addFlat("tests", null, results);
      addRecursive(".claude/commands", [".md"], results);
      addRecursive(".claude/skills", [".md"], results);
      return Array.from(results).sort();
    },
    readInput(path: string): string | null {
      const full = abs(path);
      if (!existsSync(full)) return null;
      try {
        return normalizeContent(readFileSync(full, "utf-8"));
      } catch {
        return null;
      }
    },
    listDir(dirPath: string): string[] {
      const full = abs(dirPath);
      if (!existsSync(full)) return [];
      return readdirSync(full, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => `${dirPath}/${e.name}`)
        .sort();
    },
  };
}

/**
 * Reads inputs from the git INDEX (staged content), never the working tree —
 * used by `precommit` so a partially staged file contributes exactly its
 * staged blob. Uses execFileSync (no shell) throughout so the `:path`
 * argument to `git show` can never be MSYS-mangled on Windows.
 */
function gitIndexSource(root: string): ContentSource {
  let cachedPaths: string[] | null = null;

  function lsFiles(): string[] {
    if (cachedPaths) return cachedPaths;
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8" });
    cachedPaths = out
      .split("\0")
      .filter((p) => p.length > 0)
      .map((p) => p.replace(/\\/g, "/"));
    return cachedPaths;
  }

  return {
    discover(): string[] {
      return lsFiles()
        .filter((p) => classify(p) !== null)
        .sort();
    },
    readInput(path: string): string | null {
      try {
        const out = execFileSync("git", ["show", ":" + path], { cwd: root, encoding: "utf-8" });
        return normalizeContent(out);
      } catch {
        return null;
      }
    },
    listDir(dirPath: string): string[] {
      const prefix = dirPath + "/";
      return lsFiles()
        .filter((p) => p.startsWith(prefix) && p.endsWith(".md") && !p.slice(prefix.length).includes("/"))
        .sort();
    },
  };
}

// ==========================================================================
// Bloat inputs (CLAUDE.md + docs/knowledge/*.md) — read separately from the
// hashed .maps.lock input set; these files aren't graph nodes.
// ==========================================================================

/** Collects CLAUDE.md plus every `docs/knowledge/*.md` file's normalized content for bloat estimation. */
function collectBloatFiles(source: ContentSource): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const claude = source.readInput("CLAUDE.md");
  if (claude !== null) files.push({ path: "CLAUDE.md", content: claude });
  for (const p of source.listDir("docs/knowledge")) {
    const c = source.readInput(p);
    if (c !== null) files.push({ path: p, content: c });
  }
  return files;
}

/**
 * Reads `bloat_warn_tokens` from `.claude/maintenance-policy.yaml` if present
 * and valid (`^[0-9]+$`, trailing `#` comment stripped); otherwise falls back
 * to {@link DEFAULT_BLOAT_WARN_TOKENS}. Line-by-line, bounded parsing — no
 * YAML library, matches the linear-parse mandate.
 */
function loadBloatThreshold(source: ContentSource): number {
  const text = source.readInput(".claude/maintenance-policy.yaml");
  if (text === null) return DEFAULT_BLOAT_WARN_TOKENS;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("bloat_warn_tokens:")) continue;
    let val = line.slice("bloat_warn_tokens:".length).trim();
    const hashIdx = val.indexOf("#");
    if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    return /^[0-9]+$/.test(val) ? parseInt(val, 10) : DEFAULT_BLOAT_WARN_TOKENS;
  }
  return DEFAULT_BLOAT_WARN_TOKENS;
}

// ==========================================================================
// Findings ordering
// ==========================================================================

/** Sorts findings by (kind, subject, severity, detail) for byte-identical repeated runs. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
    if (a.severity !== b.severity) return a.severity < b.severity ? -1 : 1;
    if (a.detail !== b.detail) return a.detail < b.detail ? -1 : 1;
    return 0;
  });
}

// ==========================================================================
// Build
// ==========================================================================

interface BuildResult {
  nodes: MapNode[];
  edges: MapEdge[];
  graph: SystemMapGraph;
  findings: Finding[];
  inputs: Record<string, string>;
}

/** Discovers inputs, hashes them, and returns `{path: sha256}` sorted by path. Does not build the graph. */
function computeInputs(source: ContentSource): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const p of source.discover()) {
    const c = source.readInput(p);
    if (c === null) continue;
    inputs[p] = sha256(c);
  }
  return inputs;
}

/**
 * Builds the full system map: discovers inputs, constructs nodes/edges from
 * the extractors in system-map-lib, runs every `find*` audit, and returns a
 * deterministic (sorted) result. Content is read once and reused for both
 * hashing and extraction. Never writes anything — see {@link writeArtifacts}.
 */
/**
 * Reads every discoverable input, returning normalized content by path and a
 * sorted-key hash map (`inputs`) for the lockfile. `readInput` already
 * normalizes; `sha256` hashes the normalized bytes.
 */
function readInputs(source: ContentSource): {
  contents: Map<string, string>;
  inputs: Record<string, string>;
} {
  const contents = new Map<string, string>();
  const inputs: Record<string, string> = {};
  for (const p of source.discover()) {
    const c = source.readInput(p);
    if (c === null) continue;
    contents.set(p, c);
    inputs[p] = sha256(c);
  }
  return { contents, inputs };
}

/** Builds the sorted node list from classified input paths. */
function buildNodes(contents: Map<string, string>): MapNode[] {
  const nodes: MapNode[] = [];
  for (const p of contents.keys()) {
    const kind = classify(p);
    if (!kind) continue;
    nodes.push({ id: idFor(kind, p), kind, path: p });
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return nodes;
}

/**
 * Builds the sorted edge list: settings→hook `wires`, command/skill→script
 * `references`, and script/lib/hook `imports`/`sources`. Edge targets that
 * resolve to a known node use its id; unknown targets keep the raw path so
 * `findDanglingRefs` can flag them.
 */
function buildEdges(nodes: MapNode[], contents: Map<string, string>): MapEdge[] {
  const pathToId = new Map(nodes.map((n) => [n.path, n.id]));
  const edges: MapEdge[] = [];

  const settingsContent = contents.get(".claude/settings.json");
  const settingsId = pathToId.get(".claude/settings.json");
  if (settingsContent !== undefined && settingsId) {
    for (const hookPath of extractHookWiring(settingsContent)) {
      edges.push({ from: settingsId, to: pathToId.get(hookPath) ?? hookPath, kind: "wires" });
    }
  }

  for (const n of nodes) {
    if (n.kind !== "command" && n.kind !== "skill") continue;
    for (const ref of extractScriptRefs(contents.get(n.path)!, n.path)) {
      edges.push({ from: n.id, to: pathToId.get(ref.target) ?? ref.target, kind: "references" });
    }
  }

  for (const n of nodes) {
    if (n.kind !== "script" && n.kind !== "lib" && n.kind !== "hook") continue;
    const importKind: MapEdge["kind"] = n.path.endsWith(".sh") ? "sources" : "imports";
    for (const im of extractImports(contents.get(n.path)!, n.path)) {
      edges.push({ from: n.id, to: pathToId.get(im.target) ?? im.target, kind: importKind });
    }
  }

  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  return edges;
}

/** Runs all finders over the graph and returns a sorted, deduplicated set. */
function runFindings(
  source: ContentSource,
  nodes: MapNode[],
  edges: MapEdge[],
  graph: SystemMapGraph,
  contents: Map<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  findings.push(...findUnwiredHooks(graph));
  // Tests are entry points by definition (invoked by npm test / manually) —
  // exclude them from orphan candidacy instead of allowlisting each by name.
  const pathById = new Map(nodes.map((n) => [n.id, n.path]));
  findings.push(
    ...findOrphanScripts(graph, ORPHAN_ALLOWLIST).filter(
      (f) => !(pathById.get(f.subject) || "").startsWith("tests/")
    )
  );
  findings.push(...findDanglingRefs(nodes, edges));

  const manifestContent = contents.get(".claude/manifest.json");
  if (manifestContent !== undefined) {
    try {
      findings.push(...findManifestGaps(manifestContent, nodes));
    } catch {
      // Malformed manifest — skip this one check rather than aborting the whole build.
    }
  }

  findings.push(...findBloat(collectBloatFiles(source), loadBloatThreshold(source)));
  return sortFindings(findings);
}

/** Orchestrates a full build: read inputs → nodes → edges → graph → findings. */
function build(source: ContentSource): BuildResult {
  const { contents, inputs } = readInputs(source);
  const nodes = buildNodes(contents);
  const edges = buildEdges(nodes, contents);
  const graph = buildGraph(nodes, edges);
  const findings = runFindings(source, nodes, edges, graph, contents);
  return { nodes, edges, graph, findings, inputs };
}

// ==========================================================================
// Rendering
// ==========================================================================

/** Renders `docs/maps/system-map.md`: generated-header, nodes by kind with dependent counts, edges, findings. */
function renderMarkdown(result: BuildResult): string {
  const lines: string[] = [];
  lines.push("<!-- GENERATED by scripts/system-map.ts — do not hand-edit -->");
  lines.push("");
  lines.push("# System Map");
  lines.push("");
  lines.push("## Nodes");
  for (const kind of KIND_ORDER) {
    const kindNodes = result.nodes.filter((n) => n.kind === kind);
    if (kindNodes.length === 0) continue;
    lines.push("");
    lines.push(`### ${kind}`);
    for (const n of kindNodes) {
      const dep = dependents(result.graph, n.id);
      lines.push(`- \`${n.id}\` — \`${n.path}\` (${dep} dependent${dep === 1 ? "" : "s"})`);
    }
  }
  lines.push("");
  lines.push("## Edges");
  lines.push("");
  if (result.edges.length === 0) {
    lines.push("(none)");
  } else {
    for (const e of result.edges) {
      lines.push(`- \`${e.from}\` --${e.kind}--> \`${e.to}\``);
    }
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of result.findings) {
      lines.push(`- ${f.severity} ${f.kind} ${f.subject} — ${f.detail}`);
    }
  }
  return normalizeContent(lines.join("\n"));
}

/** Renders `docs/maps/module-graph.mmd`: `flowchart LR` with one subgraph per kind, stable slug node ids. */
function renderMermaid(result: BuildResult): string {
  const lines: string[] = ["flowchart LR"];
  for (const kind of KIND_ORDER) {
    const kindNodes = result.nodes.filter((n) => n.kind === kind);
    if (kindNodes.length === 0) continue;
    lines.push(`  subgraph ${kind}`);
    for (const n of kindNodes) {
      lines.push(`    ${mermaidSafeId(n.id)}["${n.path}"]`);
    }
    lines.push("  end");
  }
  for (const e of result.edges) {
    lines.push(`  ${mermaidSafeId(e.from)} -->|${e.kind}| ${mermaidSafeId(e.to)}`);
  }
  return normalizeContent(lines.join("\n"));
}

/** Renders `docs/maps/.maps.lock`: `{generator_version, inputs}` JSON, 2-space indent, sorted keys, trailing newline. */
function renderLock(inputs: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(inputs).sort()) sorted[k] = inputs[k];
  return normalizeContent(JSON.stringify({ generator_version: 1, inputs: sorted }, null, 2));
}

/** Writes all three generated artifacts under `docs/maps/`, creating the directory if needed. */
function writeArtifacts(root: string, result: BuildResult): void {
  const dir = resolve(root, "docs/maps");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "system-map.md"), renderMarkdown(result), "utf-8");
  writeFileSync(resolve(dir, "module-graph.mmd"), renderMermaid(result), "utf-8");
  writeFileSync(resolve(dir, ".maps.lock"), renderLock(result.inputs), "utf-8");
}

// ==========================================================================
// check — drift detection
// ==========================================================================

/** Reads `docs/maps/.maps.lock`'s `inputs` map from the working tree, or `{}` if absent/malformed. */
function readLockInputs(lockPath: string): Record<string, string> {
  if (!existsSync(lockPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
    return parsed && typeof parsed === "object" && parsed.inputs && typeof parsed.inputs === "object"
      ? (parsed.inputs as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** Returns sorted `"added: <path>" | "removed: <path>" | "changed: <path>"` lines describing input drift. */
function diffInputs(current: Record<string, string>, lock: Record<string, string>): string[] {
  const results: string[] = [];
  const allPaths = new Set([...Object.keys(current), ...Object.keys(lock)]);
  for (const p of Array.from(allPaths).sort()) {
    const c = current[p];
    const l = lock[p];
    if (c === undefined) results.push(`removed: ${p}`);
    else if (l === undefined) results.push(`added: ${p}`);
    else if (c !== l) results.push(`changed: ${p}`);
  }
  return results;
}

// ==========================================================================
// Subcommands
// ==========================================================================

/** `generate`: build the graph from the working tree and write all three artifacts. */
function cmdGenerate(root: string): void {
  const result = build(workingTreeSource(root));
  writeArtifacts(root, result);
  console.log("map: generated");
}

/** `check [--heal]`: re-hash working-tree inputs vs `.maps.lock`; drift exits 3 unless `--heal` regenerates. */
function cmdCheck(root: string, heal: boolean): void {
  const source = workingTreeSource(root);
  const current = computeInputs(source);
  const lockInputs = readLockInputs(resolve(root, "docs/maps/.maps.lock"));
  const diff = diffInputs(current, lockInputs);

  if (diff.length === 0) {
    console.log("map: fresh");
    process.exit(0);
  }

  if (!heal) {
    console.log("map: drift");
    for (const line of diff) console.log(`  ${line}`);
    process.exit(3);
  }

  const result = build(source);
  writeArtifacts(root, result);
  console.log("map: healed");
  process.exit(0);
}

/** `report [--json]`: prints readiness findings (human lines or a JSON array). Always exits 0 on success. */
function cmdReport(root: string, json: boolean): void {
  const result = build(workingTreeSource(root));
  if (json) {
    console.log(JSON.stringify(result.findings, null, 2));
  } else if (result.findings.length === 0) {
    console.log("map: no findings");
  } else {
    for (const f of result.findings) {
      console.log(`${f.severity} ${f.kind} ${f.subject} — ${f.detail}`);
    }
  }
  process.exit(0);
}

/**
 * `precommit`: reads every input from the git INDEX (never the working
 * tree). Fresh vs the committed `.maps.lock` -> silent exit 0. On drift,
 * regenerates all three artifacts from the index content, writes them to
 * the working tree, `git add`s `docs/maps` only, then (if
 * scripts/security-scanner.ts exists) runs a scoped `scan-files` over the
 * three map artifacts explicitly (scan-files cannot read directories) —
 * a nonzero scan exits 1. Healed -> prints `map: healed and staged`.
 */
function cmdPrecommit(root: string): void {
  const source = gitIndexSource(root);

  let lockText: string | null;
  try {
    lockText = source.readInput("docs/maps/.maps.lock");
  } catch {
    lockText = null;
  }

  const currentInputs = computeInputs(source);
  let lockInputs: Record<string, string> = {};
  let parseOk = false;
  if (lockText !== null) {
    try {
      const parsed = JSON.parse(lockText);
      if (parsed && typeof parsed === "object" && parsed.inputs && typeof parsed.inputs === "object") {
        lockInputs = parsed.inputs as Record<string, string>;
        parseOk = true;
      }
    } catch {
      parseOk = false;
    }
  }

  const fresh = parseOk && diffInputs(currentInputs, lockInputs).length === 0;
  if (fresh) {
    process.exit(0);
  }

  const result = build(source);
  writeArtifacts(root, result);

  execFileSync("git", ["add", "docs/maps"], { cwd: root });

  const scannerPath = resolve(root, "scripts/security-scanner.ts");
  if (existsSync(scannerPath)) {
    // Explicit file list — scan-files cannot read a directory (EISDIR),
    // which silently skipped the healed content when passed "docs/maps".
    execFileSync(
      "node",
      [
        "scripts/security-scanner.ts",
        "scan-files",
        "docs/maps/system-map.md",
        "docs/maps/module-graph.mmd",
        "docs/maps/.maps.lock",
      ],
      { cwd: root, stdio: "inherit" }
    );
  }

  console.log("map: healed and staged");
  process.exit(0);
}

// ==========================================================================
// Main (only runs when executed directly, not when imported)
// ==========================================================================

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const root = getProjectRoot();

  try {
    switch (cmd) {
      case "generate":
        cmdGenerate(root);
        break;
      case "check":
        cmdCheck(root, argv.includes("--heal"));
        break;
      case "report":
        cmdReport(root, argv.includes("--json"));
        break;
      case "precommit":
        cmdPrecommit(root);
        break;
      default:
        console.error("Usage: node scripts/system-map.ts <generate|check [--heal]|report [--json]|precommit>");
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
