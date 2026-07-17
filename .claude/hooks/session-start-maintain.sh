#!/usr/bin/env bash
# session-start-maintain.sh — SessionStart auto-run of the maintenance loop.
#
# Trigger design: milestone + interval hybrid — the loop runs at the start of
# the FIRST session after `auto_run_hours` (policy, default 24) have elapsed
# since the last run (manual or automatic; the debounce reads the ledger's
# age, so a manual sweep also resets the clock). Rationale: a pure timer runs
# when nobody is working; session start is the moment results are actionable.
#
# No confirmation gate, by design: the loop can only file `[?]` drafts that
# wait for /pm:approve — detection is harmless, and the consequential step
# (promotion) is already human-gated. The cadence itself is policy-owned:
# set `auto_run_hours: 0` in .claude/maintenance-policy.yaml to disable
# auto-runs entirely (manual runs are unaffected).
#
# Guards: main working copies only (linked worktrees, where .git is a pointer
# file, and non-repos skip silently — agent sessions must not file drafts
# into worktree ROADMAP copies). Never fails a session: always exits 0.
# When drafts are filed, the notice printed to stdout enters the session
# context, so autonomous filings are always visible.

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PROJECT_OS_ROOT:-$(cd "$HOOK_DIR/../.." && pwd)}"

# Main-repo guard: .git must be a real directory (worktrees have a file).
if [ ! -d "$ROOT/.git" ]; then exit 0; fi
if [ ! -f "$ROOT/scripts/maintain.sh" ]; then exit 0; fi

# Cadence from the human-owned policy file (0 disables; malformed -> default).
AUTO_HOURS=24
POLICY="$ROOT/.claude/maintenance-policy.yaml"
if [ -f "$POLICY" ]; then
    val=$(grep -E '^auto_run_hours:' "$POLICY" 2>/dev/null | head -n1 | sed -E 's/^auto_run_hours:[[:space:]]*//' | tr -d '[:space:]')
    case "$val" in
        '' | *[!0-9]*) : ;;
        *) AUTO_HOURS="$val" ;;
    esac
fi
if [ "$AUTO_HOURS" -eq 0 ]; then exit 0; fi

# Debounce: skip if the ledger was written within the window. A missing
# ledger means the loop has never run here -> run now.
LEDGER="$ROOT/.claude/logs/maintenance-ledger.jsonl"
if [ -f "$LEDGER" ]; then
    recent="$(find "$LEDGER" -mmin -$((AUTO_HOURS * 60)) 2>/dev/null || true)"
    if [ -n "$recent" ]; then exit 0; fi
fi

OUT="$(bash "$ROOT/scripts/maintain.sh" 2>/dev/null || true)"
NOTICE="$(printf '%s\n' "$OUT" | grep '^maintain: filed' || true)"
if [ -n "$NOTICE" ]; then
    echo "Project OS maintenance auto-run: ${NOTICE#maintain: }"
fi

exit 0
