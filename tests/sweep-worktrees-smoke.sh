#!/usr/bin/env bash
# Smoke tests for scripts/sweep-worktrees.sh
# Each scenario builds its own throwaway git repo (with worktrees under
# .claude/worktrees/) under a fresh mktemp -d and cleans up after itself —
# no shared mutable state between scenarios.
# Usage: bash tests/sweep-worktrees-smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SWEEP="$PROJECT_ROOT/scripts/sweep-worktrees.sh"

# The suite may itself run inside a git hook or worktree; never inherit that.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR 2>/dev/null || true

PASS=0
FAIL=0
ERRORS=""
TMP_DIRS=()

pass() {
    local name="$1"
    PASS=$((PASS + 1))
    echo "  PASS: $name"
}

fail() {
    local name="$1"
    local detail="$2"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  FAIL: $name\n$detail"
    echo "  FAIL: $name"
}

assert_eq() {
    local name="$1" expected="$2" actual="$3" detail="$4"
    if [ "$expected" = "$actual" ]; then
        pass "$name"
    else
        fail "$name" "expected [$expected], got [$actual]\n$detail"
    fi
}

# assert_line — the output must contain exactly this line.
assert_line() {
    local name="$1" expected="$2" output="$3"
    if printf '%s\n' "$output" | grep -qxF -- "$expected"; then
        pass "$name"
    else
        fail "$name" "missing line [$expected] in output:\n$output"
    fi
}

# assert_no_match — the output must not contain this fixed string anywhere.
assert_no_match() {
    local name="$1" needle="$2" output="$3"
    if printf '%s\n' "$output" | grep -qF -- "$needle"; then
        fail "$name" "unexpected [$needle] in output:\n$output"
    else
        pass "$name"
    fi
}

# assert_dir / assert_no_dir — directory existence checks.
assert_dir() {
    local name="$1" dir="$2"
    if [ -d "$dir" ]; then pass "$name"; else fail "$name" "directory missing: $dir"; fi
}
assert_no_dir() {
    local name="$1" dir="$2"
    if [ ! -d "$dir" ]; then pass "$name"; else fail "$name" "directory still exists: $dir"; fi
}

# branch_exists — print "yes" or "no" for a local branch in $REPO.
branch_exists() {
    if git -C "$REPO" show-ref --verify --quiet "refs/heads/$1"; then echo yes; else echo no; fi
}

cleanup() {
    local d
    for d in "${TMP_DIRS[@]:-}"; do
        [ -n "$d" ] && rm -rf "$d"
    done
}
trap cleanup EXIT

# new_repo — create a fresh repo with one commit on main; sets TMP, REPO, ROOT.
new_repo() {
    TMP="$(mktemp -d)"
    TMP_DIRS+=("$TMP")
    REPO="$TMP/repo"
    mkdir -p "$REPO"
    git -C "$REPO" init -q -b main
    git -C "$REPO" config user.name "Sweep Test"
    git -C "$REPO" config user.email "sweep@example.invalid"
    git -C "$REPO" config commit.gpgsign false
    git -C "$REPO" config core.autocrlf false
    printf 'docs/specs/\ndocs/memory/\ndocs/research/\n.claude/sessions/\nnode_modules/\n*.log\n.claude/worktrees/\n.claude/worktrees-old/\n' > "$REPO/.gitignore"
    echo "base" > "$REPO/README.md"
    git -C "$REPO" add -A
    git -C "$REPO" commit -q -m "initial"
    ROOT="$(git -C "$REPO" rev-parse --show-toplevel)"
}

# add_wt <name> <branch> — add a worktree under .claude/worktrees/<name> on a new branch.
add_wt() {
    git -C "$REPO" worktree add -q -b "$2" "$REPO/.claude/worktrees/$1" >/dev/null 2>&1
}

# commit_in <dir> <file> <content> <msg> — write a file and commit it in a checkout.
commit_in() {
    echo "$3" > "$1/$2"
    git -C "$1" add -A
    git -C "$1" commit -q -m "$4"
}

# run_sweep <args...> — run the script from the repo; sets OUT and RC.
run_sweep() {
    set +e
    OUT="$(cd "$REPO" && bash "$SWEEP" "$@" 2>&1)"
    RC=$?
    set -e
}

# =============================================================================
echo "=== sweep-worktrees.sh smoke tests ==="
echo ""

# --- Scenario 1: clean + ancestor ---------------------------------------------
echo "Scenario 1: clean worktree whose branch is an ancestor of base"
new_repo
add_wt a worktree-agent-aaa
run_sweep --apply
assert_eq "sweep_cleanAncestor_exitsZero" "0" "$RC" "$OUT"
assert_line "sweep_cleanAncestor_reportsWorktreeRemoved" \
    "REMOVED $ROOT/.claude/worktrees/a (clean, head is ancestor of base)" "$OUT"
assert_line "sweep_cleanAncestor_reportsBranchRemoved" \
    "REMOVED worktree-agent-aaa (ancestor of base)" "$OUT"
assert_line "sweep_cleanAncestor_summaryCountsBoth" \
    "Summary (apply): worktrees 1 removed, 0 kept; branches 1 removed, 0 kept" "$OUT"
assert_no_dir "sweep_cleanAncestor_directoryGone" "$REPO/.claude/worktrees/a"
assert_eq "sweep_cleanAncestor_branchDeleted" "no" "$(branch_exists worktree-agent-aaa)" "$OUT"

# --- Scenario 2: clean + copy-integrated --------------------------------------
echo "Scenario 2: clean worktree integrated by copying files (not an ancestor)"
new_repo
add_wt b worktree-agent-bbb
commit_in "$REPO/.claude/worktrees/b" feature.txt "feature body" "feat: add feature in worktree"
commit_in "$REPO" feature.txt "feature body" "feat: same file copied into main"
run_sweep --apply
assert_eq "sweep_copyIntegrated_exitsZero" "0" "$RC" "$OUT"
assert_line "sweep_copyIntegrated_reportsWorktreeRemoved" \
    "REMOVED $ROOT/.claude/worktrees/b (clean, head's changed files identical in base)" "$OUT"
assert_line "sweep_copyIntegrated_reportsBranchForceDeleted" \
    "REMOVED worktree-agent-bbb (changed files identical in base)" "$OUT"
assert_no_dir "sweep_copyIntegrated_directoryGone" "$REPO/.claude/worktrees/b"
assert_eq "sweep_copyIntegrated_branchDeleted" "no" "$(branch_exists worktree-agent-bbb)" "$OUT"

# --- Scenario 3: uncommitted tracked change -----------------------------------
echo "Scenario 3: tracked file modified"
new_repo
add_wt c worktree-agent-ccc
echo "edited" >> "$REPO/.claude/worktrees/c/README.md"
run_sweep --apply
assert_line "sweep_uncommittedChange_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/c (uncommitted changes)" "$OUT"
assert_dir "sweep_uncommittedChange_directoryKept" "$REPO/.claude/worktrees/c"
assert_eq "sweep_uncommittedChange_branchKept" "yes" "$(branch_exists worktree-agent-ccc)" "$OUT"
assert_line "sweep_uncommittedChange_summaryCountsKept" \
    "Summary (apply): worktrees 0 removed, 1 kept; branches 0 removed, 0 kept" "$OUT"

# --- Scenario 4: untracked file -----------------------------------------------
echo "Scenario 4: untracked file"
new_repo
add_wt d worktree-agent-ddd
echo "new" > "$REPO/.claude/worktrees/d/notes.txt"
run_sweep --apply
assert_line "sweep_untrackedFile_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/d (uncommitted changes)" "$OUT"
assert_dir "sweep_untrackedFile_directoryKept" "$REPO/.claude/worktrees/d"
assert_eq "sweep_untrackedFile_branchKept" "yes" "$(branch_exists worktree-agent-ddd)" "$OUT"

# --- Scenario 5: ignored file under a doc dir ---------------------------------
echo "Scenario 5: ignored file under docs/specs"
new_repo
add_wt e worktree-agent-eee
mkdir -p "$REPO/.claude/worktrees/e/docs/specs/feat"
echo "spec" > "$REPO/.claude/worktrees/e/docs/specs/feat/brief.md"
run_sweep --apply
assert_line "sweep_ignoredDocFile_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/e (ignored files under docs/specs)" "$OUT"
assert_dir "sweep_ignoredDocFile_directoryKept" "$REPO/.claude/worktrees/e"
assert_eq "sweep_ignoredDocFile_branchKept" "yes" "$(branch_exists worktree-agent-eee)" "$OUT"

# --- Scenario 5b: ignored sessions file ---------------------------------------
echo "Scenario 5b: ignored file under .claude/sessions"
new_repo
add_wt e2 worktree-agent-eee2
mkdir -p "$REPO/.claude/worktrees/e2/.claude/sessions"
echo "log" > "$REPO/.claude/worktrees/e2/.claude/sessions/handoff.md"
run_sweep --apply
assert_line "sweep_ignoredSessionsFile_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/e2 (ignored files under .claude/sessions)" "$OUT"

# --- Scenario 6: disposable ignored files are fine ----------------------------
echo "Scenario 6: ignored files outside the doc dirs are disposable"
new_repo
add_wt f worktree-agent-fff
mkdir -p "$REPO/.claude/worktrees/f/node_modules/pkg"
echo "x" > "$REPO/.claude/worktrees/f/node_modules/pkg/index.js"
echo "x" > "$REPO/.claude/worktrees/f/build.log"
run_sweep --apply
assert_line "sweep_disposableIgnored_reportsRemoved" \
    "REMOVED $ROOT/.claude/worktrees/f (clean, head is ancestor of base)" "$OUT"
assert_no_dir "sweep_disposableIgnored_directoryGone" "$REPO/.claude/worktrees/f"

# --- Scenario 7: unintegrated commits -----------------------------------------
echo "Scenario 7: commits not in base"
new_repo
add_wt g worktree-agent-ggg
commit_in "$REPO/.claude/worktrees/g" one.txt "1" "feat: one"
commit_in "$REPO/.claude/worktrees/g" two.txt "2" "feat: two"
add_wt g1 worktree-agent-ggg1
commit_in "$REPO/.claude/worktrees/g1" solo.txt "s" "feat: solo"
run_sweep --apply
assert_line "sweep_unintegratedCommits_reportsPluralCount" \
    "KEPT $ROOT/.claude/worktrees/g (2 commits not in base)" "$OUT"
assert_line "sweep_unintegratedCommit_reportsSingularCount" \
    "KEPT $ROOT/.claude/worktrees/g1 (1 commit not in base)" "$OUT"
assert_dir "sweep_unintegratedCommits_directoryKept" "$REPO/.claude/worktrees/g"
assert_eq "sweep_unintegratedCommits_branchKept" "yes" "$(branch_exists worktree-agent-ggg)" "$OUT"

# --- Scenario 8: same file changed differently in base ------------------------
echo "Scenario 8: file touched by the branch differs in base"
new_repo
add_wt h worktree-agent-hhh
commit_in "$REPO/.claude/worktrees/h" feature.txt "branch version" "feat: branch version"
commit_in "$REPO" feature.txt "different version" "feat: other version in main"
run_sweep --apply
assert_line "sweep_divergedFile_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/h (1 commit not in base)" "$OUT"
assert_eq "sweep_divergedFile_branchKept" "yes" "$(branch_exists worktree-agent-hhh)" "$OUT"

# --- Scenario 9: worktrees outside .claude/worktrees/ -------------------------
echo "Scenario 9: outside paths and prefix collision are never touched"
new_repo
OUTSIDE="$TMP/outside-wt"
git -C "$REPO" worktree add -q -b worktree-agent-out "$OUTSIDE" >/dev/null 2>&1
mkdir -p "$REPO/.claude/worktrees-old"
git -C "$REPO" worktree add -q -b worktree-agent-old "$REPO/.claude/worktrees-old/x" >/dev/null 2>&1
run_sweep --apply
assert_eq "sweep_outsideAndPrefixCollision_exitsZero" "0" "$RC" "$OUT"
assert_no_match "sweep_outsideWorktree_notMentioned" "outside-wt" "$OUT"
assert_no_match "sweep_prefixCollisionWorktree_notMentioned" "worktrees-old" "$OUT"
assert_dir "sweep_outsideWorktree_directoryKept" "$OUTSIDE"
assert_dir "sweep_prefixCollisionWorktree_directoryKept" "$REPO/.claude/worktrees-old/x"
assert_eq "sweep_outsideWorktree_branchKept" "yes" "$(branch_exists worktree-agent-out)" "$OUT"
assert_eq "sweep_prefixCollisionWorktree_branchKept" "yes" "$(branch_exists worktree-agent-old)" "$OUT"
assert_line "sweep_outsideAndPrefixCollision_summaryIsEmpty" \
    "Summary (apply): worktrees 0 removed, 0 kept; branches 0 removed, 0 kept" "$OUT"

# --- Scenario 10: dry run -----------------------------------------------------
echo "Scenario 10: dry run changes nothing"
new_repo
add_wt i worktree-agent-iii
BEFORE="$(git -C "$REPO" worktree list --porcelain)"
run_sweep
AFTER="$(git -C "$REPO" worktree list --porcelain)"
assert_eq "sweep_dryRun_exitsZero" "0" "$RC" "$OUT"
assert_line "sweep_dryRun_reportsWouldRemoveWorktree" \
    "WOULD REMOVE $ROOT/.claude/worktrees/i (clean, head is ancestor of base)" "$OUT"
assert_line "sweep_dryRun_reportsWouldRemoveBranch" \
    "WOULD REMOVE worktree-agent-iii (ancestor of base)" "$OUT"
assert_line "sweep_dryRun_summaryNamesDryRun" \
    "Summary (dry run): worktrees 1 would remove, 0 kept; branches 1 would remove, 0 kept" "$OUT"
assert_dir "sweep_dryRun_directoryKept" "$REPO/.claude/worktrees/i"
assert_eq "sweep_dryRun_branchKept" "yes" "$(branch_exists worktree-agent-iii)" "$OUT"
assert_eq "sweep_dryRun_worktreeListUnchanged" "$BEFORE" "$AFTER" "$OUT"

# --- Scenario 11: stray branches ----------------------------------------------
echo "Scenario 11: stray worktree-agent-* branches with no worktree"
new_repo
git -C "$REPO" branch worktree-agent-stray-ok
git -C "$REPO" branch worktree-agent-stray-ahead
git -C "$REPO" branch not-an-agent-branch
git -C "$REPO" worktree add -q "$TMP/scratch-wt" worktree-agent-stray-ahead >/dev/null 2>&1
commit_in "$TMP/scratch-wt" ahead.txt "ahead" "feat: unintegrated work"
git -C "$REPO" worktree remove "$TMP/scratch-wt" >/dev/null 2>&1
run_sweep --apply
assert_line "sweep_strayIntegratedBranch_reportsRemoved" \
    "REMOVED worktree-agent-stray-ok (ancestor of base)" "$OUT"
assert_eq "sweep_strayIntegratedBranch_branchDeleted" "no" "$(branch_exists worktree-agent-stray-ok)" "$OUT"
assert_line "sweep_strayUnintegratedBranch_reportsKept" \
    "KEPT worktree-agent-stray-ahead (1 commit not in base)" "$OUT"
assert_eq "sweep_strayUnintegratedBranch_branchKept" "yes" "$(branch_exists worktree-agent-stray-ahead)" "$OUT"
assert_no_match "sweep_nonAgentBranch_notMentioned" "not-an-agent-branch" "$OUT"
assert_eq "sweep_nonAgentBranch_branchKept" "yes" "$(branch_exists not-an-agent-branch)" "$OUT"

# --- Scenario 12: missing worktree directory ----------------------------------
echo "Scenario 12: worktree directory already gone"
new_repo
add_wt j worktree-agent-jjj
rm -rf "$REPO/.claude/worktrees/j"
run_sweep --apply
assert_line "sweep_missingDirectory_reportsPruned" \
    "REMOVED $ROOT/.claude/worktrees/j (directory missing, stale record pruned)" "$OUT"
assert_line "sweep_missingDirectory_branchDeletedAfterPrune" \
    "REMOVED worktree-agent-jjj (ancestor of base)" "$OUT"
LISTED="$(git -C "$REPO" worktree list --porcelain | grep -c '^worktree ' || true)"
assert_eq "sweep_missingDirectory_recordPruned" "1" "$LISTED" "$OUT"

# --- Scenario 13: detached HEAD ------------------------------------------------
echo "Scenario 13: detached HEAD worktree"
new_repo
git -C "$REPO" worktree add -q --detach "$REPO/.claude/worktrees/k" >/dev/null 2>&1
git -C "$REPO" worktree add -q --detach "$REPO/.claude/worktrees/k2" >/dev/null 2>&1
commit_in "$REPO/.claude/worktrees/k2" det.txt "d" "feat: detached work"
run_sweep --apply
assert_line "sweep_detachedClean_reportsRemoved" \
    "REMOVED $ROOT/.claude/worktrees/k (clean, head is ancestor of base)" "$OUT"
assert_line "sweep_detachedUnintegrated_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/k2 (1 commit not in base)" "$OUT"
assert_no_dir "sweep_detachedClean_directoryGone" "$REPO/.claude/worktrees/k"
assert_dir "sweep_detachedUnintegrated_directoryKept" "$REPO/.claude/worktrees/k2"

# --- Scenario 14: locked worktree ---------------------------------------------
echo "Scenario 14: locked worktree is kept, in apply and dry run alike"
new_repo
add_wt l worktree-agent-lll
git -C "$REPO" worktree lock --reason "in use" "$REPO/.claude/worktrees/l"
run_sweep
assert_line "sweep_lockedWorktreeDryRun_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/l (locked)" "$OUT"
run_sweep --apply
assert_line "sweep_lockedWorktree_reportsKept" \
    "KEPT $ROOT/.claude/worktrees/l (locked)" "$OUT"
assert_dir "sweep_lockedWorktree_directoryKept" "$REPO/.claude/worktrees/l"
assert_eq "sweep_lockedWorktree_branchKept" "yes" "$(branch_exists worktree-agent-lll)" "$OUT"
git -C "$REPO" worktree unlock "$REPO/.claude/worktrees/l" >/dev/null 2>&1 || true

# --- Scenario 15: --base is never deleted -------------------------------------
echo "Scenario 15: the base branch itself is not deleted"
new_repo
add_wt m worktree-agent-mmm
commit_in "$REPO/.claude/worktrees/m" m.txt "m" "feat: work on the base branch"
run_sweep --apply --base worktree-agent-mmm
assert_line "sweep_baseBranch_worktreeRemoved" \
    "REMOVED $ROOT/.claude/worktrees/m (clean, head is ancestor of base)" "$OUT"
assert_line "sweep_baseBranch_branchKept" "KEPT worktree-agent-mmm (is the base branch)" "$OUT"
assert_eq "sweep_baseBranch_branchStillExists" "yes" "$(branch_exists worktree-agent-mmm)" "$OUT"

# --- Scenario 16: argument and environment errors -----------------------------
echo "Scenario 16: bad arguments and non-repo"
new_repo
run_sweep --bogus
assert_eq "sweep_unknownFlag_exitsTwo" "2" "$RC" "$OUT"
assert_line "sweep_unknownFlag_namesTheFlag" "sweep-worktrees: unknown argument: --bogus" "$OUT"
run_sweep --base
assert_eq "sweep_baseWithoutValue_exitsTwo" "2" "$RC" "$OUT"
assert_line "sweep_baseWithoutValue_explains" "sweep-worktrees: --base requires a ref" "$OUT"
run_sweep --base no-such-ref
assert_eq "sweep_unknownBaseRef_exitsTwo" "2" "$RC" "$OUT"
assert_line "sweep_unknownBaseRef_namesTheRef" "sweep-worktrees: unknown base ref: no-such-ref" "$OUT"
NOREPO="$(mktemp -d)"
TMP_DIRS+=("$NOREPO")
set +e
NOREPO_OUT="$(cd "$NOREPO" && GIT_CEILING_DIRECTORIES="$NOREPO/.." bash "$SWEEP" 2>&1)"
NOREPO_RC=$?
set -e
assert_eq "sweep_notAGitRepo_exitsOne" "1" "$NOREPO_RC" "$NOREPO_OUT"
assert_line "sweep_notAGitRepo_explains" "sweep-worktrees: not inside a git repository" "$NOREPO_OUT"

# =============================================================================
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
    echo -e "$ERRORS"
    exit 1
fi
exit 0
