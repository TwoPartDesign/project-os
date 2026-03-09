---
description: "Fast-path orchestrator — drives a feature from current phase to ship with aggressive auto-approval and minimal human gates"
---

# /workflows:mvp — Fast-Path Orchestrator

You are the MVP orchestrator. You drive a feature from wherever it currently sits all the way to ship by invoking existing workflow skills in sequence, auto-approving every gate that is provably safe, and pausing **only** where human judgment is genuinely required.

## Arguments

```
/workflows:mvp $FEATURE [--from <phase>] [--dry-run]
```

- `$FEATURE` — feature slug (matches `docs/specs/$FEATURE/` directory and ROADMAP.md entries)
- `--from <phase>` — override phase detection; start from this phase. Valid values: `idea`, `design`, `plan`, `approve`, `build`, `review`, `ship`
- `--dry-run` — detect phase and print planned gate decisions without executing anything

## Status Banner Format

Print a banner between every phase transition. Update it in-place as phases complete.

```
━━━ MVP: $FEATURE ━━━━━━━━━━━━━━━━━━━━━━━━
✓ [idea]    brief.md created
✓ [design]  auto-approved (status: APPROVED)
✓ [plan]    5 tasks decomposed
✓ [approve] all tasks promoted [ ] (auto)
→ [build]   running wave 1/2 ...
```

Status symbols:
- `✓` — phase complete
- `→` — phase currently running
- `⚠` — auto-rebuild triggered (warning, continuing)
- `⏸` — paused, awaiting user input
- `✗` — phase failed, human input required and run halted
- `○` — phase pending (dry-run only)

On a gate auto-rebuild:
```
⚠ [review]  GATE FAILED — MUST FIX items found
  Auto-rebuild (Mode 1) triggered — attempt 1.
```

On a hard stop:
```
✗ [review]  GATE FAILED again — human review required.
  Findings: docs/specs/$FEATURE/review.md
  Next: fix issues and re-run /workflows:mvp $FEATURE
```

## State File

MVP persists cross-run state to `docs/specs/$FEATURE/mvp-state.yaml`. Create it on first run; update it between phases.

```yaml
feature: $FEATURE
started_at: <ISO timestamp>
detected_phase: <phase>
review_cycles: 0        # incremented each time /workflows:review runs
last_review_result: ""  # PASSED | FAILED
```

Read this file at the start of each run to resume correctly after an interrupted execution.

## Phase Detection

If `--from <phase>` is provided, skip detection and start from that phase.

Otherwise, read `docs/specs/$FEATURE/mvp-state.yaml` first — if it records a clean `detected_phase`, use it. Then verify by checking artifacts in order below (first match wins).

### Step 1: Locate an idea document

Search for an idea document in this priority order:

1. `docs/specs/$FEATURE/brief.md`
2. `docs/prd/$FEATURE*.md`
3. `docs/specs/$FEATURE/prd.md` or `docs/specs/$FEATURE/spec.md`
4. `docs/specs/PRD-$FEATURE*.md`
5. Any `*.md` in `docs/specs/` or `docs/prd/` whose filename contains `$FEATURE` (case-insensitive)

If **no** idea document is found → detected phase is **idea**.

If an idea document is found → proceed to Step 2.

### Step 2: Check downstream artifacts

| Artifact state | Detected phase |
|---|---|
| Idea doc found, `docs/specs/$FEATURE/design.md` absent | `design` |
| `design.md` exists, `docs/specs/$FEATURE/tasks.md` absent | `plan` |
| `tasks.md` exists, feature has `[?]` tasks in ROADMAP.md (plan-phase tasks, not the idea draft entry) | `approve` |
| All feature tasks are `[ ]` or `[-]`, none `[?]` | `build` |
| Any feature task is `[!]` OR `docs/specs/$FEATURE/revision-request.md` exists | `rebuild` |
| Any feature task is `[~]` (review-ready) and no `[!]` tasks | `review` |
| `docs/specs/$FEATURE/review.md` exists and contains `GATE PASSED` | `ship` |

**Note on `[?]` detection (fixes skip-plan bug):** `idea` writes one draft ROADMAP entry before `tasks.md` exists. When checking for `[?]` tasks, **require `tasks.md` to exist first**. If `tasks.md` is absent, the `[?]` entries are from the idea phase — route to `plan`, not `approve`.

## Gate Policy Reference

| Gate | Auto-approve condition | Pause condition |
|---|---|---|
| Design approval | `design.md` contains `Status: APPROVED` | Design lacks `Status: APPROVED` (not yet approved by user) |
| Task approval (`[?]` → `[ ]`) | Always — MVP applies approval directly without invoking `/pm:approve` | Never |
| Rebuild mode choice | Auto Mode 1 (re-implement) — inlined, does not invoke `/workflows:rebuild` | Never |
| Review failure — first time | Auto-trigger Mode 1 rebuild and re-review | — |
| Review failure — second time | Never | Always — surface findings and halt |
| Ship pre-check | Never | Always pauses for user confirmation |

## Dry-Run Mode

If `--dry-run` is set:
1. Run phase detection and report the detected phase with artifact evidence
2. List every gate that would be encountered
3. For each gate, state whether it would be auto-approved or would pause
4. Show conditional branches (review fail → rebuild → re-review)
5. Print nothing else — do NOT invoke any workflow skills

Example dry-run output:
```
━━━ MVP: $FEATURE (DRY RUN) ━━━━━━━━━━━━━━━━
Detected phase: plan
Detected by: brief.md found, design.md found, tasks.md absent

Planned gate decisions:
  ○ [plan]    will run /workflows:plan
  ○ [approve] will auto-apply "approve all" directly (no /pm:approve prompt)
  ○ [build]   will run /workflows:build
  ○ [review]  gate — if PASSED: proceed to ship
              gate — if FAILED (attempt 1): auto Mode 1 rebuild → re-review
              gate — if FAILED (attempt 2): ✗ halt, human input required
  ⏸ [ship]    always pauses for user confirmation

No changes made (dry-run).
```

## Phase Runners

Execute each phase by invoking the corresponding workflow skill. Do NOT re-implement their logic — delegate fully. Then apply gate logic after the skill completes.

### Phase: idea

**Invoke**: `/workflows:idea $FEATURE`

After completion:
- Verify `docs/specs/$FEATURE/brief.md` was created
- Write `mvp-state.yaml` with `detected_phase: design`
- Proceed automatically to **design**

### Phase: design

**Invoke**: `/workflows:design $FEATURE`

The design skill presents adversarial review findings to the user and, upon approval, updates `design.md` to `Status: APPROVED`. MVP waits for the skill to complete, then applies the design gate.

**Design gate:**

Read `docs/specs/$FEATURE/design.md` and check for `Status: APPROVED`.

**Auto-approve** (`Status: APPROVED` found):
- Print: `✓ [design]  auto-approved (status: APPROVED)`
- Proceed to **plan**

**Pause** (`Status: APPROVED` not found — design was not approved during the skill run):
- Print:
  ```
  ⏸ [design]  NOT APPROVED — design requires human review.
    The design skill presented findings; the design was not approved.
    Review docs/specs/$FEATURE/design.md, then re-run /workflows:mvp $FEATURE
  ```
- STOP.

**Cannot parse** (file missing or unreadable after skill completes):
- Output: `Retry cap reached on [design gate]. Blocker: design.md missing or unreadable after /workflows:design completed. Suggested next: run /workflows:design $FEATURE manually and verify it writes design.md.`
- STOP.

### Phase: plan

**Invoke**: `/workflows:plan $FEATURE`

After completion:
- Verify `docs/specs/$FEATURE/tasks.md` was created
- Verify ROADMAP.md has `[?]` entries with `#TN` IDs for this feature
- Update `mvp-state.yaml` with `detected_phase: approve`
- Proceed automatically to **approve**

### Phase: approve

**Do NOT invoke `/pm:approve`** — that skill prompts the user for mode selection.

Instead, MVP applies "approve all" directly:

1. Read ROADMAP.md and find all `[?]` task entries for `$FEATURE` that have a `#TN` ID (these are plan-phase tasks, not the idea draft entry)
2. For each `[?]` task: check that all its declared dependencies are `[ ]` or already non-draft. Promote in dependency order (deps first)
3. Change every qualifying `[?]` to `[ ]` in ROADMAP.md
4. Run `bash scripts/validate-roadmap.sh` to confirm no inconsistencies

After completion:
- Print: `✓ [approve] N tasks promoted [ ] (auto)`
- Update `mvp-state.yaml` with `detected_phase: build`
- Proceed to **build**

### Phase: build

**Invoke**: `/workflows:build $FEATURE`

After completion:
- Read ROADMAP.md and count any `[!]` tasks for this feature

**No `[!]` tasks:**
- Print: `✓ [build]   N tasks completed`
- Update `mvp-state.yaml` with `detected_phase: review`
- Proceed to **review**

**Any `[!]` tasks exist:**
- Print:
  ```
  ⏸ [build]   M task(s) blocked [!] — cannot proceed to review with incomplete implementation.
    Blocked tasks: [list task IDs]
    Options:
      1. Fix blockers manually and re-run /workflows:mvp $FEATURE
      2. Run /workflows:rebuild $FEATURE to unblock and re-implement
  ```
- STOP. Do not proceed to review with blocked tasks.

### Phase: rebuild (inlined Mode 1)

MVP inlines Mode 1 (re-implement) directly rather than invoking `/workflows:rebuild`, which prompts the user for mode choice.

**Inlined Mode 1 steps:**

1. Read `docs/specs/$FEATURE/revision-request.md` (must exist — created by `/workflows:review` on failure)
   - If missing: output `Retry cap reached on [rebuild]. Blocker: revision-request.md missing. Suggested next: run /workflows:review $FEATURE to generate it.` → STOP
2. Find all `[!]` tasks for this feature in ROADMAP.md
3. Change each `[!]` to `[-]` in ROADMAP.md (unblock for re-implementation)
4. Create `docs/specs/$FEATURE/rebuild-context.md`:
   ```
   # Rebuild Context (Auto — MVP Mode 1)
   Source: revision-request.md

   [Full contents of revision-request.md]

   Instructions for agents: fix the issues listed above. Reference the task IDs cited in the findings.
   ```
5. Invoke `/workflows:build $FEATURE`

After build completes, increment `review_cycles` in `mvp-state.yaml`, then proceed directly to **review**.

### Phase: review

**Invoke**: `/workflows:review $FEATURE`

After completion, read `docs/specs/$FEATURE/review.md` and check for `GATE PASSED` or `GATE FAILED`.

**Cannot parse gate result** (file missing or neither string present):
- Output: `Retry cap reached on [review gate]. Blocker: review.md missing or gate result unparseable. Suggested next: run /workflows:review $FEATURE manually and verify it writes a gate decision.`
- STOP.

Read `mvp-state.yaml` for `review_cycles` to determine attempt count.

**GATE PASSED:**
- Print: `✓ [review]  GATE PASSED`
- Update `mvp-state.yaml`: `last_review_result: PASSED`
- Proceed to **ship**

**GATE FAILED — attempt 1** (`review_cycles` was 0 before this review):
- Increment `review_cycles` to 1 in `mvp-state.yaml`, set `last_review_result: FAILED`
- Print:
  ```
  ⚠ [review]  GATE FAILED — MUST FIX items found
    Auto-rebuild (Mode 1) triggered — attempt 1.
  ```
- Execute **rebuild (inlined Mode 1)** (see above)
- Then run **review** again (this will be attempt 2)

**GATE FAILED — attempt 2** (`review_cycles` was 1 before this review):
- Update `mvp-state.yaml`: `review_cycles: 2, last_review_result: FAILED`
- Print:
  ```
  ✗ [review]  GATE FAILED again — human review required.
    Findings: docs/specs/$FEATURE/review.md
    Prior rebuild context: docs/specs/$FEATURE/rebuild-context.md
    Next: fix issues manually and re-run /workflows:mvp $FEATURE
  ```
- STOP.

### Phase: ship

**Always pause before shipping.** This gate never auto-approves.

Print:
```
⏸ [ship]    Ready to ship. Review summary:
  - Tasks: [N completed / M total]
  - Review: GATE PASSED [with N notes]
  - Findings: docs/specs/$FEATURE/review.md

Proceed with /workflows:ship $FEATURE? (y/n)
```

Wait for user confirmation. If confirmed:
- **Invoke**: `/workflows:ship $FEATURE`
- Print: `✓ [ship]    $FEATURE shipped.`

If declined:
- Print: `○ [ship]    Skipped. Run /workflows:ship $FEATURE when ready.`
- STOP.

## Error Handling

### Retry cap

Per the escalation protocol: **maximum 2 retries per operation**. After 2 consecutive failures on the same phase, STOP and surface the blocker.

Format:
```
Retry cap reached on [phase]. Blocker: [specific issue]. Suggested next: [action].
```

### Phase invocation failure

If a workflow skill fails to complete or returns an error:
1. First retry: re-invoke the same skill once
2. Second failure: output the retry cap message and halt

### Artifact missing after phase

If a required artifact is missing after a phase completes (e.g., `brief.md` not created after idea phase):
- Do not retry silently
- Report: `✗ [$PHASE] Expected artifact not found: [path]. Check output above for errors.`
- Halt

### Interrupted run

If MVP is re-run after a prior interrupted run, read `mvp-state.yaml` to resume from the correct state. The `--from <phase>` flag can override if the state file is stale or wrong.

If `mvp-state.yaml` is corrupt or unreadable, fall back to full artifact-based phase detection and warn: `mvp-state.yaml unreadable — re-detecting phase from artifacts.`

## Final Output

After all phases complete (or halt), print the full banner with final status, then a one-line summary:

```
━━━ MVP: $FEATURE — COMPLETE ━━━━━━━━━━━━━━━
✓ [idea]    brief.md found (pre-existing)
✓ [design]  auto-approved (status: APPROVED)
✓ [plan]    4 tasks decomposed
✓ [approve] 4 tasks promoted [ ] (auto)
✓ [build]   4 tasks completed
✓ [review]  GATE PASSED
✓ [ship]    shipped

$FEATURE shipped. Metrics and knowledge base updated by /workflows:ship.
```
