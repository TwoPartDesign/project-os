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

### Skill-Edit Drafts

For any draft whose title starts `skill-edit:` or `skill-edit ack:`, display
its full proposal BEFORE asking for a decision (Step 2). Never let a
skill-edit decision point reach Step 2 without one of the following having
printed something to the user:

1. Find the draft's `<!-- proposal: ... -->` comment line — format:
   `docs/specs/<feature>/skill-edits.md Proposal <N>`.
2. Open that doc and print the referenced proposal's `#### Anchor`,
   `#### Proposed text`, and `#### Rationale` sections in full.
3. If the proposal doc does not exist (spec dirs are gitignored and may be
   local-only to whichever session filed the draft), say so explicitly and
   treat the draft as **reject-by-default** — do not ask the user to approve
   it blind. Go straight to Skill-Edit Rejection below.
4. `skill-edit ack:` drafts have no `proposal:` comment to open — the full
   proposal text was folded into the auto-apply commit message instead.
   Extract `<hash>` from the title's `(auto-applied, commit <hash>)`
   annotation and display the commit message directly:
   ```
   git show <hash> --no-patch --format=%B
   ```

## Step 2: Ask for approval

Ask the user which tasks to approve. Options:
1. **Approve all** — promote all `[?]` to `[ ]` for this feature
2. **Approve selected** — promote only specified task IDs (e.g., `#T1, #T3`)
3. **Reject** — leave all as `[?]`. **Fork**: `skill-edit:` drafts are never
   left pending — rejecting one captures a reason and retires it (see
   Skill-Edit Rejection below).

## Step 3: Promote approved tasks

For each approved task:
1. Verify dependency consistency BEFORE promoting: a task should not become `[ ]` if any dependency is still `[?]`
   - If it does, **block the promotion** and tell the user: "Cannot approve #TN — depends on #TM which is still in draft. Approve #TM first."
   - Exception: if the user is approving both the task and its dependency in the same batch, promote in dependency order (deps first)
2. Validate that the specified task IDs actually exist in ROADMAP.md — reject unknown IDs with an error
3. Change `[?]` to `[ ]` in ROADMAP.md for each validated task

### Skill-Edit Staged Apply

For each approved `skill-edit:` draft (title starts `skill-edit:`), after the
normal promotion above:

1. Promote `[?]` → `[ ]` per the normal rule (already done by Step 3.3).
2. Run:
   ```
   node scripts/skill-apply.ts apply --proposal "<doc>" --n <N>
   ```
   where `<doc>` is the proposal doc path from the draft's
   `<!-- proposal: ... -->` comment and `<N>` is its proposal number.
3. Handle the exit code:
   - **exit 0** (`applied: <hash>` printed) — mark the task `[x]` and append
     `(applied <hash>)` to its title.
   - **exit 3** (refusal, reason printed) — report the refusal reason to the
     user, then offer **guided manual apply**: apply the proposal's fenced
     code block yourself with the Edit tool while the human watches, commit
     the result, then mark the task `[x]`.
   - **exit 4** (rolled back) — the apply started but failed post-apply
     validation and was auto-reverted. Treat identically to exit 3: report
     the reason, offer guided manual apply, then mark `[x]`.

`skill-edit ack:` drafts never go through staged apply — the edit is already
applied and committed. Approving one is handled in Ack Drafts below, not here.

## Skill-Edit Rejection

Applies whenever a `skill-edit:` draft is rejected (Step 2, Option 3) —
including reject-by-default from Step 1 when the proposal doc is missing.

1. Ask the human for a one-line reason.
2. Record the rejection:
   ```
   node scripts/skill-ledger.ts append --fingerprint "<fp>" --summary "<s>" --reason "<r>" --feature <f> --task <TN> --date <YYYY-MM-DD>
   ```
   - `<fp>` — the fingerprint from the draft's `<!-- maint-fp: ... -->` comment
   - `<s>` — one-line summary of what the proposal would have changed
   - `<r>` — the reason the human gave in step 1
   - `<f>` — the feature name from the proposal doc path
     (`docs/specs/<feature>/skill-edits.md`)
   - `<TN>` — the draft's task ID
   - `<YYYY-MM-DD>` — today's date
   - exit 2 means this fingerprint is already recorded in
     `docs/knowledge/skill-edit-rejections.md` — that's not an error here,
     continue to step 3 regardless (the retirement below still has to happen).
3. Retire the draft **in place**:
   - Change `[?]` → `[x]`.
   - Append `(rejected <date>)` to the task title.
   - Move the task line and its comment lines (`maint-fp:`, `proposal:`) to
     the `maintenance-inbox` feature's `### Done` subsection.
   - **Keep** the `maint-fp:` comment — do not drop it.
4. Run:
   ```
   bash scripts/validate-roadmap.sh
   ```

**Never delete a task line.** ROADMAP `#TN` IDs are retired, never reused —
deleting the line would free its ID for reuse (see
`docs/knowledge/roadmap-format.md` § Uniqueness Rules: "Never reuse IDs: If a
task is deleted, its ID is retired permanently"). The preserved `maint-fp:`
comment is what blocks the maintenance loop from re-filing the same proposal.

## Ack Drafts (auto-applied edits)

Applies to `skill-edit ack:` drafts — records of an edit that was already
auto-applied and committed (see Step 1's Skill-Edit Drafts subsection for how
to display its proposal via `git show`).

- **Keep** — mark `[x]`, then move the task line and its comment lines to the
  `maintenance-inbox` feature's `### Done` subsection with `(acked)` appended
  to the title.
- **Revert** — undo the auto-applied commit, then record why:
  1. ```
     git revert --no-edit <hash>
     ```
  2. ```
     node scripts/skill-ledger.ts append --fingerprint "<fp>" --summary "<s>" --reason "<r>" --feature <f> --task <TN> --date <YYYY-MM-DD>
     ```
     `<r>` here is why the auto-applied edit was reverted.
  3. Mark the task `[x]`, append `(reverted <date>)` to its title, and move it
     to the `maintenance-inbox` feature's `### Done` subsection — keep the
     `maint-fp:` comment, same never-delete invariant as Skill-Edit Rejection
     above.

## Step 4: Validate

Run `bash scripts/validate-roadmap.sh` to confirm no inconsistencies.

## Step 5: Report

Tell the user:
"Approved [N] task(s) for feature '$ARGUMENTS'.
[M] task(s) are now unblocked and ready for `/workflows:build $ARGUMENTS`.
[P] task(s) remain in draft."
