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

**Pattern**: ROADMAP.md is the authoritative, git-versioned source of truth for task state. Native Tasks (TaskCreate/TaskUpdate/TaskList) serve as a runtime convenience layer for structured status queries during build execution. At each wave boundary, re-derive state from ROADMAP.md markers as a consistency check.

**Example**:
- Build start: parse ROADMAP.md → create native Tasks → compute waves
- During wave: TaskUpdate(status: "in_progress") on dispatch
- Wave boundary: re-read ROADMAP.md markers, cross-check against TaskList
- Build end: sync native Task states back to ROADMAP.md markers

**Anti-pattern**: Treating native Tasks as the source of truth. If TaskCreate fails or Tasks drift from ROADMAP markers, the build must continue using ROADMAP.md alone.

---

### Worktree Agent Output Recovery

**When to Use**: After `/workflows:build` dispatches agents with `isolation: "worktree"`.

**Pattern**: Worktree agents may have their worktrees cleaned up before changes are committed. Copy output files from the worktree to the main repo immediately after agent completion — do not assume changes will persist in worktree branches.

**Example**:
- Agent completes in worktree → check `worktreePath` in result
- If present: read files from worktree, copy/write to main repo
- If absent: changes may have been auto-applied (formatter hook) or lost — verify via grep

**Anti-pattern**: Assuming worktree branches contain commits. The agent tool creates worktrees but agents don't always commit their changes — the worktree may only have uncommitted modifications.

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
