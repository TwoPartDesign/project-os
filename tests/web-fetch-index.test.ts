/**
 * tests/web-fetch-index.test.ts
 * Unit tests for web-fetch index.ts exports.
 * Runnable in isolation: node --experimental-strip-types --test tests/web-fetch-index.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNodeVersion, parseCliArgs } from "../tools/web-fetch/src/index.ts";

// ============================================================================
// checkNodeVersion
// ============================================================================

test("index_versionGuard_rejectsOldNode", () => {
  assert.throws(
    () => checkNodeVersion("18.0.0"),
    (err: unknown) => {
      assert.ok(err instanceof Error, "should throw an Error");
      assert.ok(
        err.message.includes("requires Node.js >= 22"),
        `message should mention >= 22, got: ${err.message}`
      );
      assert.ok(
        err.message.includes("18.0.0"),
        `message should include the bad version, got: ${err.message}`
      );
      return true;
    }
  );
});

test("index_versionGuard_acceptsNode22", () => {
  // Should not throw
  assert.doesNotThrow(() => checkNodeVersion("22.0.0"));
});

test("index_versionGuard_acceptsNode23", () => {
  assert.doesNotThrow(() => checkNodeVersion("23.4.1"));
});

// ============================================================================
// parseCliArgs — fetch subcommand
// ============================================================================

test("index_cliMode_fetchSubcommand", () => {
  const result = parseCliArgs([
    "node",
    "index.ts",
    "fetch",
    "http://example.com",
    "--max-tokens",
    "100",
  ]);
  assert.equal(result.command, "fetch");
  assert.equal(result.url, "http://example.com");
  assert.equal(result.maxTokens, 100);
});

test("index_cliMode_fetchSubcommand_allFlags", () => {
  const result = parseCliArgs([
    "node",
    "index.ts",
    "fetch",
    "https://example.com/page",
    "--max-tokens",
    "500",
    "--start-index",
    "200",
    "--mode",
    "raw",
    "--no-cache",
    "--timeout",
    "5000",
  ]);
  assert.equal(result.command, "fetch");
  assert.equal(result.url, "https://example.com/page");
  assert.equal(result.maxTokens, 500);
  assert.equal(result.startIndex, 200);
  assert.equal(result.mode, "raw");
  assert.equal(result.noCache, true);
  assert.equal(result.timeout, 5000);
});

// ============================================================================
// parseCliArgs — --help flag
// ============================================================================

test("index_cliMode_helpFlag", () => {
  const result = parseCliArgs(["node", "index.ts", "--help"]);
  assert.equal(result.command, "help");
});

test("index_cliMode_helpShortFlag", () => {
  const result = parseCliArgs(["node", "index.ts", "-h"]);
  assert.equal(result.command, "help");
});

test("index_cliMode_noArgs_returnsHelp", () => {
  const result = parseCliArgs(["node", "index.ts"]);
  assert.equal(result.command, "help");
});

// ============================================================================
// parseCliArgs — cache subcommand
// ============================================================================

test("index_cliMode_cacheSubcommand", () => {
  const result = parseCliArgs(["node", "index.ts", "cache", "stats"]);
  assert.equal(result.command, "cache");
  assert.equal(result.action, "stats");
});

test("index_cliMode_cacheClear_noUrl", () => {
  const result = parseCliArgs(["node", "index.ts", "cache", "clear"]);
  assert.equal(result.command, "cache");
  assert.equal(result.action, "clear");
  assert.equal(result.cacheUrl, undefined);
});

test("index_cliMode_cacheClear_withUrl", () => {
  const result = parseCliArgs(["node", "index.ts", "cache", "clear", "https://example.com"]);
  assert.equal(result.command, "cache");
  assert.equal(result.action, "clear");
  assert.equal(result.cacheUrl, "https://example.com");
});

// ============================================================================
// parseCliArgs — --version flag
// ============================================================================

test("index_cliMode_versionFlag", () => {
  const result = parseCliArgs(["node", "index.ts", "--version"]);
  assert.equal(result.command, "version");
});
