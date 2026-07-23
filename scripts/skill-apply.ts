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
// `--auto` (#T90): a narrow, machine-checked eligibility class that lets a
// dead-reference fix apply WITHOUT prior human approval. Gated by six
// conditions, checked in order, every one of which is verified against the
// platform's real state (never trusted from the proposal's own claims):
//   1. policy: readPolicyFlag("skill_auto_apply", false) from
//      scripts/lib/policy.ts must be true
//   2. operation: proposal.operation is delete or replace (never add)
//   3. target: canonical target path is under .claude/commands/ or
//      .claude/skills/ ONLY — .claude/rules/ is excluded from auto, tighter
//      than the standard tier's containment
//   4. size: estimateTokens(newContent) <= estimateTokens(oldContent)
//   5. live map evidence: `node scripts/system-map.ts report --json` must
//      report at least one dangling-ref finding whose subject id equals
//      pathToId(target) (scripts/lib/system-map-lib.ts)
//   6. edit-content correspondence: scripts/lib/skill-apply-lib.ts's
//      checkAutoCorrespondence confirms the missing-target string named by
//      that finding genuinely occurs in the proposal's anchor as a
//      boundary-delimited match (so `scripts/dead-ref.sh` inside
//      `scripts/dead-ref.sh.bak` never counts), then checks each
//      dead-ref-bearing line for entanglement with a second, unrelated
//      live path-like reference on the same line (refused if found — see
//      the lib's docstring); a `delete` is only eligible when EVERY
//      non-blank anchor line contains the dead ref, and a `replace` is only
//      eligible when proposedText equals EXACTLY the anchor's lines with
//      the dead-ref-bearing lines removed (zero other changes tolerated) —
//      this is what prevents an anchor elsewhere in the same file, a wide
//      anchor that merely *contains* the dead ref alongside unrelated
//      content, or a single degenerate line entangling the dead ref with a
//      second live reference, from "smuggling" an unrelated edit through
//      (or destroying a live reference) under cover of a real finding.
// The first failing condition exits 3 with a `auto refused: <condition>`
// stderr message, before anything is written to disk — a clean signal the
// caller uses to fall back to filing a normal (human-approved) draft. All
// six passing falls through into the exact same apply/validate/commit path
// below, just with an `auto-apply` commit subject.
//
// Exit codes:
//   0  applied and committed — prints "applied: <40-hex commit hash>"
//   1  usage error (bad/missing subcommand, --proposal, or --n) or a
//      parseProposal error (message passed through to stderr)
//   3  refusal — target lexically invalid or outside the allowed
//      instruction directories (drive-prefixed, absolute, UNC, `..`
//      traversal, or backslash-bearing — ALL of these collapse to one
//      uniform message, checked with zero filesystem access, before target
//      is a symlink (leaf or a non-leaf indirect/junction component —
//      "canonical location differs" message), target has multiple hard
//      links, repo mid-operation (detached HEAD, merge/rebase/cherry-pick in
//      progress), dirty target or dirty docs/maps (git status not clean),
//      AnchorError (anchor not found / ambiguous), or an `--auto`
//      eligibility condition failing (see above)
//   4  rolled back — post-edit validation (system-map check --heal crash,
//      or a security-scanner finding) failed, or the apply commit itself
//      failed (e.g. a pre-commit hook rejection); the target file, the git
//      index, and docs/maps (worktree + index) have all been restored to
//      their pre-apply state
//
// Every fs/git operation past target resolution acts on the SAME canonical
// path (`canonicalTarget` / `relTarget`, derived once via `realpathSync` in
// `resolveAndContainTarget`) — never the pre-resolution `targetAbs` — so
// containment, the anchor read, the write, and the commit's pathspec can
// never diverge from one another (see the M1 fix note on
// `resolveAndContainTarget` below). `relTarget` is additionally guaranteed
// (round-2 R2) to equal the proposal's own `target` string exactly — the
// canonical-identity check refuses any indirect resolution before this
// point is ever reached.
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
  lstatSync,
  statSync,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  parseProposal,
  applyAnchoredOp,
  estimateTokens,
  checkAutoCorrespondence,
  AnchorError,
} from "./lib/skill-apply-lib.ts";
import type { SkillEditProposal } from "./lib/skill-apply-lib.ts";
import { getProjectRoot } from "./lib/project-root.ts";
import { readPolicyFlag } from "./lib/policy.ts";
import { pathToId } from "./lib/system-map-lib.ts";
import type { Finding } from "./lib/system-map-lib.ts";

/** Repo-relative directories a proposal's `target` is allowed to resolve into. */
const ALLOWED_TARGET_DIRS = [".claude/commands/", ".claude/skills/", ".claude/rules/"];

/**
 * Repo-relative directories the `--auto` tier's target may resolve into —
 * strictly narrower than {@link ALLOWED_TARGET_DIRS}: `.claude/rules/` is
 * excluded from auto (condition 3/6) even though a human-approved standard
 * apply may target it.
 */
const AUTO_TARGET_DIRS = [".claude/commands/", ".claude/skills/"];

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

/**
 * Restores `targetAbs` to `originalContent` (byte-for-byte), best-effort
 * restores `docs/maps` to its pre-apply state (R5 — see
 * {@link restoreDocsMapsBestEffort}; a crashed/failed validation step may
 * have left a partial heal behind), prints `message`, and exits with `code`.
 */
function rollbackAndExit(
  projectRoot: string,
  targetAbs: string,
  originalContent: string,
  code: number,
  message: string,
): never {
  writeFileSync(targetAbs, originalContent, "utf-8");
  restoreDocsMapsBestEffort(projectRoot);
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
 *
 * Returns `true` iff `docs/maps` was actually staged by THIS run (M3a: the
 * caller uses this to build the apply commit's pathspec — `docs/maps` is
 * only ever included in that pathspec when this run is the one that staged
 * it, never assumed).
 */
function runSystemMapCheck(
  projectRoot: string,
  targetAbs: string,
  originalContent: string,
): boolean {
  const systemMapPath = resolve(projectRoot, "scripts/system-map.ts");
  if (!existsSync(systemMapPath)) {
    console.error("warning: scripts/system-map.ts not found — skipping map validation");
    return false;
  }

  const result = spawnSync(process.execPath, [systemMapPath, "check", "--heal"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  const code = result.status;
  const stdout = result.stdout ?? "";

  if (code === null || code === 1) {
    rollbackAndExit(
      projectRoot,
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
        return true;
      } catch {
        // Best-effort: a light fixture may ship system-map.ts without a
        // docs/maps directory to heal. Nothing to stage in that case.
      }
    }
    return false;
  }

  rollbackAndExit(
    projectRoot,
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
      projectRoot,
      targetAbs,
      originalContent,
      4,
      `error: scripts/security-scanner.ts scan-files reported findings (exit ${code}), target restored`,
    );
  }
}

/**
 * Anchored, single-quantifier match for the missing-target string named at
 * the end of a `dangling-ref` finding's `detail` message — see
 * scripts/lib/system-map-lib.ts's `findDanglingRefs`, which always produces
 * `Edge ${kind} from ${from} points to missing node ${to}.` (a trailing
 * literal period after the path). Greedy-but-anchored: `.+` backtracks only
 * as far as the final literal `.`, which is always the template's own
 * terminator, never a `.` inside the path itself (e.g. `scripts/x.sh`).
 */
const DANGLING_REF_TARGET_RE = /points to missing node (.+)\.$/;

/** Extracts the missing-target path from a dangling-ref finding's `detail` string, or `null` if it doesn't match the expected shape. */
function extractDanglingRefTarget(detail: string): string | null {
  const m = DANGLING_REF_TARGET_RE.exec(detail);
  return m ? m[1] : null;
}

/**
 * Runs `node scripts/system-map.ts report --json` in `projectRoot` and
 * parses its stdout as a `Finding[]` array (scripts/system-map.ts's
 * `cmdReport` prints exactly `JSON.stringify(result.findings, null, 2)` for
 * `--json` and always exits 0 on success). Returns `null` — never throws —
 * for every failure mode: a missing script, a nonzero/signal-killed exit, or
 * stdout that doesn't parse as an array. The auto-tier gate (condition 5/6)
 * treats all of these as "no live evidence" uniformly.
 */
function runSystemMapReportJson(projectRoot: string): Finding[] | null {
  const systemMapPath = resolve(projectRoot, "scripts/system-map.ts");
  if (!existsSync(systemMapPath)) return null;

  const result = spawnSync(process.execPath, [systemMapPath, "report", "--json"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) return null;

  try {
    const parsed: unknown = JSON.parse(result.stdout ?? "");
    if (!Array.isArray(parsed)) return null;
    return parsed as Finding[];
  } catch {
    return null;
  }
}

/**
 * Runs the auto-tier's remaining eligibility conditions (4: size must not
 * increase, 5: live system-map dangling-ref evidence, 6: edit-content
 * correspondence) once the anchored operation has been computed in memory
 * but strictly before anything is written to disk. Exits 3 with a
 * `auto refused: <condition>` message on the first failing condition;
 * returns normally when all three pass. Conditions 1-3 (policy, operation,
 * target containment) are checked earlier in `main()`.
 */
function runAutoGate(
  projectRoot: string,
  relTarget: string,
  proposal: SkillEditProposal,
  originalContent: string,
  newContent: string,
): void {
  // Condition 4/6: size must not increase.
  if (estimateTokens(newContent) > estimateTokens(originalContent)) {
    console.error("auto refused: size increased");
    process.exit(3);
  }

  // Condition 5/6: live system-map evidence. Re-derive the target's node id
  // exactly the way the generator does. pathToId throws on an out-of-scope
  // path; that should be unreachable this far in (condition 3 already
  // confirmed containment under .claude/commands or .claude/skills), but is
  // still guarded rather than assumed.
  let targetId: string;
  try {
    targetId = pathToId(relTarget);
  } catch {
    console.error("auto refused: no live dangling-ref finding for target");
    process.exit(3);
  }

  const findings = runSystemMapReportJson(projectRoot);
  const matches = (findings ?? []).filter(
    (f) => f.kind === "dangling-ref" && f.subject === targetId,
  );
  if (matches.length === 0) {
    console.error("auto refused: no live dangling-ref finding for target");
    process.exit(3);
  }

  // Condition 6/6: edit-content correspondence. At least one matching
  // finding's missing-target string must genuinely be what the proposal's
  // anchor/proposedText addresses — guards against a proposal anchored
  // somewhere unrelated in the same file, smuggled in under cover of a real
  // dangling-ref finding elsewhere in that file.
  const op = proposal.operation as "delete" | "replace"; // condition 2 already excluded "add"
  const corresponds = matches.some((f) => {
    const deadRef = extractDanglingRefTarget(f.detail);
    return (
      deadRef !== null &&
      checkAutoCorrespondence(proposal.anchor, proposal.proposedText, op, deadRef)
    );
  });
  if (!corresponds) {
    console.error("auto refused: edit does not correspond to the dead reference");
    process.exit(3);
  }
}

/**
 * Round-2 R1 hardening: the single uniform rejection message for EVERY
 * lexically-invalid or lexically-out-of-bounds `target`. Deliberately
 * identical regardless of which specific defect triggered it, and regardless
 * of anything on disk — a per-defect or existence-dependent message is
 * exactly the oracle a traversal probe (e.g. a drive-relative
 * `C:..\..\...` target) can use to learn whether an out-of-repo file exists,
 * by diffing stderr across two otherwise-identical runs. Every path that
 * reaches this message must produce it byte-for-byte identically.
 */
const UNIFORM_TARGET_REJECTION =
  "error: target must be a repo-relative path inside the instruction directories";

/**
 * True iff `target` contains a literal `..` path segment. Callers must
 * reject any backslash first — this only ever splits on `/`, so a
 * backslash-separated `..` (e.g. `foo\..\bar`) is caught by the separate
 * backslash check, not by this one.
 */
function hasDotDotSegment(target: string): boolean {
  return target.split("/").some((seg) => seg === "..");
}

/**
 * Round-2 R1 hardening: lexical shape validation for a proposal's raw,
 * pre-resolution `target` string — evaluated on the string alone, with zero
 * filesystem access, so it can run before ANY `existsSync`/`realpathSync`/
 * `lstatSync` call touches the target. Proposal targets are canonical,
 * repo-relative, forward-slash paths; `target` is rejected if it:
 *
 * - matches `/^[a-zA-Z]:/` — ANY drive prefix, with or without a following
 *   separator (a bare regex requiring `C:\` or `C:/` misses Windows
 *   drive-relative paths like `C:foo\bar`, which `path.resolve` treats
 *   specially and which the previous round's `isAbsoluteOrUncTarget` check
 *   let through);
 * - starts with `/` or `\` (absolute POSIX path, or a UNC/backslash-rooted
 *   path — `//host/share` and `\\host\share` both start with one of these);
 * - contains a `..` path segment anywhere (traversal);
 * - contains any `\` at all — targets are canonical forward-slash
 *   repo-relative paths; a backslash anywhere (not just as a path
 *   separator) is out of shape.
 */
function hasInvalidTargetShape(target: string): boolean {
  return (
    /^[a-zA-Z]:/.test(target) ||
    target.startsWith("/") ||
    target.startsWith("\\") ||
    target.includes("\\") ||
    hasDotDotSegment(target)
  );
}

/**
 * Round-2 R1 hardening: validates a proposal's `target` entirely lexically —
 * shape (see {@link hasInvalidTargetShape}) plus containment, checked by
 * joining `target` onto `projectRoot` as a plain string (no `path.resolve`/
 * `path.normalize`, which could silently absorb something the shape check
 * didn't already reject) and comparing string prefixes — BEFORE any
 * `existsSync`/`realpathSync`/`lstatSync` call. Any shape or broad-containment
 * failure exits 3 with the single {@link UNIFORM_TARGET_REJECTION} message,
 * with zero variation based on what exists on disk. The auto-tier's tighter
 * containment (condition 3/6 — `.claude/rules/` excluded from auto) is
 * checked separately, after the broad check passes, with its own distinct
 * `auto refused:` message (that condition is deterministic regardless of
 * disk state, so it doesn't need to fold into the uniform message).
 */
function validateTargetLexicalOrExit(projectRoot: string, target: string, auto: boolean): void {
  if (hasInvalidTargetShape(target)) {
    console.error(UNIFORM_TARGET_REJECTION);
    process.exit(3);
  }

  const normRoot = toSlashes(projectRoot).replace(/\/$/, "");
  const lexicalTarget = `${normRoot}/${target}`;

  const contained = ALLOWED_TARGET_DIRS.some((dir) => lexicalTarget.startsWith(`${normRoot}/${dir}`));
  if (!contained) {
    console.error(UNIFORM_TARGET_REJECTION);
    process.exit(3);
  }

  // Auto-tier condition 3/6: tighter containment than the standard tier —
  // .claude/rules/ is excluded from auto even though it's allowed for a
  // human-approved standard apply. Distinct message: this is a deterministic
  // tier rule, not part of the oracle-closure surface above.
  if (auto) {
    const autoContained = AUTO_TARGET_DIRS.some((dir) => lexicalTarget.startsWith(`${normRoot}/${dir}`));
    if (!autoContained) {
      console.error(
        "auto refused: target must be under .claude/commands/ or .claude/skills/ (rules excluded from auto)",
      );
      process.exit(3);
    }
  }
}

/**
 * Resolves a proposal's `target` (already validated lexically-safe and
 * lexically-contained by {@link validateTargetLexicalOrExit}) against
 * `projectRoot`, confirms it exists, refuses it outright if the leaf itself
 * is a symlink (M1: an in-bounds symlink pointing at a different in-bounds
 * file passes a naive containment check because `realpathSync` resolves it
 * before that check runs — refusing any symlink target closes this
 * regardless of where it points), then canonicalizes via `realpathSync` and
 * runs two further checks against the canonical path:
 *
 * - R3 (hardlink refusal): `statSync(canonicalTarget).nlink > 1` means the
 *   leaf shares an inode with some other file on disk — refused outright,
 *   because a write through this path would silently mutate whatever else
 *   is hardlinked to it, wherever that file is reached from.
 * - R2 (canonical-identity check): a NON-LEAF path component being a
 *   symlink or junction (e.g. a `.claude/commands/foo` directory symlink or
 *   Windows junction pointing at `.claude/commands/real`) resolves the leaf
 *   to a DIFFERENT canonical file than the one named by `target` — which
 *   the leaf-only `lstatSync` check above cannot see, since the leaf entry
 *   itself is a perfectly ordinary file. Requires
 *   `relative(canonicalRoot, canonicalTarget)` (forward-slashed,
 *   case-insensitive compared on win32) to equal `target` exactly; any
 *   mismatch means every later fs/git operation would silently act on a
 *   different file than the one this apply run is evidenced against, so it
 *   is refused rather than trusted.
 *
 * Returns `canonicalTarget` (the real path every later fs/git operation in
 * `main()` must use) and `relTarget` (`=== target`, guaranteed by the R2
 * check just performed — so containment, the read, the write, and the
 * commit's pathspec can never diverge from one another). Exits 3 on any
 * failure.
 */
function resolveAndContainTarget(
  projectRoot: string,
  target: string,
): { canonicalTarget: string; relTarget: string } {
  const targetAbs = resolve(projectRoot, target);
  if (!existsSync(targetAbs)) {
    console.error(`error: target file does not exist: ${targetAbs}`);
    process.exit(3);
  }

  let lst;
  try {
    lst = lstatSync(targetAbs);
  } catch (err) {
    console.error(`error: cannot stat target: ${(err as Error).message}`);
    process.exit(3);
  }
  if (lst.isSymbolicLink()) {
    console.error("error: target is a symlink — instruction files must be regular files");
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

  // R3: hardlink refusal — a shared inode means a write here silently
  // mutates another file entirely, however that file is reached.
  let canonicalStat;
  try {
    canonicalStat = statSync(canonicalTarget);
  } catch (err) {
    console.error(`error: cannot stat canonical target: ${(err as Error).message}`);
    process.exit(3);
  }
  if (typeof canonicalStat.nlink === "number" && canonicalStat.nlink > 1) {
    console.error("error: target has multiple hard links");
    process.exit(3);
  }

  // R2: canonical-identity check — a non-leaf symlink/junction component
  // resolves the leaf to a different file than `target` names.
  const canonicalRel = toSlashes(relative(canonicalRoot, canonicalTarget));
  const identityMatches =
    process.platform === "win32"
      ? canonicalRel.toLowerCase() === target.toLowerCase()
      : canonicalRel === target;
  if (!identityMatches) {
    console.error("error: target path is indirect — canonical location differs from proposal target");
    process.exit(3);
  }

  return { canonicalTarget, relTarget: target };
}

/**
 * Resolves the repo's git-dir (worktree-safe — uses `git rev-parse
 * --git-dir` rather than assuming `<root>/.git`) and refuses to apply if
 * HEAD is detached or a merge/rebase/cherry-pick is mid-flight. Returns the
 * absolute git-dir path (needed later for the commit-message scratch file).
 * Exits 3 on any failure.
 */
function guardRepoState(projectRoot: string): string {
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

  return gitDir;
}

/**
 * Refuses to apply if `relTarget` has uncommitted changes (`git status
 * --porcelain -- relTarget` is non-empty). Exits 3 on a dirty target.
 */
function guardCleanTarget(projectRoot: string, relTarget: string): void {
  const statusOut = execFileSync("git", ["status", "--porcelain", "--", relTarget], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  if (statusOut.trim().length > 0) {
    console.error(`error: target has uncommitted changes (git status not clean): ${relTarget}`);
    process.exit(3);
  }
}

/**
 * Round-2 R4 hardening: refuses to apply if `docs/maps` has any uncommitted
 * changes (`git status --porcelain -- docs/maps` is non-empty) BEFORE this
 * run touches anything. `runSystemMapCheck`'s heal step stages the WHOLE
 * `docs/maps` directory via `git add docs/maps` — without this guard, a
 * pre-existing, unrelated dirty file under `docs/maps` would be silently
 * swept into this run's apply commit. A nonexistent `docs/maps` directory
 * (a fixture that has never run the heal step) reports empty status, same
 * as a clean one — nothing to reject. Exits 3 on a dirty docs/maps.
 */
function guardCleanDocsMaps(projectRoot: string): void {
  const statusOut = execFileSync("git", ["status", "--porcelain", "--", "docs/maps"], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  if (statusOut.trim().length > 0) {
    console.error("error: docs/maps has uncommitted changes — commit or stash them first");
    process.exit(3);
  }
}

/**
 * Round-2 R5 hardening: best-effort restores `docs/maps` to its pre-apply
 * (HEAD) state in both the index and the working tree — unconditionally
 * safe to call on every rollback path, because {@link guardCleanDocsMaps}
 * (R4) already confirmed `docs/maps` was clean before this run began, so
 * there is nothing under it this could clobber. Wrapped in try/catch: a
 * restore failure (e.g. no `docs/maps` ever existed to restore) only warns
 * — the caller has already decided to exit nonzero regardless.
 */
function restoreDocsMapsBestEffort(projectRoot: string): void {
  try {
    execFileSync("git", ["restore", "--worktree", "--staged", "--", "docs/maps"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch (err) {
    console.error(`warning: failed to restore docs/maps during rollback: ${(err as Error).message}`);
  }
}

/**
 * Stages and commits the applied edit, restricted to an explicit pathspec —
 * `relTarget` plus `docs/maps` iff `mapsStaged` (M3a: never the bare `git
 * commit -F <msg>` this replaces, which would sweep in ANY other change
 * already staged in the index by something else entirely, unrelated to this
 * apply run).
 *
 * If `git add` or `git commit` throws (e.g. a pre-commit hook rejection, or
 * a missing commit identity), rolls back rather than letting the exception
 * propagate uncaught (M3b): restores `targetAbs` to `originalContent`
 * byte-for-byte, best-effort unstages `relTarget` via `git restore --staged`,
 * best-effort fully restores `docs/maps` (R5 — see
 * {@link restoreDocsMapsBestEffort}; needed because the heal step may have
 * left `docs/maps` healed-and-staged, or healed-and-unstaged, ahead of the
 * commit failure), prints `error: commit failed — target restored`, and
 * exits 4 — never leaving the repo modified-and-staged with an undocumented
 * exit code.
 *
 * Returns the new commit's full hash on success.
 */
function commitApply(
  projectRoot: string,
  gitDir: string,
  relTarget: string,
  mapsStaged: boolean,
  commitMsg: string,
  targetAbs: string,
  originalContent: string,
): string {
  const pathspec = mapsStaged ? [relTarget, "docs/maps"] : [relTarget];
  const msgPath = resolve(gitDir, "SKILL_APPLY_MSG");
  writeFileSync(msgPath, commitMsg, "utf-8");

  try {
    execFileSync("git", ["add", relTarget], { cwd: projectRoot, stdio: "pipe" });
    execFileSync("git", ["commit", "-F", msgPath, "--", ...pathspec], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    writeFileSync(targetAbs, originalContent, "utf-8");
    try {
      execFileSync("git", ["restore", "--staged", "--", relTarget], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch {
      // Best-effort: nothing more to do if the restore itself fails — the
      // working-tree content is already back to originalContent, which is
      // the byte-identical guarantee the caller relies on.
    }
    restoreDocsMapsBestEffort(projectRoot);
    if (existsSync(msgPath)) unlinkSync(msgPath);
    console.error("error: commit failed — target restored");
    process.exit(4);
  }

  if (existsSync(msgPath)) unlinkSync(msgPath);
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf-8",
  }).trim();
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

  // Auto-tier condition 1/6: policy gate. Checked before other flag
  // validation (mirrors the pre-#T90 stub's behavior) so `--auto` alone,
  // even without a valid --proposal, is enough to observe a policy-off
  // refusal — the caller falls back to filing a normal draft either way.
  if (args.auto && !readPolicyFlag("skill_auto_apply", false)) {
    console.error("auto refused: policy off");
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

  // Auto-tier condition 2/6: operation must be delete or replace — add is
  // never eligible (auto only ever removes or shrinks known-dead content,
  // never introduces new content unsupervised).
  if (args.auto && proposal.operation !== "delete" && proposal.operation !== "replace") {
    console.error("auto refused: op must be delete|replace");
    process.exit(3);
  }

  // R1: validate the target's lexical shape + containment before ANY
  // filesystem call touches it — closes the existence-oracle a
  // fs-call-first check would otherwise leak (see docstring).
  const projectRoot = getProjectRoot();
  validateTargetLexicalOrExit(projectRoot, proposal.target, args.auto);

  // Step: resolve + canonicalize the target (R2/R3-hardened — see docstring).
  const { canonicalTarget, relTarget } = resolveAndContainTarget(projectRoot, proposal.target);

  // Step: repo-state guard (worktree-safe git-dir resolution).
  const gitDir = guardRepoState(projectRoot);

  // Step: clean-target guard.
  guardCleanTarget(projectRoot, relTarget);

  // R4: docs/maps must be clean before this run touches anything — the
  // heal step below stages the whole directory.
  guardCleanDocsMaps(projectRoot);

  // Step: apply the anchored operation. Reads/writes use canonicalTarget
  // throughout, never the pre-resolution targetAbs (M1).
  const originalContent = readFileSync(canonicalTarget, "utf-8");
  let newContent: string;
  try {
    newContent = applyAnchoredOp(originalContent, proposal);
  } catch (err) {
    if (err instanceof AnchorError) {
      console.error(args.auto ? `auto refused: ${err.message}` : `error: ${err.message}`);
      process.exit(3);
    }
    throw err;
  }

  // Auto-tier conditions 4-6/6 — must complete before any write.
  if (args.auto) {
    runAutoGate(projectRoot, relTarget, proposal, originalContent, newContent);
  }

  writeFileSync(canonicalTarget, newContent, "utf-8");

  // Step: post-edit validation (rolls back + exits 4 on failure).
  const mapsStaged = runSystemMapCheck(projectRoot, canonicalTarget, originalContent);
  runSecurityScan(projectRoot, canonicalTarget, originalContent);

  // Step: commit — pathspec-scoped (M3a) with rollback on failure (M3b).
  const proposalBlock = extractProposalBlock(proposalContent, n);
  const subject = args.auto
    ? `chore(skills): auto-apply ${proposal.draftTask} ${proposal.title}`
    : `chore(skills): apply ${proposal.draftTask} ${proposal.title}`;
  const commitMsg = `${subject}\n\n${proposalBlock}\n`;

  const hash = commitApply(
    projectRoot,
    gitDir,
    relTarget,
    mapsStaged,
    commitMsg,
    canonicalTarget,
    originalContent,
  );
  console.log(`applied: ${hash}`);
  process.exit(0);
}

main();
