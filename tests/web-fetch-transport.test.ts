/**
 * Unit tests for the JSON-RPC 2.0 stdio transport.
 * Uses processMessage() helper — no real stdin/stdout.
 * Run: node --experimental-strip-types --test tests/web-fetch-transport.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { processMessage, MCP_TOOL_DEFINITIONS } from "../tools/web-fetch/src/transport.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock handler that returns a fixed content response. */
async function mockContentHandler(
  _method: string,
  _params: Record<string, unknown>
): Promise<unknown> {
  return { content: [{ type: "text", text: "hello" }] };
}

/** Helper: run processMessage and parse the response JSON. */
async function call(
  line: string,
  handler = mockContentHandler
): Promise<Record<string, unknown>> {
  const raw = await processMessage(line, handler);
  assert.ok(raw !== null, "Expected a response string, got null");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("transport_validRequest_correctResponse", async () => {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "fetch_readable",
      arguments: { url: "http://example.com" },
    },
  });

  const resp = await call(req);

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 1);
  assert.ok("result" in resp, "Expected result key");
  const result = resp.result as Record<string, unknown>;
  assert.ok(Array.isArray(result.content), "Expected result.content to be an array");
  const first = (result.content as Array<Record<string, unknown>>)[0];
  assert.equal(first.type, "text");
  assert.equal(first.text, "hello");
});

test("transport_malformedJson_errorResponse", async () => {
  const resp = await call("not-json");

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, null);
  const error = resp.error as Record<string, unknown>;
  assert.equal(error.code, -32700);
  assert.equal(error.message, "Parse error");
});

test("transport_unknownMethod_methodNotFound", async () => {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "unknown/method",
  });

  const resp = await call(req);

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 2);
  const error = resp.error as Record<string, unknown>;
  assert.equal(error.code, -32601);
  assert.equal(error.message, "Method not found");
});

test("transport_missingParams_invalidParams", async () => {
  // tools/call with fetch_readable but no url
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "fetch_readable",
      arguments: {},
    },
  });

  const resp = await call(req);

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 3);
  const error = resp.error as Record<string, unknown>;
  assert.equal(error.code, -32602);
  assert.ok(
    typeof error.message === "string" && error.message.includes("url"),
    `Expected error about url, got: ${error.message}`
  );
});

test("transport_initialize_returnsServerInfo", async () => {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "initialize",
    params: {},
  });

  const resp = await call(req);

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 4);
  const result = resp.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, "2024-11-05");
  assert.ok("capabilities" in result, "Expected capabilities");
  const caps = result.capabilities as Record<string, unknown>;
  assert.ok("tools" in caps, "Expected capabilities.tools");
  assert.ok("serverInfo" in result, "Expected serverInfo");
  const info = result.serverInfo as Record<string, unknown>;
  assert.equal(info.name, "web-fetch");
  assert.equal(info.version, "1.0.0");
});

test("transport_toolsList_returnsDefinitions", async () => {
  const req = JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/list",
  });

  const resp = await call(req);

  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 5);
  const result = resp.result as Record<string, unknown>;
  assert.ok(Array.isArray(result.tools), "Expected tools array");
  const tools = result.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 3);

  // Verify all expected tool names are present
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("fetch_readable"), "Missing fetch_readable");
  assert.ok(names.includes("fetch_raw"), "Missing fetch_raw");
  assert.ok(names.includes("cache_status"), "Missing cache_status");

  // Cross-check against exported constant
  assert.equal(tools.length, MCP_TOOL_DEFINITIONS.length);
});
