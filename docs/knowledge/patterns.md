---
type: knowledge
tags: [patterns, conventions]
description: Established code patterns and conventions discovered during development
links: "[[decisions]], [[architecture]]"
date: "2026-03-03"
---

# Established Patterns

## Format
Each entry: Pattern Name, When to Use, Example, Anti-pattern to Avoid

---

<!-- Entries get appended here as patterns are discovered during build and review -->

### ROADMAP↔Tasks Dual-Track

**When to Use**: During `/workflows:build` when orchestrating parallel sub-agents.

**Pattern**: ROADMAP.md is the authoritative, git-versioned governance record for task state. Native Tasks (TaskCreate/TaskUpdate/TaskList) are the runtime scheduling engine — dependencies (`addBlockedBy`) determine what dispatches next. Each time a dispatch batch drains, re-derive state from ROADMAP.md markers as a consistency check.

**Example**:
- Build start: parse ROADMAP.md → create native Tasks with addBlockedBy from `(depends:)` clauses
- On dispatch: ROADMAP `[ ]`→`[-]` + TaskUpdate(status: "in_progress")
- On completion: ROADMAP `[-]`→`[~]` + TaskUpdate(status: "completed") — dependents unblock automatically
- Batch drain: re-read ROADMAP.md markers, cross-check against TaskList

**Anti-pattern**: Treating native Tasks as the source of truth. If TaskCreate fails or Tasks drift from ROADMAP markers, the build falls back to scheduling from ROADMAP.md markers and `(depends:)` clauses alone.

---

### Schema Contract Across File Boundaries

**When to Use**: When a producer (parser, API, hook) outputs data consumed by another module.

**Pattern**: Verify the output schema of the producer matches the input expectations of the consumer at integration time. A wrapper object (`{observations: [...]}`) vs. a bare array (`[...]`) is a common mismatch that silently fails when the consumer's validation rejects the input.

**Example**:
- `observation-parser.ts` outputs `ParseResult {observations: [...], raw_line_count, observation_count}`
- `cmdIndexObservations` originally expected a bare `ObservationEntry[]` array
- Fix: unwrap `parsed.observations` before validation

**Anti-pattern**: Testing producer and consumer in isolation without an integration test that pipes real output through the full chain.

---

### Security Scanning Gate

**When to Use**: Before any git commit, push, or PR creation.

**Pattern**: Defense-in-depth scanning at three layers: pre-commit hook blocks staged secrets via `scan-staged`, pre-push hook scans the full diff via `scan-diff`, and the ship workflow runs `scan-diff $BASE` as step 1.5. Inline `// scan:allow` suppresses intentional false positives. The allowlist at `.claude/security/allowlist.json` configures path ignores and stopwords.

**Example**:
- Pre-commit: `node scripts/security-scanner.ts scan-staged` — blocks `ghp_*`, `sk-ant-*`, PII in docs
- Ship workflow step 1.5: `node scripts/security-scanner.ts scan-diff origin/master` — catches anything that slipped through
- False positive: add `// scan:allow` on the line, or add the pattern to allowlist stopwords

**Anti-pattern**: Relying solely on `.gitignore` to prevent secret leakage. Using `--no-verify` to bypass hooks without the ship workflow as a backup safety net.
