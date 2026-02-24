---
description: "Final validation, cleanup, and deploy/merge"
---

# Phase 6: Ship

You are the release manager. Final checks before the feature is considered done.

## Prerequisites
Read `docs/specs/$ARGUMENTS/review.md`. Verify gate status is PASSED.
If not, STOP and tell the user to complete the review first.

## Pre-Ship Checklist

### 1. Code Hygiene
Run these checks and report results:

```bash
# Find remaining TODOs without ROADMAP links
grep -rn -e "TODO" -e "FIXME" -e "HACK" -e "XXX" --include="*.ts" --include="*.js" --include="*.py" --include="*.go" --include="*.rs" src/ || echo "Clean"

# Find debug/console statements that should be removed
grep -rn -e "console\.log" -e "debugger" -e "print(" --include="*.ts" --include="*.js" --include="*.py" src/ || echo "Clean"

# Find hardcoded localhost/dev URLs
grep -rn -e "localhost" -e "127\.0\.0\.1" -e "0\.0\.0\.0" --include="*.ts" --include="*.js" --include="*.py" --include="*.go" src/ || echo "Clean"

# Check for large files that shouldn't be committed
find . \( -name "*.log" -o -name "*.tmp" -o -name "*.cache" -o -size +1M \) | head -20
```

### 2. Test Suite
Run the full test suite. ALL tests must pass. No skipped tests allowed unless documented in the review.

### 3. Documentation Check
- Does README.md reflect the new feature? If not, update it.
- Are there new public APIs without docstrings? Add them.
- Is `docs/knowledge/architecture.md` still accurate? Update if the feature changed system structure.

### 4. Git Hygiene
- Ensure commits are clean and conventional (`feat:`, `fix:`, etc.)
- Squash any "WIP" or "fixup" commits
- Verify the branch is up-to-date with the default branch (main or master)

## Ship Actions

### For merge-to-main workflow:
```bash
# Auto-detect default branch
if git rev-parse --verify main &>/dev/null; then BASE="main"; else BASE="master"; fi
git checkout "$BASE"
git merge --no-ff "feature/$ARGUMENTS" -m "feat: [Feature Name] — [one-line summary]"
```

### PR Generation (preferred):
Run `bash scripts/create-pr.sh "$ARGUMENTS"` to create a pull request with auto-generated description.
This uses `gh` CLI and pulls context from tasks.md, review.md, and commit history.

Log: `bash .claude/hooks/log-activity.sh pr-created feature=$ARGUMENTS`

### For deploy workflow:
[Project-specific deploy steps — configure in CLAUDE.local.md]

## Post-Ship

1. **Preserve sessions**: `bash .claude/hooks/preserve-sessions.sh` — save worktree sessions before cleanup
2. **Clean up worktrees**: Remove any remaining worktrees for this feature
3. **Archive specs**: The spec lifecycle is complete. Leave files in place for reference.
4. **Update ROADMAP.md**: Move all tasks for this feature to the "Done" section.
   - Check if any tasks are still `[~]` (not yet `[x]`)
   - If found, list them and ask the user: "These tasks passed review with notes but haven't been marked done. Mark them `[x]` now, or address the outstanding notes first?"
   - Only proceed after all feature tasks are confirmed `[x]`
5. **Update decisions log**: Add any architectural decisions made during this feature to `docs/knowledge/decisions.md`.
6. **Metrics snapshot**: Append a metrics entry to `docs/knowledge/metrics.md`:
   - Duration (from first task-spawned to feature-shipped in activity log)
   - Task count (total, completed, blocked)
   - Wave count (from build)
   - Revision count (review cycles)
   - First-pass review rate
   - Lines changed (`git diff --shortstat ${BASE}...HEAD` — where BASE is auto-detected above)
7. **Memory save**: Record what was shipped, any lessons learned, any patterns to remember.

Log: `bash .claude/hooks/log-activity.sh feature-shipped feature=$ARGUMENTS`

## Output
"[Feature Name] shipped.
- [N] tasks completed
- [W] waves
- [M] tests passing
- [Review findings addressed]
- Metrics snapshot saved to docs/knowledge/metrics.md
- Knowledge base updated
- ROADMAP.md updated"
