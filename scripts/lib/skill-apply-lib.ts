// scripts/lib/skill-apply-lib.ts — Apply-engine pure core for the
// skill-optimization loop.
//
// Parses "## Run:" / "### Proposal N:" sections out of a skill-edit proposal
// document, and applies the parsed anchored operation to a target file's
// content. Every function here is pure (string in, string/value out) — no
// fs/git/child_process access. A later task builds the CLI (file reads,
// git operations, ROADMAP wiring) around these primitives.
//
// Parsing is index-based (indexOf loops + small single-line anchored
// regexes), per the linear-parse mandate: no unbounded-backtracking regex is
// run over the full proposal document or file content. See
// scripts/maintain-draft.ts's `appendDraftTask` for the idiom this mirrors.

/** One parsed `### Proposal N:` entry from a skill-edit proposal document. */
export interface SkillEditProposal {
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

/**
 * Thrown by `applyAnchoredOp` when a proposal's anchor text does not occur
 * exactly once in the target file content (zero matches, or more than one).
 */
export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

/** Detects whether `content` uses CRLF or LF line endings; defaults to LF. */
function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Re-writes every line ending in `s` to `eol`. Normalizes to LF first (so
 * mixed/CRLF input collapses cleanly) then expands to CRLF if requested.
 * Used to make proposal-doc text (which may have been authored with either
 * line-ending style) match the target file's actual EOL before comparing or
 * inserting it.
 */
function normalizeEol(s: string, eol: string): string {
  const lf = s.split("\r\n").join("\n");
  return eol === "\r\n" ? lf.split("\n").join("\r\n") : lf;
}

/**
 * Finds the next index at or after `fromIndex` where `content` contains
 * `prefix` starting at the beginning of a line (index 0, or immediately
 * after a `\n`). Returns -1 if none exists. Linear scan — advances past each
 * rejected candidate rather than re-scanning, so it never backtracks.
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

/**
 * Finds the next index at or after `fromIndex` where `content` contains an
 * entire line exactly equal to `line` (bounded by line start and either a
 * line terminator or EOF). Used for bare heading lines (`#### Anchor`) where
 * a plain prefix match could accidentally match a longer heading that
 * happens to start with the same text.
 */
function findExactLine(content: string, line: string, fromIndex = 0): number {
  let idx = fromIndex;
  while (true) {
    const found = content.indexOf(line, idx);
    if (found === -1) return -1;
    const atLineStart = found === 0 || content[found - 1] === "\n";
    const afterEnd = found + line.length;
    const atLineEnd =
      afterEnd === content.length ||
      content[afterEnd] === "\n" ||
      content[afterEnd] === "\r";
    if (atLineStart && atLineEnd) return found;
    idx = found + line.length;
  }
}

/** Returns the index of the next `needle` at/after `fromIndex`, or `content.length` if absent. */
function indexOfOrEnd(content: string, needle: string, fromIndex: number): number {
  const idx = content.indexOf(needle, fromIndex);
  return idx === -1 ? content.length : idx;
}

/**
 * Returns every index in `content` where `prefix` starts a line (see
 * `findLineStart`), in ascending order.
 */
function findAllLineStarts(content: string, prefix: string): number[] {
  const indices: number[] = [];
  let idx = 0;
  while (true) {
    const found = findLineStart(content, prefix, idx);
    if (found === -1) break;
    indices.push(found);
    idx = found + prefix.length;
  }
  return indices;
}

/**
 * Extracts the value of a `- **Field**: value` bullet line inside `block`.
 * Throws naming `field` if the bullet is absent. The value is the rest of
 * the line after the marker, trimmed (trim() also strips a trailing `\r` on
 * CRLF-authored documents).
 */
function extractBullet(block: string, field: string): string {
  const marker = `- **${field}**:`;
  const idx = findLineStart(block, marker);
  if (idx === -1) throw new Error(`missing field: ${field}`);
  const lineEnd = indexOfOrEnd(block, "\n", idx);
  return block.slice(idx + marker.length, lineEnd).trim();
}

/**
 * Extracts the fenced (triple-backtick) content following a `#### Heading`
 * line inside `block` — used for the `#### Anchor` and `#### Proposed text`
 * sections. Returns `null` if the heading itself is absent (the caller
 * decides whether that's an error). Throws if the heading is present but
 * the fence is missing or unterminated. Preserves internal newlines and
 * indentation exactly; strips exactly one trailing line terminator that
 * precedes the closing fence.
 */
function extractFenced(block: string, heading: string): string | null {
  const headingIdx = findExactLine(block, heading);
  if (headingIdx === -1) return null;

  const searchFrom = headingIdx + heading.length;
  const fenceOpenIdx = findLineStart(block, "```", searchFrom);
  if (fenceOpenIdx === -1) {
    throw new Error(`missing code fence after ${heading}`);
  }
  const fenceOpenLineEnd = indexOfOrEnd(block, "\n", fenceOpenIdx);
  const contentStart = fenceOpenLineEnd === block.length ? block.length : fenceOpenLineEnd + 1;

  const fenceCloseIdx = findLineStart(block, "```", contentStart);
  if (fenceCloseIdx === -1) {
    throw new Error(`unterminated code fence after ${heading}`);
  }

  let inner = block.slice(contentStart, fenceCloseIdx);
  if (inner.endsWith("\r\n")) inner = inner.slice(0, -2);
  else if (inner.endsWith("\n")) inner = inner.slice(0, -1);
  return inner;
}

/**
 * Extracts the plain-prose content following a `#### Heading` line inside
 * `block`, up to (not including) the next heading of any level (`#` through
 * `####`) or the end of `block`. Returns `null` if the heading is absent.
 */
function extractProse(block: string, heading: string): string | null {
  const headingIdx = findExactLine(block, heading);
  if (headingIdx === -1) return null;

  const headingLineEnd = indexOfOrEnd(block, "\n", headingIdx);
  const contentStart = headingLineEnd === block.length ? block.length : headingLineEnd + 1;

  // Next heading of any level: scan line-by-line from contentStart, looking
  // for a line whose first non-space character is "#". Bounded scan driven
  // by indexOf on "\n", not a regex over the whole remaining document.
  let lineStart = contentStart;
  let nextHeadingIdx = block.length;
  while (lineStart < block.length) {
    const lineEnd = indexOfOrEnd(block, "\n", lineStart);
    if (block[lineStart] === "#") {
      nextHeadingIdx = lineStart;
      break;
    }
    lineStart = lineEnd + 1;
  }

  return block.slice(contentStart, nextHeadingIdx).replace(/\s+$/, "");
}

/**
 * Parses one `### Proposal <n>:` entry out of a skill-edit proposal document
 * (see module header for the format). Runs are appended over time, so later
 * runs sit lower in the file — this always resolves `n` against the LAST
 * `## Run:` section in `docContent`, matching how the document is written.
 * Throws an `Error` naming the specific missing field or section when the
 * document is malformed; throws naming the invalid value if `Operation` is
 * not one of `add` / `delete` / `replace`.
 */
export function parseProposal(docContent: string, n: number): SkillEditProposal {
  const runStarts = findAllLineStarts(docContent, "## Run:");
  if (runStarts.length === 0) {
    throw new Error("no '## Run:' section found in proposal document");
  }
  const runStart = runStarts[runStarts.length - 1];
  const runEnd = findLineStart(docContent, "## ", runStart + 1);
  const runSection = docContent.slice(runStart, runEnd === -1 ? docContent.length : runEnd);

  const marker = `### Proposal ${n}:`;
  const proposalIdx = findLineStart(runSection, marker);
  if (proposalIdx === -1) {
    throw new Error(`Proposal ${n} not found in the last '## Run:' section`);
  }
  const titleLineEnd = indexOfOrEnd(runSection, "\n", proposalIdx);
  const title = runSection.slice(proposalIdx + marker.length, titleLineEnd).trim();

  const nextProposalIdx = findLineStart(runSection, "### Proposal ", proposalIdx + marker.length);
  const block = runSection.slice(
    proposalIdx,
    nextProposalIdx === -1 ? runSection.length : nextProposalIdx,
  );

  const fingerprint = extractBullet(block, "Fingerprint");
  const target = extractBullet(block, "Target");
  const operationRaw = extractBullet(block, "Operation");
  const tierRaw = extractBullet(block, "Tier");
  const draftTask = extractBullet(block, "Draft task");
  const evidence = extractBullet(block, "Evidence");

  if (operationRaw !== "add" && operationRaw !== "delete" && operationRaw !== "replace") {
    throw new Error(`invalid Operation: ${operationRaw}`);
  }
  if (tierRaw !== "standard" && tierRaw !== "auto-eligible") {
    throw new Error(`invalid Tier: ${tierRaw}`);
  }

  const anchor = extractFenced(block, "#### Anchor");
  if (anchor === null) {
    throw new Error("missing section: #### Anchor");
  }

  let proposedText = extractFenced(block, "#### Proposed text");
  if (proposedText === null) {
    if (operationRaw === "delete") {
      proposedText = "";
    } else {
      throw new Error("missing section: #### Proposed text");
    }
  }

  const rationale = extractProse(block, "#### Rationale");
  if (rationale === null) {
    throw new Error("missing section: #### Rationale");
  }

  return {
    n,
    title,
    fingerprint,
    target,
    operation: operationRaw,
    tier: tierRaw,
    draftTask,
    evidence,
    anchor,
    proposedText,
    rationale,
  };
}

/** Counts non-overlapping occurrences of the literal substring `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) return count;
    count++;
    idx = found + needle.length;
  }
}

/**
 * Applies a parsed `SkillEditProposal`'s anchored operation to `fileContent`
 * and returns the resulting file content. The proposal's `anchor` must occur
 * in `fileContent` exactly once (an exact-substring match, counted via an
 * indexOf loop) — zero or multiple matches throws `AnchorError`. Both
 * `anchor` and `proposedText` are normalized to `fileContent`'s detected EOL
 * style (LF vs CRLF) before matching/insertion, so a proposal document
 * authored with different line endings than the target file still applies
 * cleanly and the result keeps the target file's original EOL style
 * throughout.
 *
 * - `add`: inserts `proposedText` immediately after the anchor block,
 *   separated by one EOL.
 * - `replace`: substitutes the anchor block with `proposedText`.
 * - `delete`: removes the anchor block plus one trailing EOL, if present.
 */
export function applyAnchoredOp(fileContent: string, p: SkillEditProposal): string {
  const eol = detectEol(fileContent);
  const anchor = normalizeEol(p.anchor, eol);
  const proposedText = normalizeEol(p.proposedText, eol);

  const count = countOccurrences(fileContent, anchor);
  if (count === 0) throw new AnchorError("anchor not found");
  if (count > 1) throw new AnchorError(`anchor ambiguous (${count} matches)`);

  const anchorIdx = fileContent.indexOf(anchor);
  const anchorEnd = anchorIdx + anchor.length;

  switch (p.operation) {
    case "add": {
      const insertion = eol + proposedText;
      return fileContent.slice(0, anchorEnd) + insertion + fileContent.slice(anchorEnd);
    }
    case "replace": {
      return fileContent.slice(0, anchorIdx) + proposedText + fileContent.slice(anchorEnd);
    }
    case "delete": {
      let end = anchorEnd;
      if (fileContent.slice(end, end + eol.length) === eol) {
        end += eol.length;
      }
      return fileContent.slice(0, anchorIdx) + fileContent.slice(end);
    }
    default: {
      // Exhaustiveness guard — SkillEditProposal.operation is a 3-literal
      // union validated at parse time, so this is unreachable for
      // proposals produced by `parseProposal`.
      throw new Error(`unsupported operation: ${p.operation as string}`);
    }
  }
}

/** Estimates a token count for `s` using the common chars/4 heuristic. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
