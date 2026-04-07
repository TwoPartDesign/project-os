/**
 * Integration tests for the web-fetch pipeline.
 *
 * Run: node --experimental-strip-types --test tests/web-fetch-integration.test.ts
 *
 * Strategy: mock global.fetch to serve fixture HTML content. This tests the
 * full pipeline (SSRF validation, sanitization, extraction, caching, Markdown
 * conversion) without any real network I/O. URLs use example.com which resolves
 * to a public IP and passes SSRF validation.
 *
 * SSRF test calls validateUrl() directly for localhost, which is on the blocklist
 * and never reaches DNS — so no network call needed there either.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { fetchUrl, validateUrl } from "../tools/web-fetch/src/pipeline.ts";
import { DEFAULT_CONFIG } from "../tools/web-fetch/src/config.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "fixtures", "web-fetch");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a fixture HTML file synchronously. */
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

/** Mock global.fetch to return given HTML with status 200. Returns cleanup fn. */
function mockFetch(
  html: string,
  status = 200,
  headers: Record<string, string> = {}
): { callCount: number; restore: () => void } {
  const tracker = { callCount: 0 };
  const originalFetch = (global as Record<string, unknown>).fetch;

  (global as Record<string, unknown>).fetch = async () => {
    tracker.callCount++;
    const responseHeaders = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      ...headers,
    });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: responseHeaders,
      text: async () => html,
    } as Response;
  };

  return {
    tracker,
    restore: () => {
      (global as Record<string, unknown>).fetch = originalFetch;
    },
  } as unknown as { callCount: number; restore: () => void };
}

/** Create a temp directory and return { dir, cleanup }. */
function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "web-fetch-test-"));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

// Config with no cache and no retries for fast tests
const BASE_TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  cache: { ...DEFAULT_CONFIG.cache, enabled: false },
  fetch: { ...DEFAULT_CONFIG.fetch, timeout: 5000, retryCount: 0 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("web-fetch integration", () => {

  /**
   * integration_docPage_tokenReduction
   *
   * A realistic documentation page should be reduced to ≤20% of raw HTML size
   * after sanitization and extraction. Title must be set. Nav/footer noise
   * must be absent.
   */
  it("integration_docPage_tokenReduction", async () => {
    const rawHtml = readFixture("doc-page.html");
    const { tracker, restore } = mockFetch(rawHtml) as unknown as {
      tracker: { callCount: number };
      restore: () => void;
    };

    try {
      const result = await fetchUrl(
        "https://example.com/doc-page",
        { noCache: true },
        BASE_TEST_CONFIG
      );

      // Content must be substantially shorter than raw HTML
      const reductionRatio = result.content.length / rawHtml.length;
      assert.ok(
        reductionRatio < 0.20,
        `Expected ≥80% reduction, got ${((1 - reductionRatio) * 100).toFixed(1)}% reduction. ` +
        `raw=${rawHtml.length} chars, content=${result.content.length} chars`
      );

      // Title must be extracted
      assert.ok(
        result.title.length > 0,
        `Expected non-empty title, got: "${result.title}"`
      );
      assert.ok(
        result.title.includes("API Documentation") || result.title.includes("Getting Started"),
        `Expected doc page title, got: "${result.title}"`
      );

      // Article content must be present
      assert.ok(
        result.content.includes("Getting Started"),
        "Expected article heading in content"
      );
      assert.ok(
        result.content.includes("web-fetch"),
        "Expected article body content"
      );

      // Outer nav/footer noise must be absent — check for link text unique to nav/footer
      assert.ok(
        !result.content.includes("Join Discord"),
        "Sidebar promo content should be excluded"
      );
      assert.ok(
        !result.content.toLowerCase().includes("all rights reserved"),
        "Footer copyright should be excluded"
      );
      assert.ok(
        !result.content.includes("cookie"),
        "Cookie banner content should be excluded"
      );

      // Metadata checks
      assert.equal(result.fromCache, false, "should not be from cache");
      assert.equal(result.fetchTier, "http");
      assert.ok(result.wordCount > 0, "wordCount should be positive");
      assert.ok(result.tokenEstimate > 0, "tokenEstimate should be positive");
    } finally {
      restore();
    }
  });

  /**
   * integration_cacheHit_noSecondRequest
   *
   * Fetching the same URL twice with caching enabled should issue only one
   * real HTTP request. The second call must return fromCache=true.
   */
  it("integration_cacheHit_noSecondRequest", async () => {
    const rawHtml = readFixture("doc-page.html");
    const tmp = makeTempDir();

    // Config with cache pointing at temp dir
    const cacheConfig = {
      ...DEFAULT_CONFIG,
      cache: {
        ...DEFAULT_CONFIG.cache,
        enabled: true,
        dir: tmp.dir,
      },
      fetch: { ...DEFAULT_CONFIG.fetch, timeout: 5000, retryCount: 0 },
    };

    const tracker = { callCount: 0 };
    const originalFetch = (global as Record<string, unknown>).fetch;
    (global as Record<string, unknown>).fetch = async () => {
      tracker.callCount++;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "Content-Type": "text/html" }),
        text: async () => rawHtml,
      } as Response;
    };

    try {
      const url = "https://example.com/doc-page-cache-test";

      // First fetch — should hit network
      const result1 = await fetchUrl(url, {}, cacheConfig);
      assert.equal(result1.fromCache, false, "first fetch should not be from cache");
      assert.equal(tracker.callCount, 1, "first fetch should make exactly 1 HTTP call");

      // Second fetch — should hit cache
      const result2 = await fetchUrl(url, {}, cacheConfig);
      assert.equal(result2.fromCache, true, "second fetch should be from cache");
      assert.equal(
        tracker.callCount,
        1,
        `second fetch should not make a new HTTP call (got ${tracker.callCount} total calls)`
      );

      // Content should be identical
      assert.equal(
        result2.content,
        result1.content,
        "cached content should match original"
      );
    } finally {
      (global as Record<string, unknown>).fetch = originalFetch;
      tmp.cleanup();
    }
  });

  /**
   * integration_captcha_structuredError
   *
   * A CAPTCHA challenge page must cause fetchUrl to throw with "captcha" in
   * the error message (from validateResponse stage).
   */
  it("integration_captcha_structuredError", async () => {
    const captchaHtml = readFixture("captcha.html");
    const { restore } = mockFetch(captchaHtml) as unknown as {
      tracker: { callCount: number };
      restore: () => void;
    };

    try {
      await assert.rejects(
        () => fetchUrl("https://example.com/captcha", { noCache: true }, BASE_TEST_CONFIG),
        (err: Error) => {
          assert.ok(
            err.message.toLowerCase().includes("captcha"),
            `Expected error containing "captcha", got: "${err.message}"`
          );
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  /**
   * integration_injection_cleanOutput
   *
   * A page with all 8 injection attack types must produce clean output:
   * - No LLM delimiters (<|im_start|> etc.)
   * - No zero-width spaces (U+200B)
   * - No hidden div content leaking through
   * - result.sanitized must be non-empty (at least one removal was logged)
   */
  it("integration_injection_cleanOutput", async () => {
    const injectionHtml = readFixture("injection.html");
    const { restore } = mockFetch(injectionHtml) as unknown as {
      tracker: { callCount: number };
      restore: () => void;
    };

    try {
      const result = await fetchUrl(
        "https://example.com/injection",
        { noCache: true },
        BASE_TEST_CONFIG
      );

      // No LLM delimiters must survive
      assert.ok(
        !result.content.includes("<|im_start|>"),
        "LLM im_start delimiter must be removed"
      );
      assert.ok(
        !result.content.includes("<|im_end|>"),
        "LLM im_end delimiter must be removed"
      );
      assert.ok(
        !result.content.includes("[INST]"),
        "[INST] delimiter must be removed"
      );

      // No zero-width spaces
      assert.ok(
        !result.content.includes("\u200B"),
        "Zero-width space (U+200B) must be removed"
      );

      // Hidden div content must not appear
      assert.ok(
        !result.content.includes("HIDDEN INJECTION"),
        "Content from display:none div must be excluded"
      );
      assert.ok(
        !result.content.includes("developer mode"),
        "Injection payload from hidden element must be excluded"
      );

      // Sanitized array must be non-empty — at least some removal was detected
      assert.ok(
        result.sanitized.length > 0,
        `Expected at least one sanitization entry, got empty array. content: ${result.content.slice(0, 300)}`
      );

      // Legitimate article content must survive
      assert.ok(
        result.content.includes("Legitimate Content") ||
        result.content.includes("real") ||
        result.content.includes("sanitization"),
        `Expected legitimate article content in output. Got: ${result.content.slice(0, 400)}`
      );
    } finally {
      restore();
    }
  });

  /**
   * integration_ssrf_blocked
   *
   * validateUrl must throw for localhost (blocklisted hostname).
   * This confirms SSRF protection is active without needing DNS resolution.
   */
  it("integration_ssrf_blocked", async () => {
    await assert.rejects(
      () => validateUrl("http://localhost:8080/"),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes("ssrf") ||
          err.message.toLowerCase().includes("blocklist") ||
          err.message.toLowerCase().includes("blocked"),
          `Expected SSRF/blocklist error, got: "${err.message}"`
        );
        return true;
      }
    );

    // Also confirm 127.0.0.1 is blocked after DNS resolution
    // (127.0.0.1 is not on the hostname blocklist, but its IP resolves to loopback)
    // We test this via isPrivateIp indirectly: the message will contain "private IP"
    // For a URL with a numeric IP that is private, validateUrl should also block it
    // Note: 127.0.0.1 is not on BLOCKED_HOSTNAMES, it must pass DNS and then fail isPrivateIp
    // DNS lookup of a numeric IP should return the IP itself in most environments.
    await assert.rejects(
      () => validateUrl("http://192.168.1.1/admin"),
      (err: Error) => {
        // Either DNS fails or private IP check fires
        assert.ok(
          err.message.toLowerCase().includes("ssrf") ||
          err.message.toLowerCase().includes("private") ||
          err.message.toLowerCase().includes("dns") ||
          err.message.toLowerCase().includes("blocked"),
          `Expected SSRF/private IP error for RFC1918 address, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  /**
   * integration_urlNormalization_consistent
   *
   * Fetching a URL with UTM tracking parameters and the same URL without them
   * should both cache to the same key. After two fetches of the clean URL,
   * the second must be a cache hit (only 1 HTTP call total).
   */
  it("integration_urlNormalization_consistent", async () => {
    const rawHtml = readFixture("doc-page.html");
    const tmp = makeTempDir();

    const cacheConfig = {
      ...DEFAULT_CONFIG,
      cache: {
        ...DEFAULT_CONFIG.cache,
        enabled: true,
        dir: tmp.dir,
      },
      fetch: { ...DEFAULT_CONFIG.fetch, timeout: 5000, retryCount: 0 },
    };

    const tracker = { callCount: 0 };
    const originalFetch = (global as Record<string, unknown>).fetch;
    (global as Record<string, unknown>).fetch = async () => {
      tracker.callCount++;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "Content-Type": "text/html" }),
        text: async () => rawHtml,
      } as Response;
    };

    try {
      // Fetch with UTM params — normalized URL is cached
      const result1 = await fetchUrl(
        "https://example.com/tracking?utm_source=twitter&utm_medium=social",
        {},
        cacheConfig
      );
      assert.equal(result1.fromCache, false, "first fetch (with UTM) should be a cache miss");
      assert.equal(tracker.callCount, 1, "should make exactly 1 HTTP call");

      // Normalized URL (no UTM) must be a cache hit
      const result2 = await fetchUrl(
        "https://example.com/tracking",
        {},
        cacheConfig
      );
      assert.equal(result2.fromCache, true, "clean URL should hit cache populated by UTM URL");
      assert.equal(
        tracker.callCount,
        1,
        `normalized URL should not trigger a new HTTP call (got ${tracker.callCount})`
      );

      // Both results must have the same normalized URL
      assert.equal(
        result1.url,
        result2.url,
        "both results should have the same normalized URL"
      );
      assert.equal(result1.url, "https://example.com/tracking");
    } finally {
      (global as Record<string, unknown>).fetch = originalFetch;
      tmp.cleanup();
    }
  });

});
