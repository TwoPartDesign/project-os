// tests/scan-rules-restored.test.ts
// Coverage for the 21 detection patterns restored in #T114.
//
// WHY THE FIXTURES ARE BUILT AT RUNTIME AND NOT WRITTEN AS LITERALS:
// these patterns match real vendor token formats, so a literal fixture IS a
// token-shaped string. Committing them inline to scripts/lib/scan-rules.js
// caused GitHub push protection to reject the push, correctly identifying
// "Adobe Client Secret", "Authress Service Client Access Key", and "Doppler
// Personal Token" in the diff. That rejection is a *good* signal — independent
// confirmation the reconstructed patterns match the real formats — so the fix
// is to stop committing the literals, not to click the bypass link.
//
// Every fixture below is therefore assembled by concatenation, so no
// contiguous token-shaped string ever appears in a committed file. The
// `body()` helper also gives each fixture realistic per-character variety;
// a run of repeated characters would be filtered by the entropy gate on any
// rule that still has one, and would silently test nothing.

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

const { rules } = (await import(RULES_PATH)) as { rules: LoadedRule[] };
const byId = new Map(rules.map((r) => [r.id, r]));

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HEX = "0123456789abcdef";

/**
 * A deterministic, high-variety body of `n` characters from `alphabet`.
 * Deterministic so a failure is reproducible; varied so it clears any
 * entropy gate that is still active on the rule.
 */
function body(n: number, alphabet: string = ALNUM): string {
  let s = "";
  // Stride co-prime with the alphabet length walks it without short cycles.
  const stride = 7;
  for (let i = 0; i < n; i++)
    s += alphabet[(i * stride + i * i) % alphabet.length];
  return s;
}

/** Rule id -> a positive fixture and a negative (right prefix, wrong shape). */
const FIXTURES: ReadonlyArray<{ id: string; hit: string; miss: string }> = [
  { id: "adobe-client-secret", hit: "p8e-" + body(32), miss: "p8e-" + body(6) },
  {
    id: "alibaba-access-key-id",
    hit: "LTAI" + body(20),
    miss: "LTAI" + body(5),
  },
  {
    id: "authress-service-client-access-key",
    hit: "sc_" + body(10) + "." + body(5) + ".acc-" + body(12) + "." + body(40),
    miss: "sc_" + body(4),
  },
  {
    id: "doppler-api-token",
    hit: "dp.pt." + body(43),
    miss: "dp.pt." + body(5),
  },
  {
    id: "duffel-api-token",
    hit: "duffel_" + "test_" + body(43),
    miss: "duffel_" + "test_" + body(5),
  },
  {
    id: "dynatrace-api-token",
    hit: "dt0c01." + body(24) + "." + body(64),
    miss: "dt0c01." + body(4) + "." + body(4),
  },
  { id: "easypost-api-token", hit: "EZAK" + body(54), miss: "EZAK" + body(6) },
  {
    id: "easypost-test-api-token",
    hit: "EZTK" + body(54),
    miss: "EZTK" + body(6),
  },
  {
    id: "facebook-page-access-token",
    hit: "EAA" + "M" + body(120),
    miss: "EAA" + "M" + body(10),
  },
  {
    id: "flutterwave-encryption-key",
    hit: "FLWSECK_" + "TEST-" + body(12, HEX),
    miss: "FLWSECK_" + "TEST-zzz",
  },
  {
    id: "flutterwave-public-key",
    hit: "FLWPUBK_" + "TEST-" + body(32, HEX) + "-X",
    miss: "FLWPUBK_" + "TEST-short-X",
  },
  {
    id: "flutterwave-secret-key",
    hit: "FLWSECK_" + "TEST-" + body(32, HEX) + "-X",
    miss: "FLWSECK_" + "TEST-short-X",
  },
  {
    id: "frameio-api-token",
    hit: "fio-u-" + body(64),
    miss: "fio-u-" + body(6),
  },
  {
    id: "intra42-client-secret",
    hit: "s-s4t2" + "ud-" + body(64, HEX),
    miss: "s-s4t2" + "ud-" + body(6, HEX),
  },
  {
    id: "linear-api-key",
    hit: "lin_api_" + body(40),
    miss: "lin_api_" + body(6),
  },
  {
    id: "planetscale-api-token",
    hit: "pscale_" + "tkn_" + body(40),
    miss: "pscale_" + "tkn_" + body(6),
  },
  {
    id: "planetscale-password",
    hit: "pscale_" + "pw_" + body(40),
    miss: "pscale_" + "pw_" + body(6),
  },
  {
    id: "postman-api-token",
    hit: "PMAK-" + body(24, HEX) + "-" + body(34, HEX),
    miss: "PMAK-" + body(4, HEX) + "-" + body(4, HEX),
  },
  {
    id: "sendgrid-api-token",
    hit: "SG." + body(22) + "." + body(43),
    miss: "SG." + body(4) + "." + body(4),
  },
  {
    id: "sendinblue-api-token",
    hit: "xkeysib-" + body(64, HEX) + "-" + body(16),
    miss: "xkeysib-" + body(6, HEX) + "-" + body(4),
  },
];

describe("restored scan rules (#T114)", () => {
  for (const f of FIXTURES) {
    it(`restoredRule_${f.id.replace(/-/g, "_")}_matchesRealFormatAndRejectsMalformed`, () => {
      const rule = byId.get(f.id);
      ok(rule, `rule ${f.id} not found in scan-rules.js`);
      ok(
        rule.regex,
        `rule ${f.id} has a null regex — it was restored in #T114 and must not regress to null`,
      );
      const re = new RegExp(
        rule.regex.source,
        rule.regex.flags.replace("g", ""),
      );
      ok(re.test(f.hit), `${f.id} failed to match a well-formed token`);
      strictEqual(
        re.test(f.miss),
        false,
        `${f.id} matched a malformed token (right prefix, wrong shape) — pattern is too loose`,
      );
    });
  }

  it("restoredRules_prefixAnchoredOnes_haveTheEntropyGateOff", () => {
    // A restored pattern is useless if the entropy gate then suppresses every
    // match. postman-api-token proved this: its token is hex, and hex caps at
    // log2(16) = 4.0 bits/char, permanently below the 4.5-bit bar, so the
    // rule would have shipped dead on arrival. Disabling the gate is safe here
    // precisely because each of these is anchored on a distinctive vendor
    // prefix — the prefix is the evidence, not the randomness.
    const stillGated = FIXTURES.map((f) => byId.get(f.id))
      .filter((r): r is LoadedRule => Boolean(r))
      .filter((r) => r.entropy === true)
      .map((r) => r.id);
    strictEqual(
      stillGated.length,
      0,
      `prefix-anchored restored rules must not be entropy-gated: ${stillGated.join(", ")}`,
    );
  });

  it("restoredRules_noFixtureAppearsAsAContiguousLiteralInThisFile", async () => {
    // Guards the property that made the push succeed: fixtures must stay
    // assembled at runtime. If someone inlines one, GitHub push protection
    // will reject the next push with a confusing "secret detected" error --
    // fail here instead, with the reason.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      resolve(ROOT, "tests/scan-rules-restored.test.ts"),
      "utf-8",
    );
    for (const f of FIXTURES) {
      ok(
        !src.includes(f.hit),
        `${f.id}'s fixture appears verbatim in this file; keep it built by concatenation ` +
          `so no token-shaped literal is ever committed`,
      );
    }
  });
});
