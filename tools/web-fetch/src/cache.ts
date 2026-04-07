/**
 * cache.ts — SQLite + filesystem cache for web-fetch tool
 * Uses node:sqlite (Node 22+) with WAL mode, node:crypto for integrity checks.
 */

import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ============================================================================
// Interfaces
// ============================================================================

export interface CacheConfig {
  enabled: boolean;
  ttlDefault: number;
  ttlDocs: number;
  ttlNews: number;
  maxSizeMb: number;
  dir: string;
}

export interface CacheEntry {
  urlHash: string;
  url: string;
  title: string;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  contentSize: number;
  tokenEstimate: number;
  fetchTier: string;
  createdAt: number;
  expiresAt: number;
}

// Internal DB row shape
interface CacheRow {
  url_hash: string;
  url: string;
  title: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string;
  content_size: number;
  token_estimate: number;
  fetch_tier: string;
  created_at: number;
  expires_at: number;
  last_accessed_at: number;
  access_count: number;
}

interface StatsRow {
  entries: number;
  totalSize: number;
  oldestAccess: number;
}

// ============================================================================
// TTL Tier Detection
// ============================================================================

/**
 * Classify a URL into a TTL tier based on domain patterns.
 * Returns the appropriate TTL value from config.
 */
export function detectTtlTier(url: string, config: CacheConfig): number {
  if (/docs\.|readthedocs\.|developer\./.test(url)) {
    return config.ttlDocs;
  }
  if (/blog\.|news\.|medium\.com/.test(url)) {
    return config.ttlNews;
  }
  return config.ttlDefault;
}

// ============================================================================
// WebFetchCache
// ============================================================================

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS cache_entries (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT NOT NULL,
  content_size INTEGER,
  token_estimate INTEGER,
  fetch_tier TEXT,
  created_at INTEGER,
  expires_at INTEGER,
  last_accessed_at INTEGER,
  access_count INTEGER DEFAULT 0
);
`;

export class WebFetchCache {
  private db: DatabaseSync;
  private config: CacheConfig;
  private contentDir: string;

  /**
   * Open/create the SQLite DB at config.dir/cache.db, initialize schema,
   * set WAL mode, and ensure the content/ subdirectory exists.
   */
  constructor(config: CacheConfig) {
    this.config = config;
    const dbPath = join(config.dir, "cache.db");
    this.contentDir = join(config.dir, "content");

    mkdirSync(config.dir, { recursive: true });
    mkdirSync(this.contentDir, { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(CREATE_TABLE_SQL);
  }

  /**
   * Look up a cache entry by URL hash.
   * Returns null on miss, expiry (without updating access), or integrity failure.
   * On hit: updates last_accessed_at and access_count, verifies blob SHA-256.
   */
  get(urlHash: string): (CacheEntry & { content: string }) | null {
    const stmt = this.db.prepare(
      "SELECT * FROM cache_entries WHERE url_hash = ?"
    );
    const row = stmt.get(urlHash) as CacheRow | undefined;

    if (!row) return null;

    // Check TTL
    if (row.expires_at < Date.now()) {
      return null;
    }

    // Read blob from filesystem
    const blobPath = this.blobPath(row.url_hash);
    if (!existsSync(blobPath)) {
      // Blob missing — clean up DB entry
      this.db.prepare("DELETE FROM cache_entries WHERE url_hash = ?").run(urlHash);
      return null;
    }

    const content = readFileSync(blobPath, "utf8");

    // Verify SHA-256 integrity
    const actualHash = createHash("sha256").update(content).digest("hex");
    if (actualHash !== row.content_hash) {
      // Corrupted — clean up
      try { unlinkSync(blobPath); } catch { /* ignore */ }
      this.db.prepare("DELETE FROM cache_entries WHERE url_hash = ?").run(urlHash);
      return null;
    }

    // Update access tracking
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE cache_entries SET last_accessed_at = ?, access_count = access_count + 1 WHERE url_hash = ?"
      )
      .run(now, urlHash);

    return {
      urlHash: row.url_hash,
      url: row.url,
      title: row.title ?? "",
      etag: row.etag ?? undefined,
      lastModified: row.last_modified ?? undefined,
      contentHash: row.content_hash,
      contentSize: row.content_size,
      tokenEstimate: row.token_estimate,
      fetchTier: row.fetch_tier,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      content,
    };
  }

  /**
   * Write a cache entry and its content blob to disk, then run eviction check.
   */
  put(entry: CacheEntry, content: string): void {
    const blobPath = this.blobPath(entry.urlHash);
    const prefixDir = join(this.contentDir, entry.urlHash.slice(0, 2));
    mkdirSync(prefixDir, { recursive: true });
    writeFileSync(blobPath, content, "utf8");

    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO cache_entries
         (url_hash, url, title, etag, last_modified, content_hash, content_size,
          token_estimate, fetch_tier, created_at, expires_at, last_accessed_at, access_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.urlHash,
        entry.url,
        entry.title ?? null,
        entry.etag ?? null,
        entry.lastModified ?? null,
        entry.contentHash,
        entry.contentSize,
        entry.tokenEstimate,
        entry.fetchTier,
        entry.createdAt,
        entry.expiresAt,
        now,
        0
      );

    this.evict();
  }

  /**
   * LRU eviction: if total content_size exceeds maxSizeMb, delete oldest-accessed
   * entries (and their blobs) until under the limit.
   */
  evict(): void {
    const limitBytes = this.config.maxSizeMb * 1024 * 1024;

    const sumRow = this.db
      .prepare("SELECT SUM(content_size) AS total FROM cache_entries")
      .get() as { total: number | null };

    const total = sumRow?.total ?? 0;
    if (total <= limitBytes) return;

    // Fetch all rows ordered by oldest last_accessed_at first
    const rows = this.db
      .prepare(
        "SELECT url_hash, content_size FROM cache_entries ORDER BY last_accessed_at ASC"
      )
      .all() as Array<{ url_hash: string; content_size: number }>;

    let running = total;
    for (const row of rows) {
      if (running <= limitBytes) break;
      // Delete blob
      const blobPath = this.blobPath(row.url_hash);
      try { unlinkSync(blobPath); } catch { /* ignore */ }
      // Delete DB row
      this.db
        .prepare("DELETE FROM cache_entries WHERE url_hash = ?")
        .run(row.url_hash);
      running -= row.content_size ?? 0;
    }
  }

  /**
   * For conditional GET: returns etag/lastModified from an expired entry,
   * or null if no entry exists at all.
   */
  getExpired(urlHash: string): { etag?: string; lastModified?: string } | null {
    const stmt = this.db.prepare(
      "SELECT etag, last_modified FROM cache_entries WHERE url_hash = ?"
    );
    const row = stmt.get(urlHash) as
      | { etag: string | null; last_modified: string | null }
      | undefined;

    if (!row) return null;

    return {
      etag: row.etag ?? undefined,
      lastModified: row.last_modified ?? undefined,
    };
  }

  /**
   * Update expires_at for a 304 Not Modified response.
   */
  refreshTtl(urlHash: string, newTtl: number): void {
    const newExpiry = Date.now() + newTtl;
    this.db
      .prepare("UPDATE cache_entries SET expires_at = ? WHERE url_hash = ?")
      .run(newExpiry, urlHash);
  }

  /**
   * Return cache statistics.
   */
  stats(): { entries: number; totalSize: number; oldestAccess: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS entries,
           COALESCE(SUM(content_size), 0) AS totalSize,
           COALESCE(MIN(last_accessed_at), 0) AS oldestAccess
         FROM cache_entries`
      )
      .get() as StatsRow;

    return {
      entries: row.entries,
      totalSize: row.totalSize,
      oldestAccess: row.oldestAccess,
    };
  }

  /**
   * Delete a specific entry (by URL) or all entries + blobs.
   */
  clear(url?: string): void {
    if (url) {
      // Find entry by URL to get hash for blob deletion
      const row = this.db
        .prepare("SELECT url_hash FROM cache_entries WHERE url = ?")
        .get(url) as { url_hash: string } | undefined;

      if (row) {
        const blobPath = this.blobPath(row.url_hash);
        try { unlinkSync(blobPath); } catch { /* ignore */ }
        this.db
          .prepare("DELETE FROM cache_entries WHERE url = ?")
          .run(url);
      }
    } else {
      // Delete all blobs
      try {
        rmSync(this.contentDir, { recursive: true, force: true });
        mkdirSync(this.contentDir, { recursive: true });
      } catch { /* ignore */ }
      this.db.exec("DELETE FROM cache_entries;");
    }
  }

  /**
   * Close the SQLite connection.
   */
  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /** Compute the blob file path for a given URL hash. */
  private blobPath(urlHash: string): string {
    const prefix = urlHash.slice(0, 2);
    return join(this.contentDir, prefix, urlHash);
  }
}
