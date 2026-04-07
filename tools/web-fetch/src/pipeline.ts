/**
 * pipeline.ts — Fetch pipeline orchestrator for web-fetch tool.
 * Composes config, cache, sanitizer, and extractor into a full fetch pipeline.
 *
 * Stages:
 *   1. URL normalization
 *   2. SSRF validation
 *   3. Cache check
 *   4. Rate limit acquire
 *   5. Fetch with retry (conditional GET)
 *   6. Response validation
 *   7. Extraction: sanitizeHtml → extractAndConvert → sanitizeMarkdown
 *   8. Truncation (section-aware)
 *   9. Cache write + return FetchResult
 */

import { createHash } from "node:crypto";
import * as dns from "node:dns";

import {
  type FetchResult,
  type FetchOptions,
  type WebFetchConfig,
  DEFAULT_CONFIG,
} from "./config.ts";
import { sanitizeHtml, sanitizeMarkdown } from "./sanitizer.ts";
import { extractAndConvert } from "./extractor.ts";
import {
  WebFetchCache,
  type CacheEntry,
  detectTtlTier,
} from "./cache.ts";

// ============================================================================
// URL normalization
// ============================================================================

/** Tracking/UTM parameters that should be stripped from URLs. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ref",
]);

/**
 * Normalize a URL by stripping tracking parameters, lowercasing the hostname,
 * removing the trailing slash from the path, and removing the fragment.
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a valid URL — return as-is
    return url;
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip tracking params
  for (const key of TRACKING_PARAMS) {
    parsed.searchParams.delete(key);
  }

  // Remove fragment
  parsed.hash = "";

  // Remove trailing slash from path (but keep root "/" as-is)
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

// ============================================================================
// SSRF validation
// ============================================================================

/** Hostname blocklist for SSRF protection. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

/**
 * Check whether an IP address falls in a private/reserved range.
 * Covers: loopback, RFC1918, link-local, APIPA, IPv6 loopback/ULA/link-local,
 * and IPv6-mapped IPv4 equivalents.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv6-mapped IPv4: ::ffff:x.x.x.x
  const ipv4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    return isPrivateIp(ipv4MappedMatch[1]);
  }

  // IPv6 checks
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc00:") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }

  // IPv4 checks
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;

  const [a, b, c] = parts;

  return (
    a === 0 ||           // 0.x.x.x
    a === 10 ||          // 10.x.x.x (RFC1918)
    a === 127 ||         // 127.x.x.x (loopback)
    (a === 169 && b === 254) ||                    // 169.254.x.x (APIPA/link-local)
    (a === 172 && b >= 16 && b <= 31) ||           // 172.16–31.x.x (RFC1918)
    (a === 192 && b === 168)                        // 192.168.x.x (RFC1918)
  );
}

/**
 * Validate a URL for SSRF safety.
 * Throws a descriptive Error if:
 *   - Protocol is not http: or https:
 *   - Hostname is on the blocklist
 *   - Resolved IP is in a private range
 */
export async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `SSRF blocked: unsupported protocol "${parsed.protocol}" for URL ${url}`
    );
  }

  // Hostname blocklist
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `SSRF blocked: hostname "${parsed.hostname}" is on the blocklist`
    );
  }

  // DNS lookup + private IP check
  let address: string;
  try {
    const result = await dns.promises.lookup(parsed.hostname);
    address = result.address;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SSRF validation failed: DNS lookup for "${parsed.hostname}" failed: ${msg}`
    );
  }

  if (isPrivateIp(address)) {
    throw new Error(
      `SSRF blocked: "${parsed.hostname}" resolved to private IP "${address}"`
    );
  }
}

// ============================================================================
// Rate limiter
// ============================================================================

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * In-memory per-domain token bucket rate limiter.
 * Default: 2 requests per second per domain.
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private readonly rps: number;

  constructor(rps = 2) {
    this.rps = rps;
  }

  /**
   * Acquire a token for the given domain.
   * If no tokens are available, waits until one refills.
   */
  async acquire(domain: string): Promise<void> {
    const now = Date.now();
    let bucket = this.buckets.get(domain);

    if (!bucket) {
      bucket = { tokens: this.rps, lastRefill: now };
      this.buckets.set(domain, bucket);
    }

    // Refill based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refilled = elapsed * this.rps;
    if (refilled > 0) {
      bucket.tokens = Math.min(this.rps, bucket.tokens + refilled);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Wait until next token is available
    const msPerToken = 1000 / this.rps;
    const waitMs = Math.ceil((1 - bucket.tokens) * msPerToken);
    await sleep(waitMs);
    bucket.tokens = 0;
    bucket.lastRefill = Date.now();
  }
}

// ============================================================================
// Fetch with retry
// ============================================================================

/** HTTP status codes that indicate transient failures (retry). */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/** HTTP status codes that indicate permanent failures (fail fast). */
const PERMANENT_STATUSES = new Set([401, 403, 404, 410]);

/** Network error codes that should trigger a retry. */
const RETRYABLE_NETWORK_ERRORS = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with exponential backoff + jitter.
 * - Transient status codes → retry up to config.fetch.retryCount times
 * - Permanent status codes → fail immediately with descriptive error
 * - 429 with Retry-After header → honor the wait time
 * - Network errors (ETIMEDOUT, ECONNRESET, ECONNREFUSED) → retry
 */
export async function fetchWithRetry(
  url: string,
  config: WebFetchConfig,
  extraHeaders?: Record<string, string>
): Promise<{ html: string; headers: Headers; status: number }> {
  const { retryCount, retryBaseDelay, timeout, userAgent } = config.fetch;
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...extraHeaders,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          headers,
          signal: controller.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // Permanent failure — don't retry
      if (PERMANENT_STATUSES.has(response.status)) {
        throw new Error(
          `HTTP ${response.status}: permanent failure fetching ${url}`
        );
      }

      // Transient failure — retry with backoff
      if (TRANSIENT_STATUSES.has(response.status)) {
        // Honor Retry-After if present (for 429)
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          if (retryAfter) {
            const waitSec = parseInt(retryAfter, 10);
            if (!isNaN(waitSec) && waitSec > 0) {
              await sleep(waitSec * 1000);
            }
          }
        }

        if (attempt < retryCount) {
          const jitter = Math.random() * retryBaseDelay;
          const delay = retryBaseDelay * Math.pow(2, attempt) + jitter;
          await sleep(delay);
          continue;
        }
        throw new Error(
          `HTTP ${response.status}: transient failure after ${retryCount} retries fetching ${url}`
        );
      }

      // Success
      const html = await response.text();
      return { html, headers: response.headers, status: response.status };
    } catch (err) {
      if (err instanceof Error) {
        // Don't retry permanent errors
        if (err.message.startsWith("HTTP ") && err.message.includes("permanent failure")) {
          throw err;
        }

        // Check for retryable network errors
        const code = (err as NodeJS.ErrnoException).code ?? "";
        const isRetryableNetwork = RETRYABLE_NETWORK_ERRORS.some(
          (c) => code === c || err.message.includes(c)
        );

        if (isRetryableNetwork && attempt < retryCount) {
          const jitter = Math.random() * retryBaseDelay;
          const delay = retryBaseDelay * Math.pow(2, attempt) + jitter;
          await sleep(delay);
          lastError = err;
          continue;
        }

        // AbortError from timeout
        if (err.name === "AbortError" && attempt < retryCount) {
          const jitter = Math.random() * retryBaseDelay;
          const delay = retryBaseDelay * Math.pow(2, attempt) + jitter;
          await sleep(delay);
          lastError = err;
          continue;
        }
      }

      throw err;
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${retryCount} retries`);
}

// ============================================================================
// Response validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  reason?: "captcha" | "login-wall" | "paywall" | "soft-404" | "cloudflare-challenge";
}

/**
 * Validate the fetched HTML for common blocking patterns.
 * Returns { valid: false, reason } if a blocking page is detected.
 */
export function validateResponse(html: string): ValidationResult {
  // CAPTCHA detection
  if (/captcha|recaptcha|hcaptcha|verify you are human/i.test(html)) {
    return { valid: false, reason: "captcha" };
  }

  // Cloudflare challenge
  if (/cf-browser-verification|Checking your browser/i.test(html)) {
    return { valid: false, reason: "cloudflare-challenge" };
  }

  // Login wall
  if (/sign\s*in\s*to\s*continue|log\s*in\s*required/i.test(html)) {
    return { valid: false, reason: "login-wall" };
  }

  // Paywall
  if (/subscribe to (?:read|continue)|paywall/i.test(html)) {
    return { valid: false, reason: "paywall" };
  }

  // Soft 404: very short content after stripping tags
  const stripped = html.replace(/<[^>]+>/g, "").trim();
  if (stripped.length < 100) {
    const soft404Patterns = /not found|page doesn't exist|no results|404/i;
    if (soft404Patterns.test(stripped)) {
      return { valid: false, reason: "soft-404" };
    }
  }

  return { valid: true };
}

// ============================================================================
// Section-aware truncation
// ============================================================================

/**
 * Truncate markdown content to a token budget, preserving section boundaries.
 * Splits on heading lines (# / ## / ###), accumulates sections until budget
 * is reached, then appends "[... truncated]".
 *
 * tokenBudget is approximate: we use maxTokens * 3.5 chars as the char budget.
 */
function truncateMarkdown(content: string, maxTokens: number): string {
  const charBudget = Math.floor(maxTokens * 3.5);
  if (content.length <= charBudget) return content;

  // Split on section boundaries (keep the delimiter via lookahead)
  const sections = content.split(/(?=^#{1,3} )/m);
  const parts: string[] = [];
  let accumulated = 0;

  for (const section of sections) {
    if (accumulated + section.length > charBudget) {
      break;
    }
    parts.push(section);
    accumulated += section.length;
  }

  return parts.join("") + "\n[... truncated]";
}

// ============================================================================
// Main fetchUrl pipeline
// ============================================================================

// Module-level rate limiter singleton (per process)
const globalRateLimiter = new RateLimiter(2);

/**
 * Full fetch pipeline — stages 1–9.
 *
 * @param url     URL to fetch
 * @param options Per-request options (maxTokens, startIndex, mode, noCache, timeout)
 * @param config  Optional config override (defaults to DEFAULT_CONFIG)
 */
export async function fetchUrl(
  url: string,
  options?: FetchOptions,
  config?: WebFetchConfig
): Promise<FetchResult> {
  const cfg = config ?? DEFAULT_CONFIG;
  const opts = options ?? {};

  // ── Stage 1: URL normalization ────────────────────────────────────────────
  const normalizedUrl = normalizeUrl(url);

  // ── Stage 2: SSRF validation ──────────────────────────────────────────────
  await validateUrl(normalizedUrl);

  // ── Stage 3: Cache check ──────────────────────────────────────────────────
  const urlHash = createHash("sha256").update(normalizedUrl).digest("hex");
  const cacheEnabled = cfg.cache.enabled && !opts.noCache;

  let cache: WebFetchCache | null = null;
  if (cacheEnabled) {
    cache = new WebFetchCache(cfg.cache);
    const cached = cache.get(urlHash);
    if (cached) {
      cache.close();
      return {
        url: normalizedUrl,
        title: cached.title,
        content: cached.content,
        wordCount: cached.tokenEstimate,
        tokenEstimate: cached.tokenEstimate,
        fromCache: true,
        fetchTier: "cache",
        sanitized: [],
        extractionConfidence: "high",
      };
    }
  }

  // ── Stage 4: Rate limit acquire ───────────────────────────────────────────
  const domain = new URL(normalizedUrl).hostname;
  const rps = cfg.rateLimit.defaultRps;
  // Use module-level limiter but respect configured RPS
  const limiter = new RateLimiter(rps);
  await limiter.acquire(domain);

  // ── Stage 5: Fetch with retry (conditional GET) ───────────────────────────
  const extraHeaders: Record<string, string> = {};
  let expiredEntry: { etag?: string; lastModified?: string } | null = null;

  if (cache) {
    expiredEntry = cache.getExpired(urlHash);
    if (expiredEntry?.etag) {
      extraHeaders["If-None-Match"] = expiredEntry.etag;
    } else if (expiredEntry?.lastModified) {
      extraHeaders["If-Modified-Since"] = expiredEntry.lastModified;
    }
  }

  // Apply timeout override if specified
  const fetchConfig = opts.timeout
    ? { ...cfg, fetch: { ...cfg.fetch, timeout: opts.timeout } }
    : cfg;

  const { html, headers: responseHeaders, status } = await fetchWithRetry(
    normalizedUrl,
    fetchConfig,
    extraHeaders
  );

  // Handle 304 Not Modified — refresh TTL and return cached content
  if (status === 304 && cache && expiredEntry) {
    const ttl = detectTtlTier(normalizedUrl, cfg.cache);
    cache.refreshTtl(urlHash, ttl);
    const cached = cache.get(urlHash);
    cache.close();
    if (cached) {
      return {
        url: normalizedUrl,
        title: cached.title,
        content: cached.content,
        wordCount: cached.tokenEstimate,
        tokenEstimate: cached.tokenEstimate,
        fromCache: true,
        fetchTier: "cache",
        sanitized: [],
        extractionConfidence: "high",
      };
    }
  }

  // ── Stage 6: Response validation ──────────────────────────────────────────
  const validation = validateResponse(html);
  if (!validation.valid) {
    if (cache) cache.close();
    throw new Error(
      `Fetch blocked: ${validation.reason} detected at ${normalizedUrl}`
    );
  }

  // ── Determine effective mode ──────────────────────────────────────────────
  const mode = opts.mode ?? cfg.extraction.mode;
  const maxTokens = opts.maxTokens ?? cfg.extraction.maxTokens;

  // ── Stage 7: Extraction ───────────────────────────────────────────────────
  const sanitized: string[] = [];
  let title = "";
  let content = "";
  let excerpt = "";
  let wordCount = 0;

  if (mode === "raw") {
    // Raw mode: sanitizeHtml only, then strip all remaining tags
    const { cleaned: cleanedHtml, removed: removedHtml } = sanitizeHtml(html);
    sanitized.push(...removedHtml);
    content = cleanedHtml.replace(/<[^>]+>/g, "");
    title = "";
    excerpt = content.slice(0, 160);
    wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  } else {
    // Readable/markdown mode
    const { cleaned: cleanedHtml, removed: removedHtml } = sanitizeHtml(html);
    sanitized.push(...removedHtml);

    const extracted = extractAndConvert(cleanedHtml);
    title = extracted.title;
    excerpt = extracted.excerpt;
    wordCount = extracted.wordCount;

    const { cleaned: cleanedMd, removed: removedMd } = sanitizeMarkdown(extracted.markdown);
    sanitized.push(...removedMd);
    content = cleanedMd;
  }

  // ── Stage 7b: Quality gate — auto-degrade to raw if extraction is poor ──
  let extractionConfidence: "high" | "low" | "raw-fallback" = "high";

  if (mode !== "raw") {
    const strippedTextLength = html.replace(/<[^>]+>/g, "").trim().length;
    const hasHeadings = /^#{1,6} /m.test(content);
    const tooShort = wordCount < 50 && strippedTextLength > 500;
    const tooSmallRatio = strippedTextLength > 0 && content.length < strippedTextLength * 0.02;

    if (tooShort || tooSmallRatio) {
      if (!hasHeadings) {
        // Auto-fallback: re-extract in raw mode
        const { cleaned: rawHtml, removed: rawRemoved } = sanitizeHtml(html);
        sanitized.length = 0;
        sanitized.push(...rawRemoved);
        content = rawHtml.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
        wordCount = content.trim().split(/\s+/).filter(Boolean).length;
        excerpt = content.slice(0, 160);
        extractionConfidence = "raw-fallback";
      } else {
        extractionConfidence = "low";
      }
    }
  }

  // ── Stage 8: Truncation ───────────────────────────────────────────────────
  // Pagination: startIndex > 0 → slice content from character offset
  const startIndex = opts.startIndex ?? 0;
  if (startIndex > 0) {
    content = content.slice(startIndex);
    // Append pagination hint for next page
    const nextOffset = startIndex + content.length;
    content = content + `\n[Use start_index=${nextOffset} for more]`;
  }

  content = truncateMarkdown(content, maxTokens);
  const tokenEstimate = Math.ceil(content.length / 3.5);

  // ── Stage 9: Cache write ──────────────────────────────────────────────────
  if (cache) {
    const etag = responseHeaders.get("etag") ?? undefined;
    const lastModified = responseHeaders.get("last-modified") ?? undefined;
    const contentHash = createHash("sha256").update(content).digest("hex");
    const ttl = detectTtlTier(normalizedUrl, cfg.cache);

    const entry: CacheEntry = {
      urlHash,
      url: normalizedUrl,
      title,
      etag,
      lastModified,
      contentHash,
      contentSize: Buffer.byteLength(content, "utf8"),
      tokenEstimate,
      fetchTier: "http",
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl * 1000,
    };

    cache.put(entry, content);
    cache.close();
  }

  return {
    url: normalizedUrl,
    title,
    content,
    excerpt,
    wordCount,
    tokenEstimate,
    fromCache: false,
    fetchTier: "http",
    sanitized,
    extractionConfidence,
  };
}
