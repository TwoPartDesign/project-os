---
description: "Decompose an approved design into atomic, independently-implementable tasks"
---

# Phase 3: Task Decomposition

You are acting as a technical project manager. Your job is to transform the approved design into tasks so specific that the implementing agent never asks clarifying questions.

## Input
Read the design at `docs/specs/$ARGUMENTS/design.md`. Verify status is APPROVED.
If not approved, STOP and tell the user to run `/workflows:design $ARGUMENTS` first.

## Step 1: Decompose

Break the design into atomic tasks. Each task must satisfy ALL of these:
- **Single responsibility**: One task, one concern
- **No file conflicts**: Tasks that can run in parallel must not touch the same files
- **Complete specification**: Exact file paths, function signatures, patterns to follow
- **Acceptance criteria**: Testable conditions that define "done"
- **Estimated size**: Small (< 50 lines changed), Medium (50-150), Large (150+)
  - If Large, decompose further

## Step 2: Dependency graph

Order tasks by dependencies. Independent tasks can be parallelized.
Use this notation:
- `T1 → T2` means T2 depends on T1
- `T1 | T2` means T1 and T2 are independent (parallelizable)

## Step 3: Create task document

Write `docs/specs/$ARGUMENTS/tasks.md`:

```markdown
# Tasks: [Feature Name]
Created: [date]
Design: ./design.md
Total tasks: [N]
Parallelizable groups: [N]

## Dependency Graph
T1 → T3 → T5
T2 → T3
T4 (independent)

## Group 1 (parallel)
### T1: [Title]
- **Files**: `src/path/file.ts` (create), `src/path/other.ts` (modify lines 45-60)
- **Pattern**: Follow the pattern in `src/existing/similar.ts`
- **Implementation**:
  - Create [specific thing] with [specific interface]
  - Handle [specific edge case] by [specific approach]
- **Tests**:
  - `tests/path/file.test.ts`:
    - Test: [name] — Setup: [what], Assert: [what], Expected: [what]
    - Test: [name] — Setup: [what], Assert: [what], Expected: [what]
- **Acceptance Criteria**:
  - [ ] [Specific, testable criterion]
  - [ ] [Specific, testable criterion]
- **Size**: Small
- **Status**: [ ]

### T2: [Title]
[Same structure]

## Group 2 (after Group 1)
### T3: [Title]
- **Depends on**: T1, T2
[Same structure]
```

## Step 4: Update tracking

Update ROADMAP.md with the new v2 format. Each task becomes a `[?]` (draft) entry under the feature heading, with `#TN` IDs and inline dependency declarations:

```
## Feature: $ARGUMENTS
### Draft
- [?] Task title (depends: #T1, #T2) #T3
- [?] Independent task #T4
### Todo
### In Progress
### Review
### Done
```

Rules:
- All new tasks start as `[?]` (draft) — they require `/pm:approve` before work can begin
- Every task MUST have a unique `#TN` ID. Before assigning IDs, scan the existing ROADMAP.md for the highest `#TN` value and start new IDs from `N+1` to avoid collisions with tasks from other features.
- Dependencies use inline syntax: `(depends: #T1, #T2)`
- Independent tasks have no depends clause
- Run `bash scripts/validate-roadmap.sh` after updating to verify no cycles, dangling refs, or duplicate IDs

Notify the user: "Draft tasks require approval. Run `/pm:approve $ARGUMENTS` to promote to todo."

## Step 5: Validate

Run a self-check:
- Are any tasks missing acceptance criteria? → Add them
- Do any parallel tasks share files? → Resequence them
- Are there tasks larger than 150 lines? → Decompose further
- Does every test case have setup + assertion + expected result? → Complete them

Tell the user: "Plan created with [N] tasks in [M] groups. Run `/workflows:build $ARGUMENTS` to begin implementation."
