#!/usr/bin/env node
// observation-parser.ts — Extract structured observations from tool output text
// Usage: node scripts/observation-parser.ts <file>
//        node scripts/observation-parser.ts --stdin
//        node scripts/observation-parser.ts --help
// Only uses Node.js built-in modules: fs, path, url, process

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Type Definitions (exported for tests)
// ============================================================================

export interface Observation {
  type: "error-pattern" | "file-relationship" | "config-key" | "function-sig" | "dependency-chain";
  content: string;
  confidence: "high" | "medium" | "low";
  line_number: number;
  metadata: Record<string, string>;
}

export interface ParseResult {
  observations: Observation[];
  raw_line_count: number;
  observation_count: number;
}

// ============================================================================
// Extraction functions (exported for tests)
// ============================================================================

/**
 * Extract error messages and stack traces from lines.
 * High confidence: explicit Error/TypeError/ReferenceError/ENOENT/EPERM
 * Medium confidence: FAIL/FAILED/stack trace lines (at Object./at Module.)
 */
export function extractErrorPatterns(lines: string[]): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();

  const highPrefixes = [
    "Error:",
    "TypeError:",
    "ReferenceError:",
    "ENOENT:",
    "EPERM:",
  ];

  // Stack trace patterns — match lines like "    at Object.<anonymous> ..."
  const stackTraceRe = /^\s+at (Object\.|Module\.)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for high-confidence error prefixes
    const isHighError = highPrefixes.some((prefix) => trimmed.startsWith(prefix));

    // Check for medium-confidence FAIL/FAILED
    const isFailLine = /^(FAIL|FAILED)\b/.test(trimmed);

    // Check for stack trace lines
    const isStackTrace = stackTraceRe.test(line);

    if (!isHighError && !isFailLine && !isStackTrace) continue;

    const confidence = isHighError ? "high" : "medium";

    // For error lines: collect the error line + up to 3 following stack trace lines
    if (isHighError || isFailLine) {
      let content = trimmed;
      let stackCount = 0;
      let j = i + 1;
      while (j < lines.length && stackCount < 3 && stackTraceRe.test(lines[j])) {
        content += "\n" + lines[j].trim();
        stackCount++;
        j++;
      }

      // Truncate to 500 chars max
      if (content.length > 500) {
        content = content.substring(0, 500);
      }

      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "error-pattern",
          content,
          confidence,
          line_number: i + 1,
          metadata: {},
        });
      }
    } else if (isStackTrace) {
      // Standalone stack trace line not following an error line
      const content = trimmed.substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "error-pattern",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: {},
        });
      }
    }
  }

  return observations;
}

/**
 * Extract import/require/source file relationships from lines.
 * Confidence: always "high"
 */
export function extractFileRelationships(lines: string[]): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();

  // Match: import ... from "path" or import ... from 'path'
  const importRe = /import\s+.*?\s+from\s+["']([^"']+)["']/;
  // Match: require("path") or require('path')
  const requireRe = /require\s*\(\s*["']([^"']+)["']\s*\)/;
  // Match: source "path" or source 'path' or source path (bash source command)
  // Assumption: we match `source` at word boundary followed by optional quotes and a non-space path
  const sourceRe = /\bsource\s+["']?([^\s"']+)["']?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    let matched = false;
    let to = "";
    let matchedText = trimmed;

    const importMatch = importRe.exec(line);
    if (importMatch) {
      to = importMatch[1];
      matched = true;
      matchedText = trimmed;
    }

    if (!matched) {
      const requireMatch = requireRe.exec(line);
      if (requireMatch) {
        to = requireMatch[1];
        matched = true;
        matchedText = trimmed;
      }
    }

    if (!matched) {
      const sourceMatch = sourceRe.exec(line);
      if (sourceMatch) {
        to = sourceMatch[1];
        matched = true;
        matchedText = trimmed;
      }
    }

    if (!matched) continue;

    const content = matchedText.substring(0, 500);
    if (seen.has(content)) continue;
    seen.add(content);

    observations.push({
      type: "file-relationship",
      content,
      confidence: "high",
      line_number: i + 1,
      metadata: { from: "", to },
    });
  }

  return observations;
}

/**
 * Extract configuration key-value pairs from lines.
 * Match env-var style (ALL_CAPS=value) and JSON-style ("key": "value")
 * Confidence: always "medium"
 */
export function extractConfigKeys(lines: string[]): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();

  // ENV VAR style: KEY=VALUE at start of line (uppercase letters, digits, underscores)
  const envVarRe = /^([A-Z][A-Z0-9_]*)=(.*)/;
  // JSON style: "key": "value" or "key": value (non-object values)
  const jsonKvRe = /"([a-zA-Z_]+)":\s*"?([^",}\n]+)"?/g;

  // Skip keys that may contain sensitive values
  const sensitivePatterns = /SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const envMatch = envVarRe.exec(trimmed);
    if (envMatch) {
      if (sensitivePatterns.test(envMatch[1])) continue;
      const key = envMatch[1];
      const value = envMatch[2].trim();
      const content = trimmed.substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "config-key",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { key, value },
        });
      }
      continue;
    }

    // JSON key-value: may have multiple per line
    // Reset lastIndex for the global regex
    jsonKvRe.lastIndex = 0;
    let jsonMatch: RegExpExecArray | null;
    while ((jsonMatch = jsonKvRe.exec(line)) !== null) {
      const key = jsonMatch[1];
      if (sensitivePatterns.test(key)) continue;
      const value = jsonMatch[2].trim();
      const content = `"${key}": "${value}"`;
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "config-key",
          content: content.substring(0, 500),
          confidence: "medium",
          line_number: i + 1,
          metadata: { key, value },
        });
      }
    }
  }

  return observations;
}

/**
 * Extract function signatures from lines.
 * High confidence: exported functions
 * Medium confidence: non-exported functions
 */
export function extractFunctionSigs(lines: string[]): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();

  // export (async )? function name(params)
  const exportFunctionRe = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/;
  // export const name = (async )?(params) =>
  // Assumption: we capture arrow functions assigned to const exports
  const exportConstRe = /export\s+const\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)/;
  // function name(params): returnType  — plain function with return type annotation
  const typedFunctionRe = /function\s+(\w+)\s*\(([^)]*)\)\s*:\s*(\w+)/;
  // Plain function without return type
  const plainFunctionRe = /function\s+(\w+)\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try export function first
    const expFnMatch = exportFunctionRe.exec(line);
    if (expFnMatch) {
      const isAsync = expFnMatch[1] ? "async " : "";
      const name = expFnMatch[2];
      const params = expFnMatch[3].trim();
      const content = line.trim().substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "function-sig",
          content,
          confidence: "high",
          line_number: i + 1,
          metadata: { name, params, return_type: "unknown", is_async: isAsync ? "true" : "false" },
        });
      }
      continue;
    }

    // Try export const arrow function
    const expConstMatch = exportConstRe.exec(line);
    if (expConstMatch) {
      const name = expConstMatch[1];
      const isAsync = expConstMatch[2] ? "async " : "";
      const params = expConstMatch[3].trim();
      const content = line.trim().substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "function-sig",
          content,
          confidence: "high",
          line_number: i + 1,
          metadata: { name, params, return_type: "unknown", is_async: isAsync ? "true" : "false" },
        });
      }
      continue;
    }

    // Try typed function (return type annotation)
    const typedFnMatch = typedFunctionRe.exec(line);
    if (typedFnMatch) {
      const name = typedFnMatch[1];
      const params = typedFnMatch[2].trim();
      const returnType = typedFnMatch[3];
      const content = line.trim().substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "function-sig",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { name, params, return_type: returnType },
        });
      }
      continue;
    }

    // Try plain function (no return type, no export)
    const plainFnMatch = plainFunctionRe.exec(line);
    if (plainFnMatch) {
      const name = plainFnMatch[1];
      const params = plainFnMatch[2].trim();
      const content = line.trim().substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "function-sig",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { name, params, return_type: "unknown" },
        });
      }
    }
  }

  return observations;
}

/**
 * Extract dependency references from lines.
 * Matches: depends: #T\d+, requires <something>, from "path" (import context)
 * Confidence: always "medium"
 */
export function extractDependencyChains(lines: string[]): Observation[] {
  const observations: Observation[] = [];
  const seen = new Set<string>();

  // ROADMAP-style task dependency: "depends: #T12" or "depends: #T1, #T2"
  const taskDepRe = /depends:\s*(#T\d+(?:\s*,\s*#T\d+)*)/i;
  // Shell/plain requires: "requires foo" or "requires ./script.sh"
  const requiresRe = /\brequires\s+(\S+)/i;
  // import ... from "path" — already captured by file-relationship,
  // but spec says to capture as dependency-chain too when preceded by import keyword
  const importFromRe = /\bimport\b.*?\bfrom\s+["']([^"']+)["']/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const taskDepMatch = taskDepRe.exec(trimmed);
    if (taskDepMatch) {
      const content = trimmed.substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "dependency-chain",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { subject: "current", depends_on: taskDepMatch[1] },
        });
      }
      continue;
    }

    const requiresMatch = requiresRe.exec(trimmed);
    if (requiresMatch) {
      const dep = requiresMatch[1];
      const content = trimmed.substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "dependency-chain",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { subject: "current", depends_on: dep },
        });
      }
      continue;
    }

    const importFromMatch = importFromRe.exec(line);
    if (importFromMatch) {
      const dep = importFromMatch[1];
      const content = trimmed.substring(0, 500);
      if (!seen.has(content)) {
        seen.add(content);
        observations.push({
          type: "dependency-chain",
          content,
          confidence: "medium",
          line_number: i + 1,
          metadata: { subject: "current", depends_on: dep },
        });
      }
    }
  }

  return observations;
}

// ============================================================================
// Main parse function (exported for tests)
// ============================================================================

/**
 * Parse tool output text and extract structured observations.
 * Runs all 5 extraction functions, deduplicates by content, caps at 100 total.
 * Priority order: high confidence first, then medium.
 */
export function parseObservations(text: string): Observation[] {
  const lines = text.split("\n");

  const all: Observation[] = [
    ...extractErrorPatterns(lines),
    ...extractFileRelationships(lines),
    ...extractConfigKeys(lines),
    ...extractFunctionSigs(lines),
    ...extractDependencyChains(lines),
  ];

  // Global dedup across all types: same (type, content) pair → keep first
  const globalSeen = new Set<string>();
  const deduped: Observation[] = [];
  for (const obs of all) {
    const key = `${obs.type}::${obs.content}`;
    if (!globalSeen.has(key)) {
      globalSeen.add(key);
      deduped.push(obs);
    }
  }

  // Sort: high confidence first, then medium, then low
  const rank = (o: Observation) => (o.confidence === "high" ? 0 : o.confidence === "medium" ? 1 : 2);
  deduped.sort((a, b) => rank(a) - rank(b));

  // Cap at 100
  return deduped.slice(0, 100);
}

// ============================================================================
// CLI helpers
// ============================================================================

function printHelp(): void {
  console.log("Usage:");
  console.log("  node scripts/observation-parser.ts <file>   — parse a file");
  console.log("  node scripts/observation-parser.ts --stdin  — read from stdin");
  console.log("  node scripts/observation-parser.ts --help   — show this help");
  console.log("");
  console.log("Output: JSON to stdout with extracted observations.");
  console.log("Exit 0 on success (even with 0 observations), exit 1 on errors.");
}

function readStdin(): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", rej);
  });
}

// ============================================================================
// Main (only runs when executed directly, not when imported)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  (async () => {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === "--help") {
      printHelp();
      process.exit(0);
    }

    let text: string;

    if (args[0] === "--stdin") {
      try {
        text = await readStdin();
      } catch (e) {
        console.error(`Error reading stdin: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    } else {
      const filePath = resolve(args[0]);
      try {
        text = readFileSync(filePath, "utf-8");
      } catch (e) {
        console.error(`Error reading file: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    }

    const lines = text.split("\n");
    const observations = parseObservations(text);

    const result: ParseResult = {
      observations,
      raw_line_count: lines.length,
      observation_count: observations.length,
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })();
}
