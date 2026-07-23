// tests/skill-apply.test.ts
// Integration tests for scripts/skill-apply.ts (the standard-tier apply CLI).
// Pattern follows tests/maintain-draft.test.ts: node:test + node:assert.
// Every test spawns the CLI as a real child process against its own
// throwaway git-repo fixture in a fresh temp dir — no shared state, no
// shared beforeEach. `cwd` is set to the fixture root (not the real project
// root) so the CLI's own `getProjectRoot()` walk resolves the fixture as
// the project — this is required because the CLI takes no `--root`
// override flag; it only ever consults `process.cwd()`.

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/** Walks up from this test file to find the nearest ancestor with `.claude` — the project root. */
function findProjectRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("project root (dir containing .claude) not found from test file location");
}

const PROJECT_ROOT = findProjectRoot();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/skill-apply.ts");

/** Normalizes a native path to forward slashes for embedding in CLI argv strings. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshFixture(): string {
  return mkdtempSync(resolve(tmpdir(), "skill-apply-test-"));
}

/** Runs a git subcommand in `cwd`, discarding output. Throws on nonzero exit. */
function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Returns the sha256 hex digest of `path`'s current contents, for byte-identical rollback assertions. */
function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Runs a git subcommand in `cwd` and returns trimmed stdout. Throws on nonzero exit. */
function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** `git init` + local identity config, so commits never depend on a global gitconfig. */
function initGitRepo(dir: string): void {
  git(dir, ["init", "--quiet"]);
  git(dir, ["config", "user.email", "skill-apply-test@example.com"]);
  git(dir, ["config", "user.name", "Skill Apply Test"]);
}

/** Writes `content` to `path`, creating parent directories as needed. */
function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

/** Stages everything and commits with `message`. */
function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", message]);
}

/** Writes `.claude/maintenance-policy.yaml` with `body` as its raw contents. */
function writePolicyFile(dir: string, body: string): void {
  writeFileEnsuringDir(resolve(dir, ".claude/maintenance-policy.yaml"), body);
}

/**
 * Copies the real scripts/system-map.ts + its lib dependencies
 * (system-map-lib.ts, policy.ts, project-root.ts) from the actual project
 * into the fixture's own scripts tree, preserving the same relative layout
 * so system-map.ts's own `./lib/...` imports resolve unchanged. Needed by
 * the auto-tier tests that require a REAL `system-map.ts report` run
 * (condition 5/6 evidence) rather than the "missing script" warn-and-skip
 * path most other fixtures rely on.
 */
function copyRealSystemMap(dir: string): void {
  const files = [
    "scripts/system-map.ts",
    "scripts/lib/system-map-lib.ts",
    "scripts/lib/policy.ts",
    "scripts/lib/project-root.ts",
  ];
  for (const rel of files) {
    const content = readFileSync(resolve(PROJECT_ROOT, rel), "utf-8");
    writeFileEnsuringDir(resolve(dir, rel), content);
  }
}

interface ProposalOpts {
  n: number;
  title: string;
  fingerprint: string;
  target: string;
  operation: "add" | "delete" | "replace";
  tier: "standard" | "auto-eligible";
  draftTask: string;
  evidence: string;
  anchor: string;
  proposedText: string;
  rationale: string;
}

/** Builds a single-run, single-proposal skill-edit proposal document matching the authoritative format. */
function buildProposalDoc(o: ProposalOpts): string {
  return [
    `# Skill-Edit Proposals: fixture`,
    ``,
    `## Run: 2026-07-22 — trigger: test`,
    `Scope: ${o.target}`,
    ``,
    `### Proposal ${o.n}: ${o.title}`,
    `- **Fingerprint**: ${o.fingerprint}`,
    `- **Target**: ${o.target}`,
    `- **Operation**: ${o.operation}`,
    `- **Tier**: ${o.tier}`,
    `- **Draft task**: ${o.draftTask}`,
    `- **Evidence**: ${o.evidence}`,
    `- **Size**: 100 -> 120 (chars/4)`,
    ``,
    `#### Anchor`,
    "```",
    o.anchor,
    "```",
    ``,
    `#### Proposed text`,
    "```",
    o.proposedText,
    "```",
    ``,
    `#### Rationale`,
    o.rationale,
    ``,
  ].join("\n");
}

/** Runs the real skill-apply.ts CLI with `cwd` as the fixture root. Never throws — returns status/stdout/stderr. */
function runSkillApply(cwd: string, argvTail: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, "apply", ...argvTail], {
    cwd,
    encoding: "utf-8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("skill-apply.ts apply", () => {
  it("apply_uniqueAnchor_commitsAndPrintsHash", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "# Test Doc\n\nUnique anchor line here.\n\nTail text.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Add a note",
          fingerprint: "skill-edit:test-doc:add-note",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test evidence",
          anchor: "Unique anchor line here.",
          proposedText: "Added proposed line.",
          rationale: "Because tests.",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
      ok(
        /^applied: [0-9a-f]{40}$/.test(result.stdout.trim()),
        `stdout did not match "applied: <hash>": ${result.stdout}`,
      );

      const subject = gitOutput(dir, ["log", "-1", "--format=%s"]);
      ok(subject.startsWith("chore(skills): apply"), `unexpected commit subject: ${subject}`);

      const body = gitOutput(dir, ["log", "-1", "--format=%B"]);
      ok(body.includes("skill-edit:test-doc:add-note"), `commit body missing fingerprint: ${body}`);

      const updated = readFileSync(targetAbs, "utf-8");
      ok(updated.includes("Added proposed line."), "target content was not updated");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_anchorAmbiguous_exit3NoCommit", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      const originalContent = "Repeated line.\n\nMiddle.\n\nRepeated line.\n";
      writeFileEnsuringDir(targetAbs, originalContent);
      commitAll(dir, "initial commit");
      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Ambiguous",
          fingerprint: "skill-edit:test-doc:ambiguous",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Repeated line.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.toLowerCase().includes("ambiguous"), `stderr missing 'ambiguous': ${result.stderr}`);

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "git log changed despite ambiguous anchor");
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        originalContent,
        "target content changed despite ambiguous anchor",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_targetOutsideInstructionDirs_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      // Unlike the other fixtures, this target isn't under .claude/, so
      // nothing else here creates a .claude dir. getProjectRoot() walks up
      // from cwd looking for one — without this, it can walk straight past
      // the fixture root and false-match an unrelated ancestor .claude dir
      // (e.g. the real user's global ~/.claude), resolving the "project
      // root" outside the fixture entirely. Create one explicitly so the
      // fixture root is found first, regardless of the host machine's
      // directory layout.
      mkdirSync(resolve(dir, ".claude"), { recursive: true });
      const targetRel = "scripts/x.sh";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "#!/bin/sh\necho hi\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Outside",
          fingerprint: "skill-edit:x-sh:outside",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "echo hi",
          proposedText: "echo more",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      // Round-2 R1 hardening: this is now a lexical, fs-untouched rejection
      // (target isn't under any of the instruction dirs), so it shares the
      // single uniform message with every other lexical-shape/containment
      // rejection rather than a "containment"-specific one.
      strictEqual(
        result.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_symlinkEscape_exit3", (t) => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const outsidePath = resolve(dir, "outside.md");
      writeFileSync(outsidePath, "Outside content.\nAnchor here.\n", "utf-8");

      const linkRel = ".claude/commands/linked-doc.md";
      const linkAbs = resolve(dir, linkRel);
      mkdirSync(dirname(linkAbs), { recursive: true });
      try {
        symlinkSync(outsidePath, linkAbs, "file");
      } catch (err) {
        t.skip(`symlink creation not permitted on this system: ${(err as Error).message}`);
        return;
      }
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Escape",
          fingerprint: "skill-edit:linked-doc:escape",
          target: linkRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor here.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      // M1 hardening: symlink targets are refused outright, immediately
      // after the existence check — before containment even runs — so an
      // outside-escaping symlink is now rejected via the "target is a
      // symlink" message rather than reaching (and failing) the
      // containment check. Exit code stays 3; only the reason changes.
      ok(result.stderr.toLowerCase().includes("symlink"), `stderr missing 'symlink': ${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_inBoundsSymlinkTarget_exit3", (t) => {
    // M1: an in-bounds symlink pointing at a DIFFERENT in-bounds file passes
    // a naive containment check (realpathSync resolves it to another path
    // that is itself under .claude/commands/), but must still be refused —
    // the fs ops would otherwise mutate the link's target while git records
    // only the link path, an effective edit with no matching commit.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const realRel = ".claude/commands/real-doc.md";
      const realAbs = resolve(dir, realRel);
      const realContent = "Real content.\n\nAnchor here.\n\nTail.\n";
      writeFileEnsuringDir(realAbs, realContent);

      const linkRel = ".claude/commands/linked-doc.md";
      const linkAbs = resolve(dir, linkRel);
      mkdirSync(dirname(linkAbs), { recursive: true });
      try {
        symlinkSync(realAbs, linkAbs, "file");
      } catch (err) {
        t.skip(`symlink creation not permitted on this system: ${(err as Error).message}`);
        return;
      }
      commitAll(dir, "initial commit");
      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "In-bounds symlink indirection",
          fingerprint: "skill-edit:linked-doc:inbounds-symlink",
          target: linkRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor here.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.toLowerCase().includes("symlink"), `stderr missing 'symlink': ${result.stderr}`);

      strictEqual(
        readFileSync(realAbs, "utf-8"),
        realContent,
        "real target modified despite in-bounds symlink refusal",
      );
      strictEqual(
        readFileSync(linkAbs, "utf-8"),
        realContent,
        "link-resolved content modified despite in-bounds symlink refusal",
      );

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite in-bounds symlink refusal");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_absoluteTarget_exit3", () => {
    // M3c: an absolute (drive-letter) or UNC target must be rejected BEFORE
    // any resolve()/existsSync() touches it — resolve(projectRoot, target)
    // silently discards projectRoot for an absolute target, which would let
    // an existence-oracle or UNC probe run before containment ever gets a
    // chance to reject it.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      mkdirSync(resolve(dir, ".claude"), { recursive: true });

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Absolute target",
          fingerprint: "skill-edit:abs:absolute-target",
          target: "C:\\Windows\\System32\\drivers\\etc\\hosts",
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      // Round-2 R1 hardening: absolute/drive-prefixed targets now collapse
      // into the single uniform lexical-rejection message (see
      // apply_driveRelativeTraversalTarget_uniformError for the oracle
      // this specifically closes).
      strictEqual(
        result.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_uncTarget_exit3", () => {
    // M3c, UNC-share variant of the same guard.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      mkdirSync(resolve(dir, ".claude"), { recursive: true });

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "UNC target",
          fingerprint: "skill-edit:unc:unc-target",
          target: "//unc/share/secret.md",
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      // Round-2 R1 hardening: same uniform message as the drive-prefixed case.
      strictEqual(
        result.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_dirtyTarget_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Clean anchor line.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const dirtyContent = "Clean anchor line.\n\nTail.\nUncommitted addition.\n";
      writeFileSync(targetAbs, dirtyContent, "utf-8");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Dirty",
          fingerprint: "skill-edit:test-doc:dirty",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Clean anchor line.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.toLowerCase().includes("clean"), `stderr missing 'clean': ${result.stderr}`);
      strictEqual(readFileSync(targetAbs, "utf-8"), dirtyContent, "target content changed despite dirty guard");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_midMerge_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor line.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const gitDir = resolve(dir, ".git");
      writeFileSync(
        resolve(gitDir, "MERGE_HEAD"),
        "0000000000000000000000000000000000000000\n",
        "utf-8",
      );

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Merge",
          fingerprint: "skill-edit:test-doc:merge",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor line.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.toLowerCase().includes("merge"), `stderr missing 'merge': ${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_missingValidatorScripts_warnsAndProceeds", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor line two.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Warn",
          fingerprint: "skill-edit:test-doc:warn",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor line two.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      // Note: this fixture never has a scripts/ directory at all — the CLI
      // must treat both missing validator scripts as warn-and-proceed, not
      // as a failure.
      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
      ok(
        result.stderr.includes("scripts/system-map.ts not found"),
        `missing system-map warning: ${result.stderr}`,
      );
      ok(
        result.stderr.includes("scripts/security-scanner.ts not found"),
        `missing security-scanner warning: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_prestagedUnrelatedFile_notSweptIntoCommit", () => {
    // M3a: `git commit -F <msg>` with no pathspec sweeps in ANY other change
    // already staged in the index, not just the target this run applied.
    // Pre-stage an unrelated file's change before invoking apply, then
    // assert the apply commit contains ONLY the target (this fixture has no
    // scripts/system-map.ts, so nothing is healed into docs/maps either),
    // and that the pre-staged unrelated file remains staged afterward —
    // untouched, not committed, not unstaged.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor for sweep test.\n\nTail.\n");
      const unrelatedRel = "unrelated.txt";
      const unrelatedAbs = resolve(dir, unrelatedRel);
      writeFileSync(unrelatedAbs, "unrelated original\n", "utf-8");
      commitAll(dir, "initial commit");

      // Pre-stage an unrelated change before invoking apply.
      writeFileSync(unrelatedAbs, "unrelated modified\n", "utf-8");
      git(dir, ["add", unrelatedRel]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Sweep test",
          fingerprint: "skill-edit:test-doc:sweep",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor for sweep test.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);

      const committedFiles = gitOutput(dir, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "HEAD",
      ])
        .split("\n")
        .filter(Boolean);
      ok(committedFiles.includes(targetRel), `expected commit to include target: ${committedFiles}`);
      ok(
        !committedFiles.includes(unrelatedRel),
        `unrelated file was swept into the apply commit: ${committedFiles}`,
      );

      const stagedAfter = gitOutput(dir, ["diff", "--cached", "--name-only"])
        .split("\n")
        .filter(Boolean);
      ok(
        stagedAfter.includes(unrelatedRel),
        `unrelated file no longer staged after apply: ${stagedAfter}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_commitHookRejects_rolledBackExit4", () => {
    // M3b: if `git commit` throws (here, a pre-commit hook exiting nonzero),
    // the CLI must roll back rather than let the exception propagate —
    // target restored byte-identical, no new commit, exit 4.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      const originalContent = "Anchor for hook rejection.\n\nTail.\n";
      writeFileEnsuringDir(targetAbs, originalContent);
      commitAll(dir, "initial commit");

      const hookPath = resolve(dir, ".git", "hooks", "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\nexit 1\n", "utf-8");
      chmodSync(hookPath, 0o755);

      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);
      const originalHash = sha256File(targetAbs);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Hook rejection",
          fingerprint: "skill-edit:test-doc:hook-reject",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor for hook rejection.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 4, `expected exit 4, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      // This fixture has no scripts/system-map.ts or scripts/security-scanner.ts,
      // so the CLI's warn-and-proceed lines for both precede the commit
      // failure message — assert the specific message is present, not that
      // it's the only stderr content.
      ok(
        result.stderr.includes("error: commit failed — target restored"),
        `stderr missing 'commit failed' message: ${result.stderr}`,
      );

      const afterHash = sha256File(targetAbs);
      strictEqual(afterHash, originalHash, "target not byte-identical after commit-failure rollback");

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite hook rejection");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_policyOff_exit3", () => {
    const dir = freshFixture();
    try {
      // No .claude/maintenance-policy.yaml at all — the policy gate's
      // default is false. Create .claude/ explicitly so getProjectRoot()
      // resolves the fixture root, not the host machine's global ~/.claude.
      mkdirSync(resolve(dir, ".claude"), { recursive: true });

      const result = runSkillApply(dir, ["--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(result.stderr.trim(), "auto refused: policy off", `stderr mismatch: ${result.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_addOp_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor for add op.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Add not allowed in auto",
          fingerprint: "skill-edit:test-doc:auto-add",
          target: targetRel,
          operation: "add", // violates condition 2 — the only condition this fixture violates
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "Anchor for add op.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: op must be delete|replace",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_rulesTarget_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      // Valid delete op (condition 2 satisfied) — only condition 3 (target
      // containment) is violated: .claude/rules/ is excluded from auto even
      // though the standard tier allows it.
      const targetRel = ".claude/rules/test-rule.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor in a rule file.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Rules excluded from auto",
          fingerprint: "skill-edit:test-rule:auto-rules",
          target: targetRel,
          operation: "delete",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "Anchor in a rule file.",
          proposedText: "",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: target must be under .claude/commands/ or .claude/skills/ (rules excluded from auto)",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_sizeIncrease_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      // Valid op/target (conditions 1-3 satisfied) — only condition 4 (size
      // must not increase) is violated: replace substitutes a 1-char anchor
      // with a much longer proposed text.
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Line before.\n\nX\n\nLine after.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Grows the file",
          fingerprint: "skill-edit:test-doc:auto-size",
          target: targetRel,
          operation: "replace",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "X",
          proposedText: "Y".repeat(200),
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(result.stderr.trim(), "auto refused: size increased", `stderr mismatch: ${result.stderr}`);
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        "Line before.\n\nX\n\nLine after.\n",
        "target content changed despite auto size refusal",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_noLiveFindingForTarget_exit3", () => {
    // Conditions 1-4 all satisfied (policy on, delete op, commands target,
    // delete always shrinks). This fixture has no scripts/system-map.ts at
    // all — same as most fixtures in this file — so condition 5 refuses via
    // its "missing script" branch, which is condition 5's uniform "no live
    // evidence" refusal (see runSystemMapReportJson's docstring).
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, "Anchor with no map script.\n\nTail.\n");
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "No map script present",
          fingerprint: "skill-edit:test-doc:auto-no-map",
          target: targetRel,
          operation: "delete",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "Anchor with no map script.",
          proposedText: "",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: no live dangling-ref finding for target",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  /**
   * Shared fixture content for the two tests below: a command doc with two
   * unrelated blocks — one plain paragraph, and one fenced code block that
   * references a script that doesn't exist (`scripts/dead-ref.sh`), which a
   * REAL `system-map.ts report` run will flag as a live dangling-ref finding
   * whose subject is this doc's own node id.
   */
  const CMD_DOC_WITH_DEAD_REF = [
    "# Test Command",
    "",
    "## Section A",
    "",
    "Some intro paragraph text here.",
    "",
    "## Section B",
    "",
    "```bash",
    "bash scripts/dead-ref.sh",
    "```",
    "",
    "## Section C",
    "",
    "Trailing content unrelated.",
    "",
  ].join("\n");

  it("auto_unrelatedAnchorDespiteLiveFinding_exit3", () => {
    // THE SMUGGLING CASE: a real, live dangling-ref finding exists for this
    // target (scripts/dead-ref.sh, referenced in Section B), but the
    // proposal's anchor is Section A's unrelated paragraph — it never
    // mentions the dead reference. Condition 6 must refuse this even though
    // condition 5 (live evidence) is satisfied, or a proposal could ride an
    // unrelated file's real finding to auto-apply an arbitrary edit anywhere
    // else in that same file.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      copyRealSystemMap(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/tools/test-cmd.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, CMD_DOC_WITH_DEAD_REF);
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Unrelated anchor",
          fingerprint: "skill-edit:test-cmd:auto-smuggle",
          target: targetRel,
          operation: "delete",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "Some intro paragraph text here.",
          proposedText: "",
          rationale: "Unrelated edit riding a real finding elsewhere in the file.",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: edit does not correspond to the dead reference",
        `stderr mismatch: ${result.stderr}`,
      );
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        CMD_DOC_WITH_DEAD_REF,
        "target content changed despite correspondence refusal",
      );

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog.split("\n").length, 1, "a commit was created despite correspondence refusal");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  /**
   * Fixture for the wide-anchor smuggling test below: a fenced block with
   * the dead reference on its own line PLUS an unrelated sibling line
   * (`echo done`) inside the same anchor. A real `system-map.ts report` run
   * flags `scripts/dead-ref.sh` as a live dangling-ref finding for this doc,
   * same as CMD_DOC_WITH_DEAD_REF.
   */
  const CMD_DOC_WIDE_ANCHOR = [
    "# Test Command Wide",
    "",
    "## Section A",
    "",
    "```bash",
    "bash scripts/dead-ref.sh",
    "echo done",
    "```",
    "",
    "## Section B",
    "",
    "Trailing content unrelated.",
    "",
  ].join("\n");

  it("auto_wideAnchorExcessChange_exit3", () => {
    // M2: a real, live dangling-ref finding exists for this target
    // (scripts/dead-ref.sh), and the anchor genuinely contains the dead ref
    // — but the anchor is "wide": it also carries an unrelated sibling line
    // (`echo done`), and the replace's proposedText changes THAT line too
    // instead of leaving it untouched. Under the old substring-only
    // correspondence check this passed (deadRef was in the anchor, and gone
    // from the replacement); under the new line-wise semantics, a `replace`
    // is only valid when it changes NOTHING but removing the dead-ref
    // line(s) — so this must be refused.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      copyRealSystemMap(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/tools/test-cmd-wide.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, CMD_DOC_WIDE_ANCHOR);
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Wide anchor excess change",
          fingerprint: "skill-edit:test-cmd-wide:auto-wide-anchor",
          target: targetRel,
          operation: "replace",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "bash scripts/dead-ref.sh\necho done",
          // A faithful dead-line removal would leave exactly "echo done"
          // (the anchor's one surviving line, unchanged). This instead
          // changes that surviving line too — the excess change condition 6
          // must catch.
          proposedText: "echo done differently",
          rationale: "Removes the dead reference but also rewrites an unrelated line.",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: edit does not correspond to the dead reference",
        `stderr mismatch: ${result.stderr}`,
      );
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        CMD_DOC_WIDE_ANCHOR,
        "target content changed despite wide-anchor correspondence refusal",
      );

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(
        afterLog.split("\n").length,
        1,
        "a commit was created despite wide-anchor correspondence refusal",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_allConditionsMet_commitsWithProposalInBody", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      copyRealSystemMap(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/tools/test-cmd.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, CMD_DOC_WITH_DEAD_REF);
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Remove dead reference",
          fingerprint: "skill-edit:test-cmd:auto-happy",
          target: targetRel,
          operation: "delete",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "bash scripts/dead-ref.sh",
          proposedText: "",
          rationale: "scripts/dead-ref.sh no longer exists; removing the dead reference.",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
      ok(
        /^applied: [0-9a-f]{40}$/.test(result.stdout.trim()),
        `stdout did not match "applied: <hash>": ${result.stdout}`,
      );

      const subject = gitOutput(dir, ["log", "-1", "--format=%s"]);
      ok(subject.startsWith("chore(skills): auto-apply"), `unexpected commit subject: ${subject}`);

      const body = gitOutput(dir, ["log", "-1", "--format=%B"]);
      ok(body.includes("bash scripts/dead-ref.sh"), `commit body missing Anchor text: ${body}`);
      ok(
        body.includes("scripts/dead-ref.sh no longer exists; removing the dead reference."),
        `commit body missing Rationale text: ${body}`,
      );

      const updated = readFileSync(targetAbs, "utf-8");
      ok(!updated.includes("bash scripts/dead-ref.sh"), "dead reference was not removed from target");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  // Bonus coverage (beyond the required 8): the AC requires rollback to
  // restore byte-identical content. This forces the system-map.ts step to
  // crash via a throwaway stub script, exercising that exact code path.
  it("apply_systemMapCrash_rollsBackByteIdentical", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      const originalContent = "Anchor line three.\n\nTail.\n";
      writeFileEnsuringDir(targetAbs, originalContent);
      commitAll(dir, "initial commit");

      // Minimal stub that always crashes, standing in for a broken
      // system-map.ts generator.
      writeFileEnsuringDir(resolve(dir, "scripts", "system-map.ts"), "process.exit(1);\n");

      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Crash",
          fingerprint: "skill-edit:test-doc:crash",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor line three.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 4, `expected exit 4, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.includes("restored"), `stderr missing 'restored': ${result.stderr}`);
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        originalContent,
        "target not restored byte-identical after system-map crash",
      );

      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite rollback");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  // ---------------------------------------------------------------------
  // Round-2 hardening regression tests (R1-R7): every case below was
  // empirically reproduced against the round-1 fix commit by an adversarial
  // verifier before this round closed it.
  // ---------------------------------------------------------------------

  it("apply_hardlinkedTarget_exit3", (t) => {
    // R3: a target that shares an inode with an out-of-repo file (a
    // hardlink, not a symlink — lstat reports it as an ordinary regular
    // file, so the existing symlink refusal cannot see it) must be refused
    // outright. Pre-fix, apply exited 0 and mutated the outside file
    // through the shared inode.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const outsidePath = resolve(dir, "outside-hardlink-source.md");
      const outsideContent = "Anchor for hardlink test.\n\nTail.\n";
      writeFileSync(outsidePath, outsideContent, "utf-8");

      const targetRel = ".claude/commands/hardlinked.md";
      const targetAbs = resolve(dir, targetRel);
      mkdirSync(dirname(targetAbs), { recursive: true });
      try {
        linkSync(outsidePath, targetAbs);
      } catch (err) {
        t.skip(`hardlink creation not permitted on this system: ${(err as Error).message}`);
        return;
      }
      commitAll(dir, "initial commit");
      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Hardlinked target",
          fingerprint: "skill-edit:hardlinked:hardlink",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor for hardlink test.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.toLowerCase().includes("hard link"), `stderr missing 'hard link': ${result.stderr}`);

      strictEqual(
        readFileSync(outsidePath, "utf-8"),
        outsideContent,
        "outside file mutated despite hardlink refusal",
      );
      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite hardlink refusal");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_symlinkedParentDir_exit3IdentityMessage", (t) => {
    // R2: a NON-LEAF path component being a directory symlink/junction
    // (here, `.claude/commands/foo` -> `.claude/commands/real`) resolves
    // the leaf to a DIFFERENT canonical file than `target` names, which the
    // leaf-only lstat symlink check cannot see (the leaf, `bar.md`, is an
    // ordinary file). Pre-fix, this applied and committed to
    // `real/bar.md` while the proposal claimed `foo/bar.md` — a target
    // identity confusion. Tries a junction first (creatable without
    // elevated Windows privileges); skips if unsupported.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const realDirRel = ".claude/commands/real";
      const realDirAbs = resolve(dir, realDirRel);
      mkdirSync(realDirAbs, { recursive: true });
      const realFileAbs = resolve(realDirAbs, "bar.md");
      const realContent = "Real bar content.\n\nAnchor here.\n\nTail.\n";
      writeFileSync(realFileAbs, realContent, "utf-8");
      commitAll(dir, "initial commit");
      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const linkDirAbs = resolve(dir, ".claude/commands/foo");
      try {
        symlinkSync(realDirAbs, linkDirAbs, "junction");
      } catch (err) {
        t.skip(`junction/dir-symlink creation not permitted on this system: ${(err as Error).message}`);
        return;
      }

      const targetRel = ".claude/commands/foo/bar.md";
      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Symlinked parent dir",
          fingerprint: "skill-edit:foo-bar:parent-symlink",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor here.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "error: target path is indirect — canonical location differs from proposal target",
        `stderr mismatch: ${result.stderr}`,
      );

      strictEqual(
        readFileSync(realFileAbs, "utf-8"),
        realContent,
        "real file modified despite parent-symlink identity refusal",
      );
      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite parent-symlink identity refusal");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_driveRelativeTraversalTarget_uniformError", () => {
    // R1: a drive-relative (no separator after the colon) traversal target
    // must be rejected purely lexically, with zero filesystem access — the
    // pre-fix `isAbsoluteOrUncTarget` regex required a separator right
    // after the drive letter (`C:\` / `C:/`) and so missed `C:..\..\...`,
    // letting the CLI reach `existsSync` and leak whether the traversal's
    // destination exists via two different stderr messages. Run the SAME
    // target string against two fixtures — one where a plausible
    // traversal-reachable file exists, one where it doesn't — and assert
    // byte-identical stderr both times.
    const dirExists = freshFixture();
    const dirAbsent = freshFixture();
    try {
      initGitRepo(dirExists);
      mkdirSync(resolve(dirExists, ".claude"), { recursive: true });
      writeFileSync(resolve(dirExists, "decoy.md"), "decoy content\n", "utf-8");

      initGitRepo(dirAbsent);
      mkdirSync(resolve(dirAbsent, ".claude"), { recursive: true });
      // Deliberately no decoy.md here.

      const target = "C:..\\..\\decoy.md";

      const proposalExists = resolve(dirExists, "proposal.md");
      writeFileSync(
        proposalExists,
        buildProposalDoc({
          n: 1,
          title: "Drive-relative traversal (reachable file exists)",
          fingerprint: "skill-edit:probe:drive-exists",
          target,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );
      const resultExists = runSkillApply(dirExists, ["--proposal", toPosix(proposalExists), "--n", "1"]);

      const proposalAbsent = resolve(dirAbsent, "proposal.md");
      writeFileSync(
        proposalAbsent,
        buildProposalDoc({
          n: 1,
          title: "Drive-relative traversal (reachable file absent)",
          fingerprint: "skill-edit:probe:drive-absent",
          target,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );
      const resultAbsent = runSkillApply(dirAbsent, ["--proposal", toPosix(proposalAbsent), "--n", "1"]);

      strictEqual(resultExists.status, 3, `exists-probe expected exit 3: ${resultExists.stderr}`);
      strictEqual(resultAbsent.status, 3, `absent-probe expected exit 3: ${resultAbsent.stderr}`);
      strictEqual(
        resultExists.stderr,
        resultAbsent.stderr,
        "stderr differed depending on whether the traversal-reachable file exists — oracle leak",
      );
      strictEqual(
        resultExists.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `unexpected stderr: ${resultExists.stderr}`,
      );
    } finally {
      rmSync(dirExists, { recursive: true, force: true, maxRetries: 3 });
      rmSync(dirAbsent, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_dotDotSegmentTarget_exit3", () => {
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      mkdirSync(resolve(dir, ".claude"), { recursive: true });

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Dot-dot segment",
          fingerprint: "skill-edit:probe:dotdot",
          target: ".claude/commands/../../../etc/passwd",
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_backslashSeparatorTarget_exit3", () => {
    // R1: a target using backslash separators (not a traversal, not
    // absolute — just out of the canonical forward-slash shape) must also
    // be rejected uniformly and lexically.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      mkdirSync(resolve(dir, ".claude"), { recursive: true });

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Backslash separators",
          fingerprint: "skill-edit:probe:backslash",
          target: ".claude\\commands\\test-doc.md",
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "anything",
          proposedText: "anything else",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "error: target must be a repo-relative path inside the instruction directories",
        `stderr mismatch: ${result.stderr}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_dirtyDocsMaps_exit3", () => {
    // R4: a pre-existing, uncommitted file under docs/maps must refuse the
    // apply before anything is touched — otherwise the heal step's blanket
    // `git add docs/maps` would sweep it into this run's apply commit.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      const targetRel = ".claude/commands/test-doc.md";
      const targetAbs = resolve(dir, targetRel);
      const originalContent = "Anchor for docs-maps guard.\n\nTail.\n";
      writeFileEnsuringDir(targetAbs, originalContent);
      commitAll(dir, "initial commit");

      // Pre-existing, uncommitted (untracked) file under docs/maps.
      writeFileEnsuringDir(resolve(dir, "docs/maps/stray.md"), "pre-existing dirty content\n");

      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Dirty docs/maps",
          fingerprint: "skill-edit:test-doc:dirty-maps",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Anchor for docs-maps guard.",
          proposedText: "New line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "error: docs/maps has uncommitted changes — commit or stash them first",
        `stderr mismatch: ${result.stderr}`,
      );
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        originalContent,
        "target content changed despite dirty docs/maps guard",
      );
      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite dirty docs/maps guard");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("apply_commitHookRejectsAfterHeal_fullCleanStatus", () => {
    // R5: when the commit itself fails AFTER the heal step has already
    // modified/staged docs/maps, rollback must restore docs/maps (both
    // worktree and index) in addition to the target — not just unstage it,
    // which would leave docs/maps modified-and-unstaged. Full-repo `git
    // status --porcelain` must be empty afterward.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      copyRealSystemMap(dir);
      const targetRel = ".claude/commands/tools/test-cmd.md";
      const targetAbs = resolve(dir, targetRel);
      writeFileEnsuringDir(targetAbs, CMD_DOC_WITH_DEAD_REF);
      commitAll(dir, "initial commit");

      const hookPath = resolve(dir, ".git", "hooks", "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\nexit 1\n", "utf-8");
      chmodSync(hookPath, 0o755);

      const beforeLog = gitOutput(dir, ["log", "--format=%H"]);

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Hook rejection after heal",
          fingerprint: "skill-edit:test-cmd:hook-after-heal",
          target: targetRel,
          operation: "add",
          tier: "standard",
          draftTask: "#T99",
          evidence: "test",
          anchor: "Some intro paragraph text here.",
          proposedText: "Some intro paragraph text here.\nAdded line.",
          rationale: "test",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1"]);
      strictEqual(result.status, 4, `expected exit 4, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(
        result.stderr.includes("error: commit failed — target restored"),
        `stderr missing 'commit failed' message: ${result.stderr}`,
      );

      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        CMD_DOC_WITH_DEAD_REF,
        "target not restored byte-identical after commit-failure rollback",
      );
      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog, beforeLog, "a commit was created despite hook rejection");

      // proposal.md is fixture scaffolding (never touched by skill-apply.ts
      // itself) and is expected to remain untracked — filter it out before
      // asserting the repo is otherwise fully clean.
      const fullStatus = gitOutput(dir, ["status", "--porcelain"])
        .split("\n")
        .filter((line) => line.length > 0 && !line.endsWith("proposal.md"))
        .join("\n");
      strictEqual(fullStatus, "", `expected fully clean repo after rollback, got: ${fullStatus}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("auto_singleLineEntangledRef_exit3", () => {
    // R7 end-to-end: a real, live dangling-ref finding exists for
    // scripts/dead-ref.sh, but the anchor's ONE line also carries a second,
    // unrelated live reference (scripts/critical-security-check.sh). A
    // naive whole-line dead-ref test (every non-blank line contains the
    // dead ref) would pass this — the residue entanglement check must
    // refuse it instead.
    const dir = freshFixture();
    try {
      initGitRepo(dir);
      copyRealSystemMap(dir);
      writePolicyFile(dir, "skill_auto_apply: on\n");
      const targetRel = ".claude/commands/tools/test-cmd-entangled.md";
      const targetAbs = resolve(dir, targetRel);
      const docContent = [
        "# Test Command Entangled",
        "",
        "## Section A",
        "",
        "```bash",
        "run bash scripts/dead-ref.sh then also run bash scripts/critical-security-check.sh",
        "```",
        "",
        "## Section B",
        "",
        "Trailing content unrelated.",
        "",
      ].join("\n");
      writeFileEnsuringDir(targetAbs, docContent);
      commitAll(dir, "initial commit");

      const proposalPath = resolve(dir, "proposal.md");
      writeFileSync(
        proposalPath,
        buildProposalDoc({
          n: 1,
          title: "Entangled single-line refs",
          fingerprint: "skill-edit:test-cmd-entangled:auto-entangled",
          target: targetRel,
          operation: "delete",
          tier: "auto-eligible",
          draftTask: "#T90",
          evidence: "test",
          anchor: "run bash scripts/dead-ref.sh then also run bash scripts/critical-security-check.sh",
          proposedText: "",
          rationale: "Attempts to remove the dead reference, but the line also carries a live one.",
        }),
        "utf-8",
      );

      const result = runSkillApply(dir, ["--proposal", toPosix(proposalPath), "--n", "1", "--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      strictEqual(
        result.stderr.trim(),
        "auto refused: edit does not correspond to the dead reference",
        `stderr mismatch: ${result.stderr}`,
      );
      strictEqual(
        readFileSync(targetAbs, "utf-8"),
        docContent,
        "target content changed despite entanglement refusal",
      );
      const afterLog = gitOutput(dir, ["log", "--format=%H"]);
      strictEqual(afterLog.split("\n").length, 1, "a commit was created despite entanglement refusal");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
