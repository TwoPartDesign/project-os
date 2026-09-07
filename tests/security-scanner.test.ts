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
  mkdtempSync,
  mkdirSync,
  writeFileSync,
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
