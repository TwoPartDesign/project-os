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
  parse,
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

  it("extractErrorPatterns_stackTraceFollowingError_mergedIntoContentNotEmittedStandalone", () => {
    // Fixed behavior (T55): the collection loop merges up to 3 following
    // stack-trace lines into the error observation's content, and those same
    // lines are now marked as seen (and skipped by the outer loop's index),
    // so they are NOT also emitted a second time as separate medium-
    // confidence observations.
    const result = extractErrorPatterns(["Error: boom", "    at Object.a (f.js:1:1)"]);
    strictEqual(result.length, 1);
    strictEqual(result[0].confidence, "high");
    strictEqual(result[0].content, "Error: boom\nat Object.a (f.js:1:1)");
    strictEqual(result[0].line_number, 1);
  });

  it("extractErrorPatterns_fourStackTraceLinesFollowingError_fourthEmittedStandalone", () => {
    // The merge cap is 3 following stack-trace lines; a 4th genuinely
    // separate stack line beyond the cap is still emitted on its own,
    // proving the T55 fix only suppresses the lines actually merged.
    const result = extractErrorPatterns([
      "Error: boom",
      "    at Object.a (f.js:1:1)",
      "    at Object.b (f.js:2:1)",
      "    at Object.c (f.js:3:1)",
      "    at Object.d (f.js:4:1)",
    ]);
    strictEqual(result.length, 2);
    strictEqual(result[0].confidence, "high");
    strictEqual(
      result[0].content,
      "Error: boom\nat Object.a (f.js:1:1)\nat Object.b (f.js:2:1)\nat Object.c (f.js:3:1)",
    );
    strictEqual(result[1].confidence, "medium");
    strictEqual(result[1].content, "at Object.d (f.js:4:1)");
    strictEqual(result[1].line_number, 5);
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

  it("extractConfigKeys_camelCaseSecretKeys_excludedFromOutput", () => {
    // Regression: separator-free camelCase keys (apiKey, privateKey) must be
    // caught by the denylist too — they'd otherwise slip past the underscored
    // API_KEY/PRIVATE_KEY forms and leak the secret value into the index.
    const lines = [
      '{"apiKey": "sk-ant-SHOULD-NOT-LEAK", "name": "app"}',
      '{"privateKey": "-----BEGIN-SHOULD-NOT-LEAK-----"}',
      '{"authToken": "ghp_SHOULD_NOT_LEAK"}',
    ];
    const result = extractConfigKeys(lines);
    const keys = result.map((o) => o.metadata.key);
    deepStrictEqual(keys, ["name"]);
    const serialized = JSON.stringify(result);
    ok(!serialized.includes("SHOULD-NOT-LEAK"), "camelCase apiKey/privateKey value leaked");
    ok(!serialized.includes("SHOULD_NOT_LEAK"), "camelCase authToken value leaked");
  });

  it("extractConfigKeys_digitBearingNonSecretJsonKey_extracted", () => {
    // T57: the JSON key regex previously excluded digits, so keys like
    // "s3Bucket" were silently skipped even though they're not sensitive.
    const result = extractConfigKeys(['{"s3Bucket": "my-bucket", "name": "app"}']);
    strictEqual(result.length, 2);
    const keys = result.map((o) => o.metadata.key);
    deepStrictEqual(keys, ["s3Bucket", "name"]);
    strictEqual(result[0].metadata.value, "my-bucket");
  });

  it("extractConfigKeys_digitBearingSecretJsonKeys_excludedFromOutput", () => {
    // T57 regression guard: widening the JSON key charset to allow digits
    // must not bypass the sensitive-key denylist for digit-bearing secret
    // keys like "oauth2Token" / "s3Secret".
    const lines = [
      '{"oauth2Token": "ya29.SHOULD-NOT-LEAK", "s3Secret": "AKIA-SHOULD-NOT-LEAK", "s3Bucket": "public-bucket"}',
    ];
    const result = extractConfigKeys(lines);
    const keys = result.map((o) => o.metadata.key);
    deepStrictEqual(keys, ["s3Bucket"]);
    const serialized = JSON.stringify(result);
    ok(!serialized.includes("SHOULD-NOT-LEAK"), "digit-bearing secret key value leaked into output");
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
    // parseObservations() itself only returns Observation[], not a
    // ParseResult; the CLI (isMain block) uses the exported parse() wrapper
    // (see the "parse" describe block below) to get raw_line_count /
    // observation_count alongside the observations.
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

// ==========================================================================
// parse (T56: exported ParseResult wrapper around parseObservations)
// ==========================================================================

describe("parse", () => {
  it("parse_multiTypeFixture_returnsParseResultShapeMatchingParseObservations", () => {
    const fixtureLines = ["TypeError: something broke", "PORT=3000"];
    const text = fixtureLines.join("\n");

    const result = parse(text);

    strictEqual(result.raw_line_count, 2);
    strictEqual(result.observation_count, result.observations.length);
    strictEqual(result.observation_count, 2);
    deepStrictEqual(result.observations, parseObservations(text));
  });

  it("parse_emptyInput_zeroCountsWithOneRawLine", () => {
    // "".split("\n") is [""], so raw_line_count is 1 for an empty string —
    // matches the CLI's prior inline computation of lines.length.
    const result = parse("");
    strictEqual(result.raw_line_count, 1);
    strictEqual(result.observation_count, 0);
    deepStrictEqual(result.observations, []);
  });
});
