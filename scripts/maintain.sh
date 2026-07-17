#!/usr/bin/env bash
# scripts/maintain.sh — Deterministic, LLM-free autonomous maintenance loop.
#
# Runs five read-only checks (map, staleness, failures, consolidation,
# search-miss) against the project's operational state and files at most one
# fingerprinted `[?]` draft task per check via `scripts/maintain-draft.ts` —
# the loop's ONLY writer. Never promotes or edits an existing ROADMAP task.
# Appends one ledger line per run to `.claude/logs/maintenance-ledger.jsonl`.
#
# Usage:
#   bash scripts/maintain.sh [--dry-run]
#
# --dry-run: prints what would be filed; writes nothing (no ledger, no
#            drafts). The lock is still taken and released.
#
# Env:
#   PROJECT_OS_ROOT   Override the project root (used by tests to point the
#                     loop at a fixture project instead of walking up from
#                     this script's own directory).
#
# Exit: always 0 on a completed or gracefully-skipped run (lock contention,
# unavailable checks). Nonzero only on a genuine script bug.
#
# Design: docs/specs/self-maintenance/design.md — "Data Model" + "Security
# Considerations" sections.

set -euo pipefail

# ==========================================================================
# Paths
# ==========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_FOR_RELATIVE="$(dirname "$SCRIPT_DIR")"
MAINTAIN_DRAFT_SCRIPT="$SCRIPT_DIR/maintain-draft.ts"

# Walk up from SCRIPT_DIR to the nearest ancestor containing `.claude`.
# Mirrors getProjectRoot() in knowledge-index.ts / maintain-draft.ts /
# system-map.ts, but in bash (no PROJECT_OS_ROOT awareness there).
default_root() {
    local dir="$SCRIPT_DIR"
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if [ -d "$dir/.claude" ]; then
            printf '%s' "$dir"
            return 0
        fi
        local parent
        parent="$(dirname "$dir")"
        if [ "$parent" = "$dir" ]; then
            break
        fi
        dir="$parent"
    done
    printf '%s' "$SCRIPT_DIR"
}

OVERRIDE_MODE=0
if [ -n "${PROJECT_OS_ROOT:-}" ]; then
    OVERRIDE_MODE=1
fi
ROOT="${PROJECT_OS_ROOT:-$(default_root)}"

LOG_DIR="$ROOT/.claude/logs"
LEDGER_FILE="$LOG_DIR/maintenance-ledger.jsonl"
LOCK_DIR="$ROOT/.claude/maintenance-lock"
POLICY_FILE="$ROOT/.claude/maintenance-policy.yaml"

DRY_RUN=0
for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=1
    fi
done

mkdir -p "$LOG_DIR"

# ==========================================================================
# Small utilities
# ==========================================================================

# JSON-escape a string (backslash + double-quote only — our own generated
# strings never contain control characters worth preserving here).
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    printf '%s' "$s"
}

# Join args with a separator (no trailing/leading separator).
join_with() {
    local sep="$1"
    shift
    local IFS="$sep"
    printf '%s' "$*"
}

# Render a bash array as a JSON string array.
join_json_array() {
    local out="["
    local first=1
    local item
    for item in "$@"; do
        if [ "$first" -eq 1 ]; then
            first=0
        else
            out+=","
        fi
        out+="\"$(json_escape "$item")\""
    done
    out+="]"
    printf '%s' "$out"
}

# ==========================================================================
# Ledger (inline 10-line rotation — do NOT source .claude/hooks/_common.sh,
# which is scoped to hooks; this loop carries its own copy per design review)
# ==========================================================================

rotate_ledger() {
    [ -f "$LEDGER_FILE" ] || return 0
    local size
    size=$(wc -c <"$LEDGER_FILE" 2>/dev/null | tr -d ' ')
    case "$size" in
        *[!0-9]* | "") return 0 ;;
    esac
    if [ "$size" -gt 1048576 ]; then
        mv -f "$LEDGER_FILE" "${LEDGER_FILE}.old" 2>/dev/null || true
    fi
    return 0
}

# Appends one raw JSON line to the ledger. No-ops entirely under --dry-run.
ledger_line() {
    local json="$1"
    [ "$DRY_RUN" -eq 1 ] && return 0
    rotate_ledger
    printf '%s\n' "$json" >>"$LEDGER_FILE"
}

ledger_skip_unavailable() {
    local check="$1"
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ledger_line "{\"timestamp\":\"${ts}\",\"check\":\"$(json_escape "$check")\",\"skipped\":\"unavailable\"}"
}

ledger_note() {
    local check="$1" note="$2"
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ledger_line "{\"timestamp\":\"${ts}\",\"check\":\"$(json_escape "$check")\",\"note\":\"$(json_escape "$note")\"}"
}

# ==========================================================================
# Lock — atomic mkdir, 1h stale reclaim, trap-based release
# ==========================================================================

LOCK_ACQUIRED=0

release_lock() {
    if [ "$LOCK_ACQUIRED" -eq 1 ]; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
}
trap release_lock EXIT

attempt_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        LOCK_ACQUIRED=1
        return 0
    fi
    return 1
}

is_lock_stale() {
    [ -d "$LOCK_DIR" ] || return 1
    local hit
    hit="$(find "$LOCK_DIR" -maxdepth 0 -mmin +60 2>/dev/null || true)"
    [ -n "$hit" ]
}

if ! attempt_lock; then
    if is_lock_stale; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
        attempt_lock || true
    fi
fi

if [ "$LOCK_ACQUIRED" -ne 1 ]; then
    if [ "$DRY_RUN" -ne 1 ]; then
        ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        ledger_line "{\"timestamp\":\"${ts}\",\"skipped\":\"lock-held\"}"
    fi
    exit 0
fi

# ==========================================================================
# Policy (flat key: value, grep-anchored lookups, no YAML lib)
# ==========================================================================

POLICY_WARNINGS=()

declare -A POLICY_DEFAULTS=(
    [stale_threshold_days]=90
    [max_drafts_per_run]=3
    [failure_draft_threshold]=5
    [consolidation_pressure_files]=12
    [consolidation_pressure_sessions]=40
    [search_miss_threshold]=5
    [bloat_warn_tokens]=2500
)

policy_raw_value() {
    local key="$1"
    [ -f "$POLICY_FILE" ] || {
        printf ''
        return 0
    }
    local line
    line=$(grep -E "^${key}:" "$POLICY_FILE" 2>/dev/null | head -n1) || true
    [ -z "$line" ] && {
        printf ''
        return 0
    }
    local val="${line#*:}"
    val="${val%%#*}"
    val="$(printf '%s' "$val" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    printf '%s' "$val"
}

# Assigns the validated numeric policy value for `key` into the variable
# named by `outvar_name` (bash nameref). NOTE: deliberately NOT invoked via
# `$(...)` — command substitution runs in a subshell, which would silently
# drop any `POLICY_WARNINGS+=(...)` mutation on return.
load_policy_numeric() {
    local key="$1"
    local outvar_name="$2"
    local -n outvar="$outvar_name"
    local default="${POLICY_DEFAULTS[$key]}"
    local raw
    raw="$(policy_raw_value "$key")"
    if [ -z "$raw" ]; then
        outvar="$default"
        return 0
    fi
    if [[ "$raw" =~ ^[0-9]+$ ]]; then
        outvar="$raw"
    else
        POLICY_WARNINGS+=("${key}: invalid value '${raw}', using default ${default}")
        outvar="$default"
    fi
}

STALE_THRESHOLD_DAYS=0
MAX_DRAFTS_PER_RUN=0
FAILURE_DRAFT_THRESHOLD=0
CONSOLIDATION_PRESSURE_FILES=0
CONSOLIDATION_PRESSURE_SESSIONS=0
SEARCH_MISS_THRESHOLD=0
load_policy_numeric stale_threshold_days STALE_THRESHOLD_DAYS
load_policy_numeric max_drafts_per_run MAX_DRAFTS_PER_RUN
load_policy_numeric failure_draft_threshold FAILURE_DRAFT_THRESHOLD
load_policy_numeric consolidation_pressure_files CONSOLIDATION_PRESSURE_FILES
load_policy_numeric consolidation_pressure_sessions CONSOLIDATION_PRESSURE_SESSIONS
load_policy_numeric search_miss_threshold SEARCH_MISS_THRESHOLD

VALID_CHECKS="map staleness failures consolidation search-miss"
DEFAULT_CHECKS="map,staleness,failures,consolidation,search-miss"

checks_raw="$(policy_raw_value checks)"
[ -z "$checks_raw" ] && checks_raw="$DEFAULT_CHECKS"

CHECKS_TO_RUN=()
IFS=',' read -ra _checks_split <<<"$checks_raw"
for c in "${_checks_split[@]}"; do
    c="$(printf '%s' "$c" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -z "$c" ] && continue
    case " $VALID_CHECKS " in
        *" $c "*) CHECKS_TO_RUN+=("$c") ;;
        *) POLICY_WARNINGS+=("checks: unknown check '${c}' ignored") ;;
    esac
done
if [ "${#CHECKS_TO_RUN[@]}" -eq 0 ]; then
    POLICY_WARNINGS+=("checks: no valid checks resolved, using default")
    IFS=',' read -ra CHECKS_TO_RUN <<<"$DEFAULT_CHECKS"
fi

# ==========================================================================
# Last-run timestamp (for time-filtered checks: failures, search-miss).
# Missing ledger = process the whole file (empty LAST_RUN_TS).
# ==========================================================================

LAST_RUN_TS=""
if [ -f "$LEDGER_FILE" ]; then
    _last_line=$(grep '"run_id"' "$LEDGER_FILE" 2>/dev/null | tail -n1) || true
    if [ -n "$_last_line" ]; then
        LAST_RUN_TS=$(printf '%s' "$_last_line" | grep -oE '"timestamp":[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/') || true
    fi
fi

# ==========================================================================
# Findings accumulator
# ==========================================================================

FINDINGS_TITLES=()
FINDINGS_FPS=()

add_finding() {
    FINDINGS_TITLES+=("$1")
    FINDINGS_FPS+=("$2")
}

# ==========================================================================
# Check 1: map — node scripts/system-map.ts (project-local copy; absent in
# template-lagging projects and in test fixtures -> graceful skip)
# ==========================================================================

run_check_map() {
    local script="$ROOT/scripts/system-map.ts"
    if [ ! -f "$script" ]; then
        ledger_skip_unavailable "map"
        return 0
    fi

    local check_out check_ec
    set +e
    check_out=$(cd "$ROOT" && node "scripts/system-map.ts" check 2>&1)
    check_ec=$?
    set -e

    if [ "$check_ec" -eq 1 ]; then
        add_finding "system-map generator failing" "map:generator-error"
        return 0
    fi
    if [ "$check_ec" -eq 3 ]; then
        ledger_note "map" "drift"
    fi

    local report_out report_ec
    set +e
    report_out=$(cd "$ROOT" && node "scripts/system-map.ts" report --json 2>&1)
    report_ec=$?
    set -e

    if [ "$report_ec" -ne 0 ]; then
        ledger_skip_unavailable "map"
        return 0
    fi

    local SEV_ARR SUBJ_ARR
    mapfile -t SEV_ARR < <(printf '%s\n' "$report_out" | grep -oE '"severity":[[:space:]]*"[A-Z]+"' | sed -E 's/.*"([A-Z]+)"$/\1/')
    mapfile -t SUBJ_ARR < <(printf '%s\n' "$report_out" | grep -oE '"subject":[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/')

    local high_subjects=()
    local i
    for i in "${!SEV_ARR[@]}"; do
        if [ "${SEV_ARR[$i]:-}" = "HIGH" ]; then
            high_subjects+=("${SUBJ_ARR[$i]:-}")
        fi
    done

    if [ "${#high_subjects[@]}" -eq 0 ]; then
        return 0
    fi

    local UNIQ_SUBJ
    mapfile -t UNIQ_SUBJ < <(printf '%s\n' "${high_subjects[@]}" | sort -u)
    local top fp
    top="$(join_with ", " "${UNIQ_SUBJ[@]}")"
    fp="$(join_with "," "${UNIQ_SUBJ[@]}")"
    add_finding "readiness: ${#UNIQ_SUBJ[@]} findings — ${top}" "map:${fp}"
}

# ==========================================================================
# Check 2: staleness — node scripts/knowledge-index.ts stale
# ==========================================================================

run_check_staleness() {
    local script="$ROOT/scripts/knowledge-index.ts"
    if [ ! -f "$script" ]; then
        ledger_skip_unavailable "staleness"
        return 0
    fi

    local out ec
    set +e
    out=$(cd "$ROOT" && node "scripts/knowledge-index.ts" stale --threshold "${STALE_THRESHOLD_DAYS}d" 2>&1)
    ec=$?
    set -e

    if [ "$ec" -ne 0 ]; then
        ledger_skip_unavailable "staleness"
        return 0
    fi
    if printf '%s\n' "$out" | grep -q "^Index not found"; then
        ledger_skip_unavailable "staleness"
        return 0
    fi
    if printf '%s\n' "$out" | grep -q "^No stale files"; then
        return 0
    fi

    local NAME_LINES
    # Keep only in-project, repo-relative sources. The knowledge index can hold
    # leaked entries from test runs (e.g. ../../../AppData/Local/Temp/...); those
    # must never reach a committed ROADMAP draft (the "no personal paths in
    # generated docs" constraint). Drop anything absolute or containing "..".
    mapfile -t NAME_LINES < <(printf '%s\n' "$out" | grep -E '^  [^ ]' | sed -E 's/^  //' | grep -vE '(^/|^[A-Za-z]:|\.\.)')
    if [ "${#NAME_LINES[@]}" -eq 0 ]; then
        return 0
    fi

    local SORTED_NAMES
    mapfile -t SORTED_NAMES < <(printf '%s\n' "${NAME_LINES[@]}" | sort -u)
    local names fp
    names="$(join_with ", " "${SORTED_NAMES[@]}")"
    fp="$(join_with "," "${SORTED_NAMES[@]}")"
    add_finding "Review stale knowledge: ${#NAME_LINES[@]} files past ${STALE_THRESHOLD_DAYS}d (${names})" "stale:${fp}"
}

# ==========================================================================
# Check 3: failures — tool-failures.log FAIL lines + activity.jsonl
# task-failed events, filtered to after LAST_RUN_TS (missing ledger = whole
# file)
# ==========================================================================

run_check_failures() {
    local log="$ROOT/.claude/logs/tool-failures.log"
    local activity="$ROOT/.claude/logs/activity.jsonl"
    local -A tool_counts=()

    if [ -f "$log" ]; then
        local line ts tool
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            ts=$(printf '%s' "$line" | grep -oE '^[0-9T:-]+Z' || true)
            if [ -n "$LAST_RUN_TS" ] && [ -n "$ts" ]; then
                if [[ ! "$ts" > "$LAST_RUN_TS" ]]; then
                    continue
                fi
            fi
            tool=$(printf '%s' "$line" | sed -E 's/.*FAIL tool=([A-Za-z0-9_-]+).*/\1/')
            [ -z "$tool" ] && continue
            tool_counts["$tool"]=$((${tool_counts["$tool"]:-0} + 1))
        done <"$log"
    fi

    if [ -f "$activity" ]; then
        local aline ats
        while IFS= read -r aline; do
            [ -z "$aline" ] && continue
            printf '%s' "$aline" | grep -qE '"event":[[:space:]]*"task-failed"' || continue
            ats=$(printf '%s' "$aline" | grep -oE '"timestamp":[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/') || true
            if [ -n "$LAST_RUN_TS" ] && [ -n "$ats" ]; then
                if [[ ! "$ats" > "$LAST_RUN_TS" ]]; then
                    continue
                fi
            fi
            tool_counts["task"]=$((${tool_counts["task"]:-0} + 1))
        done <"$activity"
    fi

    # File one finding per tool at/over threshold, not just the single worst —
    # the ledger timestamp advances every run, so a co-occurring second tool
    # skipped here would be lost permanently, not merely deferred. Sorted for
    # deterministic ordering; the global draft cap still bounds how many land.
    local over_tools=() t
    for t in "${!tool_counts[@]}"; do
        if [ "${tool_counts[$t]}" -ge "$FAILURE_DRAFT_THRESHOLD" ]; then
            over_tools+=("$t")
        fi
    done
    local SORTED_TOOLS
    mapfile -t SORTED_TOOLS < <(printf '%s\n' "${over_tools[@]}" | sort)
    for t in "${SORTED_TOOLS[@]}"; do
        [ -z "$t" ] && continue
        add_finding "Investigate recurring ${t} failures (${tool_counts[$t]} since ${LAST_RUN_TS:-start})" "failures:${t}:${tool_counts[$t]}"
    done
}

# ==========================================================================
# Check 4: consolidation — docs/memory/*.md count + .claude/sessions/*.yaml
# count vs pressure thresholds
# ==========================================================================

run_check_consolidation() {
    local mem_dir="$ROOT/docs/memory"
    local sess_dir="$ROOT/.claude/sessions"
    local mem_count=0 sess_count=0

    if [ -d "$mem_dir" ]; then
        mem_count=$(find "$mem_dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ -d "$sess_dir" ]; then
        sess_count=$(find "$sess_dir" -maxdepth 1 -type f -name '*.yaml' 2>/dev/null | wc -l | tr -d ' ')
    fi

    if [ "$mem_count" -ge "$CONSOLIDATION_PRESSURE_FILES" ] || [ "$sess_count" -ge "$CONSOLIDATION_PRESSURE_SESSIONS" ]; then
        add_finding "Run /tools:dream — ${mem_count} memory files / ${sess_count} session files, consolidation due" "dream:${mem_count}:${sess_count}"
    fi
}

# ==========================================================================
# Check 5: search-miss — zero-result queries in search-log.jsonl since
# LAST_RUN_TS. File absent -> skip silently (no ledger note).
# ==========================================================================

run_check_search_miss() {
    local log="$ROOT/.claude/logs/search-log.jsonl"
    [ -f "$log" ] || return 0

    local ZERO_LINES
    mapfile -t ZERO_LINES < <(grep -F '"result_count":0' "$log")
    if [ "${#ZERO_LINES[@]}" -eq 0 ]; then
        return 0
    fi

    local queries=() count=0 line ts q
    for line in "${ZERO_LINES[@]}"; do
        [ -z "$line" ] && continue
        ts=$(printf '%s' "$line" | grep -oE '"timestamp":[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/') || true
        if [ -n "$LAST_RUN_TS" ] && [ -n "$ts" ]; then
            if [[ ! "$ts" > "$LAST_RUN_TS" ]]; then
                continue
            fi
        fi
        q=$(printf '%s' "$line" | grep -oE '"query":[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/') || true
        count=$((count + 1))
        queries+=("$q")
    done

    if [ "$count" -ge "$SEARCH_MISS_THRESHOLD" ]; then
        local UNIQ_Q
        mapfile -t UNIQ_Q < <(printf '%s\n' "${queries[@]}" | sort -u)
        local top3 fp_list fp
        top3="$(join_with ", " "${UNIQ_Q[@]:0:3}")"
        fp_list="$(join_with "," "${UNIQ_Q[@]}")"
        fp="search-miss:${fp_list}"
        if [ "${#fp}" -gt 120 ]; then
            fp="${fp:0:120}"
        fi
        add_finding "Search recall gaps: ${count} zero-result queries (${top3}) — evaluate scoped search / hybrid index" "$fp"
    fi
}

# ==========================================================================
# Run checks
# ==========================================================================

CHECKS_RUN=()
for c in "${CHECKS_TO_RUN[@]}"; do
    CHECKS_RUN+=("$c")
    case "$c" in
        map) run_check_map ;;
        staleness) run_check_staleness ;;
        failures) run_check_failures ;;
        consolidation) run_check_consolidation ;;
        search-miss) run_check_search_miss ;;
    esac
done

# ==========================================================================
# File (or, under --dry-run, report) findings up to the draft cap
# ==========================================================================

DRAFTS_FILED=()
SKIPPED_DUPLICATES=0
OVERFLOW=0
ATTEMPTED=0

if [ ! -f "$MAINTAIN_DRAFT_SCRIPT" ] && [ "$DRY_RUN" -ne 1 ] && [ "${#FINDINGS_TITLES[@]}" -gt 0 ]; then
    echo "maintain: ERROR — ${MAINTAIN_DRAFT_SCRIPT} not found, cannot file drafts" >&2
fi

for idx in "${!FINDINGS_TITLES[@]}"; do
    title="${FINDINGS_TITLES[$idx]}"
    fp="${FINDINGS_FPS[$idx]}"

    if [ "$ATTEMPTED" -ge "$MAX_DRAFTS_PER_RUN" ]; then
        OVERFLOW=$((OVERFLOW + 1))
        if [ "$DRY_RUN" -eq 1 ]; then
            printf 'would skip (cap reached): %s (fp: %s)\n' "$title" "$fp"
        fi
        continue
    fi
    ATTEMPTED=$((ATTEMPTED + 1))

    if [ "$DRY_RUN" -eq 1 ]; then
        printf 'would file: %s (fp: %s)\n' "$title" "$fp"
        continue
    fi

    if [ ! -f "$MAINTAIN_DRAFT_SCRIPT" ]; then
        continue
    fi

    draft_out=""
    draft_ec=0
    set +e
    if [ "$OVERRIDE_MODE" -eq 1 ]; then
        draft_out=$(cd "$REPO_ROOT_FOR_RELATIVE" && node "$MAINTAIN_DRAFT_SCRIPT" --title "$title" --fingerprint "$fp" --roadmap "$ROOT/ROADMAP.md" --validate-cmd "bash scripts/validate-roadmap.sh $ROOT/ROADMAP.md" 2>&1)
    else
        draft_out=$(cd "$REPO_ROOT_FOR_RELATIVE" && node "$MAINTAIN_DRAFT_SCRIPT" --title "$title" --fingerprint "$fp" 2>&1)
    fi
    draft_ec=$?
    set -e

    if [ "$draft_ec" -eq 0 ]; then
        tid=$(printf '%s' "$draft_out" | grep -oE '#T[0-9]+') || true
        [ -n "$tid" ] && DRAFTS_FILED+=("$tid")
    elif [ "$draft_ec" -eq 2 ]; then
        SKIPPED_DUPLICATES=$((SKIPPED_DUPLICATES + 1))
    else
        echo "maintain: draft filing error for '${title}': ${draft_out}" >&2
    fi
done

# ==========================================================================
# Final ledger summary line (skipped entirely under --dry-run)
# ==========================================================================

if [ "$DRY_RUN" -ne 1 ]; then
    RUN_ID="$(date +%s)-$$"
    TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    CHECKS_JSON="$(join_json_array "${CHECKS_RUN[@]}")"
    DRAFTS_JSON="$(join_json_array "${DRAFTS_FILED[@]}")"
    if [ "${#POLICY_WARNINGS[@]}" -gt 0 ]; then
        WARNINGS_JSON="$(join_json_array "${POLICY_WARNINGS[@]}")"
    else
        WARNINGS_JSON="[]"
    fi
    OVERFLOW_FIELD=""
    if [ "$OVERFLOW" -gt 0 ]; then
        OVERFLOW_FIELD=",\"overflow_findings\":${OVERFLOW}"
    fi
    ledger_line "{\"timestamp\":\"${TS}\",\"run_id\":\"${RUN_ID}\",\"checks_run\":${CHECKS_JSON},\"findings_count\":${#FINDINGS_TITLES[@]},\"drafts_filed\":${DRAFTS_JSON},\"skipped_duplicates\":${SKIPPED_DUPLICATES},\"policy_warnings\":${WARNINGS_JSON}${OVERFLOW_FIELD}}"
fi

exit 0
