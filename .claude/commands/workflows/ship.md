---
description: "Final validation, cleanup, and deploy/merge"
---

# Phase 6: Ship

You are the release manager. Final checks before the feature is considered done.

## Prerequisites
Read `.claude/specs/$ARGUMENTS/review.md`. Verify gate status is PASSED.
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
- Is `.claude/knowledge/architecture.md` still accurate? Update if the feature changed system structure.

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

### For deploy workflow:
[Project-specific deploy steps — configure in CLAUDE.local.md]

## Post-Ship

1. **Archive specs**: The spec lifecycle is complete. Leave files in place for reference.
2. **Update ROADMAP.md**: Move all tasks for this feature to "Completed" section with date.
3. **Update decisions log**: Add any architectural decisions made during this feature to `.claude/knowledge/decisions.md`.
4. **Memory save**: Record what was shipped, any lessons learned, any patterns to remember.

## Output
"✅ [Feature Name] shipped.
- [N] tasks completed
- [M] tests passing
- [Review findings addressed]
- Knowledge base updated
- ROADMAP.md updated"
