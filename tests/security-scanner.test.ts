// tests/security-scanner.test.ts
// Guards the three subcommand-level correctness defects fixed in #T168.
//
// All three shared one failure mode, the worst one a secret scanner can have:
// the scanner reported success while never reading the content it claimed to
// have checked.
//   1. scan-staged  read staged blobs through execFileSync with Node's default
//                   1 MiB maxBuffer and a bare `catch {}`. A file over that
//                   size made git's output overflow, execFileSync THREW, and
//                   the catch dropped the file — silently, exit 0.
//   2. scan-diff    listed the changed file NAMES and then read those files
//                   from the WORKING TREE, so it scanned content that was
//                   never in the diff and missed content that was in the diff
//                   but has since been edited away on disk.
//   3. scan-files   handed a directory argument straight to readFileSync,
//                   which threw EISDIR; the warning was logged, nothing was
//                   scanned, and the exit code was 0.
//
// These drive the CLI end to end: every defect lived in the plumbing between
// git and the rule engine, which a unit test of the rule engine cannot see.
// The git-backed cases build a throwaway repo under the OS temp directory, so
// nothing here depends on this repo's history or on the network.

import { describe, it } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNER = resolve(ROOT, "scripts/security-scanner.ts");

// Split so the fixture never exists as a token-shaped literal in this file:
// committing one trips both this repo's own pre-commit scan and GitHub push
// protection. Joined at runtime it is a real AWS access key ID shape, which
// the CRITICAL aws-access-token rule matches.
const AWS_FIXTURE = "AKIA" + "QYLPMN5HG3WKZ7TQ";

// Same split, same reason: joined at runtime it is a bare sk- token shape
// (T178), which the MEDIUM bare-sk-token rule matches.
const BARE_SK_FIXTURE = "sk-" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7d";

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the scanner CLI and returns its exit status and both streams. */
function runScanner(args: string[], cwd: string): Run {
  const r = spawnSync("node", [SCANNER, ...args], { cwd, encoding: "utf-8" });
  if (r.error) throw r.error;
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Runs a git subcommand in `dir`, throwing on failure. */
function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Commits everything in `dir` and returns the new commit's SHA. */
function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--no-verify", "--quiet", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/**
 * Creates a throwaway git repo under the OS temp directory, runs `fn` against
 * it, and removes it afterwards. Each test gets its own repo, so no state is
 * shared between cases.
 */
function withTempRepo(fn: (dir: string) => void): void {
  // realpath: on macOS the temp dir is a symlink (/var -> /private/var) and
  // git reports the resolved path, which would not match what we created.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "scanner-t168-")));
  try {
    git(dir, ["init", "--quiet"]);
    git(dir, ["config", "user.email", "t168@example.com"]);
    git(dir, ["config", "user.name", "T168 Fixture"]);
    fn(dir);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A locked file on Windows must not fail the assertion that just passed;
      // the OS reclaims the temp directory regardless.
    }
  }
}

/**
 * Creates a throwaway directory INSIDE the project root, runs `fn`, removes
 * it. scan-files refuses paths outside the project root, so its probes cannot
 * live in the OS temp directory.
 */
function withProbeDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(ROOT, ".t168-probe-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

describe("scan-diff scans the change set, not the working tree", () => {
  it("scanDiff_secretAddedInDiffThenRemovedFromWorkingTree_isStillReported", () => {
    withTempRepo((dir) => {
      writeFileSync(join(dir, "app.txt"), "clean line\n", "utf-8");
      const base = commitAll(dir, "base");

      writeFileSync(
        join(dir, "app.txt"),
        `clean line\naws_key = "${AWS_FIXTURE}"\n`,
        "utf-8",
      );
      commitAll(dir, "introduce the secret");

      // The secret is committed, and therefore pushed — but the working tree
      // no longer shows it. Reading files from disk found nothing here.
      writeFileSync(join(dir, "app.txt"), "clean line\n", "utf-8");

      const r = runScanner(["scan-diff", base], dir);
      strictEqual(
        r.status,
        1,
        `expected exit 1 (findings), got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /aws-access-token/);
      match(r.stdout, /app\.txt:2/);
    });
  });

  it("scanDiff_secretPresentOnlyInBaseCommit_isNotReported", () => {
    withTempRepo((dir) => {
      writeFileSync(
        join(dir, "app.txt"),
        `clean line\naws_key = "${AWS_FIXTURE}"\n`,
        "utf-8",
      );
      const base = commitAll(dir, "base already contains the secret");

      writeFileSync(
        join(dir, "app.txt"),
        `clean line\naws_key = "${AWS_FIXTURE}"\nunrelated addition\n`,
        "utf-8",
      );
      commitAll(dir, "add an unrelated line");

      // Nothing in this change set introduces the secret, so the diff scan
      // must stay quiet. Reading the file from disk reported it every time,
      // failing the push for a secret the base branch already carries.
      const r = runScanner(["scan-diff", base], dir);
      strictEqual(
        r.status,
        0,
        `expected exit 0, got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /No findings\./);
    });
  });

  it("scanDiff_additionInLaterHunk_reportsItsLineNumberInTheNewFile", () => {
    withTempRepo((dir) => {
      const preamble = Array.from(
        { length: 9 },
        (_, i) => `context line ${i + 1}`,
      ).join("\n");
      writeFileSync(join(dir, "deep.txt"), `${preamble}\n`, "utf-8");
      const base = commitAll(dir, "base");

      // The addition lands at line 10, far from the start of the file: the
      // line number has to come from the hunk header, not from a count of the
      // added lines.
      writeFileSync(
        join(dir, "deep.txt"),
        `${preamble}\naws_key = "${AWS_FIXTURE}"\n`,
        "utf-8",
      );
      commitAll(dir, "append the secret");

      const r = runScanner(["scan-diff", base], dir);
      strictEqual(
        r.status,
        1,
        `expected exit 1 (findings), got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /deep\.txt:10\b/);
    });
  });
});

describe("scan-files accepts directory arguments", () => {
  it("scanFiles_directoryArgument_recursesIntoSubdirectoriesAndReportsFinding", () => {
    withProbeDir((dir) => {
      mkdirSync(join(dir, "nested", "deeper"), { recursive: true });
      writeFileSync(
        join(dir, "nested", "deeper", "creds.txt"),
        `aws_key = "${AWS_FIXTURE}"\n`,
        "utf-8",
      );

      const r = runScanner(["scan-files", dir], ROOT);
      strictEqual(
        r.status,
        1,
        `expected exit 1 (findings), got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /aws-access-token/);
      match(r.stdout, /nested\/deeper\/creds\.txt:1/);
    });
  });

  it("scanFiles_directoryContainingNoFiles_exitsTwoWithAnExplicitError", () => {
    withProbeDir((dir) => {
      mkdirSync(join(dir, "empty-subdir"), { recursive: true });

      const r = runScanner(["scan-files", dir], ROOT);
      strictEqual(
        r.status,
        2,
        `expected exit 2, got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stderr, /Error: scan-files found no files to scan under:/);
      ok(
        !/No findings\./.test(r.stdout),
        `scanning nothing must not be reported as clean, got: ${r.stdout}`,
      );
    });
  });

  // #T176 LOW finding: a symlink argument is refused wherever it points
  // (expandScanTargets lstats the argument itself), so pointing one at a
  // secret-bearing file outside the project root must neither report that
  // secret nor silently pass — it must warn on stderr and exit 2, the same
  // "scanned nothing" contract as an empty directory.
  it("scanFiles_symlinkArgument_notFollowedWarnsAndReportsNothing", (t) => {
    withProbeDir((dir) => {
      const outsideDir = mkdtempSync(join(tmpdir(), "scanner-t176-"));
      try {
        const outsideFile = join(outsideDir, "secret.txt");
        writeFileSync(outsideFile, `aws_key = "${AWS_FIXTURE}"\n`, "utf-8");

        const linkPath = join(dir, "link-to-outside");
        try {
          symlinkSync(outsideFile, linkPath);
        } catch {
          // Windows without developer mode / symlink privilege: EPERM.
          t.skip("symlink creation unsupported");
          return;
        }

        const r = runScanner(["scan-files", linkPath], ROOT);
        strictEqual(
          r.status,
          2,
          `expected exit 2 (nothing scanned), got ${r.status}: ${r.stdout}${r.stderr}`,
        );
        match(r.stderr, /skipping symlink argument/);
        ok(
          !r.stdout.includes(AWS_FIXTURE),
          `symlink target's secret must not be reported, got: ${r.stdout}`,
        );
        ok(
          !/No findings\./.test(r.stdout),
          `scanning nothing must not be reported as clean, got: ${r.stdout}`,
        );
      } finally {
        rmSync(outsideDir, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });
});

describe("scan-staged reads every staged blob", () => {
  it("scanStagedGitShow_blobLargerThanTheDefaultMaxBuffer_isStillScanned", () => {
    withTempRepo((dir) => {
      // ~1.2 MiB, past Node's 1 MiB default maxBuffer: `git show :0:<file>`
      // used to throw ENOBUFS here and the bare catch dropped the file.
      const filler =
        "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi\n";
      writeFileSync(
        join(dir, "big.txt"),
        filler.repeat(6400) + `aws_key = "${AWS_FIXTURE}"\n`,
        "utf-8",
      );
      git(dir, ["add", "-A"]);

      const r = runScanner(["scan-staged"], dir);
      strictEqual(
        r.status,
        1,
        `expected exit 1 (findings), got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /aws-access-token/);
      match(r.stdout, /big\.txt:6401/);
    });
  });

  it("scanStaged_cleanStagedFile_stillExitsZeroWithNoFindings", () => {
    withTempRepo((dir) => {
      // The pre-commit hook depends on this exact contract; the new
      // unreadable-blob exit path must not disturb it.
      writeFileSync(join(dir, "notes.md"), "just some prose\n", "utf-8");
      git(dir, ["add", "-A"]);

      const r = runScanner(["scan-staged"], dir);
      strictEqual(
        r.status,
        0,
        `expected exit 0, got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      match(r.stdout, /No findings\./);
    });
  });
});

// #T178: a bare `sk-` token (no vendor infix, no adjacent key= name) used to
// report "No findings." — the generic-api-key-custom rule requires a nearby
// `api_key`/`secret`-shaped keyword, and no vendor-specific rule matches a
// plain sk- prefix. The bare-sk-token rule closes that gap without firing on
// the Anthropic-shaped `sk-ant-` prefix or on placeholder text.
describe("scan-files flags a bare sk- token", () => {
  it("scanFiles_bareSkToken_flagged", () => {
    withProbeDir((dir) => {
      const file = join(dir, "creds.txt");
      writeFileSync(file, `${BARE_SK_FIXTURE}\n`, "utf-8");

      const r = runScanner(["scan-files", "--format", "json", file], ROOT);
      strictEqual(
        r.status,
        1,
        `expected exit 1 (findings), got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      const parsed = JSON.parse(r.stdout);
      strictEqual(
        parsed.findings.length,
        1,
        `expected exactly one finding, got ${parsed.findings.length}: ${r.stdout}`,
      );
      strictEqual(parsed.findings[0].ruleId, "bare-sk-token");
    });
  });

  it("scanFiles_anthropicShapedKey_notFlaggedByBareRule", () => {
    withProbeDir((dir) => {
      const file = join(dir, "creds.txt");
      writeFileSync(file, "sk-ant-" + "a".repeat(40) + "\n", "utf-8");

      const r = runScanner(["scan-files", "--format", "json", file], ROOT);
      const parsed = JSON.parse(r.stdout);
      ok(
        !parsed.findings.some(
          (f: { ruleId: string }) => f.ruleId === "bare-sk-token",
        ),
        `bare-sk-token must not fire on an sk-ant- shaped token, got: ${r.stdout}`,
      );
    });
  });

  it("scanFiles_skPlaceholder_notFlagged", () => {
    withProbeDir((dir) => {
      const file = join(dir, "creds.txt");
      writeFileSync(file, "sk-example-placeholder-token-000000\n", "utf-8");

      const r = runScanner(["scan-files", "--format", "json", file], ROOT);
      strictEqual(
        r.status,
        0,
        `expected exit 0, got ${r.status}: ${r.stdout}${r.stderr}`,
      );
      const parsed = JSON.parse(r.stdout);
      strictEqual(
        parsed.findings.length,
        0,
        `expected zero findings, got ${parsed.findings.length}: ${r.stdout}`,
      );
    });
  });
});

describe("scrub writes its temp file exclusively (#T232)", () => {
  it("scrub_symlinkPlantedAtOldTmpName_outsideFileUntouchedAndTargetScrubbed", (t) => {
    withProbeDir((dir) => {
      const outsideDir = mkdtempSync(join(tmpdir(), "scanner-t232-"));
      try {
        const outsideFile = join(outsideDir, "victim.txt");
        const outsideBytes = "outside file, must stay byte-identical\n";
        writeFileSync(outsideFile, outsideBytes, "utf-8");

        const target = join(dir, "notes.txt");
        writeFileSync(target, `aws_key = "${AWS_FIXTURE}"\n`, "utf-8");

        try {
          symlinkSync(outsideFile, target + ".tmp");
        } catch {
          // Windows without developer mode / symlink privilege: EPERM.
          t.skip("symlink creation unsupported");
          return;
        }

        const r = runScanner(["scrub", target], ROOT);
        strictEqual(r.status, 0, `expected exit 0: ${r.stdout}${r.stderr}`);
        strictEqual(readFileSync(outsideFile, "utf-8"), outsideBytes);
        const scrubbed = readFileSync(target, "utf-8");
        ok(
          !scrubbed.includes(AWS_FIXTURE),
          `target must be scrubbed, got: ${scrubbed}`,
        );
        match(scrubbed, /\[REDACTED:aws-access-token\]/);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });

  it("scrub_successfulScrub_leavesNoTmpFileBesideTarget", () => {
    withProbeDir((dir) => {
      const target = join(dir, "notes.txt");
      writeFileSync(target, `aws_key = "${AWS_FIXTURE}"\n`, "utf-8");

      const r = runScanner(["scrub", target], ROOT);
      strictEqual(r.status, 0, `expected exit 0: ${r.stdout}${r.stderr}`);
      match(readFileSync(target, "utf-8"), /\[REDACTED:aws-access-token\]/);
      strictEqual(
        readdirSync(dir)
          .filter((n) => n.endsWith(".tmp"))
          .join(","),
        "",
      );
    });
  });
});

describe("scrub exit status and completeness", () => {
  it("scrub_unreadableFile_exitsNonzeroAndKeepsWarning", (t) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      t.skip("chmod 000 has no effect on Windows or for root");
      return;
    }
    withProbeDir((dir) => {
      const target = join(dir, "locked.txt");
      writeFileSync(target, `aws_key = "${AWS_FIXTURE}"\n`, "utf-8");
      chmodSync(target, 0o000);
      try {
        const r = runScanner(["scrub", target], ROOT);
        strictEqual(r.status, 1, `expected exit 1: ${r.stdout}${r.stderr}`);
        match(r.stderr, /Warning: could not read .*locked\.txt: EACCES/);
      } finally {
        chmodSync(target, 0o600);
      }
    });
  });

  it("scrub_missingPath_exitsNonzeroAndKeepsWarning", () => {
    withProbeDir((dir) => {
      const r = runScanner(["scrub", join(dir, "absent.txt")], ROOT);
      strictEqual(r.status, 1, `expected exit 1: ${r.stdout}${r.stderr}`);
      match(r.stderr, /Warning: could not read .*absent\.txt: ENOENT/);
    });
  });

  it("scrub_unreadableAmongReadable_stillScrubsReadableAndExitsNonzero", () => {
    withProbeDir((dir) => {
      const good = join(dir, "good.txt");
      writeFileSync(good, `aws_key = "${AWS_FIXTURE}"\n`, "utf-8");
      const r = runScanner(["scrub", join(dir, "absent.txt"), good], ROOT);
      strictEqual(r.status, 1, `expected exit 1: ${r.stdout}${r.stderr}`);
      ok(!readFileSync(good, "utf-8").includes(AWS_FIXTURE));
    });
  });

  it("scrub_twoDistinctGhpTokensOnOneLine_bothRedacted", () => {
    // Split so no token-shaped literal sits in this file (see AWS_FIXTURE).
    const first = "ghp_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
    const second = "ghp_" + "Zq8Yw6Xe4Vr2Ut0Ts9Rp7Qo5Pn3Om1Nl8Mk6";
    withProbeDir((dir) => {
      const target = join(dir, "tokens.txt");
      writeFileSync(target, `tokens: ${first} and ${second}\n`, "utf-8");

      const r = runScanner(["scrub", target], ROOT);
      strictEqual(r.status, 0, `expected exit 0: ${r.stdout}${r.stderr}`);
      strictEqual(
        readFileSync(target, "utf-8"),
        "tokens: [REDACTED:github-pat] and [REDACTED:github-pat]\n",
      );
    });
  });

  it("scrub_cleanFile_exitsZeroAndLeavesFileUntouched", () => {
    withProbeDir((dir) => {
      const target = join(dir, "clean.txt");
      writeFileSync(target, "nothing secret here\n", "utf-8");
      const r = runScanner(["scrub", target], ROOT);
      strictEqual(r.status, 0, `expected exit 0: ${r.stdout}${r.stderr}`);
      strictEqual(readFileSync(target, "utf-8"), "nothing secret here\n");
    });
  });
});
