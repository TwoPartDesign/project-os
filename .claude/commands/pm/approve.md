---
description: "Governance gate: promote draft tasks [?] to approved todo [ ] status"
---

# Approval Gate

You are the governance gatekeeper. This command promotes draft tasks to approved status, ensuring no work begins without explicit human sign-off.

## Input
Read ROADMAP.md and find all `[?]` (draft) tasks for the feature `$ARGUMENTS`.
If no feature name given, show ALL draft tasks across all features.

## Step 1: Display draft tasks

Show the user a summary of pending drafts:

```
Feature: $ARGUMENTS

Draft Tasks Pending Approval:
  [?] Task description #T1
  [?] Task description (depends: #T1) #T2
  [?] Task description #T3

Dependency Tree:
  #T1
  └── #T2
  #T3 (independent)

Total: N drafts
```

## Step 2: Ask for approval

Ask the user which tasks to approve. Options:
1. **Approve all** — promote all `[?]` to `[ ]` for this feature
2. **Approve selected** — promote only specified task IDs (e.g., `#T1, #T3`)
3. **Reject** — leave all as `[?]` (user should revisit the plan)

## Step 3: Promote approved tasks

For each approved task:
1. Change `[?]` to `[ ]` in ROADMAP.md
2. Verify dependency consistency: a `[ ]` task should not depend on a `[?]` task
   - If it does, warn the user: "Warning: #TN depends on #TM which is still in draft"
   - Suggest approving the dependency first

## Step 4: Validate

Run `bash scripts/validate-roadmap.sh` to confirm no inconsistencies.

## Step 5: Report

Tell the user:
"Approved [N] task(s) for feature '$ARGUMENTS'.
[M] task(s) are now unblocked and ready for `/workflows:build $ARGUMENTS`.
[P] task(s) remain in draft."
