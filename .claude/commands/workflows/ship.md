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
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.{ts,js,py,go,rs}" || echo "Clean"

# Find debug/console statements that should be removed
grep -rn "console\.log\|debugger\|print(" src/ --include="*.{ts,js,py}" || echo "Clean"

# Find hardcoded localhost/dev URLs
grep -rn "localhost\|127\.0\.0\.1\|0\.0\.0\.0" src/ --include="*.{ts,js,py,go}" || echo "Clean"

# Check for large files that shouldn't be committed
find . -name "*.{log,tmp,cache}" -o -size +1M | head -20
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
- Verify the branch is up-to-date with main

## Ship Actions

### For merge-to-main workflow:
```bash
git checkout main
git merge --no-ff feature/$ARGUMENTS -m "feat: [Feature Name] — [one-line summary]"
```

### PR Generation (preferred):
Run `bash scripts/create-pr.sh $ARGUMENTS` to create a pull request with auto-generated description.
This uses `gh` CLI and pulls context from tasks.md, review.md, and commit history.

Log: `bash .claude/hooks/log-activity.sh pr-created feature=$ARGUMENTS`

### For deploy workflow:
[Project-specific deploy steps — configure in CLAUDE.local.md]

## Post-Ship

1. **Preserve sessions**: `bash .claude/hooks/preserve-sessions.sh` — save worktree sessions before cleanup
2. **Clean up worktrees**: Remove any remaining worktrees for this feature
3. **Archive specs**: The spec lifecycle is complete. Leave files in place for reference.
4. **Update ROADMAP.md**: Move all tasks for this feature to "Completed" section with date.
5. **Update decisions log**: Add any architectural decisions made during this feature to `docs/knowledge/decisions.md`.
6. **Metrics snapshot**: Append a metrics entry to `docs/knowledge/metrics.md`:
   - Duration (from first task-spawned to feature-shipped in activity log)
   - Task count (total, completed, blocked)
   - Wave count (from build)
   - Revision count (review cycles)
   - First-pass review rate
   - Lines changed (`git diff --shortstat main...HEAD`)
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
