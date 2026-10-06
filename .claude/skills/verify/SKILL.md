---
name: verify
description: Runs the project's fast test suite (`bash tests/run-all.sh --fast`) and reports the result. Use before committing any change that touches code, hooks, scripts or tests; skip it for docs-only commits.
---

# Verify

Run the fast suite from the project root:

```bash
bash tests/run-all.sh --fast
```

- **ALL PASS:** proceed with the commit.
- **A suite fails:** do not commit. Report the failing suite name and the first failing test with its file and line, then fix it or hand it back.
- **Docs-only change** (Markdown outside `.claude/commands/`, `.claude/skills/` and `.claude/rules/`): skip the run.

`--fast` skips the slow suites (`SLOW` in `tests/run-all.sh`). The pre-push hook runs only the scanner's `scan-diff`, not the suite; the full suite (including the slow suites) runs only when the lead runs the wave gate, so never pass `--fast` there.
