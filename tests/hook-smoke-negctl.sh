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
