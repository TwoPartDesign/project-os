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

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS="$PROJECT_ROOT/.claude/hooks"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

HOOK_NAMES="_common.sh output-index.sh compact-suggest.sh tool-failure-log.sh post-tool-use.sh session-end-cleanup.sh"

# ── Mutant 1: stubs ─────────────────────────────────────────────────────────
STUB="$WORK/stub"
mkdir -p "$STUB"
for h in $HOOK_NAMES; do
    printf '#!/bin/bash\nexit 0\n' > "$STUB/$h"
done

echo "=== mutant 1: all hooks stubbed to \`exit 0\` ==="
PROJECT_OS_TEST_HOOKS="$STUB" bash "$SCRIPT_DIR/hook-smoke.sh" > "$WORK/stub.out" 2>&1
echo "exit: $?"
grep -c '^  PASS' "$WORK/stub.out"
echo "--- surviving assertions (must all be _exitsZero / liveness) ---"
grep '^  PASS' "$WORK/stub.out"
echo "--- killed ---"
grep '^  FAIL' "$WORK/stub.out"
echo ""

# ── Mutant 2: post-tool-use.sh without payload-path conversion ──────────────
RAW="$WORK/rawpath"
mkdir -p "$RAW"
for h in $HOOK_NAMES; do
    cp "$HOOKS/$h" "$RAW/$h"
done
# Revert the one line under test.
sed -i 's|^FILE=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")$|FILE=$(extract_file_path "$INPUT")|' "$RAW/post-tool-use.sh"
# The guard looks for the CODE line, not the identifier: the fix ships with a
# comment explaining itself, and grepping the bare name matched that comment and
# reported an applied mutant as unapplied.
if grep -q '^FILE=.*canonicalize_payload_path' "$RAW/post-tool-use.sh"; then
    echo "MUTANT 2 NOT APPLIED — the conversion line was not reverted"
    exit 1
fi

echo "=== mutant 2: post-tool-use.sh takes the payload path unconverted ==="
PROJECT_OS_TEST_HOOKS="$RAW" bash "$SCRIPT_DIR/hook-smoke.sh" > "$WORK/raw.out" 2>&1
echo "exit: $?"
echo "--- killed (expect exactly postToolUse_backslashPayloadPath_stillResolved) ---"
grep '^  FAIL' "$WORK/raw.out"
echo ""

# ── Mutants 3-5: the #T148 payload bound ────────────────────────────────────
# build_mutant <dir> — copies the real hooks; the caller then edits one.
build_mutant() {
    local dir="$1" h
    mkdir -p "$dir"
    for h in $HOOK_NAMES; do
        cp "$HOOKS/$h" "$dir/$h"
    done
}

# run_mutant <label> <dir> <expected-victim>
run_mutant() {
    local label="$1" dir="$2" victim="$3"
    echo "=== $label ==="
    PROJECT_OS_TEST_HOOKS="$dir" bash "$SCRIPT_DIR/hook-smoke.sh" > "$dir.out" 2>&1
    echo "exit: $?"
    echo "--- killed (expect exactly $victim) ---"
    grep '^  FAIL' "$dir.out"
    echo ""
}

BOUND="$WORK/unified-bound"
build_mutant "$BOUND"
# The tidying pass, in its smallest honest form: the streaming grep replaced by
# a bounded read of the same payload. It does not call read_hook_payload — that
# would need _common.sh sourced earlier than this hook sources it, and the
# mutant should differ from the original in one dimension, not two.
sed -i 's|^FACTS=$(grep -aoE.*|FACTS=$(head -c "${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144}")|' \
    "$BOUND/tool-failure-log.sh"
if grep -q 'FACTS=$(grep -aoE' "$BOUND/tool-failure-log.sh"; then
    echo "MUTANT 3 NOT APPLIED — the streaming read is still there"
    exit 1
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
    echo "MUTANT 4 NOT APPLIED — the drain is still there"
    exit 1
fi
run_mutant "mutant 4: read_hook_payload does not drain the remainder" \
    "$NODRAIN" "postToolUse_payloadPastBound_exitsZero + the truncation notice"

SILENT="$WORK/silent-truncation"
build_mutant "$SILENT"
sed -i '/post-tool-use: payload exceeded/d' "$SILENT/post-tool-use.sh"
if grep -q 'not formatting' "$SILENT/post-tool-use.sh"; then
    echo "MUTANT 5 NOT APPLIED — the notice is still there"
    exit 1
fi
run_mutant "mutant 5: truncated file_path degrades silently" \
    "$SILENT" "postToolUse_filePathBeyondBound_saysSoOnStderr"
