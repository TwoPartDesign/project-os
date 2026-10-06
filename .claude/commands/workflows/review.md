---
description: "Adversarial quality gate — three independent reviewers check the implementation"
---

# Phase 5: Adversarial Review

You are the review coordinator. You spawn independent reviewer sub-agents, each with a different focus and ISOLATED context. No reviewer sees another's findings until synthesis.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md` for what was supposed to be built.
Read `docs/specs/$ARGUMENTS/design.md` for what was specified.
Read completion reports from `docs/specs/$ARGUMENTS/tasks/*/completion-report.md` (iterate all task directories) for build context.
Get the diff of all changes against the default branch. Auto-detect: use `main` if it exists, otherwise `master`:
```bash
if git rev-parse --verify main &>/dev/null; then BASE="main"; else BASE="master"; fi
git diff "${BASE}...HEAD"
```

## Review sizing

Size the pass to the diff before spawning anything (`.claude/rules/lead.md`
Routing). A text-shaped diff — markdown, rules, command prose, config — gets
**one** reviewer (`reviewer-architecture` with `model: sonnet`) covering drift,
consistency, and test gaps in a single context. Code with a security or
correctness surface — hooks, the scanner, scripts touching git or the
filesystem — gets **one** reviewer (`reviewer-security` with `model: opus`)
covering security and correctness together. The full three-reviewer pass below,
at the lead's tier (`inherit`), is the **ship gate**: run it once per feature
before `/workflows:ship`, not after every wave. For a single-task feature the
sized pass plus the Lead's own drift check (every acceptance criterion
verified against the code) may stand in for it; say so under a "Sizing"
heading in review.md so ship reads the substitution. Findings under about twenty
lines in one file are the Lead's to fix directly; do not dispatch a worker for
them.

## Isolation

All three reviewers run with `isolation: worktree` for filesystem isolation (prevents reviewers from modifying the working tree). Cross-reviewer isolation is enforced by **prompt separation** — each sub-agent receives only its own instructions and review focus. The Lead (you) is the only entity that reads all three reports.

Before spawning any reviewer, read `.claude/rules/bash.md` and `.claude/rules/lead.md` and extract the full content of each one's `## Agent Rules` section (everything after that heading). Store the bash rules as `BASH_AGENT_RULES` and the lead rules as `LEAD_AGENT_RULES` — substitute them into each reviewer prompt where indicated below.

Every finding is tagged with the layer to fix, inside the ISSUE prefix — `DRIFT[design]:`, `VULN[implementation]:`, `ISSUE[rule]:`. Store the following as `LAYER_TAGS` and substitute it into each reviewer prompt where indicated (reviewers are isolated and see only their own prompt):

> Tag each finding with the layer that must change to fix it, in square brackets directly after the category word (no space): `brief` (the brief's goal or criteria were wrong or missing), `design` (design.md decided wrongly or left something out), `tasks` (tasks.md decomposition or acceptance criteria were wrong), `worker-brief` (the implementer's brief lacked what it needed), `rule` (a rule, skill, or command file is ambiguous or missing), `implementation` (the spec was right and the code does not match it). When unsure, use `implementation`. The tag stays inside the ISSUE field — never add a fifth ` / ` field; the last ` / ` separates ISSUE from FIX.

**Spawn contract:** each reviewer is a **registered roster agent dispatched by name**. If a named agent type is unknown, halt with the escalation message "Retry cap reached on dispatch. Blocker: agent <name> not registered. Suggested next: run tests/agent-roster.test.ts." Never fall back to `general-purpose` or any agent not in the roster — the reviewer would silently land on the env-var model tier instead of the roster tier.

## Reviewer 1: Drift Detection (Plan vs Implementation)

Spawn a sub-agent with this prompt:

```
Agent(
  subagent_type: "reviewer-architecture",
  isolation: "worktree",
  prompt: <the prompt below>
)
```

"You are a drift detection auditor. Your job is to find mismatches between what was planned and what was built.

CRITICAL — BASH COMMAND RULES:
[BASH_AGENT_RULES]

AGENT RULES:
[LEAD_AGENT_RULES]

PLANNED (source of truth):
[Contents of tasks.md — the task descriptions and acceptance criteria]

DESIGN (reference):
[Contents of design.md — the technical approach section, read from `<main-repo absolute path>/docs/specs/$ARGUMENTS/design.md` (docs/specs is gitignored; worktrees cannot see it)]

BRIEF (success criteria and scope):
`<main-repo absolute path>/docs/specs/$ARGUMENTS/brief.md` (docs/specs is gitignored; worktrees cannot see it, so the path must be absolute). Read only its success and scope sections. The brief comes from one of two schemas: `/workflows:idea` writes `## Success Criteria` and `## Non-Goals`; `/pm:prd` writes `## Success Metrics` and `### Out of Scope`. Accept either.

YOUR TASK:
1. For each task in the plan, verify the acceptance criteria are met in the actual code
2. Check that no UNPLANNED changes were made (scope creep)
3. Check that the implementation follows the design's architectural decisions
4. Check for TODO/FIXME/HACK comments without corresponding ROADMAP entries
5. If the feature touched framework wiring (hooks/commands/skills/scripts): read `docs/maps/system-map.md` and run `node scripts/system-map.ts report` — new HIGH findings (unwired hooks, dangling refs) on files this feature touched are DRIFT; also verify the map's edges for new/changed files match what the design intended to wire
6. Check the brief: for each success criterion (or success metric) in the BRIEF, find evidence in the code, tests, or docs that it is met. Also check that nothing in the brief's Non-Goals / Out of Scope was built

Output format — one line per finding:
`SEVERITY / FILE:LINES / ISSUE / FIX`
Severity is one of CRITICAL, HIGH, MEDIUM, LOW. The ISSUE field starts with the word `DRIFT` plus a layer tag, `DRIFT[layer]:` — e.g. `HIGH / scripts/foo.ts:40-58 / DRIFT[implementation]: task T12 required X, the code does Y / restore X`. [LAYER_TAGS] Report everything; the coordinator filters.

After the findings, add these content lines:
- UNPLANNED: [description of scope creep] | Risk: [assessment]
- PASS: [criterion that was correctly implemented]
- BRIEF: [success criterion verbatim] → [evidence: file:line, test, or command output] → MET | UNMET (one line per criterion; an UNMET criterion is also a finding line, tagged with the layer that dropped it: `[design]` or `[tasks]` if the plan omitted it, `[implementation]` if the plan covered it and the code did not)"

## Reviewer 2: Security Review

Spawn a sub-agent with this prompt:

```
Agent(
  subagent_type: "reviewer-security",
  isolation: "worktree",
  prompt: <the prompt below>
)
```

"You are a security auditor. Review ONLY the changed files for security issues.

CRITICAL — BASH COMMAND RULES:
[BASH_AGENT_RULES]

AGENT RULES:
[LEAD_AGENT_RULES]

Reference (the specification these changes must satisfy):
`<main-repo absolute path>/docs/specs/$ARGUMENTS/design.md` (docs/specs is gitignored; worktrees cannot see it)

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

Output format — one line per finding:
`SEVERITY / FILE:LINES / ISSUE / FIX`
Severity is one of CRITICAL, HIGH, MEDIUM, LOW. The ISSUE field starts with the word `VULN` plus a layer tag, `VULN[layer]:` — e.g. `CRITICAL / scripts/run.sh:12 / VULN[implementation]: command injection via unquoted $INPUT / quote the expansion`. [LAYER_TAGS] Report everything; the coordinator filters.

After the findings, add these content lines:
- CONCERN: [potential issue needing investigation] | File: [path:line]
- PASS: [security property verified]"

## Reviewer 3: Quality & Maintainability

Spawn a sub-agent with this prompt:

```
Agent(
  subagent_type: "reviewer-tests",
  isolation: "worktree",
  prompt: <the prompt below>
)
```

"You are a code quality reviewer. Review the changed files for maintainability.

CRITICAL — BASH COMMAND RULES:
[BASH_AGENT_RULES]

AGENT RULES:
[LEAD_AGENT_RULES]

Reference (the specification these changes must satisfy):
`<main-repo absolute path>/docs/specs/$ARGUMENTS/design.md` (docs/specs is gitignored; worktrees cannot see it)

Changed files and test files:
[Relevant source and test files]

Project conventions (read this file; it is not pasted here):
`<main-repo absolute path>/docs/knowledge/patterns.md`

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

Output format — one line per finding:
`SEVERITY / FILE:LINES / ISSUE / FIX`
Severity is one of CRITICAL, HIGH, MEDIUM, LOW. The ISSUE field starts with the word `ISSUE` plus a layer tag, `ISSUE[layer]:` — e.g. `MEDIUM / scripts/parse.ts:80-140 / ISSUE[implementation]: getPage() is 61 lines and mixes parse with render / split the render half out`. [LAYER_TAGS] Report everything; the coordinator filters.

After the findings, add these content lines:
- SUGGESTION: [optional improvement] | File: [path:line]
- PASS: [quality standard met]"

## Activity Logging

Before spawning reviewers: `bash .claude/hooks/log-activity.sh review-started feature=$ARGUMENTS`
After gate decision:
- PASSED: `bash .claude/hooks/log-activity.sh review-passed feature=$ARGUMENTS`
- FAILED: `bash .claude/hooks/log-activity.sh review-failed feature=$ARGUMENTS`

## Synthesis

After all three reviewers complete:

0. **Triage**: Sub-agent results arrive indented (Claude Code 2.1.277+). Dedent each
   report first — strip the common leading whitespace from every line — so
   findings start at column 0 in the file. Then write each reviewer's raw report to
   `docs/specs/$ARGUMENTS/review-raw/architecture.md`,
   `docs/specs/$ARGUMENTS/review-raw/security.md`, and
   `docs/specs/$ARGUMENTS/review-raw/tests.md`. Write
   `git diff --name-only "${BASE}...HEAD"` to
   `docs/specs/$ARGUMENTS/review-raw/changed-files.txt`. Run:
   ```bash
   node scripts/review-triage.ts "docs/specs/$ARGUMENTS" --changed-files "docs/specs/$ARGUMENTS/review-raw/changed-files.txt"
   ```
   The printed table is advisory input to steps 1-3 below and decides
   nothing — `review-raw/` sits under the gitignored spec directory. When the
   written `docs/specs/$ARGUMENTS/review-triage.json` header shows
   `"backend": "jev"`, quote its `lift` values (duplicates, scope, and
   severity changed versus the heuristic) in the review report's summary so
   every review records what Jev changed.
1. **Deduplicate**: Remove findings that multiple reviewers flagged identically
2. **Cross-validate**: For each CRITICAL/HIGH finding, verify it's accurate by checking the actual code yourself — reviewers can hallucinate
   Treat a CONCERN that a shipped document's self-validation claim is circular (the checked number is produced by the code under review) the same way: confirm it, and if it holds, the claim and every conclusion resting on it are a HIGH.
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
  - Create `docs/specs/$ARGUMENTS/revision-request.md` listing required changes with task IDs, keeping each finding's layer tag (`[brief|design|tasks|worker-brief|rule|implementation]`) so rebuild fixes the named layer
  - Notify: `bash .claude/hooks/notify-phase-change.sh review-failed "$ARGUMENTS"`
  - Run `/tools:reflect $ARGUMENTS --trigger review-fail` — reflects on the fresh failure evidence; files at most 3 bounded skill-edit drafts
  - List required fixes and tell the user, including the reflection's summary line (`Skill reflection: ...`) in the FAIL output message.

  **Next Steps:** Run `/workflows:rebuild $ARGUMENTS` to unblock failed tasks and re-implement fixes. The rebuild command reads `revision-request.md` to understand what needs fixing and guides agents accordingly.

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
Instruction-file (skills/rules/commands) changes are NOT made here — note the observation in review.md; the ship/review-fail/rebuild reflection step proposes them as governed drafts.
