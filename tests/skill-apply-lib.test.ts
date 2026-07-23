// tests/skill-apply-lib.test.ts
// Unit tests for scripts/lib/skill-apply-lib.ts (parseProposal, applyAnchoredOp,
// estimateTokens). Pattern follows tests/dashboard-render.test.ts: node:test +
// node:assert, pure in-memory fixtures — no fs, no shared state between tests.

import { describe, it } from "node:test";
import { strictEqual, ok, throws } from "node:assert";
import {
  parseProposal,
  applyAnchoredOp,
  estimateTokens,
  checkAutoCorrespondence,
  AnchorError,
} from "../scripts/lib/skill-apply-lib.ts";
import type { SkillEditProposal } from "../scripts/lib/skill-apply-lib.ts";

/**
 * Two-run, two-proposals-per-run fixture matching the authoritative format
 * from the task spec. Backticks that would close the template literal are
 * escaped with `\``.
 */
const TWO_RUN_FIXTURE = `# Skill-Edit Proposals: some-feature

## Run: 2026-07-20 — trigger: build
Scope: .claude/rules/tests.md

### Proposal 1: OLD proposal one title
- **Fingerprint**: skill-edit:.claude/rules/tests.md:old-fp-1
- **Target**: .claude/rules/tests.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T50
- **Evidence**: old evidence one
- **Size**: 100 -> 120 (chars/4)

#### Anchor
\`\`\`
old anchor one
\`\`\`

#### Proposed text
\`\`\`
old proposed one
\`\`\`

#### Rationale
Old rationale one.

### Proposal 2: OLD proposal two title
- **Fingerprint**: skill-edit:.claude/rules/tests.md:old-fp-2
- **Target**: .claude/rules/tests.md
- **Operation**: replace
- **Tier**: standard
- **Draft task**: #T51
- **Evidence**: old evidence two
- **Size**: 100 -> 120 (chars/4)

#### Anchor
\`\`\`
old anchor two
\`\`\`

#### Proposed text
\`\`\`
old proposed two
\`\`\`

#### Rationale
Old rationale two.

## Run: 2026-07-22 — trigger: ship
Scope: .claude/rules/bash.md, .claude/commands/workflows/ship.md

### Proposal 1: add heredoc ban to Agent Rules
- **Fingerprint**: skill-edit:.claude/rules/bash.md:heredoc-ban
- **Target**: .claude/rules/bash.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T93
- **Evidence**: review.md finding H2 — agent used a heredoc, triggered scanner prompt
- **Size**: 810 -> 840 (chars/4)

#### Anchor
\`\`\`
- Never embed programs in \`-c\` / \`-e\` / \`-Command\` / \`-lc\` arguments — same fix: script file.
\`\`\`

#### Proposed text
\`\`\`
- Never use heredocs (\`cat > f << EOF\`) — write files with the Write tool instead.
\`\`\`

#### Rationale
Prevents recurrence of the scanner prompt stall seen in review.md H2.

### Proposal 2: delete a stale line
- **Fingerprint**: skill-edit:.claude/rules/bash.md:new-fp-2
- **Target**: .claude/rules/bash.md
- **Operation**: delete
- **Tier**: auto-eligible
- **Draft task**: #T94
- **Evidence**: new evidence two

#### Anchor
\`\`\`
new anchor two
\`\`\`

#### Rationale
New rationale two.
`;

/** Minimal fixture missing the `#### Anchor` section entirely. */
const MISSING_ANCHOR_FIXTURE = `# Skill-Edit Proposals: broken-feature

## Run: 2026-07-22 — trigger: ship
Scope: some/file.md

### Proposal 1: malformed entry
- **Fingerprint**: skill-edit:some/file.md:broken
- **Target**: some/file.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T99
- **Evidence**: n/a

#### Proposed text
\`\`\`
some text
\`\`\`

#### Rationale
n/a.
`;

/** Builds a full SkillEditProposal, defaulting every field except the overrides given. */
function makeProposal(overrides: Partial<SkillEditProposal>): SkillEditProposal {
  return {
    n: 1,
    title: "test proposal",
    fingerprint: "skill-edit:test:fp",
    target: "some/file.md",
    operation: "replace",
    tier: "standard",
    draftTask: "#T1",
    evidence: "test evidence",
    anchor: "ANCHOR",
    proposedText: "REPLACEMENT",
    rationale: "test rationale",
    ...overrides,
  };
}

describe("parseProposal", () => {
  it("parseProposal_wellFormedDoc_extractsAllFields", () => {
    const p = parseProposal(TWO_RUN_FIXTURE, 1);
    strictEqual(p.title, "add heredoc ban to Agent Rules");
    strictEqual(p.fingerprint, "skill-edit:.claude/rules/bash.md:heredoc-ban");
    strictEqual(p.target, ".claude/rules/bash.md");
    strictEqual(p.operation, "add");
    strictEqual(
      p.anchor,
      "- Never embed programs in `-c` / `-e` / `-Command` / `-lc` arguments — same fix: script file.",
    );
    strictEqual(
      p.proposedText,
      "- Never use heredocs (`cat > f << EOF`) — write files with the Write tool instead.",
    );
  });

  it("parseProposal_missingAnchorSection_throwsNamedError", () => {
    throws(
      () => parseProposal(MISSING_ANCHOR_FIXTURE, 1),
      (err: unknown) => err instanceof Error && err.message.includes("Anchor"),
    );
  });
});

describe("applyAnchoredOp", () => {
  it("applyAnchoredOp_uniqueAnchorReplace_roundTrips", () => {
    const fileContent = "line A\nANCHOR_BLOCK\nline B\n";
    const p = makeProposal({ operation: "replace", anchor: "ANCHOR_BLOCK", proposedText: "REPLACED_BLOCK" });
    const result = applyAnchoredOp(fileContent, p);
    strictEqual(result, "line A\nREPLACED_BLOCK\nline B\n");
  });

  it("applyAnchoredOp_zeroMatches_throws", () => {
    const fileContent = "line A\nline B\n";
    const p = makeProposal({ operation: "replace", anchor: "NOT_PRESENT", proposedText: "X" });
    throws(
      () => applyAnchoredOp(fileContent, p),
      (err: unknown) => err instanceof AnchorError && err.message === "anchor not found",
    );
  });

  it("applyAnchoredOp_twoMatches_throws", () => {
    const fileContent = "DUPLICATE\nmiddle\nDUPLICATE\n";
    const p = makeProposal({ operation: "replace", anchor: "DUPLICATE", proposedText: "X" });
    throws(
      () => applyAnchoredOp(fileContent, p),
      (err: unknown) =>
        err instanceof AnchorError && err.message.includes("2 matches"),
    );
  });

  it("applyAnchoredOp_deleteOp_removesBlockAndOneEol", () => {
    const fileContent = "before\nDELETE_ME\nafter\n";
    const p = makeProposal({ operation: "delete", anchor: "DELETE_ME", proposedText: "" });
    const result = applyAnchoredOp(fileContent, p);
    strictEqual(result, "before\nafter\n");
    ok(!result.includes("\n\n"), "expected no doubled blank line after delete");
  });

  it("applyAnchoredOp_crlfFile_preservesCrlf", () => {
    const fileContent = "before\r\nANCHOR\r\nafter\r\n";
    const p = makeProposal({ operation: "add", anchor: "ANCHOR", proposedText: "NEW1\nNEW2" });
    const result = applyAnchoredOp(fileContent, p);
    const withoutCrlf = result.split("\r\n").join("");
    ok(!withoutCrlf.includes("\n"), "expected no bare LF outside CRLF pairs");
    ok(result.includes("NEW1\r\nNEW2"), "expected inserted text normalized to CRLF");
  });
});

describe("estimateTokens", () => {
  it("estimateTokens_variousLengths_ceilsCharsDivFour", () => {
    strictEqual(estimateTokens(""), 0);
    strictEqual(estimateTokens("abcd"), 1);
    strictEqual(estimateTokens("abcde"), 2);
    strictEqual(estimateTokens("a".repeat(100)), 25);
  });
});

describe("checkAutoCorrespondence", () => {
  it("checkAutoCorrespondence_deadRefInAnchor_true", () => {
    // ADAPTED (round-3 inversion): the original fixture was "bash
    // scripts/dead-ref.sh" — under the inverted, closed-residue predicate,
    // the leading "bash " word survives excision of the dead ref as
    // non-empty alphanumeric residue, which now makes the line entangled
    // (never removable) regardless of op. A pure-syntax line — just the
    // dead ref itself, so the residue is empty once it's excised — is the
    // faithful "this line is nothing but the dead reference" case the test
    // means to exercise.
    const anchor = "scripts/dead-ref.sh";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_replaceRetainsDeadRef_false", () => {
    // ADAPTED (round-3 inversion): the original fixture surrounded the dead
    // ref with prose ("See ... for details."), which under the inverted
    // predicate now makes the line entangled all by itself — the test would
    // still assert `false`, but for the wrong reason (entanglement) rather
    // than the mismatch this test means to exercise (a replace that keeps
    // the dead ref around instead of removing it). A pure-syntax dead-ref
    // line (just the ref, backticked) clears the entanglement check so the
    // assertion below genuinely exercises the exact-removal comparison.
    const anchor = "`scripts/dead-ref.sh`";
    const proposedText = "`scripts/dead-ref.sh` (kept)";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_deadRefAbsentFromAnchor_false", () => {
    const anchor = "This anchor is about something unrelated entirely.";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_wideAnchorExcessChange_false", () => {
    // M2: the anchor genuinely carries the dead ref on one line, but also an
    // unrelated sibling line. A faithful auto-replace would leave that
    // sibling line byte-for-byte untouched (deleting only the dead-ref
    // line). This replacement instead rewrites the sibling line too — a
    // wide anchor smuggling an unrelated change through under cover of a
    // real dead reference — and must be refused.
    //
    // ADAPTED (round-3 inversion): the dead-ref line itself is now pure
    // syntax ("scripts/dead-ref.sh" alone, no "bash " prefix) so it clears
    // the entanglement check and the test genuinely exercises the
    // wide-anchor mismatch below, rather than being short-circuited by
    // entanglement on the "bash " word that used to precede it.
    const anchor = "scripts/dead-ref.sh\nSome unrelated context line.\nAnother line.";
    const proposedText = "Some unrelated context line CHANGED.\nAnother line.";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_exactDeadLineRemoval_true", () => {
    // The faithful counterpart to the case above: proposedText equals
    // exactly the anchor's lines with the dead-ref-bearing line removed,
    // and nothing else changed.
    //
    // ADAPTED (round-3 inversion): same pure-syntax dead-ref line as above —
    // required here because this is a `true`-expecting case; the original
    // "bash scripts/dead-ref.sh" line would now be entangled (residue
    // "bash " has word content) and the check would wrongly return false.
    const anchor = "scripts/dead-ref.sh\nSome unrelated context line.\nAnother line.";
    const proposedText = "Some unrelated context line.\nAnother line.";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_deleteWithUnrelatedContextLine_false", () => {
    // A `delete` is only auto-eligible when EVERY non-blank anchor line
    // contains the dead ref — an anchor that also carries an unrelated,
    // non-blank context line must be refused, even though the dead ref is
    // genuinely present.
    //
    // ADAPTED (round-3 inversion): pure-syntax dead-ref line (no "bash "
    // prefix) so the refusal below is genuinely driven by the "every line
    // must contain the dead ref" delete rule, not by entanglement.
    const anchor = "scripts/dead-ref.sh\nSome unrelated context line.";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_refSubstringOfLongerPath_false", () => {
    // Round-2 R6: deadRef must only count as a BOUNDARY-DELIMITED match.
    // "scripts/dead-ref.sh" occurs as a raw substring inside
    // "scripts/dead-ref.sh.bak" (a DIFFERENT, live file), but the character
    // immediately after the match ('.') is in the boundary-char set, so it
    // must not count — no genuine dead-ref line exists in this anchor.
    const anchor = "See scripts/dead-ref.sh.bak for the backup.";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_boundaryCleanSingleRefLine_true", () => {
    // Counterpart to the .bak case: the SAME needle, genuinely
    // boundary-delimited, must still count as a match and pass a faithful
    // whole-line delete.
    //
    // ADAPTED (round-3 inversion): the original fixture was "bash
    // scripts/dead-ref.sh" — the "bash " word would now survive excision as
    // alphanumeric residue and make the line entangled, flipping this
    // `true`-expecting case to false. A markdown-list-item shape (dash,
    // space, backticked ref) keeps the line boundary-clean AND pure syntax
    // once the ref is excised (residue is just "- ``"), so it still passes.
    const anchor = "- `scripts/dead-ref.sh`";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_singleLineEntangledRefs_false", () => {
    // Round-2 R7: a single-line anchor that degenerates the whole-line
    // dead-ref test — the line genuinely contains deadRef AND a second,
    // unrelated, live path-like reference. Removing just the dead ref
    // would silently take scripts/critical-security-check.sh's live
    // reference down with it, so this must be refused regardless of op.
    const anchor =
      "...run bash scripts/dead-ref.sh then also run bash scripts/critical-security-check.sh...";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_residueSecondPathToken_false", () => {
    // Same entanglement hazard as above, exercised via `replace`: the
    // proposedText is a faithful "remove the dead-ref line" edit, but the
    // anchor's dead-ref-bearing line ALSO carries a second live reference,
    // so the correspondence check must still fail closed.
    const anchor = "bash scripts/dead-ref.sh and docs/architecture.md\nAnother line.";
    const proposedText = "Another line.";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_entangledBinShapeRef_false", () => {
    // Round-3: the EXACT line reproduced end-to-end by the adversarial
    // verifier against the pre-fix `--auto` CLI. Under the round-2 denylist
    // (`PATH_TOKEN_RE` enumerating only scripts/.claude/docs/tests/src
    // prefixes), "bin/critical-tool.sh" was an invisible shape — the check
    // saw no "second path-like token" and let the whole line (including
    // that live reference) through as auto-removable. The inverted,
    // closed-residue predicate has no such blind spot: ANY word content
    // left behind after excising the dead ref — "Run", "bash", "and",
    // "also", "see", "bin/critical-tool.sh", "for", "details" — makes the
    // line entangled, regardless of what shape it takes.
    const anchor = "Run bash scripts/dead-ref.sh and also see bin/critical-tool.sh for details";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_entangledUrlResidue_false", () => {
    // A live reference doesn't have to be a repo path at all — a bare URL
    // left behind in the residue is still word content the closed-residue
    // rule correctly refuses to discard.
    const anchor = "scripts/dead-ref.sh see https://example.com/docs for the replacement";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_entangledPlainWordResidue_false", () => {
    // Minimal case: a single bare word riding alongside the dead ref, no
    // path shape at all, no punctuation dressing — still entangled, because
    // the rule is "no alphanumeric residue survives", not "no recognized
    // path residue survives".
    const anchor = "scripts/dead-ref.sh bash";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_pureSyntaxResidue_true", () => {
    // Counterpart to the three entangled cases above: a dead-ref line whose
    // only non-ref content is markdown syntax (a list marker and backticks)
    // leaves an alphanumeric-free residue once the ref is excised, so it
    // remains auto-removable. Also confirms #T95's Unicode-aware class
    // doesn't regress the ASCII-syntax-only case: none of `-`, backticks
    // are in `\p{L}`/`\p{N}`.
    const anchor = "- `scripts/dead-ref.sh`";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_cjkResidue_false", () => {
    // #T95: the residue test must be Unicode-aware, not ASCII-only — a CJK
    // word left behind alongside the dead ref is word content just as much
    // as an ASCII one, and must entangle the line.
    const anchor = "scripts/dead-ref.sh 关键工具";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_cyrillicResidue_false", () => {
    // #T95: same class of gap, Cyrillic script.
    const anchor = "scripts/dead-ref.sh важный";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_fullwidthHomoglyphResidue_false", () => {
    // #T95: fullwidth homoglyphs (e.g. fullwidth "bin") are still `\p{L}`
    // characters under Unicode category rules even though they render as
    // ASCII-lookalike glyphs — the old `[A-Za-z0-9]` test missed them
    // entirely because their code points fall outside the ASCII range.
    const anchor = "scripts/dead-ref.sh ｂｉｎ";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });
});
