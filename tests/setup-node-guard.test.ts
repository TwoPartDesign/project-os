// tests/setup-node-guard.test.ts
// scripts/setup.sh must refuse to proceed on a Node older than the floor its
// own TypeScript tooling requires.
//
// WHY THIS EXISTS: setup.sh previously checked only `command -v node` —
// presence, not version. On Node 22 (below what scan-rules.js then needed),
// the sequence was: setup proceeds → install-hooks.sh dies for a reason that
// reads as unrelated → one generic WARN → the project runs with NO pre-commit
// secret scan and NO system-map auto-heal. Nothing failed loudly enough to
// notice. This pins the check so that regression cannot return silently.
//
// The test drives the real script with a fake `node` earlier on PATH, because
// the bug was in setup.sh's control flow, not in any function it calls.

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = resolve(ROOT, "scripts/setup.sh");

/**
 * Runs setup.sh --check with a shim `node` that reports `version`, and returns
 * the combined output. A `null` version omits node from PATH entirely.
 */
function runSetupWithNode(version: string | null): string {
  const shimDir = mkdtempSync(join(tmpdir(), "node-shim-"));
  try {
    if (version !== null) {
      const shim = join(shimDir, "node");
      // Answer --version; anything else exits non-zero so a mis-gated setup
      // fails visibly rather than doing real work with the fake runtime.
      writeFileSync(
        shim,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nexit 1\n`,
        "utf-8",
      );
      chmodSync(shim, 0o755);
    }
    // A throwaway project root: setup.sh must not touch the real repo.
    const proj = mkdtempSync(join(tmpdir(), "setup-probe-"));
    mkdirSync(join(proj, "scripts"), { recursive: true });
    try {
      // spawnSync, not execFileSync: setup.sh writes its warnings to STDERR
      // and exits 0, so execFileSync returns only (empty) stdout and never
      // throws -- the first version of this test captured nothing and two of
      // its assertions passed vacuously against an empty string.
      const r = spawnSync("bash", [SETUP, "--check"], {
        cwd: proj,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      });
      return (r.stdout ?? "") + (r.stderr ?? "");
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
}

describe("setup.sh Node floor", () => {
  it("setupNodeGuard_nodeBelowFloor_refusesAndNamesTheConsequence", () => {
    const out = runSetupWithNode("v22.17.0");
    ok(
      /below the required 22\.18/.test(out),
      `expected an explicit version refusal, got: ${out}`,
    );
    ok(
      /no pre-commit secret scan/.test(out),
      `the warning must name the consequence, not just the version, got: ${out}`,
    );
  });

  it("setupNodeGuard_veryOldMajor_refuses", () => {
    const out = runSetupWithNode("v18.20.0");
    ok(
      /below the required/.test(out),
      `expected refusal on Node 18, got: ${out}`,
    );
  });

  it("setupNodeGuard_nodeAtExactFloor_isAccepted", () => {
    // 22.18 is the floor itself — an off-by-one here would reject a supported
    // runtime, which is the opposite failure and just as bad.
    const out = runSetupWithNode("v22.18.0");
    strictEqual(
      /below the required/.test(out),
      false,
      `Node at the exact floor must be accepted, got: ${out}`,
    );
  });

  it("setupNodeGuard_newerMajor_isAccepted", () => {
    const out = runSetupWithNode("v24.0.0");
    strictEqual(
      /below the required/.test(out),
      false,
      `a newer major must be accepted, got: ${out}`,
    );
  });

  it("setupNodeGuard_absentNodeBranch_isStillPresentInTheScript", async () => {
    // LIMITATION, stated rather than faked: this assertion reads the script
    // instead of executing it. Simulating "node is absent" needs a PATH with no
    // node but with the coreutils setup.sh depends on, which cannot be built by
    // prepending a shim directory — an earlier version of this test tried
    // exactly that, left the real node reachable, and passed vacuously against
    // empty output. A source check that admits what it is beats an execution
    // test that silently proves nothing.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(SETUP, "utf-8");
    ok(
      /command -v node >\/dev\/null/.test(src),
      "setup.sh must still handle node being absent from PATH",
    );
    ok(
      /not found in PATH/.test(src),
      "the absent-node branch must still warn",
    );
  });

  it("setupNodeGuard_malformedVersionString_doesNotSilentlyPass", () => {
    // A non-numeric parse must fall to the refusing side. Treating an
    // unparseable version as "probably fine" is how a guard becomes decorative.
    const out = runSetupWithNode("not-a-version");
    ok(
      /below the required/.test(out),
      `an unparseable version must be refused, not assumed good, got: ${out}`,
    );
  });
});
