#!/usr/bin/env bash
# session-start-setup.sh — SessionStart fallback for Project OS activation.
#
# git hooks (.git/hooks/) are NOT carried by `git clone`, so a project cloned
# rather than created via new-project.sh starts with the secret scanner and
# system-map auto-heal dormant. This hook runs the idempotent setup in --check
# mode when a session starts, installing the git hooks (and generating the map
# if absent) the first time — the "fallback if the repo is cloned without the
# new-project tool call". It is quiet when everything is already in place and
# never fails a session (setup.sh --check always exits 0).

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .claude/hooks -> project root
ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

if [ -f "$ROOT/scripts/setup.sh" ]; then
    bash "$ROOT/scripts/setup.sh" --check || true
fi

exit 0
