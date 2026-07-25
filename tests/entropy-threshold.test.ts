// tests/entropy-threshold.test.ts
// Guards the length-aware entropy gate in scripts/security-scanner.ts (#T113).
//
// THE DEFECT: Shannon entropy of an N-character string is capped at log2(N),
// reached only when every character is distinct. With a fixed 4.5-bit
// threshold, any token of <= 22 characters has a ceiling of log2(22) = 4.46
// and could NEVER clear the bar. Every `entropy: true` rule matching a short
// token was dead code that reported "No findings" while detecting nothing --
// including `aws-access-token`, which is CRITICAL and matches a 20-char key.
//
// The scanner is a CLI, so these drive it end-to-end through real files rather
// than importing internals: the bug lived in the interaction between rule
// matching and the gate, which a unit test of the gate alone would have missed.

import { describe, it, before, after } from "node:test";
import { strictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER = resolve(ROOT, "scripts/security-scanner.ts");

// The scanner refuses paths outside the project root, so probes must live
// inside it. A dedicated directory keeps them out of the way and lets the
// suite clean up even if an assertion throws.
let probeDir: string;

before(() => {
  probeDir = mkdtempSync(join(ROOT, ".entropy-probe-"));
});
after(() => {
  rmSync(probeDir, { recursive: true, force: true });
});

/** Writes `content` to a probe file and returns the scanner's findings text. */
function scan(name: string, content: string): { out: string; found: boolean } {
  const file = join(probeDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf-8");
  let out = "";
  let found = false;
  try {
    out = execFileSync("node", [SCANNER, "scan-files", file], {
      cwd: ROOT,
      encoding: "utf-8",
    });
  } catch (err) {
    // Non-zero exit == findings present.
    const e = err as { stdout?: string; stderr?: string };
    out = (e.stdout ?? "") + (e.stderr ?? "");
    found = true;
  }
  ok(
    !/path outside project root|Fatal|Error:/.test(out),
    `scanner errored instead of scanning: ${out.slice(0, 200)}`,
  );
  return { out, found };
}

describe("length-aware entropy gate", () => {
  it("entropyGate_realAwsAccessKey_isDetectedAsCritical", () => {
    // The headline regression. 20 chars, 4.02 bits -- under the old fixed
    // 4.5-bit bar this CRITICAL rule silently never fired.
    const { out, found } = scan(
      "aws.txt",
      'aws_key = "AKIAQYLPMN5HG3WKZ7TQ"\n', // scan:allow — deliberate fixture, this rule firing IS the test
    );
    ok(found, `expected a finding, got: ${out}`);
    ok(
      /CRITICAL.*aws-access-token/.test(out),
      `expected a CRITICAL aws-access-token finding, got: ${out}`,
    );
  });

  it("entropyGate_lowEntropyPaddedKey_isNotDetected", () => {
    // Same length and same rule shape, but padded: 0.47 bits against a
    // 3.89-bit bar. The gate must still do its job at short lengths -- a fix
    // that simply disabled it would pass the test above and be worthless.
    const { out, found } = scan(
      "aws-padded.txt",
      'aws_key = "AKIAAAAAAAAAAAAAAAAA"\n',
    );
    strictEqual(found, false, `expected no finding, got: ${out}`);
  });

  it("entropyGate_awsDocumentationExampleKey_staysStopwordSuppressed", () => {
    // AKIAIOSFODNN7EXAMPLE is AWS's published example and is in
    // .claude/security/allowlist.json stopwords. Loosening the gate must not
    // resurrect it as a finding.
    const { out, found } = scan(
      "aws-example.txt",
      'aws_key = "AKIAIOSFODNN7EXAMPLE"\n',
    );
    strictEqual(found, false, `expected no finding, got: ${out}`);
  });

  it("entropyGate_ordinaryProseNearKeyword_isNotDetected", () => {
    // Regression for the false positive the first attempt at this fix caused:
    // at a 0.9 ratio applied globally, the capture "git-versioned" (13 chars,
    // 3.39 bits) fired as a secret in two committed markdown files. The
    // keyword-proximity rules keep the strict absolute bar for exactly this.
    const { out, found } = scan(
      "prose.md",
      "ROADMAP.md is the authoritative, git-versioned governance record for task state.\n",
    );
    strictEqual(
      found,
      false,
      `ordinary prose must not be a finding, got: ${out}`,
    );
  });

  it("entropyGate_highEntropyLongSecret_stillDetected", () => {
    // Long tokens must be unaffected: for len >= 32 the length term exceeds
    // 4.5, so the configured threshold still governs.
    const { out, found } = scan(
      "long.txt",
      'SECRET_KEY = "aB3xQ9mZ7pL2vK8nR4tY6wE1sD5fG0hJcU%iO+/zX"\n', // scan:allow — deliberate fixture, this rule firing IS the test
    );
    ok(found, `expected a finding, got: ${out}`);
  });

  it("entropyGate_longRepetitiveString_isNotDetected", () => {
    // A long low-entropy value must stay quiet under both the old and new
    // rules -- confirms the change did not become a blanket pass.
    const { out, found } = scan(
      "repetitive.txt",
      `SECRET_KEY = "${"ab".repeat(30)}"\n`,
    );
    strictEqual(found, false, `expected no finding, got: ${out}`);
  });

  it("entropyGate_noEntropyFlag_stillBypassesTheGate", () => {
    // --no-entropy must remain an escape hatch.
    const file = join(probeDir, "padded-noentropy.txt");
    writeFileSync(file, 'aws_key = "AKIAAAAAAAAAAAAAAAAA"\n', "utf-8");
    let out = "";
    let found = false;
    try {
      out = execFileSync(
        "node",
        [SCANNER, "scan-files", "--no-entropy", file],
        {
          cwd: ROOT,
          encoding: "utf-8",
        },
      );
    } catch (err) {
      const e = err as { stdout?: string };
      out = e.stdout ?? "";
      found = true;
    }
    ok(found, `--no-entropy should surface the padded key, got: ${out}`);
  });
});

describe("entropy threshold arithmetic", () => {
  // Pins the property that motivated the fix, independent of the CLI, so the
  // reasoning survives even if the rules change.
  const RATIO = 0.9;
  const CONFIGURED = 4.5;
  const bar = (len: number) =>
    len < 2 ? CONFIGURED : Math.min(CONFIGURED, Math.log2(len) * RATIO);

  it("entropyThreshold_shortTokens_areReachable", () => {
    // The old bar was unreachable for every length <= 22.
    for (const len of [8, 16, 20, 22]) {
      ok(
        Math.log2(len) < CONFIGURED,
        `precondition: log2(${len}) must be under the fixed bar`,
      );
      ok(
        bar(len) < Math.log2(len),
        `bar for len=${len} must sit below the achievable ceiling log2(${len})`,
      );
    }
  });

  it("entropyThreshold_lengthsAtOrAbove32_areUnchanged", () => {
    // log2(32) * 0.9 = 4.5, so from 32 up the configured threshold governs and
    // behaviour is bit-for-bit identical to before the change.
    for (const len of [32, 40, 64, 128]) {
      strictEqual(
        bar(len),
        CONFIGURED,
        `len=${len} must still use the configured threshold`,
      );
    }
  });

  it("entropyThreshold_isMonotonicallyMorePermissive", () => {
    // The change can only ADD detections, never remove one -- the safe
    // direction when altering 108 rules at once.
    for (let len = 2; len <= 256; len++) {
      ok(
        bar(len) <= CONFIGURED,
        `bar for len=${len} exceeded the old threshold`,
      );
    }
  });
});
