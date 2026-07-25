// tests/scan-rules-node22.test.ts
// Guards the Node-22 compatibility of scripts/lib/scan-rules.js.
//
// THE DEFECT THIS EXISTS FOR: the rules module is one file of regex LITERALS.
// It used inline modifier groups — `(?i:...)` (11 rules) and `(?s:.)` (4 in one
// rule) — which require V8 12.5+, i.e. Node >= 23. package.json declares
// `"node": ">=22.18"`. On Node 22 the module was a MODULE-LEVEL SYNTAX ERROR,
// so `loadRules()` threw, `install-hooks.sh` died, and every cloned project got
// NO pre-commit secret scan and NO system-map auto-heal while `setup.sh`
// reported only "WARN: Could not install git hooks". Silent, total, and it
// looked like ordinary noise.
//
// Two layers of protection:
//   1. The module must actually load, and contain no inline modifier groups.
//   2. Every rewritten sub-expression must accept EXACTLY the same strings the
//      original did. `(?i:X)` semantics are reproducible on Node 22 as
//      `new RegExp(X, "i")`, so equivalence is directly testable here rather
//      than argued in a comment.

import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = resolve(ROOT, "scripts/lib/scan-rules.js");

// ==========================================================================
// 1. The module loads, and no inline modifier groups remain
// ==========================================================================

describe("scan-rules Node 22 compatibility", () => {
  it("scanRules_moduleLoadsOnThisNode_doesNotThrow", async () => {
    // The actual regression. On Node 22 with inline modifiers present, this
    // import throws SyntaxError and the entire scanner is inert.
    const mod = await import(resolve(RULES_PATH));
    ok(Array.isArray(mod.rules), "scan-rules.js must export a rules array");
    ok(
      mod.rules.length > 100,
      `expected the full ruleset, got ${mod.rules.length} rules`,
    );
  });

  it("scanRules_nullRegexCount_doesNotGrowBeyondKnownBaseline", async () => {
    // security-scanner.ts:268 skips rules whose regex is null, so each null is
    // a NAMED detection rule that silently scans nothing.
    //
    // Was 24; #T114 restored 21 of them from the services' documented token
    // formats, anchored on the literal prefix each rule already recorded in its
    // `keywords`. The remaining 3 are null BY DECISION, not oversight —
    // curl-auth-header (multi-line shell match), pkcs12-file (binary container,
    // wrong mechanism for a line regex), and jwt-base64 (its ZXlK prefix is
    // base64 of 'eyJ', present in any base64-encoded JSON). Each carries an
    // explanatory comment in scan-rules.js.
    //
    // This assertion is a RATCHET: the count may never grow, and lowering it
    // means someone implemented one of the three and should update this
    // number deliberately.
    const KNOWN_NULL_RULES = 3;
    const mod = await import(resolve(RULES_PATH));
    const nulls = (mod.rules as Array<{ id: string; regex: RegExp | null }>)
      .filter((r) => !r.regex)
      .map((r) => r.id);
    ok(
      nulls.length <= KNOWN_NULL_RULES,
      `null-regex rules grew from ${KNOWN_NULL_RULES} to ${nulls.length}; newly inert: ${nulls.join(", ")}`,
    );
    strictEqual(
      nulls.length,
      KNOWN_NULL_RULES,
      `null-regex count dropped to ${nulls.length} — rules were fixed; lower KNOWN_NULL_RULES to lock in the gain`,
    );
  });

  it("scanRules_source_containsNoInlineModifierGroups", () => {
    // Catches a reintroduction: `(?i:`, `(?s:`, `(?m:`, `(?-i:`, etc.
    const src = readFileSync(RULES_PATH, "utf-8");
    const found = [...src.matchAll(/\(\?[a-zA-Z-]+:/g)]
      .map((m) => m[0])
      // Non-capturing groups `(?:` are fine and ubiquitous; only flag
      // modifier groups, which carry letters before the colon.
      .filter((s) => s !== "(?:");
    deepStrictEqual(
      [...new Set(found)],
      [],
      `inline modifier groups require Node >= 23 but engines declares >= 22.18; found: ${[...new Set(found)].join(", ")}`,
    );
  });

  it("scanRules_declaredEngineMinimum_canActuallyLoadTheRules", () => {
    // Ties the two facts together so a future engines bump is a deliberate act.
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf-8"),
    );
    strictEqual(
      pkg.engines?.node,
      ">=22.18",
      "if engines.node changes, re-evaluate whether inline regex modifiers are now allowed",
    );
  });
});

// ==========================================================================
// 2. Rewrite equivalence: new sub-expression === old `(?i:...)` semantics
//
// `original` is the exact body that used to sit inside `(?i:...)`, matched with
// the "i" flag — that IS the old semantics. `rewritten` is what replaced it.
// Both are anchored and run over a shared corpus; every verdict must agree.
// ==========================================================================

const EQUIVALENCE_CASES: ReadonlyArray<{
  label: string;
  original: string;
  rewritten: string;
  corpus: string[];
}> = [
  {
    label: "atlassian token body (20 alnum + 4 hex)",
    original: "[a-z0-9]{20}[a-f0-9]{4}",
    rewritten: "[a-zA-Z0-9]{20}[a-fA-F0-9]{4}",
    corpus: [
      "abcdefghij0123456789abcd",
      "ABCDEFGHIJ0123456789ABCD",
      "AbCdEfGhIj0123456789aBcD",
      "abcdefghij0123456789abcz", // z is not hex -> both must reject
      "abcdefghij0123456789ABCZ",
      "abcdefghij0123456789abc", // too short
      "abcdefghij0123456789abcde", // too long
      "abcdefghij0123456789ab-d", // hyphen
    ],
  },
  {
    label: "atlassian ATATT3 prefix",
    original: "ATATT3",
    rewritten: "[Aa][Tt][Aa][Tt][Tt]3",
    corpus: ["ATATT3", "atatt3", "AtAtT3", "ATATT4", "ATATT", "atatt3x"],
  },
  {
    label: "etsy / sumo / vault alnum bodies (24)",
    original: "[a-z0-9]{24}",
    rewritten: "[a-zA-Z0-9]{24}",
    corpus: [
      "abcdefgh0123456789012345",
      "ABCDEFGH0123456789012345",
      "AbCdEfGh0123456789012345",
      "abcdefgh012345678901234", // 23
      "abcdefgh01234567890123456", // 25
      "abcdefgh-123456789012345", // hyphen
    ],
  },
  {
    label: "sumo 64-char body",
    original: "[a-z0-9]{64}",
    rewritten: "[a-zA-Z0-9]{64}",
    corpus: [
      "a1b2".repeat(16),
      "A1B2".repeat(16),
      "A1b2".repeat(16),
      "a1b2".repeat(15),
      `${"a1b2".repeat(16)}x`,
    ],
  },
  {
    label: "huggingface 34-letter body",
    original: "[a-z]{34}",
    rewritten: "[a-zA-Z]{34}",
    corpus: [
      "abcdefghijklmnopqrstuvwxyzabcdefgh",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGH",
      "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGh",
      "abcdefghijklmnopqrstuvwxyzabcdefg", // 33
      "abcdefghijklmnopqrstuvwxyzabcdef0", // digit
    ],
  },
  {
    label: "telegram token tail",
    original: "[a-z0-9_\\-]{34}",
    rewritten: "[a-zA-Z0-9_\\-]{34}",
    corpus: [
      "abcdefghijklmnopqrstuvwxyzABCDEFGH",
      "abcdefghijklmnopqrstuvwxyz01234567",
      "abcdefghijklmnopqrstuvwxyz_-_-_-_-",
      "abcdefghijklmnopqrstuvwxyzABCDEFG", // 33
      "abcdefghijklmnopqrstuvwxyzABCDEF.H", // dot
    ],
  },
  {
    label: "telegram keyword",
    original: "telegr",
    rewritten: "[Tt][Ee][Ll][Ee][Gg][Rr]",
    corpus: ["telegr", "TELEGR", "TeLeGr", "telegx", "teleg"],
  },
  {
    label: "atlassian atlasv1 prefix body (14)",
    original: "[a-z0-9]{14}",
    rewritten: "[a-zA-Z0-9]{14}",
    corpus: [
      "abcdef01234567",
      "ABCDEF01234567",
      "AbCdEf01234567",
      "abcdef0123456",
      "abcdef-1234567",
    ],
  },
  {
    label: "atlassian atlasv1 token body",
    original: "[a-z0-9\\-_=]{60,70}",
    rewritten: "[a-zA-Z0-9\\-_=]{60,70}",
    corpus: [
      "x".repeat(65),
      "X".repeat(65),
      "aB1-_=".repeat(11),
      "x".repeat(59),
      "x".repeat(71),
      `${"x".repeat(64)}.`,
    ],
  },
  {
    label: "generic base64-ish value",
    original: "[a-z0-9][a-z0-9+\\/]{11,}",
    rewritten: "[a-zA-Z0-9][a-zA-Z0-9+\\/]{11,}",
    corpus: [
      "abcdefghijkl",
      "ABCDEFGHIJKL",
      "aBcDeF+/1234",
      "abcdefghijk",
      "+bcdefghijkl",
      "abcdefghij-l",
    ],
  },
  {
    label: "cohere keyword alternation",
    original: "(?:cohere|CO_API_KEY)",
    rewritten:
      "(?:[Cc][Oo][Hh][Ee][Rr][Ee]|[Cc][Oo]_[Aa][Pp][Ii]_[Kk][Ee][Yy])",
    corpus: [
      "cohere",
      "COHERE",
      "CoHeRe",
      "CO_API_KEY",
      "co_api_key",
      "Co_Api_Key",
      "cohere_",
      "COAPIKEY",
    ],
  },
  {
    label: "privateai keyword",
    original: "(?:private[_-]?ai)",
    rewritten: "(?:[Pp][Rr][Ii][Vv][Aa][Tt][Ee][_-]?[Aa][Ii])",
    corpus: [
      "privateai",
      "PRIVATEAI",
      "Private_Ai",
      "private-ai",
      "PRIVATE_AI",
      "privateaix",
      "privatai",
    ],
  },
  {
    label: "generic credential keyword list",
    original: "(?:access|auth|credential|creds|key|passw(?:or)?d|secret|token)",
    rewritten:
      "(?:[Aa][Cc][Cc][Ee][Ss][Ss]|[Aa][Uu][Tt][Hh]" +
      "|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Cc][Rr][Ee][Dd][Ss]" +
      "|[Kk][Ee][Yy]|[Pp][Aa][Ss][Ss][Ww](?:[Oo][Rr])?[Dd]" +
      "|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn])",
    corpus: [
      "access",
      "ACCESS",
      "Access",
      "auth",
      "AUTH",
      "AuTh",
      "credential",
      "CREDENTIAL",
      "Credential",
      "creds",
      "CREDS",
      "key",
      "KEY",
      "Key",
      "password",
      "PASSWORD",
      "PassWord",
      "passwd",
      "PASSWD",
      "PassWd",
      "secret",
      "SECRET",
      "Secret",
      "token",
      "TOKEN",
      "Token",
      "passwrd",
      "acces",
      "keys",
      "tokenx",
    ],
  },
];

describe("scan-rules rewrite equivalence", () => {
  for (const c of EQUIVALENCE_CASES) {
    it(`rewriteEquivalence_${c.label.replace(/[^a-zA-Z0-9]+/g, "_")}_acceptsIdenticalStrings`, () => {
      const oldRe = new RegExp(`^(?:${c.original})$`, "i");
      const newRe = new RegExp(`^(?:${c.rewritten})$`);
      ok(
        c.corpus.length >= 4,
        "each case needs a corpus with accepts AND rejects",
      );
      let accepted = 0;
      for (const s of c.corpus) {
        const before = oldRe.test(s);
        const after = newRe.test(s);
        strictEqual(
          after,
          before,
          `divergence on ${JSON.stringify(s)}: old(?i:)=${before}, rewritten=${after} — the rewrite changed what this rule matches`,
        );
        if (before) accepted++;
      }
      ok(accepted > 0, "corpus must contain at least one accepted string");
      ok(
        accepted < c.corpus.length,
        "corpus must contain at least one rejected string",
      );
    });
  }

  it("rewriteEquivalence_dotAllGroup_matchesNewlinesIdentically", () => {
    // `(?s:.)` -> `[\s\S]`. Verified against the "s" flag, which is the old
    // semantics, over characters where dot and dotAll differ.
    const oldRe = new RegExp("^(?:.){1}$", "s");
    const newRe = new RegExp("^(?:[\\s\\S]){1}$");
    for (const ch of ["a", "\n", "\r", " ", " ", "\t", " "]) {
      strictEqual(
        newRe.test(ch),
        oldRe.test(ch),
        `divergence on ${JSON.stringify(ch)}`,
      );
    }
    // And the case that motivated dotAll: spanning a newline.
    ok(new RegExp("kind:[\\s\\S]{0,200}?data:").test("kind: Secret\ndata:"));
  });

  it("rewriteEquivalence_caseSensitivityOutsideGroups_preserved", () => {
    // Three literals sat OUTSIDE the former (?i:) groups and must stay
    // case-sensitive. Widening them would silently broaden the rules.
    const src = readFileSync(RULES_PATH, "utf-8");
    ok(
      src.includes("\\.atlasv1\\."),
      "atlasv1 must remain a case-sensitive literal",
    );
    ok(
      src.includes(":A[a-zA-Z0-9_\\-]{34}"),
      "telegram's uppercase `A` must remain case-sensitive",
    );
    ok(
      src.includes("([a-z0-9]{32})"),
      "privateai's lowercase-only 32-char capture must stay lowercase-only",
    );
  });
});
