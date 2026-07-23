#!/usr/bin/env node
// scripts/skill-apply.ts — Apply-engine CLI for the skill-optimization loop
// (standard tier).
//
// Reads a skill-edit proposal document, resolves proposal `n` from its LAST
// `## Run:` section (via scripts/lib/skill-apply-lib.ts's parseProposal),
// applies the proposal's anchored operation to its target instruction file,
// runs post-edit validation (system-map drift check, security scan), and
// commits the result with the full proposal block as the durable evidence
// record in the commit body.
//
// Usage:
//   node scripts/skill-apply.ts apply --proposal "<path>" --n <N> [--auto]
//
// Exit codes:
//   0  applied and committed — prints "applied: <40-hex commit hash>"
//   1  usage error (bad/missing subcommand, --proposal, or --n) or a
//      parseProposal error (message passed through to stderr)
//   3  refusal — target outside the allowed instruction directories
//      (traversal/symlink escape), repo mid-operation (detached HEAD,
//      merge/rebase/cherry-pick in progress), dirty target (git status
//      not clean), AnchorError (anchor not found / ambiguous), or the
//      `--auto` stub (auto-tier eligibility is a later task)
//   4  rolled back — post-edit validation (system-map check --heal crash,
//      or a security-scanner finding) failed; the target file has been
//      restored to its pre-apply content
//
// NOTE on scripts/system-map.ts's actual `check --heal` contract: the
// committed implementation exits 0 for BOTH "fresh" and "healed" outcomes
// (distinguished only by a "map: healed" vs "map: fresh" stdout line) and
// only uses exit 3 for drift *without* `--heal`. This CLI treats exit 3 as
// "healed" too (defensive: matches the documented contract this task was
// specified against) in addition to detecting the "map: healed" stdout
// marker, so it works under either contract. Exit 1 is treated as a
// generator crash (rollback). A missing scripts/system-map.ts or
// scripts/security-scanner.ts file (e.g. in a minimal test fixture) is
// warn-and-proceed, not a failure.
//
// All git operations use execFileSync in array form — never string
// templates — per the project's shell-safety convention.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  parseProposal,
  applyAnchoredOp,
  AnchorError,
} from "./lib/skill-apply-lib.ts";
import type { SkillEditProposal } from "./lib/skill-apply-lib.ts";
import { getProjectRoot } from "./lib/project-root.ts";

/** Repo-relative directories a proposal's `target` is allowed to resolve into. */
const ALLOWED_TARGET_DIRS = [".claude/commands/", ".claude/skills/", ".claude/rules/"];

/** Parsed `apply` subcommand flags. `--auto` is a bare boolean switch. */
interface ApplyArgs {
  proposal?: string;
  n?: string;
  auto: boolean;
}

/**
 * Minimal flag parser for the `apply` subcommand's argv tail (everything
 * after the subcommand token). `--proposal` and `--n` each consume the next
 * token as their value; `--auto` is a bare switch and never consumes a
 * following token.
 */
function parseApplyArgs(argv: string[]): ApplyArgs {
  const out: ApplyArgs = { auto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto") {
      out.auto = true;
    } else if (a === "--proposal") {
      out.proposal = argv[i + 1];
      i++;
    } else if (a === "--n") {
      out.n = argv[i + 1];
      i++;
    }
  }
  return out;
}

/** Prints usage to stderr and exits with `code`. */
function usageAndExit(code: number, message?: string): never {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/skill-apply.ts apply --proposal "<path>" --n <N> [--auto]',
  );
  process.exit(code);
}

/** Converts backslashes to forward slashes for cross-platform prefix comparison. */
function toSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Finds the next index at or after `fromIndex` where `content` contains
 * `prefix` starting at the beginning of a line. Mirrors the line-start
 * scanner in skill-apply-lib.ts, but is reimplemented locally (not
 * exported by the lib) because it is used here for a different purpose:
 * recovering the exact *raw* text span of a proposal block for the commit
 * message body, not structured field extraction.
 */
function findLineStart(content: string, prefix: string, fromIndex = 0): number {
  let idx = fromIndex;
  while (true) {
    const found = content.indexOf(prefix, idx);
    if (found === -1) return -1;
    if (found === 0 || content[found - 1] === "\n") return found;
    idx = found + prefix.length;
  }
}

/** Returns the index of the LAST line-start occurrence of `prefix`, or -1 if none. */
function lastLineStart(content: string, prefix: string): number {
  let idx = 0;
  let last = -1;
  while (true) {
    const found = findLineStart(content, prefix, idx);
    if (found === -1) return last;
    last = found;
    idx = found + prefix.length;
  }
}

/**
 * Re-locates and returns the raw, verbatim text of proposal `n`'s block
 * from the LAST `## Run:` section in `docContent` — the same block
 * `parseProposal` parses structurally. Needed for the commit message body,
 * which must carry fields (e.g. `Size`) that the parsed `SkillEditProposal`
 * does not retain, so it cannot be reconstructed from the parsed object.
 * Assumes `parseProposal(docContent, n)` has already succeeded against the
 * same `docContent`/`n` (the caller's responsibility) — boundary lookups
 * here are therefore not expected to fail in practice, but still throw a
 * descriptive error if they do.
 */
function extractProposalBlock(docContent: string, n: number): string {
  const runStart = lastLineStart(docContent, "## Run:");
  if (runStart === -1) {
    throw new Error("no '## Run:' section found in proposal document");
  }
  const runEnd = findLineStart(docContent, "## ", runStart + "## Run:".length);
  const runSection = docContent.slice(runStart, runEnd === -1 ? docContent.length : runEnd);

  const marker = `### Proposal ${n}:`;
  const proposalIdx = findLineStart(runSection, marker);
  if (proposalIdx === -1) {
    throw new Error(`Proposal ${n} not found in the last '## Run:' section`);
  }
  const nextProposalIdx = findLineStart(runSection, "### Proposal ", proposalIdx + marker.length);
  const block = runSection.slice(
    proposalIdx,
    nextProposalIdx === -1 ? runSection.length : nextProposalIdx,
  );
  return block.replace(/\s+$/, "");
}

/** Restores `targetAbs` to `originalContent` (byte-for-byte), prints `message`, and exits with `code`. */
function rollbackAndExit(
  targetAbs: string,
  originalContent: string,
  code: number,
  message: string,
): never {
  writeFileSync(targetAbs, originalContent, "utf-8");
  console.error(message);
  process.exit(code);
}

/**
 * Runs `node scripts/system-map.ts check --heal` in `projectRoot`. A missing
 * script is warn-and-proceed. Exit 1 (or a null status, i.e. killed by
 * signal) is treated as a generator crash and rolls back. Exit 0 with a
 * "map: healed" stdout marker, or exit 3 (the documented-but-unobserved
 * "healed" contract), stages `docs/maps` via `git add` (best-effort — a
 * minimal fixture may have system-map.ts but no docs/maps directory yet).
 */
function runSystemMapCheck(
  projectRoot: string,
  targetAbs: string,
  originalContent: string,
): void {
  const systemMapPath = resolve(projectRoot, "scripts/system-map.ts");
  if (!existsSync(systemMapPath)) {
    console.error("warning: scripts/system-map.ts not found — skipping map validation");
    return;
  }

  const result = spawnSync(process.execPath, [systemMapPath, "check", "--heal"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  const code = result.status;
  const stdout = result.stdout ?? "";

  if (code === null || code === 1) {
    rollbackAndExit(
      targetAbs,
      originalContent,
      4,
      "error: scripts/system-map.ts check --heal crashed, target restored",
    );
  }

  if (code === 0 || code === 3) {
    if (code === 3 || stdout.includes("map: healed")) {
      try {
        execFileSync("git", ["add", "docs/maps"], { cwd: projectRoot, stdio: "pipe" });
      } catch {
        // Best-effort: a light fixture may ship system-map.ts without a
        // docs/maps directory to heal. Nothing to stage in that case.
      }
    }
    return;
  }

  rollbackAndExit(
    targetAbs,
    originalContent,
    4,
    `error: scripts/system-map.ts check --heal exited ${code}, target restored`,
  );
}

/**
 * Runs `node scripts/security-scanner.ts scan-files <targetAbs>` in
 * `projectRoot`. A missing script is warn-and-proceed. Any nonzero (or
 * null, i.e. killed by signal) exit status is treated as a finding and
 * rolls back.
 */
function runSecurityScan(projectRoot: string, targetAbs: string, originalContent: string): void {
  const scannerPath = resolve(projectRoot, "scripts/security-scanner.ts");
  if (!existsSync(scannerPath)) {
    console.error("warning: scripts/security-scanner.ts not found — skipping security scan");
    return;
  }

  const result = spawnSync(process.execPath, [scannerPath, "scan-files", targetAbs], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  const code = result.status;
  if (code !== 0) {
    rollbackAndExit(
      targetAbs,
      originalContent,
      4,
      `error: scripts/security-scanner.ts scan-files reported findings (exit ${code}), target restored`,
    );
  }
}

/**
 * Entry point for the `apply` subcommand. See the module header for the
 * full step sequence and exit-code contract.
 */
function main(): void {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  if (subcommand !== "apply") {
    usageAndExit(1, `error: unknown subcommand: ${subcommand ?? "(none)"}`);
  }

  const args = parseApplyArgs(argv.slice(1));

  // --auto stub: a later task replaces this with the six-condition
  // eligibility class (#T90). Checked before other flag validation so
  // `--auto` alone is sufficient to observe the stub behavior.
  if (args.auto) {
    console.error("auto tier not yet enabled");
    process.exit(3);
  }

  if (!args.proposal) {
    usageAndExit(1, "error: missing --proposal");
  }
  if (!args.n || !/^\d+$/.test(args.n) || parseInt(args.n, 10) <= 0) {
    usageAndExit(1, `error: missing or invalid --n: ${args.n ?? "(none)"}`);
  }
  const n = parseInt(args.n, 10);

  const proposalPath = resolve(args.proposal);
  if (!existsSync(proposalPath)) {
    console.error(`error: proposal file not found: ${proposalPath}`);
    process.exit(1);
  }
  const proposalContent = readFileSync(proposalPath, "utf-8");

  let proposal: SkillEditProposal;
  try {
    proposal = parseProposal(proposalContent, n);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Step 3: resolve + contain the target.
  const projectRoot = getProjectRoot();
  const targetAbs = resolve(projectRoot, proposal.target);
  if (!existsSync(targetAbs)) {
    console.error(`error: target file does not exist: ${targetAbs}`);
    process.exit(3);
  }

  let canonicalTarget: string;
  let canonicalRoot: string;
  try {
    canonicalTarget = realpathSync(targetAbs);
    canonicalRoot = realpathSync(projectRoot);
  } catch (err) {
    console.error(`error: cannot resolve target path: ${(err as Error).message}`);
    process.exit(3);
  }

  const normTarget = toSlashes(canonicalTarget);
  const normRoot = toSlashes(canonicalRoot).replace(/\/$/, "");
  const contained = ALLOWED_TARGET_DIRS.some((dir) => normTarget.startsWith(`${normRoot}/${dir}`));
  if (!contained) {
    console.error(
      `error: containment check failed — target resolves outside the allowed instruction directories (.claude/commands, .claude/skills, .claude/rules): ${canonicalTarget}`,
    );
    process.exit(3);
  }

  // Step 4: repo-state guard (worktree-safe git-dir resolution).
  let gitDirRaw: string;
  try {
    gitDirRaw = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();
  } catch (err) {
    console.error(`error: not a git repository: ${(err as Error).message}`);
    process.exit(3);
  }
  const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(projectRoot, gitDirRaw);

  let detached = false;
  try {
    execFileSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: projectRoot, stdio: "pipe" });
  } catch {
    detached = true;
  }
  if (detached) {
    console.error("error: refusing to apply — HEAD is detached");
    process.exit(3);
  }

  const inProgressMarkers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"];
  for (const marker of inProgressMarkers) {
    if (existsSync(resolve(gitDir, marker))) {
      console.error(`error: refusing to apply — repo mid-operation (${marker} present)`);
      process.exit(3);
    }
  }

  // Step 5: clean-target guard.
  const relTarget = relative(projectRoot, targetAbs).replace(/\\/g, "/");
  const statusOut = execFileSync("git", ["status", "--porcelain", "--", relTarget], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  if (statusOut.trim().length > 0) {
    console.error(`error: target has uncommitted changes (git status not clean): ${relTarget}`);
    process.exit(3);
  }

  // Step 6: apply the anchored operation.
  const originalContent = readFileSync(targetAbs, "utf-8");
  let newContent: string;
  try {
    newContent = applyAnchoredOp(originalContent, proposal);
  } catch (err) {
    if (err instanceof AnchorError) {
      console.error(`error: ${err.message}`);
      process.exit(3);
    }
    throw err;
  }
  writeFileSync(targetAbs, newContent, "utf-8");

  // Step 7: post-edit validation (rolls back + exits 4 on failure).
  runSystemMapCheck(projectRoot, targetAbs, originalContent);
  runSecurityScan(projectRoot, targetAbs, originalContent);

  // Step 8: commit.
  const proposalBlock = extractProposalBlock(proposalContent, n);
  const subject = `chore(skills): apply ${proposal.draftTask} ${proposal.title}`;
  const commitMsg = `${subject}\n\n${proposalBlock}\n`;

  const msgPath = resolve(gitDir, "SKILL_APPLY_MSG");
  writeFileSync(msgPath, commitMsg, "utf-8");
  try {
    execFileSync("git", ["add", relTarget], { cwd: projectRoot, stdio: "pipe" });
    execFileSync("git", ["commit", "-F", msgPath], { cwd: projectRoot, stdio: "pipe" });
  } finally {
    if (existsSync(msgPath)) unlinkSync(msgPath);
  }

  const hash = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf-8",
  }).trim();
  console.log(`applied: ${hash}`);
  process.exit(0);
}

main();
