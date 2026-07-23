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
    const anchor = "bash scripts/dead-ref.sh";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_replaceRetainsDeadRef_false", () => {
    const anchor = "See bash scripts/dead-ref.sh for details.";
    const proposedText = "See bash scripts/dead-ref.sh (still referenced) for details.";
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
    const anchor = "bash scripts/dead-ref.sh\nSome unrelated context line.\nAnother line.";
    const proposedText = "Some unrelated context line CHANGED.\nAnother line.";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });

  it("checkAutoCorrespondence_exactDeadLineRemoval_true", () => {
    // The faithful counterpart to the case above: proposedText equals
    // exactly the anchor's lines with the dead-ref-bearing line removed,
    // and nothing else changed.
    const anchor = "bash scripts/dead-ref.sh\nSome unrelated context line.\nAnother line.";
    const proposedText = "Some unrelated context line.\nAnother line.";
    const result = checkAutoCorrespondence(anchor, proposedText, "replace", "scripts/dead-ref.sh");
    strictEqual(result, true);
  });

  it("checkAutoCorrespondence_deleteWithUnrelatedContextLine_false", () => {
    // A `delete` is only auto-eligible when EVERY non-blank anchor line
    // contains the dead ref — an anchor that also carries an unrelated,
    // non-blank context line must be refused, even though the dead ref is
    // genuinely present.
    const anchor = "bash scripts/dead-ref.sh\nSome unrelated context line.";
    const result = checkAutoCorrespondence(anchor, "", "delete", "scripts/dead-ref.sh");
    strictEqual(result, false);
  });
});
