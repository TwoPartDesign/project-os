// tests/critical-rules.test.ts
// #T115: every CRITICAL-severity rule must be able to fire.
//
// The recurring failure in this scanner has not been "a rule matched the wrong
// thing" — it has been "a rule silently matched NOTHING while the scanner
// reported No findings":
//   #T112  the whole module was a syntax error on the declared minimum Node
//   #T113  the entropy bar was mathematically unreachable for short tokens
//   #T114  24 rules shipped with `regex: null`
//   #T116  22 rules had an entropy gate their token alphabet could never clear
// Every one of those was invisible because nothing asserted that a rule can
// actually produce a finding. CRITICAL rules are where that hurts most, so
// this file pins them.
//
// Fixtures are built by concatenation, never written as literals: these match
// real vendor formats, and committing token-shaped literals causes GitHub push
// protection to reject the push (it did, on the first attempt at #T114).

import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = resolve(ROOT, "scripts/lib/scan-rules.js");

interface LoadedRule {
  id: string;
  regex: RegExp | null;
  entropy?: boolean;
  severity: string;
}

const { rules, ENTROPY_THRESHOLD } = (await import(RULES_PATH)) as {
  rules: LoadedRule[];
  ENTROPY_THRESHOLD: number;
};
const byId = new Map(rules.map((r) => [r.id, r]));
const CRITICAL = rules.filter((r) => r.severity === "CRITICAL");

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HEX = "0123456789abcdef";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Deterministic high-variety filler, so fixtures clear any live entropy gate. */
function body(n: number, alphabet: string = ALNUM): string {
  let s = "";
  const stride = 7;
  for (let i = 0; i < n; i++)
    s += alphabet[(i * stride + i * i) % alphabet.length];
  return s;
}

/** Fixtures for CRITICAL rules that carry a constructible token format. */
const CRITICAL_FIXTURES: ReadonlyArray<{ id: string; hit: string }> = [
  { id: "aws-access-token", hit: "AKIA" + body(16, B32) },
  { id: "databricks-api-token", hit: "dapi" + body(32, HEX) },
  { id: "sendgrid-api-token", hit: "SG." + body(22) + "." + body(43) },
  { id: "github-pat", hit: "ghp_" + body(36) },
  { id: "github-oauth", hit: "gho_" + body(36) },
  { id: "github-app-token", hit: "ghu_" + body(36) },
  { id: "github-refresh-token", hit: "ghr_" + body(36) },
  { id: "vault-service-token", hit: "hvs." + body(90) },
  { id: "anthropic-api-key", hit: "sk-ant-api03-" + body(93) + "AA" },
  {
    id: "anthropic-admin-api-key",
    hit: "sk-ant-admin01-" + body(93) + "AA",
  },
];

describe("CRITICAL rules can fire (#T115)", () => {
  for (const f of CRITICAL_FIXTURES) {
    it(`criticalRule_${f.id.replace(/-/g, "_")}_matchesAWellFormedToken`, () => {
      const rule = byId.get(f.id);
      ok(rule, `CRITICAL rule ${f.id} not found`);
      ok(
        rule.regex,
        `CRITICAL rule ${f.id} has a null regex — it detects nothing`,
      );
      const re = new RegExp(
        rule.regex.source,
        rule.regex.flags.replace("g", ""),
      );
      ok(
        re.test(f.hit),
        `CRITICAL rule ${f.id} did not match a well-formed token of its own documented shape`,
      );
    });
  }
});

describe("no CRITICAL rule is structurally dead", () => {
  it("criticalRules_noneHasANullRegexExceptTheDocumentedOne", () => {
    // pkcs12-file is null BY DECISION (#T114): it detects a binary container,
    // for which a line-oriented content regex is the wrong mechanism.
    const nulls = CRITICAL.filter((r) => !r.regex).map((r) => r.id);
    strictEqual(
      nulls.join(","),
      "pkcs12-file",
      `unexpected CRITICAL rule(s) with a null regex: ${nulls.join(", ")}`,
    );
  });

  it("criticalRules_noneHasAnUnreachableEntropyGate", () => {
    // The #T116 class, pinned for CRITICAL rules specifically. A capture drawn
    // from an alphabet of size A over at least L characters has Shannon entropy
    // bounded by min(log2 A, log2 L). If that ceiling is below the rule's bar,
    // the rule can never fire no matter the input -- which is exactly how
    // databricks-api-token sat dead at CRITICAL.
    const RATIO = 0.9;
    const dead: string[] = [];
    for (const r of CRITICAL) {
      if (!r.entropy || !r.regex) continue;
      const classes = [
        ...r.regex.source.matchAll(/\[([^\]]+)\]\{(\d+)(?:,(\d+))?\}/g),
      ];
      if (!classes.length) continue;
      const [, cls, min] = classes[classes.length - 1];
      let size = 0;
      if (/a-z/.test(cls)) size += 26;
      if (/A-Z/.test(cls)) size += 26;
      if (/0-9/.test(cls)) size += 10;
      if (/a-f(?!A)/.test(cls) && !/a-z/.test(cls)) size += 6;
      if (/A-F/.test(cls) && !/A-Z/.test(cls)) size += 6;
      if (/2-7/.test(cls)) size += 6;
      if (/\\w/.test(cls)) size += 63;
      for (const ch of ["_", "-", "+", "/", "=", "."])
        if (cls.includes(ch)) size += 1;
      if (!size) continue;
      const len = Math.max(Number(min), 2);
      const bar = Math.min(ENTROPY_THRESHOLD, Math.log2(len) * RATIO);
      const ceiling = Math.min(Math.log2(size), Math.log2(len));
      if (ceiling < bar)
        dead.push(
          `${r.id} (ceiling ${ceiling.toFixed(2)} < bar ${bar.toFixed(2)})`,
        );
    }
    strictEqual(
      dead.length,
      0,
      `CRITICAL rule(s) whose entropy gate can never be cleared: ${dead.join("; ")}`,
    );
  });

  it("criticalRules_countIsRatchetedSoNewOnesGetFixtures", () => {
    // If someone adds a CRITICAL rule, this fails and points them at
    // CRITICAL_FIXTURES rather than letting it ship unverified.
    strictEqual(
      CRITICAL.length,
      20,
      "CRITICAL rule count changed — add a fixture to CRITICAL_FIXTURES for any new rule, then update this number",
    );
  });
});
