#!/usr/bin/env bash
# scripts/setup.sh — idempotent Project OS activation.
#
# Runs the required one-time setup for a Project OS working copy:
#   1. installs the git pre-commit/pre-push hooks (secret scanner + system-map
#      auto-heal) — these live in .git/hooks and are NOT carried by `git clone`;
#   2. generates the initial system map (docs/maps/) if it is missing.
#
# It is safe to run any number of times: already-installed hooks and an
# existing map are left untouched. It never exits non-zero for a "can't set up
# yet" condition (missing Node, not a git repo) — it warns and continues — so
# it is safe to call from a SessionStart hook without ever breaking a session.
#
# Usage:
#   bash scripts/setup.sh            # verbose: report every step
#   bash scripts/setup.sh --check    # quiet: act only when something is missing
#                                    #   (used by the SessionStart fallback hook)

set -uo pipefail

MODE="verbose"
if [ "${1:-}" = "--check" ]; then MODE="check"; fi

# Resolve project root: explicit override (tests) or walk up to a .claude dir.
resolve_root() {
    if [ -n "${PROJECT_OS_ROOT:-}" ]; then
        printf '%s' "$PROJECT_OS_ROOT"
        return 0
    fi
    local dir
    dir="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
    local i=0
    while [ "$i" -lt 10 ]; do
        if [ -d "$dir/.claude" ]; then
            printf '%s' "$dir"
            return 0
        fi
        local parent
        parent="$(dirname "$dir")"
        [ "$parent" = "$dir" ] && break
        dir="$parent"
        i=$((i + 1))
    done
    printf '%s' "$(pwd)"
}

ROOT="$(resolve_root)"

say() { [ "$MODE" = "verbose" ] && printf '%s\n' "$1"; return 0; }
notice() { printf '%s\n' "$1"; }   # always shown, even in --check mode
warn() { printf 'WARN: %s\n' "$1" >&2; }

DID_SOMETHING=0

# --- Node availability ---------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    warn "Node.js not found in PATH — the TypeScript tooling (security scanner, knowledge index, system map, dashboard) is inactive. Install Node 22.18+ and re-run: bash scripts/setup.sh"
    say "Setup: skipped Node-dependent steps (no Node)."
    exit 0
fi

# --- Git hooks -----------------------------------------------------------------
if [ -d "$ROOT/.git" ]; then
    HOOK="$ROOT/.git/hooks/pre-commit"
    if [ -f "$HOOK" ] && grep -q "security-scanner.ts scan-staged" "$HOOK" 2>/dev/null; then
        say "Git hooks: already installed."
    else
        if bash "$ROOT/scripts/install-hooks.sh" >/dev/null 2>&1; then
            notice "Project OS: installed git pre-commit/pre-push hooks (secret scanner + map auto-heal)."
            DID_SOMETHING=1
        else
            warn "Could not install git hooks (install-hooks.sh failed) — run it manually: bash scripts/install-hooks.sh"
        fi
    fi
else
    warn "Not a git repository — skipped git-hook install. Run 'git init' then: bash scripts/setup.sh"
fi

# --- Initial system map --------------------------------------------------------
if [ -f "$ROOT/scripts/system-map.ts" ]; then
    if [ -f "$ROOT/docs/maps/.maps.lock" ]; then
        say "System map: present."
    else
        if (cd "$ROOT" && node scripts/system-map.ts generate >/dev/null 2>&1); then
            notice "Project OS: generated the initial system map (docs/maps/)."
            DID_SOMETHING=1
        else
            warn "Could not generate the system map — run manually: node scripts/system-map.ts generate"
        fi
    fi
fi

if [ "$MODE" = "verbose" ]; then
    if [ "$DID_SOMETHING" -eq 1 ]; then
        say "Project OS setup complete."
    else
        say "Project OS already set up — nothing to do."
    fi
fi
exit 0
