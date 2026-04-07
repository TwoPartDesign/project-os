/**
 * index.ts — Entry point for web-fetch MCP server and CLI.
 *
 * Mode detection: piped stdin (non-TTY) = MCP server mode; TTY = CLI mode.
 */

import { stdin, argv, stdout, exit } from "node:process";
import { StdioTransport, MCP_TOOL_DEFINITIONS } from "./transport.ts";
import { fetchUrl } from "./pipeline.ts";
import { loadConfig, type WebFetchConfig } from "./config.ts";
import { WebFetchCache } from "./cache.ts";

// ============================================================================
// Version guard
// ============================================================================

/**
 * Check that Node.js version meets the minimum requirement (>= 22).
 * Throws an Error if the version is too old; otherwise returns void.
 */
export function checkNodeVersion(version: string): void {
  const major = parseInt(version.split(".")[0], 10);
  if (isNaN(major) || major < 22) {
    throw new Error(
      `web-fetch requires Node.js >= 22. Current: ${version}`
    );
  }
}

// ============================================================================
// CLI argument parser
// ============================================================================

export interface CliArgs {
  command: "fetch" | "cache" | "help" | "version";
  url?: string;
  maxTokens?: number;
  startIndex?: number;
  mode?: "readable" | "raw" | "markdown";
  noCache?: boolean;
  timeout?: number;
  action?: "stats" | "clear" | "list";
  cacheUrl?: string;
}

/**
 * Parse CLI arguments from an argv-style array.
 * First two elements are expected to be [node, script] (skipped).
 */
export function parseCliArgs(args: string[]): CliArgs {
  const positional = args.slice(2);

  // --help / -h
  if (positional.includes("--help") || positional.includes("-h") || positional.length === 0) {
    return { command: "help" };
  }

  // --version
  if (positional.includes("--version")) {
    return { command: "version" };
  }

  const subcommand = positional[0];

  if (subcommand === "fetch") {
    const url = positional[1];
    if (!url || url.startsWith("--")) {
      return { command: "help" };
    }

    const result: CliArgs = { command: "fetch", url };

    for (let i = 2; i < positional.length; i++) {
      const flag = positional[i];
      if (flag === "--max-tokens" && positional[i + 1]) {
        result.maxTokens = parseInt(positional[i + 1], 10);
        i++;
      } else if (flag === "--start-index" && positional[i + 1]) {
        result.startIndex = parseInt(positional[i + 1], 10);
        i++;
      } else if (flag === "--mode" && positional[i + 1]) {
        result.mode = positional[i + 1] as "readable" | "raw" | "markdown";
        i++;
      } else if (flag === "--no-cache") {
        result.noCache = true;
      } else if (flag === "--timeout" && positional[i + 1]) {
        result.timeout = parseInt(positional[i + 1], 10);
        i++;
      }
    }

    return result;
  }

  if (subcommand === "cache") {
    const action = positional[1] as "stats" | "clear" | "list" | undefined;
    if (!action) {
      return { command: "help" };
    }
    const cacheUrl = positional[2];
    return { command: "cache", action, cacheUrl };
  }

  return { command: "help" };
}

// ============================================================================
// CLI runner
// ============================================================================

const USAGE = `
web-fetch — Fetch web content for Claude (MCP server + CLI)

Usage:
  web-fetch fetch <url> [options]    Fetch a URL and print content
  web-fetch cache stats              Show cache statistics
  web-fetch cache clear [url]        Clear all cache entries or a specific URL
  web-fetch --version                Print version
  web-fetch --help                   Print this help

Fetch options:
  --max-tokens N      Truncate output to N tokens (default: 15000)
  --start-index N     Start reading from character offset N
  --mode readable|raw|markdown  Extraction mode (default: readable)
  --no-cache          Bypass cache for this request
  --timeout N         Request timeout in milliseconds
`.trim();

async function runCli(args: CliArgs, config: WebFetchConfig): Promise<void> {
  switch (args.command) {
    case "help":
      stdout.write(USAGE + "\n");
      return;

    case "version":
      stdout.write("web-fetch 1.0.0\n");
      return;

    case "fetch": {
      if (!args.url) {
        stdout.write(USAGE + "\n");
        return;
      }
      const result = await fetchUrl(
        args.url,
        {
          maxTokens: args.maxTokens,
          startIndex: args.startIndex,
          mode: args.mode,
          noCache: args.noCache,
          timeout: args.timeout,
        },
        config
      );
      const header = result.title ? `# ${result.title}\n\n` : "";
      stdout.write(header + result.content + "\n");
      return;
    }

    case "cache": {
      const cache = new WebFetchCache(config.cache);
      try {
        if (args.action === "stats") {
          const s = cache.stats();
          stdout.write(
            `Cache entries: ${s.entries}\n` +
            `Total size: ${(s.totalSize / 1024).toFixed(1)} KB\n` +
            `Oldest access: ${s.oldestAccess ? new Date(s.oldestAccess).toISOString() : "never"}\n`
          );
        } else if (args.action === "clear") {
          cache.clear(args.cacheUrl);
          stdout.write(
            args.cacheUrl
              ? `Cleared cache entry for: ${args.cacheUrl}\n`
              : "Cache cleared.\n"
          );
        } else if (args.action === "list") {
          // list not implemented yet — fall back to stats
          const s = cache.stats();
          stdout.write(
            `Cache entries: ${s.entries}\n` +
            `Total size: ${(s.totalSize / 1024).toFixed(1)} KB\n`
          );
        }
      } finally {
        cache.close();
      }
      return;
    }
  }
}

// ============================================================================
// MCP handler
// ============================================================================

async function runMcp(config: WebFetchConfig): Promise<void> {
  const transport = new StdioTransport();

  transport.onRequest(async (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case "fetch_readable": {
        const url = params.url as string;
        const maxTokens = typeof params.max_tokens === "number" ? params.max_tokens : undefined;
        const startIndex = typeof params.start_index === "number" ? params.start_index : undefined;
        const result = await fetchUrl(url, { mode: "readable", maxTokens, startIndex }, config);
        return {
          content: [
            {
              type: "text",
              text: (result.title ? `# ${result.title}\n\n` : "") + result.content,
            },
          ],
        };
      }

      case "fetch_raw": {
        const url = params.url as string;
        const maxTokens = typeof params.max_length === "number" ? params.max_length : undefined;
        const result = await fetchUrl(url, { mode: "raw", maxTokens }, config);
        return {
          content: [{ type: "text", text: result.content }],
        };
      }

      case "cache_status": {
        const action = params.action as string;
        const cacheUrl = typeof params.url === "string" ? params.url : undefined;
        const cache = new WebFetchCache(config.cache);
        try {
          if (action === "stats" || action === "list") {
            // list not fully implemented — return stats for now
            const s = cache.stats();
            return {
              content: [
                {
                  type: "text",
                  text: `entries: ${s.entries}, totalSize: ${s.totalSize} bytes, oldestAccess: ${s.oldestAccess}`,
                },
              ],
            };
          } else if (action === "clear") {
            cache.clear(cacheUrl);
            return {
              content: [
                {
                  type: "text",
                  text: cacheUrl ? `Cleared: ${cacheUrl}` : "Cache cleared.",
                },
              ],
            };
          } else {
            throw new Error(`Unknown cache action: ${action}`);
          }
        } finally {
          cache.close();
        }
      }

      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  });

  transport.start();
}

// ============================================================================
// main()
// ============================================================================

/**
 * Entry point — detects MCP vs CLI mode and dispatches accordingly.
 */
export async function main(): Promise<void> {
  // Version guard
  checkNodeVersion(process.versions.node);

  const config = loadConfig();
  const isMcpMode = !stdin.isTTY;

  if (isMcpMode) {
    await runMcp(config);
  } else {
    const parsed = parseCliArgs(argv);
    try {
      await runCli(parsed, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      exit(1);
    }
  }
}

// ============================================================================
// Auto-start guard
// ============================================================================

// Run when executed directly (node index.ts) or via the compiled entry
const scriptPath = argv[1] ?? "";
if (
  import.meta.url === `file://${scriptPath}` ||
  scriptPath.endsWith("index.ts") ||
  scriptPath.endsWith("index.js")
) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  });
}
