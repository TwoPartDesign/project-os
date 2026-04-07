import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, DEFAULT_CONFIG } from "../tools/web-fetch/src/config.ts";

// ── config_defaults_appliedWhenMissing ─────────────────────────────────────────

test("config_defaults_appliedWhenMissing", () => {
  const result = loadConfig("/nonexistent/path/that/does/not/exist.json");
  assert.deepEqual(result, DEFAULT_CONFIG);
});

// ── config_override_mergedCorrectly ───────────────────────────────────────────

test("config_override_mergedCorrectly", () => {
  const tempPath = join(tmpdir(), "web-fetch-test-override.json");
  writeFileSync(tempPath, JSON.stringify({ fetch: { timeout: 5000 } }), "utf8");

  try {
    const result = loadConfig(tempPath);

    // overridden field
    assert.equal(result.fetch.timeout, 5000);

    // other fetch fields remain defaults
    assert.equal(result.fetch.retryCount, DEFAULT_CONFIG.fetch.retryCount);
    assert.equal(result.fetch.retryBaseDelay, DEFAULT_CONFIG.fetch.retryBaseDelay);
    assert.equal(result.fetch.userAgent, DEFAULT_CONFIG.fetch.userAgent);
    assert.equal(result.fetch.headlessThreshold, DEFAULT_CONFIG.fetch.headlessThreshold);

    // unrelated sections remain defaults
    assert.deepEqual(result.extraction, DEFAULT_CONFIG.extraction);
    assert.deepEqual(result.cache, DEFAULT_CONFIG.cache);
    assert.deepEqual(result.rateLimit, DEFAULT_CONFIG.rateLimit);
    assert.deepEqual(result.wayback, DEFAULT_CONFIG.wayback);
  } finally {
    unlinkSync(tempPath);
  }
});

// ── config_invalidJson_throwsClearError ───────────────────────────────────────

test("config_invalidJson_throwsClearError", () => {
  const tempPath = join(tmpdir(), "web-fetch-test-invalid.json");
  writeFileSync(tempPath, "{ this is not valid json }", "utf8");

  try {
    assert.throws(
      () => loadConfig(tempPath),
      (err: unknown) => {
        assert.ok(err instanceof Error, "expected an Error instance");
        assert.ok(
          err.message.includes("web-fetch"),
          `expected 'web-fetch' in message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("config file"),
          `expected 'config file' in message, got: ${err.message}`
        );
        return true;
      }
    );
  } finally {
    unlinkSync(tempPath);
  }
});
