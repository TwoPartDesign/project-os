#!/bin/bash
# Smoke tests for PostToolUse hooks
# Verifies each hook exits 0 on valid input and doesn't crash on edge cases.
# Usage: bash tests/hook-smoke.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.claude/hooks"

PASS=0
FAIL=0
ERRORS=""

run_test() {
    local name="$1"
    local hook="$2"
    local input="$3"
    local expect_exit="${4:-0}"

    local actual_exit=0
    echo "$input" | bash "$hook" >/dev/null 2>&1 || actual_exit=$?

    if [ "$actual_exit" -eq "$expect_exit" ]; then
        PASS=$((PASS + 1))
        echo "  PASS: $name"
    else
        FAIL=$((FAIL + 1))
        ERRORS="${ERRORS}\n  FAIL: $name (expected exit $expect_exit, got $actual_exit)"
        echo "  FAIL: $name (expected exit $expect_exit, got $actual_exit)"
    fi
}

# Minimal valid PostToolUse JSON payloads
VALID_READ='{"tool_name":"Read","arguments":{"file_path":"/tmp/test.txt"},"output":"hello world","is_error":false}'
VALID_BASH='{"tool_name":"Bash","arguments":{"command":"echo hi"},"output":"hi","is_error":false}'
VALID_GREP='{"tool_name":"Grep","arguments":{"pattern":"test"},"output":"match","is_error":false}'
VALID_WRITE='{"tool_name":"Write","arguments":{"file_path":"/tmp/test.txt"},"output":"ok","is_error":false}'
VALID_ERROR='{"tool_name":"Bash","arguments":{"command":"false"},"output":"failed","is_error":true}'
EMPTY_INPUT='{}'
INVALID_JSON='not json at all'

echo "=== Hook Smoke Tests ==="
echo ""

# --- output-index.sh ---
echo "output-index.sh:"
# Disable context filtering to test the early-exit path
CONTEXT_FILTER_DISABLED=1 run_test \
    "disabled_contextFilter_exitsCleanly" \
    "$HOOKS_DIR/output-index.sh" \
    "$VALID_READ"

# With filtering enabled but small output (under threshold)
run_test \
    "smallOutput_underThreshold_exitsCleanly" \
    "$HOOKS_DIR/output-index.sh" \
    "$VALID_READ"

run_test \
    "emptyJson_exitsCleanly" \
    "$HOOKS_DIR/output-index.sh" \
    "$EMPTY_INPUT"

run_test \
    "invalidJson_exitsCleanly" \
    "$HOOKS_DIR/output-index.sh" \
    "$INVALID_JSON"

echo ""

# --- compact-suggest.sh ---
echo "compact-suggest.sh:"
run_test \
    "validInput_exitsCleanly" \
    "$HOOKS_DIR/compact-suggest.sh" \
    "$VALID_READ"

run_test \
    "emptyJson_exitsCleanly" \
    "$HOOKS_DIR/compact-suggest.sh" \
    "$EMPTY_INPUT"

echo ""

# --- tool-failure-log.sh ---
echo "tool-failure-log.sh:"
run_test \
    "nonError_exitsCleanly" \
    "$HOOKS_DIR/tool-failure-log.sh" \
    "$VALID_READ"

run_test \
    "isError_logsAndExitsCleanly" \
    "$HOOKS_DIR/tool-failure-log.sh" \
    "$VALID_ERROR"

run_test \
    "invalidJson_exitsCleanly" \
    "$HOOKS_DIR/tool-failure-log.sh" \
    "$INVALID_JSON"

echo ""

# --- post-tool-use.sh ---
echo "post-tool-use.sh:"
run_test \
    "validWrite_exitsCleanly" \
    "$HOOKS_DIR/post-tool-use.sh" \
    "$VALID_WRITE"

run_test \
    "emptyJson_exitsCleanly" \
    "$HOOKS_DIR/post-tool-use.sh" \
    "$EMPTY_INPUT"

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
