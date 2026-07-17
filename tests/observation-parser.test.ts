// tests/observation-parser.test.ts
// Unit tests for scripts/observation-parser.ts (extractErrorPatterns,
// extractFileRelationships, extractConfigKeys, extractFunctionSigs,
// extractDependencyChains, parseObservations).
// Pattern follows tests/system-map.test.ts: node:test + node:assert, one
// describe block per exported function, each test self-contained (no shared
// state across tests).

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  extractErrorPatterns,
  extractFileRelationships,
  extractConfigKeys,
  extractFunctionSigs,
  extractDependencyChains,
  parseObservations,
} from "../scripts/observation-parser.ts";

// ==========================================================================
// extractErrorPatterns
// ==========================================================================

describe("extractErrorPatterns", () => {
  it("extractErrorPatterns_explicitTypeErrorLine_highConfidence", () => {
    const result = extractErrorPatterns(["TypeError: Cannot read property foo of undefined"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].type, "error-pattern");
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].content, "TypeError: Cannot read property foo of undefined");
    strictEqual(result[0].line_number, 1);
    deepStrictEqual(result[0].metadata, {});
  });

  it("extractErrorPatterns_failLine_mediumConfidence", () => {
    const result = extractErrorPatterns(["FAIL src/foo.test.ts"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].content, "FAIL src/foo.test.ts");
    strictEqual(result[0].line_number, 1);
  });

  it("extractErrorPatterns_standaloneStackTraceLine_mediumConfidence", () => {
    const result = extractErrorPatterns(["    at Object.<anonymous> (test.js:5:3)"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].content, "at Object.<anonymous> (test.js:5:3)");
    strictEqual(result[0].line_number, 1);
  });

  it("extractErrorPatterns_stackTraceFollowingError_mergedIntoContentAndAlsoEmittedStandalone", () => {
    // Documents actual behavior: the collection loop merges up to 3 following
    // stack-trace lines into the error observation's content, but the outer
    // loop still visits those same lines afterward and (since their
    // standalone trimmed text was never added to `seen`) emits them a
    // second time as separate medium-confidence observations. This is a
    // discrepancy from the docstring, which doesn't mention duplication.
    const result = extractErrorPatterns(["Error: boom", "    at Object.a (f.js:1:1)"]);
    strictEqual(result.length, 2);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].content, "Error: boom\nat Object.a (f.js:1:1)");
    strictEqual(result[0].line_number, 1);
    strictEqual(result[1].confidence, "medium");
    strictEqual(result[1].content, "at Object.a (f.js:1:1)");
    strictEqual(result[1].line_number, 2);
  });

  it("extractErrorPatterns_regularLogLine_noObservation", () => {
    const result = extractErrorPatterns(["Just a normal log line with no error indicators"]);
    deepStrictEqual(result, []);
  });

  it("extractErrorPatterns_duplicateErrorLines_deduped", () => {
    const result = extractErrorPatterns(["Error: same", "Error: same"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].line_number, 1);
  });
});

// ==========================================================================
// extractFileRelationships
// ==========================================================================

describe("extractFileRelationships", () => {
  it("extractFileRelationships_esImport_highConfidenceWithToPath", () => {
    const result = extractFileRelationships(['import { foo } from "./utils/foo.ts";']);
    strictEqual(result.length, 1);
    strictEqual(result[0].type, "file-relationship");
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].line_number, 1);
    deepStrictEqual(result[0].metadata, { from: "", to: "./utils/foo.ts" });
  });

  it("extractFileRelationships_commonJsRequire_highConfidenceWithToPath", () => {
    const result = extractFileRelationships(['const foo = require("./bar.js");']);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].metadata.to, "./bar.js");
    strictEqual(result[0].line_number, 1);
  });

  it("extractFileRelationships_bashSource_highConfidenceWithToPath", () => {
    const result = extractFileRelationships(["source scripts/lib/_common.sh"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].metadata.to, "scripts/lib/_common.sh");
    strictEqual(result[0].content, "source scripts/lib/_common.sh");
  });

  it("extractFileRelationships_lineWithoutImportKeyword_noObservation", () => {
    const result = extractFileRelationships(["console.log('just a log statement');"]);
    deepStrictEqual(result, []);
  });

  it("extractFileRelationships_duplicateImportLines_deduped", () => {
    const result = extractFileRelationships([
      'import x from "./a.ts";',
      'import x from "./a.ts";',
    ]);
    strictEqual(result.length, 1);
    strictEqual(result[0].line_number, 1);
  });
});

// ==========================================================================
// extractConfigKeys
// ==========================================================================

describe("extractConfigKeys", () => {
  it("extractConfigKeys_envVarStyle_mediumConfidenceWithKeyValueMetadata", () => {
    const result = extractConfigKeys(["PORT=3000"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].type, "config-key");
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].content, "PORT=3000");
    strictEqual(result[0].line_number, 1);
    deepStrictEqual(result[0].metadata, { key: "PORT", value: "3000" });
  });

  it("extractConfigKeys_jsonStyleMultipleKeysOnOneLine_bothExtracted", () => {
    const result = extractConfigKeys(['{"name": "project-os", "version": "1.0.0"}']);
    strictEqual(result.length, 2);
    strictEqual(result[0].metadata.key, "name");
    strictEqual(result[0].metadata.value, "project-os");
    strictEqual(result[1].metadata.key, "version");
    strictEqual(result[1].metadata.value, "1.0.0");
    strictEqual(result[0].line_number, 1);
  });

  it("extractConfigKeys_lowercaseAssignmentNoQuotes_noObservation", () => {
    const result = extractConfigKeys(["port=3000"]);
    deepStrictEqual(result, []);
  });

  it("extractConfigKeys_envAndJsonSecrets_excludedFromOutput", () => {
    const lines = [
      "PORT=3000",
      "API_KEY=sk-abcDEF123456789",
      '{"password": "hunter2", "name": "myapp"}',
      "AUTH_TOKEN=ghp_1234567890abcdef",
    ];
    const result = extractConfigKeys(lines);
    strictEqual(result.length, 2);
    const keys = result.map((o) => o.metadata.key);
    deepStrictEqual(keys, ["PORT", "name"]);
    const serialized = JSON.stringify(result);
    ok(!serialized.includes("sk-abcDEF123456789"), "API key value leaked into output");
    ok(!serialized.includes("hunter2"), "password value leaked into output");
    ok(!serialized.includes("ghp_1234567890abcdef"), "auth token value leaked into output");
  });

  it("extractConfigKeys_privateKeyAndCredentialKeys_excludedFromOutput", () => {
    const lines = ["PRIVATE_KEY=abc123", "DB_CREDENTIAL=xyz789", "SAFE_VALUE=ok"];
    const result = extractConfigKeys(lines);
    strictEqual(result.length, 1);
    strictEqual(result[0].metadata.key, "SAFE_VALUE");
    const serialized = JSON.stringify(result);
    ok(!serialized.includes("abc123"), "private key value leaked into output");
    ok(!serialized.includes("xyz789"), "credential value leaked into output");
  });

  it("extractConfigKeys_duplicateEnvVarLines_deduped", () => {
    const result = extractConfigKeys(["PORT=3000", "PORT=3000"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].line_number, 1);
  });
});

// ==========================================================================
// extractFunctionSigs
// ==========================================================================

describe("extractFunctionSigs", () => {
  it("extractFunctionSigs_exportFunction_highConfidence", () => {
    const result = extractFunctionSigs(["export function doThing(a: string, b: number) {"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].type, "function-sig");
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].line_number, 1);
    deepStrictEqual(result[0].metadata, {
      name: "doThing",
      params: "a: string, b: number",
      return_type: "unknown",
      is_async: "false",
    });
  });

  it("extractFunctionSigs_exportAsyncFunction_isAsyncTrue", () => {
    const result = extractFunctionSigs(["export async function fetchData(url: string) {"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].metadata.name, "fetchData");
    strictEqual(result[0].metadata.is_async, "true");
  });

  it("extractFunctionSigs_exportConstArrow_highConfidence", () => {
    const result = extractFunctionSigs(["export const parse = (text: string) => {"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].metadata.name, "parse");
    strictEqual(result[0].metadata.params, "text: string");
    strictEqual(result[0].metadata.is_async, "false");
  });

  it("extractFunctionSigs_typedFunction_mediumConfidenceWithReturnType", () => {
    const result = extractFunctionSigs(["function computeSum(a: number, b: number): number {"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].metadata.name, "computeSum");
    strictEqual(result[0].metadata.return_type, "number");
  });

  it("extractFunctionSigs_plainFunctionNoReturnType_mediumConfidence", () => {
    const result = extractFunctionSigs(["function helper(x) {"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].metadata.name, "helper");
    strictEqual(result[0].metadata.params, "x");
    strictEqual(result[0].metadata.return_type, "unknown");
  });

  it("extractFunctionSigs_nonFunctionLine_noObservation", () => {
    const result = extractFunctionSigs(["const x = 5;"]);
    deepStrictEqual(result, []);
  });
});

// ==========================================================================
// extractDependencyChains
// ==========================================================================

describe("extractDependencyChains", () => {
  it("extractDependencyChains_taskDependency_mediumConfidenceWithDependsOn", () => {
    const result = extractDependencyChains(["Task #T20 depends: #T12, #T13"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].type, "dependency-chain");
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].line_number, 1);
    deepStrictEqual(result[0].metadata, { subject: "current", depends_on: "#T12, #T13" });
  });

  it("extractDependencyChains_requiresKeywordOnLaterLine_mediumConfidenceWithLineNumber", () => {
    const result = extractDependencyChains([
      "one",
      "two",
      "This script requires ./lib/common.sh to run",
    ]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].line_number, 3);
    strictEqual(result[0].metadata.depends_on, "./lib/common.sh");
  });

  it("extractDependencyChains_importFrom_mediumConfidenceWithDependsOn", () => {
    const result = extractDependencyChains(['import { helper } from "./utils/helper.ts";']);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "medium");
    strictEqual(result[0].metadata.depends_on, "./utils/helper.ts");
    strictEqual(result[0].metadata.subject, "current");
  });

  it("extractDependencyChains_plainTextNoDependencyKeyword_noObservation", () => {
    const result = extractDependencyChains(["Just a plain comment with no keywords here"]);
    deepStrictEqual(result, []);
  });

  it("extractDependencyChains_duplicateDependsLines_deduped", () => {
    const result = extractDependencyChains(["depends: #T1", "depends: #T1"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].line_number, 1);
  });
});

// ==========================================================================
// parseObservations
// ==========================================================================

describe("parseObservations", () => {
  it("parseObservations_multiTypeFixture_containsAllFiveTypesWithExactCount", () => {
    const fixtureLines = [
      "TypeError: something broke",
      "PORT=3000",
      "export function doWork(x: number) {",
      'import { helper } from "./lib/helper.ts";',
      "depends: #T5",
    ];
    const text = fixtureLines.join("\n");

    // raw_line_count as computed by the CLI (text.split("\n").length) —
    // parseObservations itself only returns Observation[], not a ParseResult;
    // the CLI (isMain block) assembles {observations, raw_line_count,
    // observation_count} inline and is not separately exported.
    strictEqual(text.split("\n").length, 5);

    const observations = parseObservations(text);
    strictEqual(observations.length, 6);

    const types = new Set(observations.map((o) => o.type));
    deepStrictEqual(
      [...types].sort(),
      ["config-key", "dependency-chain", "error-pattern", "file-relationship", "function-sig"].sort(),
    );

    strictEqual(observations[0].type, "error-pattern");
    strictEqual(observations[0].confidence, "high");
    strictEqual(observations[0].line_number, 1);
  });

  it("parseObservations_emptyInput_emptyObservations", () => {
    const observations = parseObservations("");
    deepStrictEqual(observations, []);
    strictEqual(observations.length, 0);
  });

  it("parseObservations_over100RawObservations_cappedAtExactly100InOriginalOrder", () => {
    const lines: string[] = [];
    for (let i = 0; i < 150; i++) {
      lines.push(`KEY_${i}=v${i}`);
    }
    const text = lines.join("\n");
    const observations = parseObservations(text);
    strictEqual(observations.length, 100);
    strictEqual(observations[0].metadata.key, "KEY_0");
    strictEqual(observations[99].metadata.key, "KEY_99");
    ok(
      !observations.some((o) => o.metadata.key === "KEY_100"),
      "expected the 101st distinct observation to be dropped by the 100-item cap",
    );
  });
});
