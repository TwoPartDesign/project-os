// tests/test-hygiene.test.ts
// Guards the test suite itself, because the suite is the thing that stops
// defects from being discovered by pushing and waiting for an external review.
//
// THE DEFECTS THIS EXISTS FOR, both found the first time the whole suite was
// run on the owner's machine rather than in a Linux container:
//
//   1. Three test files called `await import(RULES_PATH)` with a bare absolute
//      path. On Linux that works. On Windows `C:\...` parses as the URL scheme
//      "c:" and throws ERR_UNSUPPORTED_ESM_URL_SCHEME, so the file aborted at
//      module scope — taking 33 assertions with it, silently, since a file that
//      never registers a test cannot report the tests it did not run.
//   2. Seven `tests/*.sh` suites existed that `npm test` never invoked. They
//      were green when last run by hand and nobody could say when that was.
//
// Both are the same failure: a check that exists but does not run reads exactly
// like a check that passes.

import { describe, it } from "node:test";
import { ok, strictEqual, deepStrictEqual } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TESTS_DIR, "..");

const entries = readdirSync(TESTS_DIR);
const tsTests = entries.filter((f) => f.endsWith(".test.ts"));
const shSuites = entries
  .filter((f) => f.endsWith(".sh") && f !== "run-all.sh")
  .sort();

// ==========================================================================
// 1. Every suite is reachable from one command
// ==========================================================================

describe("the runner reaches every suite", () => {
  it("runner_everyShellSuiteInTestsDir_isDiscoveredByRunAll", () => {
    // run-all.sh discovers by glob rather than by list, so this asserts the
    // glob is still the broad one. A narrowing edit (back to *-smoke.sh, say)
    // would silently drop tests/compaction-hooks.sh and any future suite whose
    // name does not fit the convention.
    const runner = readFileSync(resolve(TESTS_DIR, "run-all.sh"), "utf-8");
    ok(
      /for f in "\$SCRIPT_DIR"\/\*\.sh; do/.test(runner),
      "run-all.sh must discover every tests/*.sh, not a name-pattern subset — " +
        "a suite that does not match the glob never runs",
    );
    ok(
      runner.includes('[ "$base" = "run-all.sh" ] && continue'),
      "run-all.sh must exclude itself from its own suite list",
    );
  });

  it("runner_npmTest_invokesTheRunnerAndNotTheUnitGlobAlone", () => {
    // `npm test` running only node:test is how the shell suites went unrun.
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    strictEqual(
      pkg.scripts?.test,
      "bash tests/run-all.sh",
      "npm test must be the full gate; the node:test-only glob lives at test:unit",
    );
    ok(
      pkg.scripts?.["test:unit"]?.includes("node --test"),
      "keep a unit-only escape hatch at test:unit for fast iteration",
    );
  });

  it("runner_shellSuites_areNonEmptyAndExecutableAsBashFiles", () => {
    ok(shSuites.length > 0, "expected shell suites in tests/");
    for (const name of shSuites) {
      const src = readFileSync(resolve(TESTS_DIR, name), "utf-8");
      ok(
        /^#!.*\b(bash|sh)\b/m.test(src.split("\n")[0]),
        `${name} has no bash shebang — run-all.sh invokes it as \`bash tests/${name}\``,
      );
      ok(
        src.length > 200,
        `${name} is too small to be a real suite (${src.length} bytes) — ` +
          "a placeholder in tests/ is counted as a passing suite by the runner",
      );
    }
  });
});

// ==========================================================================
// 2. Nothing in the suite is Windows-broken
// ==========================================================================

describe("tests run on the platform they are run on", () => {
  it("hygiene_dynamicImports_useFileUrlsNotBareAbsolutePaths", () => {
    // `await import(somePath)` where somePath came from path.resolve() is a
    // Linux-only idiom. pathToFileURL(...).href is the portable form.
    //
    // Comments and string bodies are stripped first, so this file — which has
    // to spell the broken pattern out to describe it — is scanned by the same
    // rule as every other, with no self-exemption.
    const offenders: string[] = [];
    for (const name of tsTests) {
      const raw = readFileSync(resolve(TESTS_DIR, name), "utf-8");
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, "$1$1");
      // A name assigned from pathToFileURL(...) carries the fix; importing it
      // is correct even though the call site names only the identifier.
      const urlNames = new Set(
        [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=[^;\n]*pathToFileURL/g)].map(
          (m) => m[1],
        ),
      );
      for (const m of code.matchAll(/\bimport\(\s*([^)]+?)\s*\)/g)) {
        const arg = m[1].trim();
        // String literals are fine: "node:fs", "./thing.js" are valid
        // specifiers. Only a filesystem path expression is the bug.
        if (/^["'`]/.test(arg)) continue;
        if (/pathToFileURL|\.href|^import\.meta/.test(arg)) continue;
        if (urlNames.has(arg)) continue;
        offenders.push(`${name}: import(${arg})`);
      }
    }
    deepStrictEqual(
      offenders,
      [],
      "dynamic import() of a filesystem path must go through " +
        "pathToFileURL(p).href — a bare `C:\\...` parses as URL scheme 'c:' " +
        `and throws ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("hygiene_testFiles_doNotTouchTheFilesystemAtALiteralTmpPath", () => {
    // On Windows the Write tool and Git Bash resolve /tmp/ to different real
    // locations, so a test that writes there passes on Linux and fails here
    // with a "No such file or directory" that points at the wrong cause.
    //
    // Only actual filesystem OPERATIONS are flagged. A "/tmp/..." appearing as
    // data — a synthetic hook payload in hook-smoke.sh, the absolute-prefix
    // list in template-residue.test.ts — is not a write and must not trip this,
    // or the check gets muted for being noisy.
    const OPERATIONS: ReadonlyArray<[RegExp, string]> = [
      [/[^>]>>?\s*\/tmp\//, "shell redirection into /tmp"],
      [
        /\b(mkdir|rm|cp|mv|touch|cat|tee|ln|chmod|find)\b[^\n]*\s\/tmp\//,
        "shell filesystem command on /tmp",
      ],
      [/\bmktemp\b[^\n]*(-p|--tmpdir=?)\s*\/tmp/, "mktemp pinned to /tmp"],
      [/\bTMPDIR=\/tmp/, "TMPDIR pinned to /tmp"],
      [
        /\b(writeFile|readFile|mkdir|rm|cp|appendFile|open)\w*\(\s*["'`]\/tmp\//,
        "node:fs call on a /tmp literal",
      ],
    ];
    const offenders: string[] = [];
    for (const name of [...tsTests, ...shSuites]) {
      const src = readFileSync(resolve(TESTS_DIR, name), "utf-8");
      src.split("\n").forEach((line, i) => {
        if (/^\s*(#|\/\/|\*)/.test(line)) return; // comments may discuss it
        for (const [re, why] of OPERATIONS)
          if (re.test(line))
            offenders.push(`${name}:${i + 1}: ${why} — ${line.trim().slice(0, 80)}`);
      });
    }
    deepStrictEqual(
      offenders,
      [],
      "tests must create temp state with mktemp -d / os.tmpdir(), never a " +
        `literal /tmp/ path:\n  ${offenders.join("\n  ")}`,
    );
  });
});
