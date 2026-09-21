// tests/egress-guard.test.ts
// Unit tests for scripts/lib/egress-guard.ts (pure redaction primitives).
// Each test is self-contained — no shared mutable state, no shared
// beforeEach. Run in isolation with:
//   node --test tests/egress-guard.test.ts

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
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
  neutralizeScanMarkers,
  resolveEgressDir,
  guardEgressFields,
} from "../scripts/lib/egress-guard.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

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

  it("redactSensitivePairs_quotedValueAfterEquals_redacts", () => {
    const { line, count } = redactSensitivePairs('TOKEN="abc123def456"');
    strictEqual(line, "TOKEN=[REDACTED:key]");
    strictEqual(count, 1);
  });

  it("redactSensitivePairs_spacedEquals_redactsKeepingSpaces", () => {
    const { line, count } = redactSensitivePairs("api_key = 'abc123def456'");
    strictEqual(line, "api_key = [REDACTED:key]");
    strictEqual(count, 1);
  });

  it("redactSensitivePairs_colonBareKey_redacts", () => {
    const { line, count } = redactSensitivePairs(
      "privateKey: abcdefghij1234567890",
    );
    strictEqual(line, "privateKey: [REDACTED:key]");
    strictEqual(count, 1);
  });

  it("redactSensitivePairs_nonSensitiveShapes_untouched", () => {
    const input = "file: scripts/x.ts path=foo https://host:8443/x";
    const { line, count } = redactSensitivePairs(input);
    strictEqual(line, input);
    strictEqual(count, 0);
  });

  it("redactSensitivePairs_jsonPairNotDoubleRedacted", () => {
    const { line, count } = redactSensitivePairs('{"api_key": "abc"}');
    strictEqual(line, '{"api_key": "[REDACTED:key]"}');
    strictEqual(count, 1);
  });
});

/**
 * Builds a run of `count` hex characters with maximal variety (a stride of 7
 * is coprime with the 16-symbol hex alphabet, so it visits every digit before
 * repeating). Computed at runtime — never a key-shaped string literal in this
 * file's source.
 */
function hexRun(count: number): string {
  const alphabet = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < count; i++) {
    out += alphabet[(i * 7 + 3) % alphabet.length];
  }
  return out;
}

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

  it("redactHighEntropyTokens_randomHex40_redacts", () => {
    const hex = hexRun(40);
    strictEqual(hex.length, 40);
    // A 40-slot hex run cannot reach the general 4.0 floor, so this token is
    // redacted only by the hex branch (>=32 chars, entropy >=3.0).
    ok(
      shannonEntropy(hex) < 4.0,
      `expected entropy < 4.0, got ${shannonEntropy(hex)}`,
    );
    ok(
      shannonEntropy(hex) >= 3.0,
      `expected entropy >= 3.0, got ${shannonEntropy(hex)}`,
    );
    const { line, count } = redactHighEntropyTokens(`hash ${hex}`);
    strictEqual(line, "hash [REDACTED:entropy]");
    strictEqual(count, 1);
  });

  it("redactHighEntropyTokens_repeatedHex_untouched", () => {
    const degenerate = "a".repeat(40);
    // A single-symbol distribution sums to -0, so compare the magnitude.
    strictEqual(Math.abs(shannonEntropy(degenerate)), 0);
    const { line, count } = redactHighEntropyTokens(degenerate);
    strictEqual(line, degenerate);
    strictEqual(count, 0);
  });

  it("redactHighEntropyTokens_hex31_untouched", () => {
    const hex = hexRun(31);
    strictEqual(hex.length, 31);
    // Below the 32-char hex floor and below the general 4.0 floor.
    ok(
      shannonEntropy(hex) < 4.0,
      `expected entropy < 4.0, got ${shannonEntropy(hex)}`,
    );
    const { line, count } = redactHighEntropyTokens(`hash ${hex}`);
    strictEqual(line, `hash ${hex}`);
    strictEqual(count, 0);
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
    // The prefix is "sha: ", not "token: ": `token` is a sensitive key and
    // `redactSensitivePairs` now also recognizes a `key: value` pair, so a
    // "token: " prefix would be consumed by the key pass before the entropy
    // pass ever saw the value. This field must reach the entropy pass for
    // the test to still cover both passes.
    const fields = ["privateKey=abcdefghij1234567890 rest", `sha: ${sample}`];
    const { fields: outFields, redactions } = redactFields(fields);
    strictEqual(outFields[0], "privateKey=[REDACTED:key] rest");
    strictEqual(outFields[1], "sha: [REDACTED:entropy]");
    strictEqual(redactions, 2);
  });
});

// ============================================================================
// guardEgressFields / resolveEgressDir — I/O half (staging, scrub
// subprocess, positive re-scan)
// ============================================================================

/**
 * Builds a run of `count` lowercase-alphanumeric characters with maximal
 * variety (a coprime stride over a 36-symbol alphabet visits every symbol
 * before repeating), so the result reliably clears the scanner's
 * length-aware entropy bar. Computed at runtime — never a high-entropy
 * string literal in this file's source.
 */
function highEntropyLower(count: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < count; i++) {
    out += alphabet[(i * 7 + 3) % alphabet.length];
  }
  return out;
}

/**
 * Same idea as {@link highEntropyLower} but over a 62-symbol mixed-case
 * alphanumeric alphabet, for fixtures that need mixed case.
 */
function highEntropyMixed(count: number): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < count; i++) {
    out += alphabet[(i * 17 + 5) % alphabet.length];
  }
  return out;
}

/**
 * Creates a throwaway root directory under the OS temp directory (never
 * inside this project), runs `fn` against it, then removes it. Kept
 * outside the project so `resolveEgressDir`'s containment check and the
 * scanner's own git-based project-root fallback (it shells out to `git
 * rev-parse --show-toplevel`, which would otherwise resolve to this repo)
 * both see the temp root as the whole world.
 */
function withTempRoot(fn: (root: string) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "egress-guard-")));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Like {@link withTempRoot}, but also copies the real security scanner
 * (`scripts/security-scanner.ts`, `scripts/lib/scan-rules.js`,
 * `.claude/security/allowlist.json`) into the throwaway root so
 * `guardEgressFields`'s default (real) `scrubCmd`/`scanCmd` can run against
 * it — the scanner loads `scan-rules.js` relative to its own file location,
 * so both files must land at the same relative paths as in this repo.
 */
function withCopiedScannerRoot(fn: (root: string) => void): void {
  withTempRoot((root) => {
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    mkdirSync(join(root, ".claude", "security"), { recursive: true });
    cpSync(
      join(PROJECT_ROOT, "scripts", "security-scanner.ts"),
      join(root, "scripts", "security-scanner.ts"),
    );
    cpSync(
      join(PROJECT_ROOT, "scripts", "lib", "scan-rules.js"),
      join(root, "scripts", "lib", "scan-rules.js"),
    );
    cpSync(
      join(PROJECT_ROOT, ".claude", "security", "allowlist.json"),
      join(root, ".claude", "security", "allowlist.json"),
    );
    fn(root);
  });
}

/** Stub commands that always succeed without touching the staged file. */
function okStubs(): {
  scrubCmd: (file: string) => { status: number };
  scanCmd: (file: string) => { status: number };
} {
  return {
    scrubCmd: () => ({ status: 0 }),
    scanCmd: () => ({ status: 0 }),
  };
}

describe("guardEgressFields — real scanner", () => {
  it("guardEgressFields_realScrub_redactsKnownPatterns", () => {
    withCopiedScannerRoot((root) => {
      const ghp = "ghp_" + highEntropyLower(36);
      const fields = [`token ${ghp}`, "other"];
      const result = guardEgressFields(fields, { projectRoot: root });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) return;
      ok(
        result.fields[0].includes("[REDACTED:"),
        `expected a redaction marker in field 0, got: ${result.fields[0]}`,
      );
      ok(
        !result.fields[0].includes(ghp),
        "the ghp_ token value must not appear in the returned field",
      );
      strictEqual(result.fields[1], "other");
      ok(
        result.redactions >= 0,
        `expected redactions >= 0, got ${result.redactions}`,
      );
      const remaining = readdirSync(join(root, ".claude", "logs", "jev"));
      strictEqual(
        remaining.length,
        0,
        `expected no files left in the egress dir, got: ${remaining.join(", ")}`,
      );
    });
  });

  it("guardEgressFields_bareSkToken_redactedByNewRule", () => {
    withCopiedScannerRoot((root) => {
      const sk = "sk-" + highEntropyMixed(40);
      const result = guardEgressFields([sk], { projectRoot: root });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) return;
      strictEqual(
        result.fields[0],
        "[REDACTED:bare-sk-token]",
        `expected the exact marker format, got: ${result.fields[0]}`,
      );
    });
  });
});

describe("guardEgressFields — refusal paths", () => {
  it("guardEgressFields_scrubExitsZeroButSecretRemains_refusesScrubFailed", () => {
    withTempRoot((root) => {
      const result = guardEgressFields(["secret"], {
        projectRoot: root,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 1 }),
      });
      ok(
        "refused" in result,
        `expected a refusal, got: ${JSON.stringify(result)}`,
      );
      if (!("refused" in result)) return;
      strictEqual(result.refused, "scrub-failed");
    });
  });

  it("guardEgressFields_scrubChangesLineCount_refusesScrubFailed", () => {
    withTempRoot((root) => {
      const result = guardEgressFields(["a", "b"], {
        projectRoot: root,
        scrubCmd: (file) => {
          writeFileSync(file, "only-one-line\n", "utf8");
          return { status: 0 };
        },
        scanCmd: () => ({ status: 0 }),
      });
      ok(
        "refused" in result,
        `expected a refusal, got: ${JSON.stringify(result)}`,
      );
      if (!("refused" in result)) return;
      strictEqual(result.refused, "scrub-failed");
    });
  });

  it("guardEgressFields_scrubThrows_refusesAndCleansUp", () => {
    withTempRoot((root) => {
      const result = guardEgressFields(["secret"], {
        projectRoot: root,
        scrubCmd: () => {
          throw new Error("boom");
        },
        scanCmd: () => ({ status: 0 }),
      });
      ok(
        "refused" in result,
        `expected a refusal, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) strictEqual(result.refused, "scrub-failed");

      const dir = join(root, ".claude", "logs", "jev");
      const remaining = readdirSync(dir);
      ok(
        !remaining.some((f) => f.startsWith("egress-")),
        `expected no egress-* residue, got: ${remaining.join(", ")}`,
      );
    });
  });

  it("guardEgressFields_egressDirSymlinkOutsideRoot_refusesEgressDirUnsafe", () => {
    withTempRoot((root) => {
      withTempRoot((outside) => {
        mkdirSync(join(root, ".claude", "logs"), { recursive: true });
        symlinkSync(outside, join(root, ".claude", "logs", "jev"));

        const result = guardEgressFields(["secret"], {
          ...okStubs(),
          projectRoot: root,
        });
        ok(
          "refused" in result,
          `expected a refusal, got: ${JSON.stringify(result)}`,
        );
        if ("refused" in result)
          strictEqual(result.refused, "egress-dir-unsafe");

        const outsideFiles = readdirSync(outside);
        strictEqual(
          outsideFiles.length,
          0,
          `expected no new files outside the root, got: ${outsideFiles.join(", ")}`,
        );
      });
    });
  });

  it("guardEgressFields_egressDirSymlinkToInRootSibling_proceeds", () => {
    withTempRoot((root) => {
      mkdirSync(join(root, ".claude", "logs", "jev-real"), {
        recursive: true,
      });
      mkdirSync(join(root, ".claude", "logs"), { recursive: true });
      symlinkSync(
        join(root, ".claude", "logs", "jev-real"),
        join(root, ".claude", "logs", "jev"),
      );

      const result = guardEgressFields(["a\nb"], {
        ...okStubs(),
        projectRoot: root,
      });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) return;
      strictEqual(result.fields[0], "a\nb");
    });
  });

  it("guardEgressFields_prefixCollisionDir_refusesEgressDirUnsafe", () => {
    withTempRoot((root) => {
      const evilDir = join(`${root}-evil`, "logs");
      try {
        const result = guardEgressFields(["secret"], {
          ...okStubs(),
          projectRoot: root,
          egressDir: evilDir,
        });
        ok(
          "refused" in result,
          `expected a refusal, got: ${JSON.stringify(result)}`,
        );
        if ("refused" in result) {
          strictEqual(result.refused, "egress-dir-unsafe");
        }
      } finally {
        rmSync(`${root}-evil`, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });

  it("guardEgressFields_fieldWithNewline_roundTripsAndCountsLines", () => {
    withTempRoot((root) => {
      const field = "a\nb\r\nc\\d";
      const result = guardEgressFields([field], {
        ...okStubs(),
        projectRoot: root,
      });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) return;
      strictEqual(result.fields[0], field);
    });
  });

  it("guardEgressFields_stagingFileMode_0600", (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX file mode bits are not meaningful on Windows");
      return;
    }
    withTempRoot((root) => {
      let capturedMode: number | undefined;
      const result = guardEgressFields(["secret"], {
        projectRoot: root,
        scrubCmd: (file) => {
          capturedMode = statSync(file).mode & 0o777;
          return { status: 0 };
        },
        scanCmd: () => ({ status: 0 }),
      });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      strictEqual(capturedMode, 0o600);
    });
  });

  it("guardEgressFields_defaultDeps_egressDirNotPreexisting_createsWith0700", () => {
    withTempRoot((root) => {
      const result = guardEgressFields(["secret"], {
        ...okStubs(),
        projectRoot: root,
      });
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      const dir = join(root, ".claude", "logs", "jev");
      const stat = statSync(dir);
      ok(stat.isDirectory(), "expected the egress dir to have been created");
      if (process.platform !== "win32") {
        strictEqual(stat.mode & 0o777, 0o700);
      }
    });
  });
});

describe("neutralizeScanMarkers", () => {
  it("neutralizeScanMarkers_mixedCase_replacesAll", () => {
    // Built at runtime so this source line does not itself carry the
    // scanner's inline allow marker.
    const marker = "scan" + ":" + "allow";
    const input = `x ${marker} y ${marker.toUpperCase()}`;
    strictEqual(neutralizeScanMarkers(input), "x scan-allow y scan-allow");
  });
});

describe("guardEgressFields — scan marker neutralization", () => {
  it("guardEgressFields_scanAllowInField_stagedTextHasNoMarker", () => {
    withTempRoot((root) => {
      const marker = "scan" + ":" + "allow";
      let stagedContent: string | undefined;
      const result = guardEgressFields([`leave ${marker} here`], {
        projectRoot: root,
        scrubCmd: (file) => {
          stagedContent = readFileSync(file, "utf8");
          return { status: 0 };
        },
        scanCmd: () => ({ status: 0 }),
      });
      strictEqual(stagedContent, "leave scan-allow here\n");
      ok(
        !stagedContent.includes(marker),
        `staged text must not carry the inline allow marker, got: ${stagedContent}`,
      );
      ok(
        !("refused" in result),
        `expected success, got: ${JSON.stringify(result)}`,
      );
      if ("refused" in result) return;
      strictEqual(result.fields[0], "leave scan-allow here");
      strictEqual(result.redactions, 0);
    });
  });
});

describe("resolveEgressDir", () => {
  it("resolveEgressDir_defaultDirInsideRoot_returnsRealpath", () => {
    withTempRoot((root) => {
      const resolved = resolveEgressDir(root);
      ok(resolved !== null, "expected a resolved directory, got null");
      strictEqual(resolved, realpathSync(join(root, ".claude", "logs", "jev")));
    });
  });
});
