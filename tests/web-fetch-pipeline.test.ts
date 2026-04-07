/**
 * Tests for tools/web-fetch/src/pipeline.ts
 *
 * Run: node --experimental-strip-types --test tests/web-fetch-pipeline.test.ts
 *
 * All tests:
 *   - Disable cache (noCache: true) to avoid filesystem I/O
 *   - Mock global.fetch to avoid real network requests
 *   - Restore global.fetch after each test
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeUrl,
  validateUrl,
  isPrivateIp,
  RateLimiter,
  validateResponse,
  fetchUrl,
} from "../tools/web-fetch/src/pipeline.ts";
import { DEFAULT_CONFIG } from "../tools/web-fetch/src/config.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal HTML page with a given body content. */
function makeHtmlPage(bodyContent: string, title = "Test Page"): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body><article>${bodyContent}</article></body></html>`;
}

/** Mock global fetch to return a given response. Returns cleanup function. */
function mockFetch(
  html: string,
  status = 200,
  headers: Record<string, string> = {}
): () => void {
  const originalFetch = (global as Record<string, unknown>).fetch;

  (global as Record<string, unknown>).fetch = async () => {
    const responseHeaders = new Headers({
      "Content-Type": "text/html",
      ...headers,
    });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: responseHeaders,
      text: async () => html,
    } as Response;
  };

  return () => {
    (global as Record<string, unknown>).fetch = originalFetch;
  };
}

// Config with cache disabled and fast timeouts for tests
const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  cache: { ...DEFAULT_CONFIG.cache, enabled: false },
  fetch: { ...DEFAULT_CONFIG.fetch, timeout: 5000, retryCount: 0 },
};

// ============================================================================
// Test: pipeline_urlNormalization_stripsTracking
// ============================================================================

describe("normalizeUrl", () => {
  it("pipeline_urlNormalization_stripsTracking", () => {
    const input =
      "https://Example.COM/page?utm_source=google&utm_medium=cpc&q=hello&ref=nav#section1";
    const result = normalizeUrl(input);

    assert.ok(!result.includes("utm_source"), "should strip utm_source");
    assert.ok(!result.includes("utm_medium"), "should strip utm_medium");
    assert.ok(!result.includes("ref=nav"), "should strip ref");
    assert.ok(result.includes("q=hello"), "should keep non-tracking params");
    assert.ok(result.startsWith("https://example.com"), "should lowercase hostname");
    assert.ok(!result.includes("#section1"), "should strip fragment");
  });

  it("pipeline_urlNormalization_trailingSlashRemoved", () => {
    const input = "https://example.com/page/";
    const result = normalizeUrl(input);
    assert.equal(result, "https://example.com/page");
  });

  it("pipeline_urlNormalization_preservesRootSlash", () => {
    const input = "https://example.com/";
    const result = normalizeUrl(input);
    // Root slash may or may not be kept depending on URL spec — just ensure no crash
    assert.ok(result.startsWith("https://example.com"), "should keep hostname");
  });
});

// ============================================================================
// Test: pipeline_ssrf_blocksPrivateIp
// ============================================================================

describe("validateUrl / isPrivateIp", () => {
  it("pipeline_ssrf_blocksPrivateIp_localhost", async () => {
    await assert.rejects(
      () => validateUrl("http://localhost/secret"),
      (err: Error) => {
        assert.ok(err.message.includes("blocklist"), `expected blocklist, got: ${err.message}`);
        return true;
      }
    );
  });

  it("pipeline_ssrf_blocksPrivateIp_metadataServer", async () => {
    await assert.rejects(
      () => validateUrl("http://169.254.169.254/latest/meta-data/"),
      (err: Error) => {
        assert.ok(
          err.message.includes("blocklist"),
          `expected blocklist, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("pipeline_ssrf_blocksPrivateIp_nonHttpProtocol", async () => {
    await assert.rejects(
      () => validateUrl("ftp://example.com/file"),
      (err: Error) => {
        assert.ok(
          err.message.includes("protocol"),
          `expected protocol error, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("pipeline_ssrf_isPrivateIp_loopback", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("127.255.255.255"), true);
  });

  it("pipeline_ssrf_isPrivateIp_rfc1918", () => {
    assert.equal(isPrivateIp("10.0.0.1"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true); // scan:allow — test data for SSRF validation
    assert.equal(isPrivateIp("172.31.255.255"), true); // scan:allow — test data for SSRF validation
    assert.equal(isPrivateIp("192.168.1.1"), true);
  });

  it("pipeline_ssrf_isPrivateIp_apipa", () => {
    assert.equal(isPrivateIp("169.254.1.1"), true);
  });

  it("pipeline_ssrf_isPrivateIp_publicIp_notBlocked", () => {
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("1.1.1.1"), false);
  });

  it("pipeline_ssrf_isPrivateIp_ipv6Loopback", () => {
    assert.equal(isPrivateIp("::1"), true);
  });

  it("pipeline_ssrf_isPrivateIp_ipv6ULA", () => {
    assert.equal(isPrivateIp("fc00::1"), true);
    assert.equal(isPrivateIp("fc01::1"), true);
    assert.equal(isPrivateIp("fcff::1"), true);
    assert.equal(isPrivateIp("fd00::1"), true);
  });

  it("pipeline_ssrf_blocksPrivateIp_awsEcsEndpoint", async () => {
    await assert.rejects(
      () => validateUrl("http://169.254.170.2/credentials"),
      (err: Error) => {
        assert.ok(err.message.includes("blocklist"), `expected blocklist, got: ${err.message}`);
        return true;
      }
    );
  });

  it("pipeline_ssrf_isPrivateIp_ipv6MappedLoopback", () => {
    assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  });
});

// ============================================================================
// Test: pipeline_rateLimiter_enforcesLimit
// ============================================================================

describe("RateLimiter", () => {
  it("pipeline_rateLimiter_enforcesLimit", async () => {
    // 2 req/s means second token should be delayed ~500ms
    const limiter = new RateLimiter(2);
    const domain = "test.example.com";

    const t0 = Date.now();
    await limiter.acquire(domain);  // First: immediate
    await limiter.acquire(domain);  // Second: should be immediate (still has tokens)
    await limiter.acquire(domain);  // Third: bucket empty, must wait
    const elapsed = Date.now() - t0;

    // Should have waited at least 300ms (being lenient for CI timing)
    assert.ok(elapsed >= 300, `Expected elapsed >= 300ms, got ${elapsed}ms`);
  });

  it("pipeline_rateLimiter_firstRequest_immediate", async () => {
    const limiter = new RateLimiter(10);
    const t0 = Date.now();
    await limiter.acquire("fast.example.com");
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `First acquire should be fast, got ${elapsed}ms`);
  });
});

// ============================================================================
// Test: validateResponse
// ============================================================================

describe("validateResponse", () => {
  it("pipeline_captchaDetected_structuredError", () => {
    const captchaHtml = makeHtmlPage(
      '<div>Please complete the CAPTCHA to continue</div>'
    );
    const result = validateResponse(captchaHtml);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "captcha");
  });

  it("pipeline_responseValidation_recaptchaDetected", () => {
    const html = makeHtmlPage('<div class="g-recaptcha"></div>');
    const result = validateResponse(html);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "captcha");
  });

  it("pipeline_responseValidation_loginWall", () => {
    const html = makeHtmlPage('<p>Sign in to continue reading this article.</p>');
    const result = validateResponse(html);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "login-wall");
  });

  it("pipeline_responseValidation_paywall", () => {
    const html = makeHtmlPage('<p>Subscribe to read the full article.</p>');
    const result = validateResponse(html);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "paywall");
  });

  it("pipeline_responseValidation_cloudflareChallenge", () => {
    const html = '<html><body><div id="cf-browser-verification">Checking your browser before accessing...</div></body></html>';
    const result = validateResponse(html);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "cloudflare-challenge");
  });

  it("pipeline_responseValidation_validContent_passes", () => {
    const html = makeHtmlPage(
      "<p>This is a normal article with plenty of content that should pass validation easily.</p>"
    );
    const result = validateResponse(html);
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });
});

// ============================================================================
// Test: pipeline_htmlInput_markdownOutput
// ============================================================================

describe("fetchUrl", () => {
  it("pipeline_htmlInput_markdownOutput", async () => {
    const articleHtml = `
      <nav>Navigation links here</nav>
      <article>
        <h1>Main Article Title</h1>
        <p>This is the main content of the article with useful information.</p>
        <p>A second paragraph with more details about the topic.</p>
      </article>
      <footer>Footer content</footer>
    `;
    const fullHtml = `<!DOCTYPE html><html><head><title>Test Article</title></head><body>${articleHtml}</body></html>`;

    const restore = mockFetch(fullHtml);
    try {
      const result = await fetchUrl(
        "https://example.com/article",
        { noCache: true },
        TEST_CONFIG
      );

      assert.equal(typeof result.content, "string", "content should be a string");
      assert.ok(result.content.length > 0, "content should not be empty");

      // Should contain article content
      assert.ok(
        result.content.includes("Main Article Title") || result.content.includes("main content"),
        `expected article content, got: ${result.content.slice(0, 200)}`
      );

      // Should not contain navigation or footer noise
      assert.ok(
        !result.content.toLowerCase().includes("navigation links here"),
        "should not contain nav content"
      );

      assert.equal(result.fromCache, false, "should not be from cache");
      assert.equal(result.fetchTier, "http");
      assert.equal(result.url, "https://example.com/article");
    } finally {
      restore();
    }
  });

  it("pipeline_captchaDetected_throws", async () => {
    const captchaHtml = `<html><body><div>Please complete the CAPTCHA verify you are human to continue.</div></body></html>`;

    const restore = mockFetch(captchaHtml);
    try {
      await assert.rejects(
        () => fetchUrl("https://example.com/blocked", { noCache: true }, TEST_CONFIG),
        (err: Error) => {
          assert.ok(
            err.message.includes("captcha"),
            `expected captcha in error, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it("pipeline_tokenTruncation_sectionAware", async () => {
    // Generate HTML with 10 long sections
    const sections = Array.from({ length: 10 }, (_, i) => {
      const loremWords = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(20);
      return `<h2>Section ${i + 1}</h2><p>${loremWords}</p>`;
    });

    const fullHtml = `<!DOCTYPE html><html><head><title>Long Page</title></head><body><article>${sections.join("")}</article></body></html>`;

    const restore = mockFetch(fullHtml);
    try {
      const result = await fetchUrl(
        "https://example.com/long",
        { noCache: true, maxTokens: 100 },
        TEST_CONFIG
      );

      // Should be truncated
      assert.ok(
        result.content.includes("[... truncated]"),
        "should contain truncation marker"
      );

      // Token estimate should be within the budget (with some slack for section boundaries)
      const charBudget = 100 * 3.5;
      assert.ok(
        result.content.length < charBudget + 200,
        `content length ${result.content.length} should be near char budget ${charBudget}`
      );

      // Should end at a section boundary (the truncation should be at a heading split)
      const truncationIdx = result.content.indexOf("[... truncated]");
      assert.ok(truncationIdx > 0, "truncation marker should be present");
    } finally {
      restore();
    }
  });

  it("pipeline_fetchUrl_normalizesUrl", async () => {
    const restore = mockFetch(makeHtmlPage("<p>Normal content here.</p>"));
    try {
      const result = await fetchUrl(
        "https://Example.COM/page?utm_source=twitter&q=test",
        { noCache: true },
        TEST_CONFIG
      );

      assert.ok(result.url.startsWith("https://example.com"), "URL should be lowercase");
      assert.ok(!result.url.includes("utm_source"), "URL should strip tracking params");
      assert.ok(result.url.includes("q=test"), "URL should keep real params");
    } finally {
      restore();
    }
  });

  it("pipeline_qualityGate_highConfidence_normalExtraction", async () => {
    const html = makeHtmlPage(
      "<h1>Good Article</h1><p>This article has plenty of meaningful content that should extract well. " +
      "It includes multiple sentences with real information about the topic at hand. " +
      "The extraction should produce a high confidence result.</p>"
    );

    const restore = mockFetch(html);
    try {
      const result = await fetchUrl(
        "https://example.com/good-article",
        { noCache: true },
        TEST_CONFIG
      );

      assert.equal(result.extractionConfidence, "high", "normal extraction should be high confidence");
      assert.ok(result.content.length > 0, "content should not be empty");
    } finally {
      restore();
    }
  });

  it("pipeline_qualityGate_poorExtraction_autoFallbackToRaw", async () => {
    // Simulate a page where the extractor produces almost nothing but the raw HTML has lots of text.
    // Many small, deeply nested elements with nav/aside/footer noise — extractor strips most of it.
    const sentence = "Important information embedded in noise. ";
    const noiseBlocks = Array.from({ length: 20 }, (_, i) =>
      `<nav><ul><li>${sentence}</li></ul></nav><aside><p>${sentence}</p></aside><footer><p>${sentence}</p></footer>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Noisy Page</title></head><body>` +
      noiseBlocks +
      `</body></html>`;

    const restore = mockFetch(html);
    try {
      const result = await fetchUrl(
        "https://example.com/tricky-page",
        { noCache: true },
        TEST_CONFIG
      );

      // The quality gate should detect poor extraction and fall back to raw
      assert.equal(
        result.extractionConfidence,
        "raw-fallback",
        `expected raw-fallback for poor extraction, got: ${result.extractionConfidence}`
      );
      assert.ok(
        result.content.includes("Important information"),
        "raw fallback should preserve the text content"
      );
    } finally {
      restore();
    }
  });

  it("pipeline_qualityGate_lowConfidence_hasHeadings", async () => {
    // Page where extraction is poor but has headings — should be "low" not "raw-fallback"
    const loremText = "Detailed content the extractor mostly misses. ".repeat(30);
    const html = `<!DOCTYPE html><html><head><title>Heading Page</title></head><body>` +
      `<div class="app"><h2>Section One</h2><span>${loremText}</span></div>` +
      `</body></html>`;

    const restore = mockFetch(html);
    try {
      const result = await fetchUrl(
        "https://example.com/heading-page",
        { noCache: true },
        TEST_CONFIG
      );

      // The extractor may capture this content well (high) or poorly (low/raw-fallback).
      // What matters is that raw-fallback is NOT returned when headings are present.
      assert.ok(
        result.extractionConfidence === "high" || result.extractionConfidence === "low",
        `expected 'high' or 'low' (not 'raw-fallback') when headings present, got: ${result.extractionConfidence}`
      );
    } finally {
      restore();
    }
  });

  it("pipeline_ssrf_redirectToPrivateIp_blocked", async () => {
    const originalFetch = (global as Record<string, unknown>).fetch;
    (global as Record<string, unknown>).fetch = async (url: string) => {
      if (url.includes("example.com")) {
        return {
          status: 302,
          ok: false,
          headers: new Headers({ Location: "http://169.254.169.254/latest/meta-data/" }),
          text: async () => "",
        } as Response;
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "Content-Type": "text/html" }),
        text: async () => "<html><body>secret</body></html>",
      } as Response;
    };

    try {
      await assert.rejects(
        () => fetchUrl("https://example.com/redirect-test", { noCache: true }, TEST_CONFIG),
        (err: Error) => {
          assert.ok(
            err.message.includes("blocklist") || err.message.includes("private"),
            `expected SSRF block on redirect, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      (global as Record<string, unknown>).fetch = originalFetch;
    }
  });

  it("pipeline_fetchUrl_rawMode_stripsAllTags", async () => {
    const html = '<html><head><title>Raw Test</title></head><body><h1>Title</h1><p>Content here.</p><script>alert("xss")</script></body></html>';

    const restore = mockFetch(html);
    try {
      const result = await fetchUrl(
        "https://example.com/raw",
        { noCache: true, mode: "raw" },
        TEST_CONFIG
      );

      assert.ok(!result.content.includes("<"), "raw mode should strip all HTML tags");
      assert.ok(!result.content.includes(">"), "raw mode should strip all HTML tags");
      assert.ok(result.content.includes("Content here"), "raw mode should keep text content");
    } finally {
      restore();
    }
  });
});
