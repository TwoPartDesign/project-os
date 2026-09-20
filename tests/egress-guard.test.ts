// tests/egress-guard.test.ts
// Unit tests for scripts/lib/egress-guard.ts (pure redaction primitives).
// Each test is self-contained — no shared mutable state, no shared
// beforeEach. Run in isolation with:
//   node --test tests/egress-guard.test.ts

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SENSITIVE_KEY_RE,
  isSensitiveKey,
  escapeField,
  unescapeField,
  redactSensitivePairs,
  shannonEntropy,
  redactHighEntropyTokens,
  redactFields,
} from "../scripts/lib/egress-guard.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("isSensitiveKey", () => {
  it("isSensitiveKey_matchesObservationParserOnFixture_hitsAndMissesAsExpected", () => {
    const expected: Array<[string, boolean]> = [
      ["api_key", true],
      ["apiKey", true],
      ["PRIVATE-KEY", true],
      ["authToken", true],
      ["password", true],
      ["credentials", true],
      ["apiVersion", false],
      // "authorName" contains the substring "auth" (case-insensitively),
      // so the ported regex — a plain substring test, not a word-boundary
      // one — genuinely matches it. Parity with observation-parser.ts wins
      // over the design brief's example, which assumed a miss here.
      ["authorName", true],
      ["keyboard", false],
      // "tokenizer_mode" strips to "tokenizermode", which starts with the
      // substring "token" — same substring-match reasoning as "authorName"
      // above, so this is genuinely a hit under the ported regex.
      ["tokenizer_mode", true],
      ["file", false],
      ["severity", false],
    ];
    for (const [key, want] of expected) {
      strictEqual(
        isSensitiveKey(key),
        want,
        `isSensitiveKey(${JSON.stringify(key)}) should be ${want}`,
      );
    }
  });

  it("isSensitiveKey_matchesObservationParserOnFixture_regexSourceParityWithObservationParser", () => {
    const parserSrc = readFileSync(
      resolve(__dirname, "../scripts/observation-parser.ts"),
      "utf8",
    );
    const match = parserSrc.match(
      /const sensitivePatterns\s*=\s*(\/.*?\/[a-z]*)\s*;/,
    );
    ok(
      match,
      "expected to find `const sensitivePatterns = /.../;` in observation-parser.ts",
    );
    const literalText = match![1];
    const lastSlash = literalText.lastIndexOf("/");
    const pattern = literalText.slice(1, lastSlash);
    const flags = literalText.slice(lastSlash + 1);
    const portedRegex = new RegExp(pattern, flags);
    strictEqual(SENSITIVE_KEY_RE.source, portedRegex.source);
    strictEqual(SENSITIVE_KEY_RE.flags, portedRegex.flags);
  });
});

describe("escapeField / unescapeField", () => {
  it("escapeField_roundTrip_identity", () => {
    const s = "line1\nline2\rline3\\tail\\nlit";
    const escaped = escapeField(s);
    ok(!escaped.includes("\n"), "escaped field must contain no raw newline");
    ok(
      !escaped.includes("\r"),
      "escaped field must contain no raw carriage return",
    );
    strictEqual(unescapeField(escaped), s);
  });
});

describe("redactSensitivePairs", () => {
  it("redactSensitivePairs_envStyle_redactsValue", () => {
    const { line, count } = redactSensitivePairs(
      "privateKey=abcdefghij1234567890 rest",
    );
    strictEqual(line, "privateKey=[REDACTED:key] rest");
    strictEqual(count, 1);
  });

  it("redactSensitivePairs_jsonStyle_redactsValue", () => {
    const { line, count } = redactSensitivePairs(
      '"api_key": "zzz", "file": "x"',
    );
    strictEqual(line, '"api_key": "[REDACTED:key]", "file": "x"');
    strictEqual(count, 1);
  });

  it("redactSensitivePairs_proseAuthentication_untouched", () => {
    const input = "missing authentication on the endpoint";
    const { line, count } = redactSensitivePairs(input);
    strictEqual(line, input);
    strictEqual(count, 0);
  });
});

describe("redactHighEntropyTokens", () => {
  it("redactHighEntropyTokens_base64Like40Chars_redacted", () => {
    const sample = "aB3xQ9zK7mN2pR8vC1tW6yU4hL5jF0gS9dEoIuY7";
    strictEqual(sample.length, 40);
    ok(
      shannonEntropy(sample) >= 4.0,
      `expected entropy >= 4.0, got ${shannonEntropy(sample)}`,
    );
    // "=" is in the token charset [A-Za-z0-9_\-/+=], so a "key=" prefix
    // merges into the same token match — use "token: " (colon+space, both
    // outside the charset) to keep the prefix a separate, unredacted run.
    const { line, count } = redactHighEntropyTokens(`token: ${sample}`);
    strictEqual(line, "token: [REDACTED:entropy]");
    strictEqual(count, 1);
  });

  it("redactHighEntropyTokens_lowEntropyPath_untouched", () => {
    const path = "scripts/lib/scan-rules.js/scan-rules.js";
    ok(
      shannonEntropy(path) < 4.0,
      `expected entropy < 4.0, got ${shannonEntropy(path)}`,
    );
    const { line, count } = redactHighEntropyTokens(path);
    strictEqual(line, path);
    strictEqual(count, 0);
  });

  it("redactHighEntropyTokens_gitSha_redactedAccepted", () => {
    // A 40-hex string cannot mathematically reach entropy 4.0 (16 symbols
    // into 40 slots maxes at ~3.971), so this uses a 64-hex SHA-256-style
    // hash instead, with each of the 16 hex digits appearing exactly 4
    // times — the only integer distribution that hits log2(16) = 4.0
    // exactly for a hex alphabet.
    const sha =
      "cfafb6e304ab927b5d4ac05ece2f93712d4d194ed90b56f82608a358c1763187";
    strictEqual(sha.length, 64);
    ok(
      shannonEntropy(sha) >= 4.0,
      `expected entropy >= 4.0, got ${shannonEntropy(sha)}`,
    );
    const { line, count } = redactHighEntropyTokens(`sha: ${sha}`);
    strictEqual(line, "sha: [REDACTED:entropy]");
    strictEqual(count, 1);
  });

  it("redactHighEntropyTokens_alreadyRedacted_notDoubleWrapped", () => {
    const input = "[REDACTED:bare-sk-token]";
    const { line, count } = redactHighEntropyTokens(input);
    strictEqual(line, input);
    strictEqual(count, 0);
  });
});

describe("redactFields", () => {
  it("redactFields_countsAcrossFields_sumsBothFields", () => {
    const sample = "aB3xQ9zK7mN2pR8vC1tW6yU4hL5jF0gS9dEoIuY7";
    const fields = ["privateKey=abcdefghij1234567890 rest", `token: ${sample}`];
    const { fields: outFields, redactions } = redactFields(fields);
    strictEqual(outFields[0], "privateKey=[REDACTED:key] rest");
    strictEqual(outFields[1], "token: [REDACTED:entropy]");
    strictEqual(redactions, 2);
  });
});
