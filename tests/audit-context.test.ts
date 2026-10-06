// tests/audit-context.test.ts
// Behaviour tests for scripts/audit-context.sh, run against a copied project
// root: the script is copied into a per-test mkdtemp root that holds a
// fixture CLAUDE.md, rules and knowledge file, then executed with cwd set to
// that root (it reads CLAUDE.md and .claude/rules/ relative to cwd). No shared
// state between tests.

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findAlwaysLoadedOverBudget } from "../scripts/lib/system-map-lib.ts";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/audit-context.sh",
);

/** Returns exactly `bytes` ASCII bytes of filler. */
function filler(bytes: number): string {
  return "x".repeat(bytes);
}

/**
 * Builds a copied root: the script plus CLAUDE.md (400 B), an unscoped rule
 * (400 B), an LF `paths:` rule (600 B), a CRLF `paths:` rule (800 B) and an
 * oversized docs/knowledge/big.md. Sizes differ so that counting a scoped rule
 * would change the total. Returns the root and the script path inside it.
 */
function makeRoot(): { root: string; script: string } {
  const root = mkdtempSync(join(tmpdir(), "audit-context-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  mkdirSync(join(root, "docs", "knowledge"), { recursive: true });
  const script = join(root, "scripts", "audit-context.sh");
  copyFileSync(SCRIPT, script);

  writeFileSync(join(root, "CLAUDE.md"), filler(400));
  writeFileSync(join(root, ".claude", "rules", "unscoped.md"), filler(400));

  const lfHead = `---\npaths: ["**/*.ts"]\n---\n`;
  writeFileSync(
    join(root, ".claude", "rules", "scoped-lf.md"),
    lfHead + filler(600 - lfHead.length),
  );
  const crlfHead = `---\r\npaths: ["**/*.ts"]\r\n---\r\n`;
  writeFileSync(
    join(root, ".claude", "rules", "scoped-crlf.md"),
    crlfHead + filler(800 - crlfHead.length),
  );

  writeFileSync(join(root, "docs", "knowledge", "big.md"), filler(40000));
  return { root, script };
}

/** Runs the copied script with cwd set to `root`. */
function runScript(root: string, script: string) {
  return spawnSync("bash", [script], { cwd: root, encoding: "utf8" });
}

describe("audit-context.sh", () => {
  it("auditContext_lfAndCrlfPathsRules_excludedFromAlwaysLoadedTotal", () => {
    const { root, script } = makeRoot();
    try {
      const run = runScript(root, script);
      strictEqual(run.status, 0, run.stderr);
      const lines = run.stdout.split("\n");
      // (400 + 400) / 4: only CLAUDE.md and the unscoped rule count.
      strictEqual(
        lines.filter((l) => l.startsWith("=== TOTAL always-loaded")).length,
        1,
      );
      strictEqual(
        lines.includes("=== TOTAL always-loaded: ~200 tokens ==="),
        true,
        run.stdout,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("auditContext_sameFixtureRules_includesSameFilesAsFindAlwaysLoadedOverBudget", () => {
    const { root, script } = makeRoot();
    try {
      const paths = [
        "CLAUDE.md",
        ".claude/rules/unscoped.md",
        ".claude/rules/scoped-lf.md",
        ".claude/rules/scoped-crlf.md",
      ];
      const files = paths.map((path) => ({
        path,
        content: readFileSync(join(root, path), "utf8"),
      }));

      // Budget 0 flags every always-loaded file with at least one token.
      const included = findAlwaysLoadedOverBudget(files, 0).map(
        (f) => f.subject,
      );
      deepStrictEqual(included, ["CLAUDE.md", ".claude/rules/unscoped.md"]);

      // The script's total must equal the bytes of exactly those files.
      const includedBytes = included.reduce(
        (sum, p) => sum + readFileSync(join(root, p)).byteLength,
        0,
      );
      const run = runScript(root, script);
      strictEqual(run.status, 0, run.stderr);
      strictEqual(
        run.stdout.includes(
          `=== TOTAL always-loaded: ~${Math.floor(includedBytes / 4)} tokens ===`,
        ),
        true,
        run.stdout,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
