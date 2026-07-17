#!/usr/bin/env node
// scripts/detect-stack.ts — Deterministic tech-stack detection (Node 22 stdlib only)
//
// Reads only: manifest/lockfile *presence* on disk plus parsed dependency-key
// tables from package.json and a line-scan of pyproject.toml. NEVER executes
// anything in the target repo — no execSync/spawn/network, ever. This is a
// pure filesystem-read + JSON.parse/string-scan operation, consumed by
// `/tools:init` Step 1b and the adopt flow (see design.md §Key Interfaces).
//
// Usage: node scripts/detect-stack.ts [root]   (default: cwd)
// Output: single JSON object to stdout (see DetectionResult), exit 0 always
//         — malformed inputs degrade to null fields + a `parse-error:<file>`
//         signal rather than throwing.
//
// Security posture (Denylist-Before-Emit): `signals` carries file/key NAMES
// only — dependency *values* (versions, scripts, arbitrary manifest fields)
// are never read into any output field. This is enforced by construction:
// the code only ever calls `Object.prototype.hasOwnProperty` against known
// key tables and pushes the key name itself, never a value pulled from the
// parsed manifest.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Type Definitions (exported for tests)
// ============================================================================

export interface DetectionResult {
  language: string | null;
  package_manager: string | null;
  framework: string | null;
  database: string | null;
  test_runner: string | null;
  formatter: string | null;
  confidence: "high" | "medium" | "low";
  signals: string[];
  fallback_used: boolean;
}

// ============================================================================
// Fixed tables (spec-driven, first match in list order wins per category)
// ============================================================================

/** Directories never descended into, at any tier. */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "vendor", ".venv", "target"]);

// Shared across both the package.json dependency lookup (JS ecosystem) and
// the pyproject.toml line-scan (Python ecosystem) — the spec lists these as
// one combined table per category, so python-only keys (fastapi/django/flask,
// pytest, black/ruff) simply never match against package.json deps, and
// JS-only keys (next/react/... etc.) simply never match a pyproject.toml line.
const FRAMEWORK_KEYS = ["next", "react", "vue", "express", "fastify", "fastapi", "django", "flask"];
const TEST_RUNNER_KEYS = ["vitest", "jest", "mocha", "pytest"];
const FORMATTER_KEYS = ["prettier", "eslint", "black", "ruff"];
// Database table is npm-package-name only — no python equivalent in the spec.
const DATABASE_KEYS = ["prisma", "pg", "sqlite3", "better-sqlite3", "mongoose"];

// Tier 2: lockfile -> package manager. First match in this order wins.
const LOCKFILE_TABLE: Array<[string, string]> = [
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
];

// ============================================================================
// Small filesystem helpers (read-only; never throw)
// ============================================================================

function safeExists(root: string, name: string): boolean {
  return existsSync(join(root, name));
}

/** Directory listing that degrades to an empty array on any read error (permissions, race, etc). */
function listDir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function isDirectory(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

// ============================================================================
// Tier 1: manifests -> language (exported for tests)
// ============================================================================

/**
 * Root-level (+1 level for `*.csproj`/`*.sln`) scan for a C# project file,
 * skipping `SKIP_DIRS`. Entries are sorted before comparison so the result
 * is deterministic regardless of the OS's native directory-listing order.
 * Returns the matched file's path relative to `root` (name only — never
 * file contents), or null if none found.
 */
export function findCsharpProjectFile(root: string): string | null {
  const isCsProjOrSln = (name: string) => name.endsWith(".csproj") || name.endsWith(".sln");

  const rootEntries = listDir(root).sort();
  for (const entry of rootEntries) {
    if (SKIP_DIRS.has(entry)) continue;
    if (isCsProjOrSln(entry)) return entry;
  }

  for (const entry of rootEntries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    if (!isDirectory(full)) continue;
    const subEntries = listDir(full).sort();
    for (const sub of subEntries) {
      if (isCsProjOrSln(sub)) return `${entry}/${sub}`;
    }
  }

  return null;
}

/**
 * Tier 1: detect `language` from root-level manifest files, first match
 * wins (Nixpacks-style fixed priority order): package.json (tsconfig.json
 * presence distinguishes typescript vs javascript) -> pyproject.toml /
 * setup.py / requirements.txt (python) -> go.mod (go) -> Cargo.toml (rust)
 * -> Gemfile (ruby) -> composer.json (php) -> *.csproj/*.sln (csharp).
 *
 * Assumption (documented per task's "on ambiguity, simplest choice" rule):
 * language detection depends only on manifest *presence*, not validity —
 * a syntactically-broken package.json still signals a JS/TS project via
 * Tier 1 (file existence), it just yields null Tier-3 fields (see
 * `detectFromPackageJson`) plus a `parse-error:package.json` signal.
 *
 * Mutates `signals` with the matched file name(s) — names only, never file
 * contents or manifest values.
 */
export function detectLanguage(root: string, signals: string[]): string | null {
  if (safeExists(root, "package.json")) {
    signals.push("package.json");
    if (safeExists(root, "tsconfig.json")) {
      signals.push("tsconfig.json");
      return "typescript";
    }
    return "javascript";
  }
  if (safeExists(root, "pyproject.toml")) {
    signals.push("pyproject.toml");
    return "python";
  }
  if (safeExists(root, "setup.py")) {
    signals.push("setup.py");
    return "python";
  }
  if (safeExists(root, "requirements.txt")) {
    signals.push("requirements.txt");
    return "python";
  }
  if (safeExists(root, "go.mod")) {
    signals.push("go.mod");
    return "go";
  }
  if (safeExists(root, "Cargo.toml")) {
    signals.push("Cargo.toml");
    return "rust";
  }
  if (safeExists(root, "Gemfile")) {
    signals.push("Gemfile");
    return "ruby";
  }
  if (safeExists(root, "composer.json")) {
    signals.push("composer.json");
    return "php";
  }
  const csFile = findCsharpProjectFile(root);
  if (csFile) {
    signals.push(csFile);
    return "csharp";
  }
  return null;
}

// ============================================================================
// Tier 2: lockfiles -> package manager (exported for tests)
// ============================================================================

/**
 * Tier 2: detect `package_manager` from root-level lockfiles, first match
 * in `LOCKFILE_TABLE` order wins. Independent of Tier 1 — a lockfile alone
 * (no recognized manifest) is possible but yields `confidence: "low"`
 * overall, since confidence is keyed off manifest (Tier 1) presence.
 */
export function detectPackageManager(root: string, signals: string[]): string | null {
  for (const [file, pm] of LOCKFILE_TABLE) {
    if (safeExists(root, file)) {
      signals.push(file);
      return pm;
    }
  }
  return null;
}

// ============================================================================
// Tier 3: dependency-key tables (exported for tests)
// ============================================================================

export interface PackageJsonTier3 {
  framework: string | null;
  test_runner: string | null;
  formatter: string | null;
  database: string | null;
}

/**
 * Tier 3 (JS ecosystem): reads `dependencies` + `devDependencies` from
 * package.json and matches against the fixed keyword tables, first match in
 * table order wins per category (deps checked before devDeps for a given
 * key, so an app dependency outranks the same package appearing as a dev
 * dependency). Only dependency *key names* are ever read into `signals`
 * (format `deps:<name>` / `devDeps:<name>`, mirroring design.md's example)
 * — dependency version strings and every other manifest field are never
 * touched, so secrets planted anywhere in package.json (including as a
 * matched dependency's version value) cannot leak into the output.
 *
 * On read/parse failure (missing file, invalid JSON, or a non-object root),
 * pushes `parse-error:package.json` and returns all-null fields; never
 * throws.
 */
export function detectFromPackageJson(root: string, signals: string[]): PackageJsonTier3 {
  const empty: PackageJsonTier3 = { framework: null, test_runner: null, formatter: null, database: null };
  const path = join(root, "package.json");
  if (!existsSync(path)) return empty;

  let parsed: unknown;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    signals.push("parse-error:package.json");
    return empty;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    signals.push("parse-error:package.json");
    return empty;
  }

  const obj = parsed as Record<string, unknown>;
  const deps = isPlainRecord(obj.dependencies) ? (obj.dependencies as Record<string, unknown>) : {};
  const devDeps = isPlainRecord(obj.devDependencies) ? (obj.devDependencies as Record<string, unknown>) : {};

  const lookup = (keys: string[]): { value: string | null; source: "deps" | "devDeps" | null } => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(deps, key)) return { value: key, source: "deps" };
      if (Object.prototype.hasOwnProperty.call(devDeps, key)) return { value: key, source: "devDeps" };
    }
    return { value: null, source: null };
  };

  const result: PackageJsonTier3 = { framework: null, test_runner: null, formatter: null, database: null };

  const fw = lookup(FRAMEWORK_KEYS);
  if (fw.value) {
    result.framework = fw.value;
    signals.push(`${fw.source}:${fw.value}`);
  }
  const tr = lookup(TEST_RUNNER_KEYS);
  if (tr.value) {
    result.test_runner = tr.value;
    signals.push(`${tr.source}:${tr.value}`);
  }
  const fmt = lookup(FORMATTER_KEYS);
  if (fmt.value) {
    result.formatter = fmt.value;
    signals.push(`${fmt.source}:${fmt.value}`);
  }
  const db = lookup(DATABASE_KEYS);
  if (db.value) {
    result.database = db.value;
    signals.push(`${db.source}:${db.value}`);
  }

  return result;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export interface PyProjectTier3 {
  framework: string | null;
  test_runner: string | null;
  formatter: string | null;
}

/**
 * Tier 3 (Python ecosystem): pyproject.toml has no TOML parser available
 * (spec constraint — zero npm deps, stdlib only), so this scans the file
 * line-by-line for a word-boundary, case-insensitive match against the same
 * keyword tables used for package.json — this naturally also catches
 * `[tool.pytest.ini_options]` / `[tool.black]` / `[tool.ruff]` section
 * headers (which contain the keyword as a literal substring) without a
 * separate section-header code path.
 *
 * Assumption (documented): only pyproject.toml is line-scanned for Tier 3 —
 * requirements.txt is used for Tier 1 language detection only, not Tier 3,
 * to keep the two tiers' file sets simple and match the spec's explicit
 * "pyproject tool sections via line scan" wording.
 *
 * Only the matched keyword *name* is pushed into `signals` (format
 * `pyproject:<name>`) — raw file lines are never emitted, so no manifest
 * content (including any planted secret) can leak into the output.
 */
export function detectFromPyProject(root: string, signals: string[]): PyProjectTier3 {
  const empty: PyProjectTier3 = { framework: null, test_runner: null, formatter: null };
  const path = join(root, "pyproject.toml");
  if (!existsSync(path)) return empty;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    signals.push("parse-error:pyproject.toml");
    return empty;
  }

  const lowerLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.toLowerCase());

  const findKeyword = (keys: string[]): string | null => {
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      if (lowerLines.some((l) => re.test(l))) return key;
    }
    return null;
  };

  const result: PyProjectTier3 = { framework: null, test_runner: null, formatter: null };

  const fw = findKeyword(FRAMEWORK_KEYS);
  if (fw) {
    result.framework = fw;
    signals.push(`pyproject:${fw}`);
  }
  const tr = findKeyword(TEST_RUNNER_KEYS);
  if (tr) {
    result.test_runner = tr;
    signals.push(`pyproject:${tr}`);
  }
  const fmt = findKeyword(FORMATTER_KEYS);
  if (fmt) {
    result.formatter = fmt;
    signals.push(`pyproject:${fmt}`);
  }

  return result;
}

// ============================================================================
// Main detection entry point (exported for tests)
// ============================================================================

/**
 * Runs the full 3-tier detection pass over `root` and returns a single
 * `DetectionResult`. Never throws — every sub-step degrades to null fields
 * plus a `parse-error:<file>` signal on read/parse failure.
 *
 * `confidence`: "high" when both a Tier-1 manifest and a Tier-2 lockfile
 * matched, "medium" when only a manifest matched, "low" when neither did.
 *
 * `fallback_used` (assumption, documented — the spec defines the census
 * fallback as caller-side markdown instructions, not code here): mirrors
 * `confidence === "low"`, i.e. true exactly when no Tier-1 manifest matched
 * at all, which is the condition under which `/tools:init` falls back to
 * the extension-census heuristic.
 */
export function detectStack(root: string): DetectionResult {
  const resolvedRoot = resolve(root);
  const signals: string[] = [];

  const language = detectLanguage(resolvedRoot, signals);
  const package_manager = detectPackageManager(resolvedRoot, signals);

  let framework: string | null = null;
  let test_runner: string | null = null;
  let formatter: string | null = null;
  let database: string | null = null;

  if (existsSync(join(resolvedRoot, "package.json"))) {
    const tier3 = detectFromPackageJson(resolvedRoot, signals);
    framework = tier3.framework;
    test_runner = tier3.test_runner;
    formatter = tier3.formatter;
    database = tier3.database;
  }

  if (existsSync(join(resolvedRoot, "pyproject.toml"))) {
    const pyTier3 = detectFromPyProject(resolvedRoot, signals);
    // package.json (JS ecosystem) already checked first above — only fill
    // fields Tier 3 hasn't already set, so a mixed repo doesn't let python
    // keywords clobber a JS match.
    if (framework === null) framework = pyTier3.framework;
    if (test_runner === null) test_runner = pyTier3.test_runner;
    if (formatter === null) formatter = pyTier3.formatter;
  }

  const confidence: "high" | "medium" | "low" =
    language !== null && package_manager !== null ? "high" : language !== null ? "medium" : "low";

  const fallback_used = confidence === "low";

  return {
    language,
    package_manager,
    framework,
    database,
    test_runner,
    formatter,
    confidence,
    signals,
    fallback_used,
  };
}

// ============================================================================
// CLI (only runs when executed directly, not when imported)
// ============================================================================

const FALLBACK_RESULT: DetectionResult = {
  language: null,
  package_manager: null,
  framework: null,
  database: null,
  test_runner: null,
  formatter: null,
  confidence: "low",
  signals: ["unexpected-error"],
  fallback_used: true,
};

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  const argv = process.argv.slice(2);
  const root = argv[0] ? resolve(argv[0]) : process.cwd();

  // Belt-and-suspenders: every sub-step above already catches its own
  // errors, but detection must never exit non-zero, so a top-level guard
  // falls back to a minimal structured result rather than letting anything
  // unexpected escape to a stack trace on stderr + non-zero exit.
  let result: DetectionResult;
  try {
    result = detectStack(root);
  } catch {
    result = FALLBACK_RESULT;
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
