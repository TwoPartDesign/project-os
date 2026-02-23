---
description: "Adversarial quality gate — three independent reviewers check the implementation"
---

# Phase 5: Adversarial Review

You are the review coordinator. You spawn independent reviewer sub-agents, each with a different focus and ISOLATED context. No reviewer sees another's findings until synthesis.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md` for what was supposed to be built.
Read `docs/specs/$ARGUMENTS/design.md` for what was specified.
Read completion reports from `docs/specs/$ARGUMENTS/tasks/*/completion-report.md` (iterate all task directories) for build context.
Get the diff of all changes: `git diff main...HEAD` (or appropriate base branch).

## Isolation

All three reviewers run with `isolation: worktree` for filesystem isolation (prevents reviewers from modifying the working tree). Cross-reviewer isolation is enforced by **prompt separation** — each sub-agent receives only its own instructions and review focus. The orchestrator (you) is the only entity that reads all three reports.

## Reviewer 1: Drift Detection (Plan vs Implementation)

Spawn a sub-agent with this prompt:

"You are a drift detection auditor. Your job is to find mismatches between what was planned and what was built.

PLANNED (source of truth):
[Contents of tasks.md — the task descriptions and acceptance criteria]

DESIGN (reference):
[Contents of design.md — the technical approach section]

YOUR TASK:
1. For each task in the plan, verify the acceptance criteria are met in the actual code
2. Check that no UNPLANNED changes were made (scope creep)
3. Check that the implementation follows the design's architectural decisions
4. Check for TODO/FIXME/HACK comments without corresponding ROADMAP entries

Output format:
- DRIFT: [description of mismatch] | Severity: CRITICAL/HIGH/MEDIUM/LOW
- UNPLANNED: [description of scope creep] | Risk: [assessment]
- PASS: [criterion that was correctly implemented]"

## Reviewer 2: Security Review

Spawn a sub-agent with this prompt:

"You are a security auditor. Review ONLY the changed files for security issues.

Changed files:
[git diff output — filenames and content]

Check for:
1. Hardcoded secrets, tokens, API keys, passwords
2. SQL injection, XSS, command injection vectors
3. Path traversal vulnerabilities
4. Insecure deserialization
5. Missing input validation on user-facing interfaces
6. Overly permissive file/network permissions
7. Dependencies with known CVEs (check package.json/requirements.txt changes)
8. Auth/authz gaps — operations that should require authentication but don't
9. Sensitive data in logs or error messages
10. Race conditions in concurrent operations

Output format:
- VULN: [description] | Severity: CRITICAL/HIGH/MEDIUM/LOW | File: [path:line]
- CONCERN: [potential issue needing investigation] | File: [path:line]
- PASS: [security property verified]"

## Reviewer 3: Quality & Maintainability

Spawn a sub-agent with this prompt:

"You are a code quality reviewer. Review the changed files for maintainability.

Changed files and test files:
[Relevant source and test files]

Project conventions:
[Contents of docs/knowledge/patterns.md]

Check for:
1. Functions longer than 50 lines — should they be decomposed?
2. Duplicated logic that should be extracted
3. Missing error handling (bare catches, swallowed errors)
4. Missing or inadequate test coverage for edge cases
5. Inconsistency with established project patterns
6. Dead code, unused imports, commented-out blocks
7. Naming inconsistencies
8. Missing docstrings on public interfaces
9. Magic numbers or strings that should be constants
10. Complex conditionals that should be simplified

Output format:
- ISSUE: [description] | Severity: CRITICAL/HIGH/MEDIUM/LOW | File: [path:line]
- SUGGESTION: [optional improvement] | File: [path:line]
- PASS: [quality standard met]"

## Activity Logging

Before spawning reviewers: `bash .claude/hooks/log-activity.sh review-started feature=$ARGUMENTS`
After gate decision:
- PASSED: `bash .claude/hooks/log-activity.sh review-passed feature=$ARGUMENTS`
- FAILED: `bash .claude/hooks/log-activity.sh review-failed feature=$ARGUMENTS`

## Synthesis

After all three reviewers complete:

1. **Deduplicate**: Remove findings that multiple reviewers flagged identically
2. **Cross-validate**: For each CRITICAL/HIGH finding, verify it's accurate by checking the actual code yourself — reviewers can hallucinate
3. **Cost-benefit**: For MEDIUM/LOW findings, assess if fixing is worth the effort for a personal project
4. **Classify findings**:
   - 🚫 MUST FIX (Critical/High severity, verified accurate)
   - ⚠️ SHOULD FIX (Medium severity, clear improvement)
   - 💡 CONSIDER (Low severity, nice to have)
   - ✅ PASSED (Clean areas)

## Output

Create `docs/specs/$ARGUMENTS/review.md` with the full synthesized report.

## Gate Decision

- If ANY 🚫 MUST FIX items exist → GATE FAILED.
  - Mark only the **specific tasks cited in the findings** as `[!]` in ROADMAP.md — do NOT mark unrelated tasks
  - Create `docs/specs/$ARGUMENTS/revision-request.md` listing required changes with task IDs
  - Notify: `bash .claude/hooks/notify-phase-change.sh review-failed $ARGUMENTS`
  - List required fixes and tell the user.
- If only ⚠️/💡 items → GATE PASSED WITH NOTES.
  - Mark only `[~]` (review) tasks for this feature as `[x]` in ROADMAP.md — do NOT change tasks in other states
  - User decides which notes to fix.
- If clean → GATE PASSED.
  - Mark only `[~]` (review) tasks for this feature as `[x]` in ROADMAP.md
  - Proceed to ship.

"Review complete. [Result]. Run `/workflows:ship $ARGUMENTS` when ready, or fix issues and re-run `/workflows:review $ARGUMENTS`."

## Learning

Add any new patterns or anti-patterns discovered to `docs/knowledge/patterns.md`.
Add any new bug patterns to `docs/knowledge/bugs.md`.
Save a memory entry with the review findings summary.
