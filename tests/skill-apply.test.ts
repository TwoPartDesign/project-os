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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
      ok(result.stderr.toLowerCase().includes("containment"), `stderr missing 'containment': ${result.stderr}`);
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
      ok(result.stderr.toLowerCase().includes("containment"), `stderr missing 'containment': ${result.stderr}`);
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

  it("apply_autoFlag_exit3Stub", () => {
    const dir = freshFixture();
    try {
      const result = runSkillApply(dir, ["--auto"]);
      strictEqual(result.status, 3, `expected exit 3, stdout: ${result.stdout}, stderr: ${result.stderr}`);
      ok(result.stderr.includes("auto tier not yet enabled"), `stderr mismatch: ${result.stderr}`);
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
});
