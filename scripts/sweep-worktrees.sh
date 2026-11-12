#!/usr/bin/env bash
# sweep-worktrees.sh — Remove agent worktrees (and their branches) only when no
# work can be lost.
#
# WHY THIS EXISTS: agent worktrees under .claude/worktrees/ pile up, and nothing
# defined "safe to delete", so sessions either hesitated or hand-audited each
# one. This script is that definition. It is mechanical: if every rule below
# holds the worktree is removed, otherwise it is kept and the failed rule is
# named. The lead rules pre-authorize running it with --apply.
#
# A worktree is REMOVABLE only if ALL of these hold:
#   1. `git status --porcelain` is empty (no modified, staged or untracked files).
#   2. No ignored files exist under the gitignored doc dirs (docs/specs,
#      docs/memory, docs/research, .claude/sessions). Output written there
#      vanishes with the worktree. Other ignored files (node_modules, logs)
#      are disposable.
#   3. Its work is already in the base: the head commit is an ancestor of the
#      base, OR every file the branch changed since its merge-base with the base
#      is byte-identical between head and base (the lead often integrates by
#      copying files, so the branch is not always an ancestor).
#
# Candidates are only worktrees located inside <repo>/.claude/worktrees/. The
# main worktree and any worktree elsewhere are never touched. A worktree whose
# directory is already gone is handled by `git worktree prune`.
#
# Branch candidates are local `worktree-agent-*` branches not checked out in any
# remaining worktree, plus the branch of each worktree removed in this run. A
# branch is deleted only if rule 3 holds for it and it is not the base branch:
# `git branch -d` when it is an ancestor of the base, `git branch -D` only after
# the file-identity check passed.
#
# Usage:
#   bash scripts/sweep-worktrees.sh [--apply] [--base <ref>]
#
#   (default)      dry run: report what would happen, change nothing
#   --apply        actually remove worktrees and delete branches
#   --base <ref>   ref the work must be contained in (default: HEAD)
#
# Output: one line per candidate, then a summary line:
#   REMOVED|WOULD REMOVE|KEPT <path-or-branch> (<reason>)
#
# Exit: 0 normally, 1 if not inside a git repository, 2 on bad arguments.

set -uo pipefail

APPLY=0
BASE="HEAD"

# usage — print the usage line to stderr.
usage() {
    echo "usage: sweep-worktrees.sh [--apply] [--base <ref>]" >&2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --apply) APPLY=1 ;;
        --base)
            if [ $# -lt 2 ] || [ -z "$2" ]; then
                echo "sweep-worktrees: --base requires a ref" >&2
                usage
                exit 2
            fi
            BASE="$2"
            shift
            ;;
        --base=*) BASE="${1#--base=}" ;;
        -h|--help) sed -n '2,43p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)
            echo "sweep-worktrees: unknown argument: $1" >&2
            usage
            exit 2
            ;;
    esac
    shift
done

if [ -z "$BASE" ]; then
    echo "sweep-worktrees: --base requires a ref" >&2
    usage
    exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "sweep-worktrees: not inside a git repository" >&2
    exit 1
}

BASE_SHA="$(git -C "$ROOT" rev-parse --verify --quiet "${BASE}^{commit}")" || {
    echo "sweep-worktrees: unknown base ref: $BASE" >&2
    exit 2
}

# Everything below runs against the repo root, whatever the caller's cwd was.
cd "$ROOT" || exit 1

IGNORED_DOC_DIRS=(docs/specs docs/memory docs/research .claude/sessions)

# Fully-qualified name of the base branch, if the base is (or resolves to) one.
BASE_BRANCH_REF="$(git rev-parse --symbolic-full-name "$BASE" 2>/dev/null || true)"
if [ "$BASE_BRANCH_REF" = "HEAD" ] || [ -z "$BASE_BRANCH_REF" ]; then
    BASE_BRANCH_REF="$(git symbolic-ref -q HEAD 2>/dev/null || true)"
fi

# norm_path — normalize a path for comparison (Windows C:/ vs /c/ forms, case, trailing slashes).
norm_path() {
    local p="$1"
    if command -v cygpath >/dev/null 2>&1; then
        p="$(cygpath -m -- "$p" 2>/dev/null || printf '%s' "$p")"
        p="${p,,}"
    fi
    while [ "${p%/}" != "$p" ] && [ -n "${p%/}" ]; do
        p="${p%/}"
    done
    printf '%s' "$p"
}

# in_set — succeed if $1 is a line of the newline-delimited set $2.
in_set() {
    case $'\n'"$2"$'\n' in
        *$'\n'"$1"$'\n'*) return 0 ;;
    esac
    return 1
}

# plural_commits — print "1 commit" / "N commits".
plural_commits() {
    if [ "$1" = "1" ]; then
        printf '1 commit'
    else
        printf '%s commits' "$1"
    fi
}

# check_integrated — rule 3: succeed if commit $1 is in the base; sets KIND (ancestor|identical) or WHY.
check_integrated() {
    local sha="$1" mb count f
    local files=()
    KIND=""
    WHY=""
    if git merge-base --is-ancestor "$sha" "$BASE_SHA" 2>/dev/null; then
        KIND="ancestor"
        return 0
    fi
    count="$(git rev-list --count "$BASE_SHA..$sha" 2>/dev/null || echo "?")"
    mb="$(git merge-base "$BASE_SHA" "$sha" 2>/dev/null || true)"
    if [ -z "$mb" ]; then
        WHY="no common history with base"
        return 1
    fi
    while IFS= read -r f; do
        if [ -n "$f" ]; then files+=("$f"); fi
    done < <(git -c core.quotepath=off diff --no-renames --name-only "$mb" "$sha")
    if [ ${#files[@]} -eq 0 ]; then
        KIND="identical"
        return 0
    fi
    if git --literal-pathspecs diff --quiet "$BASE_SHA" "$sha" -- "${files[@]}"; then
        KIND="identical"
        return 0
    fi
    WHY="$(plural_commits "$count") not in base"
    return 1
}

# kind_reason — human reason for a passed rule 3 ($1 = worktree|branch).
kind_reason() {
    if [ "$KIND" = "ancestor" ]; then
        if [ "$1" = "worktree" ]; then printf 'clean, head is ancestor of base'; else printf 'ancestor of base'; fi
    else
        if [ "$1" = "worktree" ]; then printf "clean, head's changed files identical in base"; else printf "changed files identical in base"; fi
    fi
}

# ignored_doc_dirs — list the gitignored doc dirs in worktree $1 that hold ignored files.
ignored_doc_dirs() {
    local wt="$1" line dir found=""
    while IFS= read -r line; do
        case "$line" in
            '!! '*) ;;
            *) continue ;;
        esac
        for dir in "${IGNORED_DOC_DIRS[@]}"; do
            case "${line#!! }" in
                "$dir"/*|"$dir")
                    if ! in_set "$dir" "$found"; then found="${found:+$found$'\n'}$dir"; fi
                    ;;
            esac
        done
    done < <(git -C "$wt" status --porcelain --ignored -- "${IGNORED_DOC_DIRS[@]}" 2>/dev/null)
    printf '%s' "$found"
}

WT_COUNT=0
WT_PATH=()
WT_HEAD=()
WT_BRANCH=()

# load_worktrees — parse `git worktree list --porcelain` into WT_PATH/WT_HEAD/WT_BRANCH.
load_worktrees() {
    local line path="" head="" branch="" have=0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "worktree "*)
                if [ "$have" -eq 1 ]; then
                    WT_PATH+=("$path"); WT_HEAD+=("$head"); WT_BRANCH+=("$branch")
                fi
                have=1
                path="${line#worktree }"; head=""; branch=""
                ;;
            "HEAD "*) head="${line#HEAD }" ;;
            "branch "*) branch="${line#branch refs/heads/}" ;;
        esac
    done < <(git worktree list --porcelain)
    if [ "$have" -eq 1 ]; then
        WT_PATH+=("$path"); WT_HEAD+=("$head"); WT_BRANCH+=("$branch")
    fi
    WT_COUNT=${#WT_PATH[@]}
}

WT_REMOVED=0
WT_KEPT=0
BR_REMOVED=0
BR_KEPT=0
CHECKED_OUT=""      # branches checked out in a worktree that stays
REMOVED_BRANCHES="" # branches of worktrees removed (or to be removed) in this run

if [ "$APPLY" -eq 1 ]; then
    VERB_REMOVED="REMOVED"
else
    VERB_REMOVED="WOULD REMOVE"
fi

# sweep_worktrees — evaluate and (with --apply) remove each candidate worktree.
sweep_worktrees() {
    local prefix i path branch head reasons why dirs d msg
    prefix="$(norm_path "$ROOT/.claude/worktrees")/"
    load_worktrees
    i=0
    while [ "$i" -lt "$WT_COUNT" ]; do
        path="${WT_PATH[$i]}"
        head="${WT_HEAD[$i]}"
        branch="${WT_BRANCH[$i]}"
        # Index 0 is the main worktree; anything outside .claude/worktrees/ is not ours.
        if [ "$i" -eq 0 ] || [[ "$(norm_path "$path")/" != "$prefix"* ]]; then
            if [ -n "$branch" ]; then CHECKED_OUT="${CHECKED_OUT:+$CHECKED_OUT$'\n'}$branch"; fi
            i=$((i + 1))
            continue
        fi

        if [ ! -d "$path" ]; then
            echo "$VERB_REMOVED $path (directory missing, stale record pruned)"
            WT_REMOVED=$((WT_REMOVED + 1))
            if [ -n "$branch" ]; then REMOVED_BRANCHES="${REMOVED_BRANCHES:+$REMOVED_BRANCHES$'\n'}$branch"; fi
            i=$((i + 1))
            continue
        fi

        reasons=""
        if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
            reasons="uncommitted changes"
        fi
        dirs="$(ignored_doc_dirs "$path")"
        if [ -n "$dirs" ]; then
            while IFS= read -r d; do
                reasons="${reasons:+$reasons; }ignored files under $d"
            done <<< "$dirs"
        fi
        if check_integrated "$head"; then
            :
        else
            why="$WHY"
            reasons="${reasons:+$reasons; }$why"
        fi

        if [ -n "$reasons" ]; then
            echo "KEPT $path ($reasons)"
            WT_KEPT=$((WT_KEPT + 1))
            if [ -n "$branch" ]; then CHECKED_OUT="${CHECKED_OUT:+$CHECKED_OUT$'\n'}$branch"; fi
            i=$((i + 1))
            continue
        fi

        if [ "$APPLY" -eq 1 ]; then
            if msg="$(git worktree remove "$path" 2>&1)"; then
                :
            else
                msg="${msg//$'\n'/ }"
                echo "KEPT $path ($msg)"
                WT_KEPT=$((WT_KEPT + 1))
                if [ -n "$branch" ]; then CHECKED_OUT="${CHECKED_OUT:+$CHECKED_OUT$'\n'}$branch"; fi
                i=$((i + 1))
                continue
            fi
        fi
        echo "$VERB_REMOVED $path ($(kind_reason worktree))"
        WT_REMOVED=$((WT_REMOVED + 1))
        if [ -n "$branch" ]; then REMOVED_BRANCHES="${REMOVED_BRANCHES:+$REMOVED_BRANCHES$'\n'}$branch"; fi
        i=$((i + 1))
    done
}

# sweep_branches — evaluate and (with --apply) delete candidate branches.
sweep_branches() {
    local candidates="" b sha msg
    while IFS= read -r b; do
        if [ -n "$b" ] && ! in_set "$b" "$candidates"; then candidates="${candidates:+$candidates$'\n'}$b"; fi
    done < <(git for-each-ref --format='%(refname:short)' 'refs/heads/worktree-agent-*'; printf '%s\n' "$REMOVED_BRANCHES")

    [ -n "$candidates" ] || return 0
    while IFS= read -r b; do
        if in_set "$b" "$CHECKED_OUT"; then continue; fi
        sha="$(git rev-parse --verify --quiet "refs/heads/$b^{commit}")" || continue
        if [ "refs/heads/$b" = "$BASE_BRANCH_REF" ]; then
            echo "KEPT $b (is the base branch)"
            BR_KEPT=$((BR_KEPT + 1))
            continue
        fi
        if ! check_integrated "$sha"; then
            echo "KEPT $b ($WHY)"
            BR_KEPT=$((BR_KEPT + 1))
            continue
        fi
        if [ "$APPLY" -eq 1 ]; then
            if [ "$KIND" = "ancestor" ]; then
                msg="$(git branch -d "$b" 2>&1)"
            else
                msg="$(git branch -D "$b" 2>&1)"
            fi
            if [ $? -ne 0 ]; then
                msg="${msg//$'\n'/ }"
                echo "KEPT $b ($msg)"
                BR_KEPT=$((BR_KEPT + 1))
                continue
            fi
        fi
        echo "$VERB_REMOVED $b ($(kind_reason branch))"
        BR_REMOVED=$((BR_REMOVED + 1))
    done <<< "$candidates"
}

sweep_worktrees

# A removed worktree's branch (and a missing worktree's stale record) only
# becomes deletable once git has forgotten the worktree.
if [ "$APPLY" -eq 1 ]; then git worktree prune; fi

sweep_branches

if [ "$APPLY" -eq 1 ]; then
    git worktree prune
    echo "Summary (apply): worktrees $WT_REMOVED removed, $WT_KEPT kept; branches $BR_REMOVED removed, $BR_KEPT kept"
else
    echo "Summary (dry run): worktrees $WT_REMOVED would remove, $WT_KEPT kept; branches $BR_REMOVED would remove, $BR_KEPT kept"
fi
exit 0
