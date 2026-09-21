# Skill-Edit Proposals: jev-integration

## Run: 2026-09-20 — trigger: ship
Scope: .claude/commands/workflows/build.md, .claude/commands/workflows/review.md, .claude/commands/workflows/ship.md, .claude/commands/tools/reflect.md, .claude/rules/bash.md, .claude/rules/escalation.md, .claude/rules/lead.md, .claude/rules/tests.md, .claude/rules/preferences.md, .claude/rules/api.md, .claude/skills/spec-driven-dev/SKILL.md, .claude/skills/tdd-workflow/SKILL.md

### Proposal 1: build.md — worktree briefs merge the feature branch, not master
- **Fingerprint**: skill-edit:.claude/commands/workflows/build.md:worktree-merge-feature-branch
- **Target**: .claude/commands/workflows/build.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T190
- **Evidence**: `docs/memory/2026-09-20-jev-integration-build.md` "Surprises: Agent-tool worktrees branch from the merge-base, so every brief must open with `git merge <feature-branch>`"; all five jev-integration batches plus the #T189 and review-fix dispatches needed the merge, and the `docs/knowledge/patterns.md` entry "Brief Every Worktree Worker to Self-Ground First" names `git merge master`, which is wrong on a feature branch
- **Size**: 4283 → 4390 (chars/4)

#### Anchor
```
DO NOT give agents: full spec history, other tasks, the brief, research findings, or review comments. Context isolation is critical.
```

#### Proposed text
```

**Worktree base:** an Agent-tool worktree branches from the merge-base with the default branch, not from the current HEAD. When the build runs on a feature branch, the brief's first command must be `git -C "<worktree>" merge <current-branch> --no-edit` (the branch `git branch --show-current` prints), not `git merge master` — otherwise the worker builds against a tree missing every prior batch's integration.
```

#### Rationale
Every dispatch in the jev-integration build (five batches, one rider task, one review-fix) needed the lead to hand-correct the merge target because the pattern text says `master`. Naming the current branch in the brief step removes a per-dispatch correction and a silent-stale-tree failure mode for the next feature built on a branch.

### Proposal 2: ship.md — PR fallback when `gh` is unavailable
- **Fingerprint**: skill-edit:.claude/commands/workflows/ship.md:pr-without-gh-cli
- **Target**: .claude/commands/workflows/ship.md
- **Operation**: add
- **Tier**: standard
- **Draft task**: #T191
- **Evidence**: this ship — the remote session has no `gh` CLI, so `bash scripts/create-pr.sh jev-integration` cannot run and the PR was opened through the GitHub MCP `create_pull_request` tool instead; `docs/knowledge/metrics.md` "Feature: jev-integration" PR line
- **Size**: 1423 → 1510 (chars/4)

#### Anchor
```
This uses `gh` CLI and pulls context from tasks.md, review.md, and commit history.
```

#### Proposed text
```
If `gh` is not installed (remote sessions), build the same description by hand from tasks.md, review.md, and `git log --oneline "${BASE}...HEAD"`, and open the PR with the GitHub MCP `create_pull_request` tool (base `$BASE`, head the current branch). Never skip the PR step because the script cannot run.
```

#### Rationale
The ship command's only PR path assumes `gh`, which remote sessions lack; without a named fallback the step is either skipped or improvised. One sentence keeps the PR gate reachable in every environment the project ships from.
