#!/usr/bin/env bash
# tests/run-all.sh — the single local verification gate.
#
# WHY THIS EXISTS: the repo's checks were split across two worlds — `npm test`
# (node:test over tests/**/*.test.ts) and seven free-standing `tests/*-smoke.sh`
# scripts that nothing ever invoked together. Verifying a change meant knowing
# which of the eight to run, so in practice none of the smoke suites ran and
# defects were discovered by pushing and waiting for an external reviewer.
# One command, one exit code, every suite.
#
# Usage:
#   bash tests/run-all.sh              # everything
#   bash tests/run-all.sh --fast       # skip suites tagged slow (see SLOW)
#   bash tests/run-all.sh --only scan  # substring filter on suite name
#   bash tests/run-all.sh --list       # print the suite inventory and exit
#
# Exit: 0 only if every selected suite passed.
#
# Per-suite output goes to tests/.logs/<suite>.log (gitignored). Only the
# failing suites' tails are printed, so a green run stays short and a red run
# shows the actual error without a second command.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$SCRIPT_DIR/.logs"

# Suites that take more than ~30s. --fast skips these; CI and pre-push do not.
SLOW="new-project-smoke"

FAST=0
ONLY=""
LIST=0
TAIL_LINES=40

while [ $# -gt 0 ]; do
    case "$1" in
        --fast) FAST=1 ;;
        --only) ONLY="${2:-}"; shift ;;
        --only=*) ONLY="${1#--only=}" ;;
        --list) LIST=1 ;;
        --tail) TAIL_LINES="${2:-40}"; shift ;;
        -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Suite inventory
#
# The unit suite is one entry (node:test runs the whole tests/**/*.test.ts glob
# in a single process and prints its own TAP summary). Shell suites are
# DISCOVERED, not listed: a new tests/*.sh is picked up with no edit here, which
# is the only way this stays honest as suites are added. The glob is every .sh
# in tests/ rather than just *-smoke.sh, because suites do get added under other
# names (tests/compaction-hooks.sh) and a naming convention nobody enforces is
# how a suite ends up never running.
# ---------------------------------------------------------------------------

SUITE_NAMES=()
SUITE_CMDS=()

add_suite() {
    local name="$1"; shift
    if [ -n "$ONLY" ] && [[ "$name" != *"$ONLY"* ]]; then return 0; fi
    if [ "$FAST" -eq 1 ] && [[ " $SLOW " == *" $name "* ]]; then
        SKIPPED="${SKIPPED}${name} "
        return 0
    fi
    SUITE_NAMES+=("$name")
    SUITE_CMDS+=("$*")
}

SKIPPED=""

# Commands are relative to the repo root (every suite is run from there), so a
# repo path containing spaces — the common case on Windows — never reaches the
# shell as an unquoted word.
add_suite "unit" 'node --test --test-reporter=spec "tests/**/*.test.ts"'

for f in "$SCRIPT_DIR"/*.sh; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    [ "$base" = "run-all.sh" ] && continue   # the runner is not one of its own suites
    add_suite "${base%.sh}" "bash \"tests/$base\""
done

if [ "$LIST" -eq 1 ]; then
    printf '%s\n' "${SUITE_NAMES[@]}"
    exit 0
fi

if [ ${#SUITE_NAMES[@]} -eq 0 ]; then
    echo "No suites matched --only '$ONLY'." >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

mkdir -p "$LOG_DIR"

echo "=== Project OS verification — ${#SUITE_NAMES[@]} suite(s) ==="
if [ -n "$SKIPPED" ]; then
    echo "    skipped (--fast): $SKIPPED"
elif [ -z "$ONLY" ]; then
    # new-project-smoke bootstraps whole throwaway projects and dominates the
    # wall clock. Say so up front rather than letting it look like a hang.
    echo "    (includes slow suites — 'npm run test:fast' skips them)"
fi
echo

FAILED=()
TOTAL_START=$SECONDS

i=0
while [ $i -lt ${#SUITE_NAMES[@]} ]; do
    name="${SUITE_NAMES[$i]}"
    cmd="${SUITE_CMDS[$i]}"
    log="$LOG_DIR/$name.log"
    i=$((i + 1))

    printf '  %-24s ' "$name"
    start=$SECONDS
    # Suites resolve their own paths from BASH_SOURCE, but node --test and any
    # relative path inside a suite need the repo root as cwd.
    ( cd "$REPO_ROOT" && eval "$cmd" ) >"$log" 2>&1
    status=$?
    elapsed=$((SECONDS - start))

    if [ $status -eq 0 ]; then
        printf 'PASS  (%ss)\n' "$elapsed"
    else
        printf 'FAIL  (%ss, exit %s)\n' "$elapsed" "$status"
        FAILED+=("$name")
    fi
done

TOTAL_ELAPSED=$((SECONDS - TOTAL_START))
echo

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

if [ ${#FAILED[@]} -eq 0 ]; then
    echo "=== ALL PASS — ${#SUITE_NAMES[@]} suite(s) in ${TOTAL_ELAPSED}s ==="
    exit 0
fi

echo "=== ${#FAILED[@]} SUITE(S) FAILED in ${TOTAL_ELAPSED}s ==="
for name in "${FAILED[@]}"; do
    echo
    echo "--- $name (last $TAIL_LINES lines of tests/.logs/$name.log) ---"
    tail -n "$TAIL_LINES" "$LOG_DIR/$name.log"
done
echo
echo "Full logs: tests/.logs/"
exit 1
