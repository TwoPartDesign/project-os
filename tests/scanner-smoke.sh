#!/bin/bash
# Smoke tests for scripts/security-scanner.ts
# Verifies the rule set compiles and the built-in regression tests pass.
# Usage: bash tests/scanner-smoke.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCANNER="$PROJECT_ROOT/scripts/security-scanner.ts"

PASS=0
FAIL=0
ERRORS=""

run_test() {
    local name="$1"
    local expect_exit="$2"
    shift 2

    local actual_exit=0
    local output=""
    output="$("$@" 2>&1)" || actual_exit=$?

    if [ "$actual_exit" -eq "$expect_exit" ]; then
        PASS=$((PASS + 1))
        echo "  PASS: $name"
    else
        FAIL=$((FAIL + 1))
        ERRORS="${ERRORS}\n  FAIL: $name (expected exit $expect_exit, got $actual_exit)\n$output"
        echo "  FAIL: $name (expected exit $expect_exit, got $actual_exit)"
    fi
}

echo "=== Scanner Smoke Tests ==="
echo ""

# --- test-rules subcommand ---
echo "security-scanner.ts test-rules:"

run_test \
    "testRules_ruleSetLoads_exitsZero" \
    0 \
    node "$SCANNER" test-rules

# Capture output separately to assert on content (no "0 failed" -> at least one
# regex threw or a regression test's expected match/no-match assertion failed).
TEST_RULES_OUTPUT="$(node "$SCANNER" test-rules 2>&1)"

if echo "$TEST_RULES_OUTPUT" | grep -q ", 0 failed,"; then
    PASS=$((PASS + 1))
    echo "  PASS: testRules_regressionSuite_zeroFailures"
else
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  FAIL: testRules_regressionSuite_zeroFailures\n$TEST_RULES_OUTPUT"
    echo "  FAIL: testRules_regressionSuite_zeroFailures"
fi

if echo "$TEST_RULES_OUTPUT" | grep -qE "^(SyntaxError|.*Invalid regular expression)"; then
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  FAIL: testRules_noUncaughtRegexError_none\n$TEST_RULES_OUTPUT"
    echo "  FAIL: testRules_noUncaughtRegexError_none"
else
    PASS=$((PASS + 1))
    echo "  PASS: testRules_noUncaughtRegexError_none"
fi

echo ""

# --- list-rules subcommand (sanity: rule set is well-formed and enumerable) ---
echo "security-scanner.ts list-rules:"

run_test \
    "listRules_ruleSetLoads_exitsZero" \
    0 \
    node "$SCANNER" list-rules

echo ""

# --- Summary ---
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    echo -e "$ERRORS"
    exit 1
fi

exit 0
