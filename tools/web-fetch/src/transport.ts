/**
 * JSON-RPC 2.0 stdio transport for MCP web-fetch server.
 * Never uses console.log — all stdout output is structured JSON-RPC.
 */

import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// MCP Tool Definitions
// ---------------------------------------------------------------------------

/** MCP tool schema definitions for all web-fetch tools. */
export const MCP_TOOL_DEFINITIONS = [
  {
    name: "fetch_readable",
    description: "Fetch a URL and return readable text content.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        max_tokens: { type: "number", description: "Max tokens to return" },
        start_index: { type: "number", description: "Token offset to start from" },
      },
      required: ["url"],
    },
  },
  {
    name: "fetch_raw",
    description: "Fetch a URL and return raw response body.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        max_length: { type: "number", description: "Max bytes to return" },
      },
      required: ["url"],
    },
  },
  {
    name: "cache_status",
    description: "Inspect or manage the fetch cache.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "clear", "stats"],
          description: "Cache action to perform",
        },
        url: { type: "string", description: "Filter cache entries by URL" },
      },
      required: ["action"],
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type ToolHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// StdioTransport
// ---------------------------------------------------------------------------

/** Hand-rolled MCP stdio transport. Reads line-delimited JSON-RPC 2.0 from stdin. */
export class StdioTransport {
  private handler: ToolHandler | null = null;

  constructor() {
    // Nothing to set up until start() is called.
  }

  /**
   * Register the tool call handler.
   * Called with (toolName, arguments) when tools/call is received.
   */
  onRequest(handler: ToolHandler): void {
    this.handler = handler;
  }

  /** Begin reading lines from stdin and dispatching JSON-RPC messages. */
  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      this._handleLine(trimmed, (response) => {
        if (response !== null) {
          process.stdout.write(response + "\n");
        }
      });
    });
  }

  /** Write a JSON-RPC success response to stdout. */
  sendResponse(id: string | number, result: unknown): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    process.stdout.write(msg + "\n");
  }

  /** Write a JSON-RPC error response to stdout. */
  sendError(id: string | number | null, code: number, message: string): void {
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    });
    process.stdout.write(msg + "\n");
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _handleLine(line: string, emit: (response: string | null) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req: any;
    try {
      req = JSON.parse(line);
    } catch {
      emit(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })
      );
      return;
    }

    this._dispatch(req)
      .then((response) => emit(response))
      .catch((err) => {
        const id = req?.id ?? null;
        console.error("[transport] unexpected error:", err);
        emit(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: "Internal error" },
          })
        );
      });
  }

  private async _dispatch(req: JsonRpcRequest): Promise<string | null> {
    // Validate basic JSON-RPC shape
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: req.id ?? null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }

    const id = req.id ?? null;

    // Notifications (no id) — some require responses, most don't
    if (req.method === "notifications/initialized") {
      // Notification: no response
      return null;
    }

    switch (req.method) {
      case "initialize": {
        const result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "web-fetch", version: "1.0.0" },
        };
        return JSON.stringify({ jsonrpc: "2.0", id, result });
      }

      case "tools/list": {
        const result = { tools: MCP_TOOL_DEFINITIONS };
        return JSON.stringify({ jsonrpc: "2.0", id, result });
      }

      case "tools/call": {
        return this._handleToolCall(id, req.params ?? {});
      }

      default: {
        // If this is a notification (no id), silently ignore
        if (id === null || id === undefined) return null;

        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
      }
    }
  }

  private async _handleToolCall(
    id: string | number | null,
    params: Record<string, unknown>
  ): Promise<string> {
    const toolName = params.name;
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    if (typeof toolName !== "string" || !toolName) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Invalid params: missing tool name" },
      });
    }

    // Validate required params per tool
    const validationError = this._validateToolArgs(toolName, args);
    if (validationError) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: validationError },
      });
    }

    if (!this.handler) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "Internal error: no handler registered" },
      });
    }

    try {
      const result = await this.handler(toolName, args);
      return JSON.stringify({ jsonrpc: "2.0", id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message },
      });
    }
  }

  private _validateToolArgs(toolName: string, args: Record<string, unknown>): string | null {
    switch (toolName) {
      case "fetch_readable":
      case "fetch_raw":
        if (typeof args.url !== "string" || !args.url) {
          return "Invalid params: url is required";
        }
        return null;

      case "cache_status":
        if (!["list", "clear", "stats"].includes(args.action as string)) {
          return "Invalid params: action must be list|clear|stats";
        }
        return null;

      default:
        return null; // Unknown tool — let handler deal with it
    }
  }
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * Parse one JSON-RPC line and return the serialised response string (or null
 * for notifications). Intended for unit tests — avoids real stdin/stdout.
 */
export async function processMessage(
  line: string,
  handler: ToolHandler
): Promise<string | null> {
  const transport = new StdioTransport();
  transport.onRequest(handler);

  const trimmed = line.trim();
  if (!trimmed) return null;

  let req: unknown;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  // Use the private dispatch via a small wrapper
  const result = await (transport as unknown as { _dispatch: (r: unknown) => Promise<string | null> })._dispatch(req as JsonRpcRequest);
  return result;
}
