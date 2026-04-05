#!/usr/bin/env bash
# Install git hooks for the Project OS security scanner.
# Usage: bash scripts/install-hooks.sh

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required but not found in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(dirname "$0")"

echo "Validating scanner rules..."
node "$SCRIPT_DIR/security-scanner.ts" test-rules --quiet
echo "Rules OK."

echo "Installing git hooks..."
node "$SCRIPT_DIR/security-scanner.ts" install-hooks
