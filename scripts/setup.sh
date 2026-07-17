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
#   bash scripts/setup.sh --adopt    # verbose: install hooks in quarantine mode
#                                    #   (--no-chain — see install-hooks.sh); used by
#                                    #   the adopt-existing-project flow so a hostile
#                                    #   pre-existing hook is never chained/invoked

set -uo pipefail

MODE="verbose"
ADOPT=0
for arg in "$@"; do
    case "$arg" in
        --check) MODE="check" ;;
        --adopt) ADOPT=1 ;;
    esac
done

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
    # Gate on the exact installer marker, never a substring a hostile
    # pre-existing hook could spoof in a comment (e.g. "security-scanner.ts
    # scan-staged"). In --adopt mode the gate is bypassed entirely: always
    # delegate to install-hooks.sh, whose marker-based rename logic is
    # idempotent and performs the quarantine — a spoofed hook must still be
    # renamed and replaced, never skipped.
    ALREADY_INSTALLED=0
    if [ -f "$HOOK" ] && grep -q "Auto-installed by Project OS security scanner" "$HOOK" 2>/dev/null; then
        ALREADY_INSTALLED=1
    fi
    if [ "$ADOPT" -eq 0 ] && [ "$ALREADY_INSTALLED" -eq 1 ]; then
        say "Git hooks: already installed."
    else
        # --adopt: pass --no-chain so a pre-existing (possibly hostile) hook is
        # quarantined to <hook>.pre-adopt and never invoked, instead of the
        # default <hook>.local auto-chain. INSTALL_HOOKS_FLAG is always either
        # empty or a single no-space flag, so the unquoted expansion below is safe.
        INSTALL_HOOKS_FLAG=""
        if [ "$ADOPT" -eq 1 ]; then INSTALL_HOOKS_FLAG="--no-chain"; fi
        if bash "$ROOT/scripts/install-hooks.sh" $INSTALL_HOOKS_FLAG >/dev/null 2>&1; then
            notice "Project OS: installed git pre-commit/pre-push hooks (secret scanner + map auto-heal)."
            DID_SOMETHING=1
        else
            warn "Could not install git hooks (install-hooks.sh failed) — run it manually: bash scripts/install-hooks.sh"
        fi
    fi
elif [ -f "$ROOT/.git" ]; then
    # Linked git worktree (.git is a pointer FILE, not a directory): hooks live
    # in — and are shared from — the main repository's .git/hooks, so there is
    # nothing to install here. Silent: agent worktree sessions hit this on
    # every SessionStart and must not accumulate warning noise.
    say "Git hooks: linked worktree — shared with the main repository, nothing to install."
else
    # Truly not a git repo. In --check mode (SessionStart fallback) stay quiet:
    # a scratch/exported copy shouldn't warn on every session. In verbose mode
    # (explicit setup run) tell the user what to do.
    if [ "$MODE" = "verbose" ]; then
        warn "Not a git repository — skipped git-hook install. Run 'git init' then: bash scripts/setup.sh"
    fi
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
