# Skill-Edit Proposals: compaction-gate

## Run: 2026-09-21 — trigger: ship
Scope: .claude/commands/workflows/build.md, .claude/commands/workflows/review.md, .claude/commands/workflows/ship.md, .claude/rules/api.md, .claude/rules/bash.md, .claude/rules/escalation.md, .claude/rules/lead.md, .claude/rules/preferences.md, .claude/rules/tests.md

### Proposal 1: Sized review plus the Lead's drift check is the ship gate for a single-task feature
- **Fingerprint**: skill-edit:.claude/commands/workflows/review.md:sized-pass-ship-gate
- **Target**: .claude/commands/workflows/review.md
- **Operation**: replace
- **Tier**: standard
- **Draft task**: #T192
- **Evidence**: `docs/specs/compaction-gate/review.md` "Sizing" — the feature shipped on a two-reviewer pass plus the Lead's own drift check, while lines 27-29 of review.md say the three-reviewer pass "is the ship gate: run it once per feature before `/workflows:ship`"; `docs/knowledge/metrics.md` compaction-gate entry records the same substitution. The practice and the rule disagree, and ship.md checks neither.
- **Size**: 2847 → 2905 (chars/4)

#### Anchor
```
covering security and correctness together. The full three-reviewer pass below,
at the lead's tier (`inherit`), is the **ship gate**: run it once per feature
before `/workflows:ship`, not after every wave. Findings under about twenty
```

#### Proposed text
```
covering security and correctness together. The full three-reviewer pass below,
at the lead's tier (`inherit`), is the **ship gate**: run it once per feature
before `/workflows:ship`, not after every wave. For a single-task feature the
sized pass plus the Lead's own drift check (every acceptance criterion
verified against the code) may stand in for it; say so under a "Sizing"
heading in review.md so ship reads the substitution. Findings under about twenty
```

#### Rationale
The rule as written was not followed on the first single-task feature to reach ship after it was adopted, and nothing in ship.md would have caught the gap. Making the substitution explicit, and requiring the review record to declare it, keeps the ship gate honest without forcing three `inherit`-tier reviewers onto a one-script diff. The 58-token growth is in a command doc, not an always-loaded rule.

### Proposal 2: Cross-validate a reviewer's circularity CONCERN like a HIGH
- **Fingerprint**: skill-edit:.claude/commands/workflows/review.md:circular-self-validation
- **Target**: .claude/commands/workflows/review.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T193
- **Evidence**: `docs/specs/compaction-gate/review-raw/security.md` CONCERN 1 — the knowledge doc's "validates itself, reproduces 3 compactions" claim was circular: the matching count came from the replay bug the review's HIGH 2 named. The CONCERN, not the HIGH line, was what showed the doc's headline recommendation rested on the bug; under the current step 2 wording only CRITICAL/HIGH lines are cross-validated, so a CONCERN carrying the decisive evidence has no mandated check.
- **Size**: 2847 → 2889 (chars/4)

#### Anchor
```
2. **Cross-validate**: For each CRITICAL/HIGH finding, verify it's accurate by checking the actual code yourself — reviewers can hallucinate
```

#### Proposed text
```
   Treat a CONCERN that a shipped document's self-validation claim is circular (the checked number is produced by the code under review) the same way: confirm it, and if it holds, the claim and every conclusion resting on it are a HIGH.
```

#### Rationale
Reviewer CONCERN lines are advisory by format, so a lead filtering by severity can pass over the one line that explains why a HIGH matters. The compaction-gate review only re-derived the doc's recommendation because the lead happened to read the CONCERN; naming the case makes the check part of the protocol rather than luck.
