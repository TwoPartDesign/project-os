#!/bin/bash
# Smoke tests for scripts/lib/dashboard-render.ts
# Runs the node:test suite in tests/dashboard-render.test.ts and reports PASS/FAIL.
# Usage: bash tests/dashboard-smoke.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Dashboard Render Smoke Tests ==="
echo ""

OUTPUT=""
EXIT_CODE=0
OUTPUT="$(cd "$PROJECT_ROOT" && node --test tests/dashboard-render.test.ts 2>&1)" || EXIT_CODE=$?

echo "$OUTPUT"
echo ""

# node --test prints a summary line: "ℹ pass N" / "ℹ fail N" (older versions use "# pass N")
PASS_COUNT="$(echo "$OUTPUT" | grep -E "^(ℹ|#) pass " | grep -oE "[0-9]+" || echo "0")"
FAIL_COUNT="$(echo "$OUTPUT" | grep -E "^(ℹ|#) fail " | grep -oE "[0-9]+" || echo "0")"

echo "=== Results ==="
echo "  PASS: ${PASS_COUNT:-0}"
echo "  FAIL: ${FAIL_COUNT:-0}"

if [ "$EXIT_CODE" -ne 0 ] || [ "${FAIL_COUNT:-0}" != "0" ]; then
    echo ""
    echo "Smoke test FAILED (node --test exit code: $EXIT_CODE)"
    exit 1
fi

echo ""
echo "Smoke test PASSED"
exit 0
