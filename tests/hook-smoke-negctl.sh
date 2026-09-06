#!/bin/bash
# Negative control for tests/hook-smoke.sh.
# Usage: bash tests/hook-smoke-negctl.sh
#
# A test that passes on both a fixed and a broken tree is vacuous until proven
# otherwise, and the previous version of hook-smoke.sh was the worked example:
# it asserted exit codes against five hooks that all run `trap 'exit 0' ERR`, so
# 14 of its 15 assertions passed against hooks replaced by `exit 0`. This script
# is what keeps that from happening again.
#
# Two mutants:
#
#   1. STUB — every hook replaced by `exit 0`. Two kinds of assertion are
#      EXPECTED to survive, and neither is a defect: the `_exitsZero` liveness
#      checks, and the negative assertions (`_writesNothing`, `_noSideEffect`,
#      `_doesNotIndex`, `_nothingDeleted…`), which a hook that does nothing at
#      all trivially satisfies. A negative assertion carries weight only next to
#      its positive twin on the same hook — `_writesNothing` means something
#      because `_logsToolName` is there to fail. Every assertion that names an
#      EFFECT must appear in the FAIL list.
#
#   2. RAW-PATH — the real hooks, with post-tool-use.sh's payload path taken
#      unconverted (the pre-fix spelling). Exactly one assertion must fail:
#      postToolUse_backslashPayloadPath_stillResolved. A mutant that fails more
#      than its one target is not isolating anything.
#
#   3. UNIFIED-BOUND — tool-failure-log.sh switched to the bounded read the
#      other hooks use. This is the mutant a future tidying pass would write:
#      the hooks look inconsistent, and making them consistent breaks the one
#      that reads a key from the END of the payload. Must kill
#      toolFailureLog_isErrorBeyondPayloadBound_stillLogged.
#
#   4. NO-DRAIN — read_hook_payload stops at the bound without consuming the
#      rest. The hook itself still works, which is exactly why this needs a
#      control: the damage is to the WRITER, which takes EPIPE, and it shows up
#      only because the suite pipes the payload in under `set -o pipefail`. Must
#      kill postToolUse_payloadPastBound_exitsZero. It also kills the truncation
#      notice, because the same `wc -c` both drains and counts — this is the one
#      mutant here with two victims, and it is meant to.
#
#   5. SILENT-TRUNCATION — the stderr notice for a file_path that fell outside
#      the window removed. The bound's blind spot is defensible only while it is
#      audible; this proves the assertion that keeps it so. Must kill
#      postToolUse_filePathBeyondBound_saysSoOnStderr.

# THIS SCRIPT'S OWN PASS CONDITION. A negative control that cannot fail is the
# same vacuous test it exists to prevent, and until #T170 this was one: it ran
# under `set -uo` with no `-e`, printed the mutants' results, and exited 0 on
# whatever they were. Every expectation in the comments above is now checked —
# each mutant must FAIL hook-smoke.sh, and must kill exactly the assertions it
# claims to target — and a mismatch, or any error building a mutant, exits 1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS="$PROJECT_ROOT/.claude/hooks"
WORK="$(mktemp -d)"
# Every mutant is a COPY under $WORK that the suite is pointed at with
# PROJECT_OS_TEST_HOOKS; the repo's own hooks are never edited. The trap is what
# makes that true on the failure paths too.
trap 'rm -rf "$WORK"' EXIT

HOOK_NAMES="_common.sh output-index.sh compact-suggest.sh tool-failure-log.sh post-tool-use.sh session-end-cleanup.sh"

CTL_FAIL=0

# ctl_fail <case> <detail> — the control did not behave as documented. Recorded
# rather than fatal, so one run reports every broken mutant instead of the first.
ctl_fail() {
    CTL_FAIL=$((CTL_FAIL + 1))
    echo "NEGCTL FAIL [$1]: $2"
}

# fatal <case> <detail> — the mutant could not be built or the suite did not
# run. Nothing downstream means anything after this, so stop.
fatal() {
    echo "NEGCTL ERROR [$1]: $2"
    exit 1
}

oneline() { printf '%s' "$1" | tr '\n' ' '; }

# failed_names <log> — names of the assertions that failed, deduped. hook-smoke
# prints each FAIL twice (inline, then in its summary), so `sort -u` is load
# bearing rather than cosmetic.
failed_names() {
    grep '^  FAIL: ' "$1" | sed 's/^  FAIL: //; s/ — .*$//' | sort -u || true
}

# passed_names <log> — names of the assertions that survived.
passed_names() {
    grep '^  PASS: ' "$1" | sed 's/^  PASS: //; s/ — .*$//' | sort -u || true
}

# check_suite_ran <case> <log> — a mutant that crashes the suite before it
# reports would otherwise read as "everything was killed".
check_suite_ran() {
    if ! grep -q '^=== Results ===' "$2"; then
        echo "--- last 20 lines of the run ---"
        tail -n 20 "$2"
        fatal "$1" "hook-smoke.sh never reached its summary — the run itself broke"
    fi
}

# ── Mutant 1: stubs ─────────────────────────────────────────────────────────
STUB="$WORK/stub"
mkdir -p "$STUB"
for h in $HOOK_NAMES; do
    printf '#!/bin/bash\nexit 0\n' > "$STUB/$h"
done

# The survivors the header licenses: liveness (`_exitsZero`) and the negative
# assertions, which a hook that does nothing at all trivially satisfies. Any
# other survivor is an assertion that names an EFFECT and passed against a stub,
# which is the exact defect this file exists to catch.
STUB_SURVIVORS_OK='_(exitsZero|notOnStdout|doesNotIndex|noHint|indexerNeverInvoked|emitsNothing|doesNotLogOutput|writesNothing|noSideEffect|deliberatelyKept|notPruned|nothingDeleted[A-Za-z]*|doesNotCreateOne)$'

echo "=== mutant 1: all hooks stubbed to \`exit 0\` ==="
STUB_STATUS=0
PROJECT_OS_TEST_HOOKS="$STUB" bash "$SCRIPT_DIR/hook-smoke.sh" > "$WORK/stub.out" 2>&1 || STUB_STATUS=$?
echo "exit: $STUB_STATUS"
check_suite_ran "mutant 1" "$WORK/stub.out"
echo "--- surviving assertions (must all be _exitsZero / liveness / negative) ---"
passed_names "$WORK/stub.out"
echo "--- killed ---"
failed_names "$WORK/stub.out"
if [ "$STUB_STATUS" -eq 0 ]; then
    ctl_fail "mutant 1" "hook-smoke.sh PASSED against hooks that do nothing at all"
fi
STUB_UNEXPECTED="$(passed_names "$WORK/stub.out" | grep -Ev "$STUB_SURVIVORS_OK" || true)"
if [ -n "$STUB_UNEXPECTED" ]; then
    ctl_fail "mutant 1" "effect assertions survived the stubs: $(oneline "$STUB_UNEXPECTED")"
fi
if [ -z "$(failed_names "$WORK/stub.out")" ]; then
    ctl_fail "mutant 1" "the stubs killed no assertion at all"
fi
echo ""

# ── Shared mutant plumbing ──────────────────────────────────────────────────
# build_mutant <dir> — copies the real hooks; the caller then edits one.
build_mutant() {
    local dir="$1" h
    mkdir -p "$dir"
    for h in $HOOK_NAMES; do
        cp "$HOOKS/$h" "$dir/$h"
    done
}

# run_mutant <label> <dir> <expected-victim>... — runs the suite against the
# mutant and holds it to both halves of the contract: the suite must FAIL, and
# it must kill EXACTLY the named assertions. More than the target means the
# mutant isolates nothing; fewer means the sabotage did not bite.
run_mutant() {
    local label="$1" dir="$2"
    shift 2
    local log="$dir.out" status=0 expected actual
    echo "=== $label ==="
    PROJECT_OS_TEST_HOOKS="$dir" bash "$SCRIPT_DIR/hook-smoke.sh" > "$log" 2>&1 || status=$?
    echo "exit: $status"
    echo "--- killed (expect exactly: $*) ---"
    failed_names "$log"
    check_suite_ran "$label" "$log"
    if [ "$status" -eq 0 ]; then
        ctl_fail "$label" "hook-smoke.sh PASSED against this mutant — it proves nothing"
    fi
    expected="$(printf '%s\n' "$@" | sort -u)"
    actual="$(failed_names "$log")"
    if [ "$expected" != "$actual" ]; then
        ctl_fail "$label" "killed [$(oneline "$actual")] — expected exactly [$(oneline "$expected")]"
    fi
    echo ""
}

# ── Mutant 2: post-tool-use.sh without payload-path conversion ──────────────
RAW="$WORK/rawpath"
build_mutant "$RAW"
# Revert the one line under test.
sed -i 's|^FILE=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")$|FILE=$(extract_file_path "$INPUT")|' "$RAW/post-tool-use.sh"
# The guard looks for the CODE line, not the identifier: the fix ships with a
# comment explaining itself, and grepping the bare name matched that comment and
# reported an applied mutant as unapplied.
if grep -q '^FILE=.*canonicalize_payload_path' "$RAW/post-tool-use.sh"; then
    fatal "mutant 2" "NOT APPLIED — the conversion line was not reverted"
fi

run_mutant "mutant 2: post-tool-use.sh takes the payload path unconverted" \
    "$RAW" "postToolUse_backslashPayloadPath_stillResolved"

# ── Mutants 3-5: the #T148 payload bound ────────────────────────────────────
BOUND="$WORK/unified-bound"
build_mutant "$BOUND"
# The tidying pass, in its smallest honest form: the streaming grep replaced by
# a bounded read of the same payload. It does not call read_hook_payload — that
# would need _common.sh sourced earlier than this hook sources it, and the
# mutant should differ from the original in one dimension, not two.
sed -i 's|^FACTS=$(grep -aoE.*|FACTS=$(head -c "${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144}")|' \
    "$BOUND/tool-failure-log.sh"
if grep -q 'FACTS=$(grep -aoE' "$BOUND/tool-failure-log.sh"; then
    fatal "mutant 3" "NOT APPLIED — the streaming read is still there"
fi
run_mutant "mutant 3: tool-failure-log.sh uses a bounded read" \
    "$BOUND" "toolFailureLog_isErrorBeyondPayloadBound_stillLogged"

NODRAIN="$WORK/no-drain"
build_mutant "$NODRAIN"
# Drop the `wc -c` that consumes the remainder. It also reports the count, so
# this mutant necessarily takes the truncation flag with it — it kills TWO
# assertions, and that is stated rather than papered over.
sed -i 's|^    rest=$(wc -c 2>/dev/null.*|    rest=0|' "$NODRAIN/_common.sh"
# Anchored to the CODE line. `wc -c` also appears in the comment above it
# explaining why the drain is there, and grepping the bare command reported an
# applied mutant as unapplied — the same way mutant 2's guard did before it was
# anchored.
if grep -q '^    rest=$(wc -c' "$NODRAIN/_common.sh"; then
    fatal "mutant 4" "NOT APPLIED — the drain is still there"
fi
# Two victims, for the reason stated at the top: the same `wc -c` both drains
# and counts, so removing it takes the truncation notice with it.
run_mutant "mutant 4: read_hook_payload does not drain the remainder" \
    "$NODRAIN" "postToolUse_payloadPastBound_exitsZero" \
    "postToolUse_filePathBeyondBound_saysSoOnStderr"

SILENT="$WORK/silent-truncation"
build_mutant "$SILENT"
sed -i '/post-tool-use: payload exceeded/d' "$SILENT/post-tool-use.sh"
if grep -q 'not formatting' "$SILENT/post-tool-use.sh"; then
    fatal "mutant 5" "NOT APPLIED — the notice is still there"
fi
run_mutant "mutant 5: truncated file_path degrades silently" \
    "$SILENT" "postToolUse_filePathBeyondBound_saysSoOnStderr"

# ── Verdict ─────────────────────────────────────────────────────────────────
echo "=== negative control ==="
if [ "$CTL_FAIL" -gt 0 ]; then
    echo "  $CTL_FAIL check(s) failed — see the NEGCTL FAIL lines above."
    echo "  Either hook-smoke.sh lost an assertion, or a mutant no longer applies."
    exit 1
fi
echo "  all 5 mutants behaved as documented — hook-smoke.sh detects broken hooks"
exit 0
