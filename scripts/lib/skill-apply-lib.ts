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

/**
 * Characters that disqualify an occurrence of a dead-ref needle from
 * counting as a genuine, boundary-delimited match (round-2 R6 hardening):
 * a raw substring match — e.g. `scripts/dead-ref.sh` occurring inside
 * `scripts/dead-ref.sh.bak` — must NOT count, because the `.bak` file is a
 * different, live artifact, not the dead reference itself.
 */
const REF_BOUNDARY_CHARS = /[A-Za-z0-9._$-]/;

/**
 * Finds every boundary-delimited, non-overlapping occurrence of `needle` in
 * `haystack`: the character immediately before the match (if any) and the
 * character immediately after it (if any) must each NOT be in
 * {@link REF_BOUNDARY_CHARS}. A candidate occurrence whose neighboring
 * character fails this test is skipped entirely (not counted, not
 * re-attempted at a shifted offset that would still overlap it) and the scan
 * resumes strictly past it. Returns `[start, end)` index pairs in ascending
 * order.
 */
function findBoundaryMatches(haystack: string, needle: string): Array<[number, number]> {
  if (needle.length === 0) return [];
  const matches: Array<[number, number]> = [];
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) return matches;
    const end = found + needle.length;
    const before = found > 0 ? haystack[found - 1] : null;
    const after = end < haystack.length ? haystack[end] : null;
    const beforeOk = before === null || !REF_BOUNDARY_CHARS.test(before);
    const afterOk = after === null || !REF_BOUNDARY_CHARS.test(after);
    if (beforeOk && afterOk) matches.push([found, end]);
    idx = found + needle.length;
  }
}

/** True iff `line` contains at least one boundary-delimited occurrence of `needle` (R6). */
function containsBoundaryMatch(line: string, needle: string): boolean {
  return findBoundaryMatches(line, needle).length > 0;
}

/**
 * Removes every boundary-delimited occurrence of `needle` from `line`,
 * returning the residue. Used by the R7 entanglement check to see what
 * else, if anything, is left on the line once the dead reference itself is
 * excised.
 */
function removeBoundaryMatches(line: string, needle: string): string {
  const matches = findBoundaryMatches(line, needle);
  if (matches.length === 0) return line;
  let result = "";
  let last = 0;
  for (const [start, end] of matches) {
    result += line.slice(last, start);
    last = end;
  }
  result += line.slice(last);
  return result;
}

/**
 * Round-3 hardening: inverts the round-2 entanglement predicate from an
 * open-ended DENYLIST of "known live-reference shapes" to a closed ALLOWLIST
 * of "known-safe residue". Round-2's `PATH_TOKEN_RE` enumerated five
 * path-prefix conventions (`scripts/`, `.claude/`, `docs/`, `tests/`,
 * `src/`) and treated any residue that didn't match one of them as safe to
 * delete — but a live reference of ANY OTHER shape (`bin/critical-tool.sh`,
 * a bare filename, a URL, anything not starting with one of those five
 * prefixes) was invisible to it. A reproduced live break: the line `Run
 * bash scripts/dead-ref.sh and also see bin/critical-tool.sh for details`
 * passed the old denylist check and had its ENTIRE line — including the
 * live `bin/critical-tool.sh` reference — deleted unattended by `--auto`.
 * Enumerating every shape a live reference might take is an unwinnable
 * recognition problem; the set of residues that are safe to delete is not.
 *
 * So this checks the opposite direction: `line` is "entangled" (NOT safely
 * removable) unless, after excising every boundary-delimited occurrence of
 * `deadRef`, the residue contains NO `\p{L}`/`\p{N}` character at all (any
 * Unicode letter or number, not just ASCII `[A-Za-z0-9]`) — only whitespace
 * and prose/markdown syntax (list markers, backticks, quotes,
 * parens/brackets, pipes, colons, commas, periods, dashes, `#`, `>`, etc.)
 * may remain. Any word content whatsoever — `bash`, `Run`, `see`, a URL, a
 * bare filename, CJK/Cyrillic word content, a fullwidth homoglyph, or a
 * live reference of any other shape — makes the residue non-empty of
 * letters/numbers and the line entangled; the proposal falls back to a
 * human-reviewed draft instead of auto-applying. A closed allowlist of
 * trivial residue can only ever reject MORE lines than an open denylist of
 * shapes, never fewer, which is what makes this direction sound: nothing is
 * auto-removable unless what's left behind is unambiguously not content.
 */
function isEntangledLine(line: string, deadRef: string): boolean {
  const residue = removeBoundaryMatches(line, deadRef);
  return /[\p{L}\p{N}]/u.test(residue);
}

/**
 * Auto-tier condition 6/6 (skill-apply.ts's `--auto` eligibility class,
 * #T90): checks whether a proposed edit genuinely corresponds to a specific
 * dead reference, rather than being anchored somewhere unrelated in the same
 * file and merely riding along on an unrelated live dangling-ref finding, OR
 * anchoring a real dead-ref line but smuggling arbitrary unrelated content
 * through alongside its removal (the "wide-anchor" case — a near-file-sized
 * `replace` anchor that merely *contains* the dead ref, with everything else
 * in the anchor changed too, still passes a naive substring check; both
 * "smuggling" variants are what this condition exists to catch), OR
 * entangling the dead reference with a second, unrelated live reference on
 * the same line (the "single-line degenerate anchor" case — see
 * {@link isEntangledLine}).
 *
 * Both strings are EOL-normalized to `\n` first (so CRLF- and
 * LF-authored proposal docs compare identically), then evaluated as line
 * arrays with deterministic, line-wise semantics — never a fuzzy substring
 * check:
 *
 * - Occurrences of `deadRef` only count when boundary-delimited (R6): the
 *   character immediately before/after a match, when present, must not be
 *   in `[A-Za-z0-9._$-]` — so `scripts/dead-ref.sh` occurring inside
 *   `scripts/dead-ref.sh.bak` never counts as a match.
 * - At least one line of `anchor` must boundary-match `deadRef`; otherwise
 *   this returns `false` regardless of `op`.
 * - R7 (round-3 inverted allowlist): every dead-ref-bearing line is checked
 *   for entanglement via {@link isEntangledLine} — if excising its
 *   boundary-matched `deadRef` occurrence(s) leaves a residue containing ANY
 *   `\p{L}`/`\p{N}` character (any Unicode letter or number — word content
 *   of any kind, including non-ASCII scripts and fullwidth homoglyphs, not
 *   merely a recognized path shape), this returns `false` regardless of
 *   `op`; only a residue of pure whitespace/syntax is tolerated. The
 *   proposal falls back to a human-reviewed draft rather than risk deleting
 *   a live reference — of ANY shape — alongside the dead one.
 * - `op === "delete"`: valid iff EVERY non-blank line of `anchor`
 *   boundary-matches `deadRef` — a delete is only auto-eligible when the
 *   whole anchor is dead content, never when it carries unrelated context
 *   lines along for the ride.
 * - `op === "replace"`: valid iff `proposedText` (after EOL normalization)
 *   equals EXACTLY `anchor`'s lines with every dead-ref-bearing line
 *   removed, in the same relative order, and nothing else changed. In
 *   other words, an auto-replace is definitionally "delete the
 *   dead-ref-bearing lines" — zero other edits are tolerated, however
 *   small. An empty `proposedText` is valid only when every line of
 *   `anchor` qualified for removal.
 */
export function checkAutoCorrespondence(
  anchor: string,
  proposedText: string,
  op: "delete" | "replace",
  deadRef: string,
): boolean {
  const normAnchor = anchor.split("\r\n").join("\n");
  const normProposed = proposedText.split("\r\n").join("\n");
  const anchorLines = normAnchor.split("\n");

  const deadRefLines = anchorLines.filter((line) => containsBoundaryMatch(line, deadRef));
  if (deadRefLines.length === 0) return false;

  // R7: an entangled dead-ref-bearing line (one that carries a second,
  // live path-like token alongside the dead reference) is never removable —
  // fail closed regardless of op.
  if (deadRefLines.some((line) => isEntangledLine(line, deadRef))) return false;

  if (op === "delete") {
    return anchorLines.every((line) => line.trim() === "" || containsBoundaryMatch(line, deadRef));
  }

  // op === "replace": the only tolerated change is removing every
  // dead-ref-bearing line — compare via a rejoined string (not an
  // index-wise array comparison) so the "anchor reduces to zero remaining
  // lines" edge case (proposedText === "") compares correctly against
  // Array.prototype.join's own empty-array-to-"" behavior.
  const expected = anchorLines.filter((line) => !containsBoundaryMatch(line, deadRef)).join("\n");
  return expected === normProposed;
}
