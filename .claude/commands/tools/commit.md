---
description: "Quality-checked git commit with pre-commit validation"
---

# Commit Tool

## Pre-commit checks

1. `git diff --cached --name-only` — list staged files
2. Scan staged files for:
   - `TODO` or `FIXME` without ticket references
   - `console.log` / `print()` debug statements
   - Commented-out code blocks (>3 lines)
   - Hardcoded secrets: `sk-`, `pk_`, `AKIA`, `password =`
   - Files >500 lines (flag for splitting)
3. Run tests on staged files
4. Run linter on staged files

## Results

**All clean**: Commit with conventional format:
```
<type>(<scope>): <description>
```
Types: feat, fix, refactor, docs, test, chore

**Issues found**: Report and ask:
> "[N] issues found. Fix before committing, or commit anyway?"
