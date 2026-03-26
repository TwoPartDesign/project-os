#!/usr/bin/env node
// knowledge-index.ts — FTS5-powered knowledge base indexing and search
// Usage: node scripts/knowledge-index.ts <command> [args...]
// Commands: index, index-vault, search, rebuild, stats, stale, config
// Requires Node 22.16+ for node:sqlite

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, mkdirSync, statSync, readdirSync, renameSync, realpathSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================================
// Type Definitions
// ============================================================================

interface FreshnessMetadata {
  source_type: "knowledge" | "spec" | "other";
  content_date: string | null;
  retrieved_at: string;
  freshness_confidence: "high" | "medium" | "low";
  last_validated: string | null;
}

interface ChunkMetadata {
  source: string;
  heading: string;
  content: string;
  chunk_type: "code" | "list" | "prose";
  indexed_at: string;
  session_id: string | null;
}

interface SearchResult {
  score: number;
  source: string;
  heading: string;
  content: string;
  chunk_type: string;
  freshness_age_days: number;
  freshness_confidence: string;
  is_stale: boolean;
}

interface IndexMetadata {
  source: string;
  last_modified: string;
  last_indexed: string;
  chunk_count: number;
  content_date: string | null;
  freshness_confidence: string;
  access_count: number;
  last_accessed: string | null;
}

// DB row types (for query results)
interface IndexMetaRow {
  last_indexed: string;
}

interface SearchRow {
  source: string;
  heading: string;
  content: string;
  chunk_type: string;
  content_date: string | null;
  freshness_confidence: string | null;
  last_validated: string | null;
  last_modified: string | null;
  access_count: number | null;
  last_accessed: string | null;
}

interface FreshnessReportRow {
  source: string;
  content_date: string | null;
  freshness_confidence: string | null;
  last_validated: string | null;
  age_days: number;
}

interface Config {
  enabled: boolean;
  threshold_bytes: number;
  index_path: string;
  max_search_results: number;
  freshness: {
    stale_threshold_days: number;
    decay_halflife_days: number;
    warn_on_stale: boolean;
    auto_detect_dates: boolean;
    recency_halflife_days: number;
  };
}

// ============================================================================
// Utilities (exported for testing)
// ============================================================================

export function getProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

export function loadConfig(): Config {
  const projectRoot = getProjectRoot();
  const settingsPath = resolve(projectRoot, ".claude/settings.json");

  const defaultConfig: Config = {
    enabled: true,
    threshold_bytes: 5120,
    index_path: ".claude/index/knowledge.db",
    max_search_results: 10,
    freshness: {
      stale_threshold_days: 90,
      decay_halflife_days: 30,
      warn_on_stale: true,
      auto_detect_dates: true,
      recency_halflife_days: 14,
    },
  };

  if (!existsSync(settingsPath)) return defaultConfig;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const ctxFilter = settings.project_os?.context_filter;
    if (!ctxFilter) return defaultConfig;

    return {
      enabled: ctxFilter.enabled ?? defaultConfig.enabled,
      threshold_bytes: ctxFilter.threshold_bytes ?? defaultConfig.threshold_bytes,
      index_path: ctxFilter.index_path ?? defaultConfig.index_path,
      max_search_results: ctxFilter.max_search_results ?? defaultConfig.max_search_results,
      freshness: {
        stale_threshold_days: ctxFilter.freshness?.stale_threshold_days ?? defaultConfig.freshness.stale_threshold_days,
        decay_halflife_days: ctxFilter.freshness?.decay_halflife_days ?? defaultConfig.freshness.decay_halflife_days,
        warn_on_stale: ctxFilter.freshness?.warn_on_stale ?? defaultConfig.freshness.warn_on_stale,
        auto_detect_dates: ctxFilter.freshness?.auto_detect_dates ?? defaultConfig.freshness.auto_detect_dates,
        recency_halflife_days: ctxFilter.freshness?.recency_halflife_days ?? defaultConfig.freshness.recency_halflife_days,
      },
    };
  } catch {
    return defaultConfig;
  }
}

function initializeDatabase(dbPath: string): DatabaseSync {
  const dbDir = dirname(dbPath);
  mkdirSync(dbDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");

  // Create FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(
      source,
      heading,
      content,
      chunk_type,
      indexed_at,
      session_id,
      tokenize = 'porter'
    )
  `);

  // Create metadata tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS freshness_meta (
      source TEXT PRIMARY KEY,
      source_type TEXT,
      content_date TEXT,
      retrieved_at TEXT,
      freshness_confidence TEXT,
      last_validated TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      source TEXT PRIMARY KEY,
      last_modified TEXT,
      last_indexed TEXT,
      chunk_count INTEGER,
      content_date TEXT,
      freshness_confidence TEXT
    )
  `);

  // Migration: add access tracking columns if missing.
  // SQLite ALTER TABLE ADD COLUMN throws if the column already exists; we catch and ignore.
  try {
    db.exec("ALTER TABLE index_meta ADD COLUMN access_count INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    db.exec("ALTER TABLE index_meta ADD COLUMN last_accessed TEXT");
  } catch { /* column already exists */ }

  // Observation metadata companion table (for --obs-type filtering)
  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_meta (
      source TEXT,
      heading TEXT,
      observation_type TEXT,
      confidence TEXT,
      line_number INTEGER,
      metadata TEXT,
      PRIMARY KEY (source, observation_type, line_number)
    )
  `);

  return db;
}

export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const lines = content.split("\n");
  if (!lines[0]?.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("---")) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const fmLines = lines.slice(1, endIdx);
  const frontmatter: Record<string, string> = {};

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > -1) {
      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      frontmatter[key] = val.replace(/^["']|["']$/g, "");
    }
  }

  return { frontmatter, body: lines.slice(endIdx + 1).join("\n") };
}

function extractDate(frontmatter: Record<string, string>, filePath: string): { date: string; confidence: "high" | "low" } {
  // First priority: YAML date field
  if (frontmatter.date) {
    return { date: frontmatter.date, confidence: "high" };
  }

  // Second priority: git first-commit date
  const projectRoot = getProjectRoot();
  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");

  try {
    const gitDate = execFileSync("git", ["log", "--diff-filter=A", "--format=%aI", "--", relativePath], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    if (gitDate) {
      return { date: gitDate, confidence: "high" };
    }
  } catch {
    // git failed, continue to fallback
  }

  // Third priority: file mtime
  try {
    const stat = statSync(filePath);
    return { date: new Date(stat.mtime).toISOString(), confidence: "low" };
  } catch {
    // fallback to now
  }

  // Last resort: now
  return { date: new Date().toISOString(), confidence: "low" };
}

export function chunkContent(content: string): { heading: string; content: string; chunk_type: "code" | "list" | "prose" }[] {
  const lines = content.split("\n");
  const chunks: { heading: string; content: string; chunk_type: "code" | "list" | "prose" }[] = [];

  let headingStack: string[] = [];
  let currentChunk = "";
  let currentType: "code" | "list" | "prose" = "prose";
  let inCodeFence = false;

  function flushChunk() {
    if (currentChunk.trim()) {
      const heading = headingStack.join(" > ") || "ROOT";
      chunks.push({
        heading,
        content: currentChunk.trim(),
        chunk_type: currentType,
      });
    }
    currentChunk = "";
    currentType = "prose";
  }

  for (const line of lines) {
    // Handle code fences
    if (line.match(/^```/)) {
      if (!inCodeFence) {
        flushChunk();
        inCodeFence = true;
        currentType = "code";
        currentChunk = line;
      } else {
        currentChunk += "\n" + line;
        inCodeFence = false;
        flushChunk();
      }
      continue;
    }

    if (inCodeFence) {
      currentChunk += "\n" + line;
      continue;
    }

    // Handle headings
    const headingMatch = line.match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      flushChunk();
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      headingStack = headingStack.slice(0, level - 1);
      headingStack.push(title);
      continue;
    }

    // Handle list items
    if (line.match(/^\s*[-*+]\s/)) {
      if (currentType !== "list") {
        flushChunk();
        currentType = "list";
      }
      currentChunk += (currentChunk ? "\n" : "") + line;
      continue;
    }

    // Regular content
    if (line.trim()) {
      if (currentType !== "prose") {
        flushChunk();
        currentType = "prose";
      }
      currentChunk += (currentChunk ? "\n" : "") + line;
    }
  }

  flushChunk();
  return chunks;
}

export function getSourceType(filePath: string): "knowledge" | "spec" | "other" {
  if (filePath.includes("docs/knowledge/")) return "knowledge";
  if (filePath.includes("docs/specs/")) return "spec";
  return "other";
}

export function calculateFreshness(
  contentDate: string,
  threshold: number,
  confidence: "high" | "low"
): { age_days: number; is_stale: boolean } {
  const now = new Date();
  const date = new Date(contentDate);
  const ageDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  return {
    age_days: ageDays,
    is_stale: ageDays > threshold,
  };
}

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

// ============================================================================
// Subcommands
// ============================================================================

function cmdIndex(filePath: string, args: string[]): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const fullPath = resolve(projectRoot, filePath);

  // Path traversal guard: resolved path must stay inside project root
  if (!fullPath.startsWith(projectRoot + "/") && fullPath !== projectRoot) {
    console.error(`Error: Path escapes project root: ${filePath}`);
    process.exit(1);
  }

  if (!existsSync(fullPath)) {
    console.error(`Error: File not found: ${fullPath}`);
    process.exit(1);
  }

  // Resolve symlinks and re-check boundary
  const canonicalPath = realpathSync(fullPath);
  if (!canonicalPath.startsWith(projectRoot + "/") && canonicalPath !== projectRoot) {
    console.error(`Error: Path escapes project root after symlink resolution: ${filePath}`);
    process.exit(1);
  }

  // Parse optional args
  let contentDate: string | null = null;
  let confidence: "high" | "medium" | "low" = "low";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--content-date") {
      contentDate = args[++i];
    } else if (args[i] === "--confidence") {
      const val = args[++i];
      confidence = (val === "high" || val === "medium" || val === "low") ? val : "low";
    }
  }

  const fileContent = readFileSync(fullPath, "utf-8");
  const { frontmatter, body } = parseYamlFrontmatter(fileContent);
  const stat = statSync(fullPath);

  const dateInfo = contentDate
    ? { date: contentDate, confidence }
    : extractDate(frontmatter, fullPath);

  const chunks = chunkContent(body);
  const now = new Date().toISOString();
  const normalizedPath = normalizeFilePath(relative(projectRoot, fullPath));
  const sourceType = getSourceType(normalizedPath);

  const db = initializeDatabase(resolve(projectRoot, config.index_path));

  // Clear existing chunks for this file
  db.prepare("DELETE FROM knowledge WHERE source = ?").run(normalizedPath);
  db.prepare("DELETE FROM index_meta WHERE source = ?").run(normalizedPath);
  db.prepare("DELETE FROM freshness_meta WHERE source = ?").run(normalizedPath);

  // Insert chunks
  const insertChunk = db.prepare(
    "INSERT INTO knowledge (source, heading, content, chunk_type, indexed_at, session_id) VALUES (?, ?, ?, ?, ?, ?)"
  );

  for (const chunk of chunks) {
    insertChunk.run(
      normalizedPath,
      chunk.heading,
      chunk.content,
      chunk.chunk_type,
      now,
      process.env.SESSION_ID || null
    );
  }

  // Insert metadata
  db.prepare(
    "INSERT INTO index_meta (source, last_modified, last_indexed, chunk_count, content_date, freshness_confidence) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    normalizedPath,
    new Date(stat.mtime).toISOString(),
    now,
    chunks.length,
    dateInfo.date,
    dateInfo.confidence
  );

  db.prepare(
    "INSERT INTO freshness_meta (source, source_type, content_date, retrieved_at, freshness_confidence, last_validated) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    normalizedPath,
    sourceType,
    dateInfo.date,
    now,
    dateInfo.confidence,
    null
  );

  db.close();

  console.log(`Indexed: ${normalizedPath} (${chunks.length} chunks)`);
}

function cmdIndexVault(): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();

  const dirs = [
    resolve(projectRoot, "docs/knowledge"),
    resolve(projectRoot, "docs/specs"),
  ];

  let totalFiles = 0;
  let totalChunks = 0;
  const failedFiles: string[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    // Scan directory for .md files
    const files = scanDirectory(dir, ".md");

    for (const filePath of files) {
      try {
        // Check if file needs re-indexing (mtime changed)
        const dbPath = resolve(projectRoot, config.index_path);

        if (existsSync(dbPath)) {
          const db = new DatabaseSync(dbPath);
          const stat = statSync(filePath);
          const lastMod = new Date(stat.mtime).toISOString();
          const normalizedPath = normalizeFilePath(relative(projectRoot, filePath));

          const meta = db.prepare("SELECT last_indexed FROM index_meta WHERE source = ?").get(normalizedPath) as IndexMetaRow | undefined;
          db.close();

          if (meta && meta.last_indexed >= lastMod) {
            continue; // Skip unchanged files
          }
        }

        // Index the file
        cmdIndex(relative(projectRoot, filePath), []);
        totalFiles++;

        // Count chunks
        const fileContent = readFileSync(filePath, "utf-8");
        const { body } = parseYamlFrontmatter(fileContent);
        const chunks = chunkContent(body);
        totalChunks += chunks.length;
      } catch (e) {
        failedFiles.push(filePath);
        console.error(`Failed to index ${filePath}: ${e}`);
      }
    }
  }

  console.log(`Indexed vault: ${totalFiles} files, ${totalChunks} chunks`);
  if (failedFiles.length > 0) {
    console.error(`Failed to index ${failedFiles.length} file(s): ${failedFiles.join(", ")}`);
    process.exit(1);
  }
}

function cmdSearch(query: string, args: string[]): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.error("Error: Index not found. Run 'index-vault' first.");
    process.exit(1);
  }

  // Parse options
  let limit = config.max_search_results;
  let type: "code" | "prose" | "all" = "all";
  let fresh = false;
  let afterDate: string | null = null;
  let noStale = false;
  let observationType: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit)) {
        console.error("Error: --limit must be a valid integer");
        process.exit(1);
      }
    } else if (args[i] === "--type") type = args[++i] as "code" | "prose" | "all";
    else if (args[i] === "--fresh") fresh = true;
    else if (args[i] === "--after") afterDate = args[++i];
    else if (args[i] === "--no-stale") noStale = true;
    else if (args[i] === "--obs-type" || args[i] === "--observation-type") observationType = args[++i]?.toLowerCase() ?? null;
  }

  const db = new DatabaseSync(dbPath);

  let sql = `
    SELECT k.source, k.heading, k.content, k.chunk_type,
           f.content_date, f.freshness_confidence, f.last_validated, im.last_modified,
           im.access_count, im.last_accessed
    FROM knowledge k
    LEFT JOIN freshness_meta f ON k.source = f.source
    LEFT JOIN index_meta im ON k.source = im.source
  `;

  // Conditionally JOIN observation_meta when filtering by observation type
  if (observationType) {
    sql += `    INNER JOIN observation_meta om ON k.source = om.source\n`;
  }

  sql += `    WHERE k.knowledge MATCH ?`;

  if (observationType) {
    sql += ` AND om.observation_type = ?`;
  }

  if (type !== "all") {
    sql += ` AND k.chunk_type = ?`;
  }

  if (afterDate) {
    sql += ` AND f.content_date >= ?`;
  }

  // FTS5 rank is negative (more negative = better match). ORDER BY rank ASC gives best-first.
  sql += ` ORDER BY rank LIMIT ?`;

  // Build parameter list in SQL clause order
  const params: (string | number)[] = [query];
  if (observationType) params.push(observationType);
  if (type !== "all") params.push(type);
  if (afterDate) params.push(afterDate);
  params.push(limit);

  let results: SearchRow[] = [];
  try {
    const stmt = db.prepare(sql);
    results = stmt.all(...params) as SearchRow[];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fts5") || msg.includes("MATCH") || msg.includes("syntax")) {
      console.error(`Invalid query syntax: ${query}`);
      console.error(`Hint: Avoid unmatched quotes or special characters. Use AND/OR/NEAR for boolean queries.`);
    } else {
      console.error(`Search failed: ${msg}`);
    }
    process.exit(1);
  }

  // Update access tracking for each unique source that appeared in results.
  // COALESCE handles NULL in rows that predate the migration (access_count may be NULL).
  if (results.length > 0) {
    const updateAccess = db.prepare(
      "UPDATE index_meta SET access_count = COALESCE(access_count, 0) + 1, last_accessed = ? WHERE source = ?"
    );
    const accessedAt = new Date().toISOString();
    const seenSources = new Set<string>();
    for (const row of results) {
      if (!seenSources.has(row.source)) {
        seenSources.add(row.source);
        updateAccess.run(accessedAt, row.source);
      }
    }
  }

  db.close();

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  // Calculate composite scores for all results before display
  const now = new Date();
  const threshold = config.freshness.stale_threshold_days;
  const halflife = config.freshness.decay_halflife_days;
  const recencyHalflife = config.freshness.recency_halflife_days;
  const totalResults = results.length;

  interface ScoredRow {
    row: SearchRow;
    compositeScore: number;
    ageDays: number;
    isStale: boolean;
    accessDays: number;
  }

  const scored: ScoredRow[] = results.map((row, position) => {
    // FTS5 rank proxy: position 0 (best FTS5 match) gets score 1.0, last gets ~(1/n)
    const fts5RankProxy = (totalResults - position) / totalResults;

    // Access count boost: log(access_count + 1), defaulting to 0 if null
    const accessCount = row.access_count ?? 0;
    const accessBoost = Math.log(accessCount + 1);

    // Recency decay based on last_accessed (how recently this source was retrieved)
    // Default: use content_date or now if last_accessed is null
    let lastAccessedDate: Date;
    if (row.last_accessed) {
      lastAccessedDate = new Date(row.last_accessed);
    } else if (row.content_date) {
      lastAccessedDate = new Date(row.content_date);
    } else {
      lastAccessedDate = now;
    }
    const accessAgeMs = now.getTime() - lastAccessedDate.getTime();
    const accessAgeDays = Math.max(0, accessAgeMs / (1000 * 60 * 60 * 24));
    const recencyDecay = Math.pow(0.5, accessAgeDays / recencyHalflife);

    // Composite score: blend FTS5 rank and access boost, weighted by recency decay
    let compositeScore = (fts5RankProxy * 0.7 + accessBoost * 0.3) * recencyDecay;

    // Content freshness (for stale label and --fresh flag)
    let contentDate: Date;
    if (row.last_validated) {
      const validatedDate = new Date(row.last_validated);
      const originalDate = row.content_date ? new Date(row.content_date) : new Date(row.last_modified || now);
      contentDate = validatedDate > originalDate ? validatedDate : originalDate;
    } else {
      contentDate = row.content_date ? new Date(row.content_date) : new Date(row.last_modified || now);
    }
    const ageDays = Math.floor((now.getTime() - contentDate.getTime()) / (1000 * 60 * 60 * 24));
    const isStale = ageDays > threshold;

    // If --fresh flag: apply content staleness decay on top of composite score
    if (fresh) {
      const stalenessDecay = Math.pow(0.5, ageDays / halflife);
      compositeScore *= stalenessDecay;
    }

    return { row, compositeScore, ageDays, isStale, accessDays: Math.round(accessAgeDays) };
  });

  // Re-sort by composite score descending (may differ from FTS5-only order)
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  let displayIdx = 1;
  for (const { row, compositeScore, ageDays, isStale, accessDays } of scored) {
    if (noStale && isStale) continue;

    const staleLabel = isStale ? " [STALE]" : "";
    const freshLabel =
      ageDays === 0
        ? "today"
        : ageDays === 1
          ? "1d ago"
          : ageDays < 30
            ? `${ageDays}d ago`
            : `${Math.floor(ageDays / 30)}m ago`;

    const accessedLabel = accessDays === 0 ? "today" : `${accessDays}d ago`;
    const accessCount = row.access_count ?? 0;

    console.log(`[${displayIdx}] (score: ${compositeScore.toFixed(4)}, fresh: ${freshLabel}, accessed: ${accessCount} times, last: ${accessedLabel}, confidence: ${row.freshness_confidence || "unknown"})${staleLabel}`);
    const obsPrefix = observationType ? `[${observationType}] ` : "";
    console.log(`    ${obsPrefix}${row.source} > ${row.heading}`);
    console.log(`    ${row.content.substring(0, 120)}${row.content.length > 120 ? "..." : ""}`);
    console.log();

    displayIdx++;
  }
}

interface ObservationEntry {
  type: string;
  confidence?: string;
  line_number?: number;
  metadata?: Record<string, unknown>;
  heading?: string;
}

function cmdIndexObservations(sourceFile: string, observationsJson: string): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();

  const fullSourcePath = resolve(projectRoot, sourceFile);
  if (!fullSourcePath.startsWith(projectRoot + "/") && fullSourcePath !== projectRoot) {
    console.error(`Error: Path escapes project root: ${sourceFile}`);
    process.exit(1);
  }

  // observationsJson is typically a mktemp path written by the hook — no project-root guard needed
  const fullJsonPath = resolve(observationsJson);

  if (!existsSync(fullJsonPath)) {
    console.error(`Error: Observations JSON not found: ${fullJsonPath}`);
    process.exit(1);
  }

  let observations: ObservationEntry[];
  try {
    const raw = readFileSync(fullJsonPath, "utf-8");
    let parsed = JSON.parse(raw);
    // observation-parser.ts outputs { observations: [...], raw_line_count, observation_count }
    // Unwrap the ParseResult wrapper if present
    if (!Array.isArray(parsed) && parsed?.observations && Array.isArray(parsed.observations)) {
      parsed = parsed.observations;
    }
    observations = parsed;
    if (!Array.isArray(observations)) {
      console.error("Error: Observations JSON must be an array or a ParseResult object with .observations array");
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: Failed to parse observations JSON: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const normalizedSource = normalizeFilePath(relative(projectRoot, fullSourcePath));
  const dbPath = resolve(projectRoot, config.index_path);
  const db = initializeDatabase(dbPath);

  // Clear existing observations for this source before re-inserting
  db.prepare("DELETE FROM observation_meta WHERE source = ?").run(normalizedSource);

  const insert = db.prepare(`
    INSERT INTO observation_meta (source, heading, observation_type, confidence, line_number, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const obs of observations) {
    if (!obs.type) continue;
    const heading = obs.heading ?? "ROOT";
    const confidence = obs.confidence ?? null;
    const lineNumber = obs.line_number ?? null;
    const metadata = obs.metadata ? JSON.stringify(obs.metadata) : null;
    insert.run(normalizedSource, heading, obs.type, confidence, lineNumber, metadata);
    inserted++;
  }

  db.close();
  console.log(`Indexed ${inserted} observations for ${normalizedSource}`);
}

function cmdRebuild(): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (existsSync(dbPath)) {
    const oldPath = dbPath + ".bak";
    renameSync(dbPath, oldPath);
    console.log(`Backed up old index to ${oldPath}`);
  }

  cmdIndexVault();
  console.log("Rebuild complete.");
}

function cmdStats(): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.log("Index not found.");
    return;
  }

  const db = new DatabaseSync(dbPath);

  const totalChunks = (db.prepare("SELECT COUNT(*) as cnt FROM knowledge").get() as any).cnt;
  const totalFiles = (db.prepare("SELECT COUNT(*) as cnt FROM index_meta").get() as any).cnt;
  const byType = db.prepare("SELECT chunk_type, COUNT(*) as cnt FROM knowledge GROUP BY chunk_type").all() as any[];

  console.log(`Index Statistics`);
  console.log(`  Total files: ${totalFiles}`);
  console.log(`  Total chunks: ${totalChunks}`);
  console.log(`  By type:`);

  for (const row of byType) {
    console.log(`    ${row.chunk_type}: ${row.cnt}`);
  }

  db.close();
}

function cmdStale(args: string[]): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.log("Index not found.");
    return;
  }

  let threshold = config.freshness.stale_threshold_days;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--threshold") {
      const val = args[++i];
      const match = val.match(/^(\d+)d$/);
      if (match) threshold = parseInt(match[1], 10);
    }
  }

  const db = new DatabaseSync(dbPath);
  const now = new Date();

  const staleFiles = db
    .prepare(
      `
    SELECT DISTINCT f.source, f.content_date, f.freshness_confidence, im.chunk_count
    FROM freshness_meta f
    JOIN index_meta im ON f.source = im.source
    WHERE
      f.content_date IS NOT NULL AND
      (julianday(?) - julianday(f.content_date)) > ?
    ORDER BY f.content_date ASC
  `
    )
    .all(now.toISOString(), threshold) as any[];

  if (staleFiles.length === 0) {
    console.log(`No stale files (threshold: ${threshold}d)`);
    db.close();
    return;
  }

  console.log(`Stale files (threshold: ${threshold}d):`);
  for (const file of staleFiles) {
    const fileDate = new Date(file.content_date);
    const ageDays = Math.floor((now.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  ${file.source}`);
    console.log(`    Age: ${ageDays}d, Confidence: ${file.freshness_confidence}, Chunks: ${file.chunk_count}`);
  }

  db.close();
}

function cmdConfig(key: string): void {
  const config = loadConfig();

  // Support dotted keys like "freshness.stale_threshold_days"
  const keys = key.split(".");
  let value: any = config;

  for (const k of keys) {
    if (typeof value === "object" && value !== null && k in value) {
      value = value[k];
    } else {
      console.error(`Config key not found: ${key}`);
      process.exit(1);
    }
  }

  // Output: booleans as "true"/"false", numbers as-is, strings as-is
  if (typeof value === "boolean") {
    console.log(value ? "true" : "false");
  } else {
    console.log(value);
  }
}

function cmdValidate(source: string): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.error("Error: Index not found. Run 'index-vault' first.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const db = new DatabaseSync(dbPath);

  // Update last_validated for all chunks matching this source
  const stmt = db.prepare("UPDATE freshness_meta SET last_validated = ? WHERE source = ?");
  stmt.run(now, source);

  db.close();

  console.log(`Validated: ${source} (last_validated set to now)`);
}

function cmdValidateVault(): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.error("Error: Index not found. Run 'index-vault' first.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const db = new DatabaseSync(dbPath);

  // Get all unique sources
  const sources = db.prepare("SELECT DISTINCT source FROM freshness_meta").all() as any[];

  if (sources.length === 0) {
    console.log("No sources to validate.");
    db.close();
    return;
  }

  // Update last_validated for all sources
  const stmt = db.prepare("UPDATE freshness_meta SET last_validated = ? WHERE source = ?");
  for (const row of sources) {
    stmt.run(now, row.source);
  }

  db.close();

  console.log(`Validated ${sources.length} sources (all last_validated set to now)`);
}

function cmdReport(): void {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const dbPath = resolve(projectRoot, config.index_path);

  if (!existsSync(dbPath)) {
    console.error("Error: Index not found. Run 'index-vault' first.");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath);
  const now = new Date();
  const threshold = config.freshness.stale_threshold_days;

  // Query all rows with age calculation
  const rows = db
    .prepare(
      `
    SELECT
      source,
      content_date,
      freshness_confidence,
      last_validated,
      (julianday(?) - julianday(content_date)) as age_days
    FROM freshness_meta
    WHERE content_date IS NOT NULL
    ORDER BY content_date DESC
  `
    )
    .all(now.toISOString()) as FreshnessReportRow[];

  db.close();

  if (rows.length === 0) {
    console.log("No indexed content to report on.");
    return;
  }

  // Group by age buckets
  const buckets: { [key: string]: { high: number; medium: number; low: number } } = {
    "< 7 days": { high: 0, medium: 0, low: 0 },
    "7-30 days": { high: 0, medium: 0, low: 0 },
    "30-90 days": { high: 0, medium: 0, low: 0 },
    "90-180 days": { high: 0, medium: 0, low: 0 },
    "180+ days": { high: 0, medium: 0, low: 0 },
  };

  for (const row of rows) {
    const ageDays = Math.floor(row.age_days);
    const confidence = row.freshness_confidence || "low";

    let bucket: string;
    if (ageDays < 7) {
      bucket = "< 7 days";
    } else if (ageDays < 30) {
      bucket = "7-30 days";
    } else if (ageDays < 90) {
      bucket = "30-90 days";
    } else if (ageDays < 180) {
      bucket = "90-180 days";
    } else {
      bucket = "180+ days";
    }

    if (confidence === "high" || confidence === "medium" || confidence === "low") {
      buckets[bucket][confidence]++;
    }
  }

  // Output report
  console.log("Freshness Report");
  const bucketOrder = ["< 7 days", "7-30 days", "30-90 days", "90-180 days", "180+ days"];

  for (const bucketName of bucketOrder) {
    const bucket = buckets[bucketName];
    const total = bucket.high + bucket.medium + bucket.low;

    if (total > 0) {
      console.log(
        `  ${bucketName.padEnd(13)}: ${String(total).padStart(3)} chunks (high: ${bucket.high}, medium: ${bucket.medium}, low: ${bucket.low})`
      );
    }
  }
}

// ============================================================================
// Helper
// ============================================================================

function scanDirectory(dir: string, extension: string): string[] {
  const results: string[] = [];
  const items = readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) {
      results.push(...scanDirectory(path, extension));
    } else if (item.name.endsWith(extension)) {
      results.push(path);
    }
  }

  return results;
}

// ============================================================================
// Main (only runs when executed directly, not when imported)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (!isMain) {
  // Imported as a module — skip CLI dispatch
  // Functions are available via named exports
} else {

const nodeVersion = process.versions.node;
const [major, minor] = nodeVersion.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
  console.error(`Error: Requires Node 22.16+ for node:sqlite (current: ${nodeVersion})`);
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/knowledge-index.ts <command> [args...]");
  console.error("Commands: index, index-vault, search, rebuild, stats, stale, config, validate, validate-vault, report");
  process.exit(1);
}

const cmd = args[0];

try {
  switch (cmd) {
    case "index":
      if (args.length < 2) {
        console.error("Usage: node scripts/knowledge-index.ts index <file> [--content-date DATE] [--confidence high|low]");
        process.exit(1);
      }
      cmdIndex(args[1], args.slice(2));
      break;

    case "index-vault":
      cmdIndexVault();
      break;

    case "index-observations":
      if (args.length < 3) {
        console.error("Usage: node scripts/knowledge-index.ts index-observations <source-file> <observations-json>");
        process.exit(1);
      }
      cmdIndexObservations(args[1], args[2]);
      break;

    case "search":
      if (args.length < 2) {
        console.error('Usage: node scripts/knowledge-index.ts search "<query>" [--limit 10] [--type code|prose|all] [--fresh] [--after DATE] [--no-stale] [--obs-type TYPE]');
        process.exit(1);
      }
      cmdSearch(args[1], args.slice(2));
      break;

    case "rebuild":
      cmdRebuild();
      break;

    case "stats":
      cmdStats();
      break;

    case "stale":
      cmdStale(args.slice(1));
      break;

    case "config":
      if (args.length < 2) {
        console.error("Usage: node scripts/knowledge-index.ts config <key>");
        process.exit(1);
      }
      cmdConfig(args[1]);
      break;

    case "validate":
      if (args.length < 2) {
        console.error("Usage: node scripts/knowledge-index.ts validate <source>");
        process.exit(1);
      }
      cmdValidate(args[1]);
      break;

    case "validate-vault":
      cmdValidateVault();
      break;

    case "report":
      cmdReport();
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

} // end isMain
