#!/usr/bin/env bash
# tests/maintain-smoke.sh — Smoke suite for scripts/maintain.sh.
#
# Builds isolated mktemp fixture "projects" (each with its own git repo,
# .claude/, docs/memory/, ROADMAP.md) and points scripts/maintain.sh at them
# via PROJECT_OS_ROOT, while invoking the REAL repo's copy of the script.
# Never touches the real project's ROADMAP.md.
#
# Usage: bash tests/maintain-smoke.sh
# Exit: 0 if every scenario passes, 1 if any assertion fails.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
MAINTAIN_SH="$REPO_ROOT/scripts/maintain.sh"
VALIDATE_SH="$REPO_ROOT/scripts/validate-roadmap.sh"

FAIL_COUNT=0
TMP_DIRS=()
SCENARIO1_FIXTURE=""

pass() { printf 'PASS: %s\n' "$1"; }
fail() {
    printf 'FAIL: %s\n' "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

cleanup() {
    local d
    for d in "${TMP_DIRS[@]}"; do
        rm -rf "$d" 2>/dev/null || true
    done
}
trap cleanup EXIT

# ==========================================================================
# Fixture builder
# ==========================================================================

new_fixture() {
    local dir
    dir=$(mktemp -d)
    TMP_DIRS+=("$dir")
    mkdir -p "$dir/.claude/logs"
    mkdir -p "$dir/.claude/sessions"
    mkdir -p "$dir/docs/memory"
    printf '%s\n' \
        "# ROADMAP" \
        "" \
        "Marker legend: [?] draft, [ ] todo, [-] wip, [~] review, [x] done, [!] blocked" \
        "" \
        "## Feature: fixture" \
        "" \
        "### Draft" \
        "### Todo" \
        "### In Progress" \
        "### Review" \
        "### Done" \
        "" \
        "## Backlog" \
        "" \
        >"$dir/ROADMAP.md"
    (cd "$dir" && git init -q && git add -A && git -c user.email=t@t.com -c user.name=t commit -q -m init) >/dev/null 2>&1
    printf '%s' "$dir"
}

seed_stale_load() {
    local fx="$1"
    local i
    for i in $(seq 1 13); do
        printf '%s\n' "# Memory ${i}" "content" >"$fx/docs/memory/mem${i}.md"
    done
    for i in 1 2 3 4 5 6; do
        printf '2026-01-01T00:00:0%sZ FAIL tool=Bash\n' "$i" >>"$fx/.claude/logs/tool-failures.log"
    done
    for i in 1 2 3 4 5 6; do
        printf '{"timestamp":"2026-01-01T00:00:0%sZ","query":"q%s","result_count":0}\n' "$i" "$i" >>"$fx/.claude/logs/search-log.jsonl"
    done
    (cd "$fx" && git add -A && git -c user.email=t@t.com -c user.name=t commit -q -m seed) >/dev/null 2>&1
}

# ==========================================================================
# Ledger assertion helpers
# ==========================================================================

json_valid() {
    printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{JSON.parse(s);process.exit(0)}catch(e){process.exit(1)}})' 2>/dev/null
}

last_main_ledger_line() {
    local ledger="$1/.claude/logs/maintenance-ledger.jsonl"
    [ -f "$ledger" ] || {
        printf ''
        return 0
    }
    grep '"run_id"' "$ledger" 2>/dev/null | tail -n1 || true
}

ledger_get_findings_count() {
    printf '%s' "$1" | grep -oE '"findings_count":[0-9]+' | sed -E 's/.*:([0-9]+)/\1/'
}

ledger_get_skipped_duplicates() {
    printf '%s' "$1" | grep -oE '"skipped_duplicates":[0-9]+' | sed -E 's/.*:([0-9]+)/\1/'
}

ledger_get_drafts_filed_count() {
    printf '%s' "$1" | grep -oE '"drafts_filed":\[[^]]*\]' | grep -oE '#T[0-9]+' | wc -l | tr -d ' '
}

ledger_get_checks_run() {
    printf '%s' "$1" | grep -oE '"checks_run":\[[^]]*\]' | grep -oE '"[a-z-]+"' | tr -d '"' | tr '\n' ',' | sed 's/,$//'
}

# ==========================================================================
# Scenario 1: seeded-stale fixture -> 3 findings, capped at max_drafts_per_run
# ==========================================================================

scenario_1() {
    local name="scenario1-seeded-stale-cap"
    local fx
    fx="$(new_fixture)"
    seed_stale_load "$fx"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local line
    line="$(last_main_ledger_line "$fx")"
    if [ -z "$line" ]; then
        fail "$name: no ledger main line written"
        return
    fi
    if json_valid "$line"; then
        pass "$name: ledger line is valid JSON"
    else
        fail "$name: ledger line is not valid JSON: $line"
    fi

    local dcount
    dcount="$(ledger_get_drafts_filed_count "$line")"
    if [ "$dcount" = "3" ]; then
        pass "$name: drafts_filed length is 3 (capped at max_drafts_per_run)"
    else
        fail "$name: expected drafts_filed length 3, got '$dcount' ($line)"
    fi

    if bash "$VALIDATE_SH" "$fx/ROADMAP.md" >/dev/null 2>&1; then
        pass "$name: fixture ROADMAP.md passes validate-roadmap.sh"
    else
        fail "$name: fixture ROADMAP.md fails validate-roadmap.sh"
    fi

    SCENARIO1_FIXTURE="$fx"
}

# ==========================================================================
# Scenario 2: second identical run -> 0 new drafts, skipped_duplicates > 0
# ==========================================================================

scenario_2() {
    local name="scenario2-dedup-second-run"
    local fx="$SCENARIO1_FIXTURE"
    if [ -z "$fx" ]; then
        fail "$name: scenario 1 fixture unavailable, skipping"
        return
    fi

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local line
    line="$(last_main_ledger_line "$fx")"
    if [ -z "$line" ] || ! json_valid "$line"; then
        fail "$name: no valid ledger main line on second run"
        return
    fi

    local dcount dupes
    dcount="$(ledger_get_drafts_filed_count "$line")"
    dupes="$(ledger_get_skipped_duplicates "$line")"

    if [ "$dcount" = "0" ]; then
        pass "$name: 0 new drafts filed on second identical run"
    else
        fail "$name: expected 0 new drafts, got '$dcount'"
    fi

    if [ -n "$dupes" ] && [ "$dupes" -gt 0 ] 2>/dev/null; then
        pass "$name: skipped_duplicates > 0 ($dupes)"
    else
        fail "$name: expected skipped_duplicates > 0, got '$dupes'"
    fi
}

# ==========================================================================
# Scenario 3: fresh fixture -> no-op, findings_count 0
# ==========================================================================

scenario_3() {
    local name="scenario3-fresh-noop"
    local fx
    fx="$(new_fixture)"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local line
    line="$(last_main_ledger_line "$fx")"
    if [ -z "$line" ] || ! json_valid "$line"; then
        fail "$name: no valid ledger main line"
        return
    fi

    local fcount
    fcount="$(ledger_get_findings_count "$line")"
    if [ "$fcount" = "0" ]; then
        pass "$name: findings_count is 0 on a fresh fixture"
    else
        fail "$name: expected findings_count 0, got '$fcount'"
    fi
}

# ==========================================================================
# Scenario 4: malformed policy value -> run completes, defaults used
# ==========================================================================

scenario_4() {
    local name="scenario4-malformed-policy"
    local fx
    fx="$(new_fixture)"
    printf '%s\n' "stale_threshold_days: banana" "max_drafts_per_run: 3" >"$fx/.claude/maintenance-policy.yaml"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi
    pass "$name: run completes despite malformed policy value"

    local line
    line="$(last_main_ledger_line "$fx")"
    if [ -z "$line" ] || ! json_valid "$line"; then
        fail "$name: no valid ledger main line"
        return
    fi

    if printf '%s' "$line" | grep -q 'stale_threshold_days'; then
        pass "$name: ledger policy_warnings mentions the malformed key"
    else
        fail "$name: expected policy_warnings to mention stale_threshold_days: $line"
    fi
}

# ==========================================================================
# Scenario 5: checks narrowed to `staleness` only
# ==========================================================================

scenario_5() {
    local name="scenario5-checks-narrowed"
    local fx
    fx="$(new_fixture)"
    printf '%s\n' "checks: staleness" >"$fx/.claude/maintenance-policy.yaml"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local line
    line="$(last_main_ledger_line "$fx")"
    if [ -z "$line" ] || ! json_valid "$line"; then
        fail "$name: no valid ledger main line"
        return
    fi

    local checks_run
    checks_run="$(ledger_get_checks_run "$line")"
    if [ "$checks_run" = "staleness" ]; then
        pass "$name: checks_run is exactly [staleness]"
    else
        fail "$name: expected checks_run=[staleness], got [$checks_run]"
    fi
}

# ==========================================================================
# Scenario 6: concurrent invocation -> lock held, exits 0, no drafts
# ==========================================================================

scenario_6() {
    local name="scenario6-lock-held"
    local fx
    fx="$(new_fixture)"
    mkdir "$fx/.claude/maintenance-lock"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec (expected 0): $out"
        return
    fi
    pass "$name: exits 0 when the lock is already held"

    if git -C "$fx" diff --quiet -- ROADMAP.md; then
        pass "$name: no drafts filed (ROADMAP.md unchanged)"
    else
        fail "$name: ROADMAP.md changed despite lock contention"
    fi

    local line
    line="$(tail -n1 "$fx/.claude/logs/maintenance-ledger.jsonl" 2>/dev/null || true)"
    if printf '%s' "$line" | grep -q '"skipped":"lock-held"'; then
        pass "$name: ledger records a lock-held note"
    else
        fail "$name: expected a lock-held ledger note, got: $line"
    fi

    if [ -d "$fx/.claude/maintenance-lock" ]; then
        pass "$name: pre-existing lock dir left untouched (not ours to release)"
    else
        fail "$name: lock dir was removed even though maintain.sh never acquired it"
    fi
}

# ==========================================================================
# Scenario 7: write-surface containment (fixture side) — reuses scenario 1's
# fixture after two runs (scenario 1 + scenario 2).
# ==========================================================================

scenario_7() {
    local name="scenario7-write-surface-fixture"
    local fx="$SCENARIO1_FIXTURE"
    if [ -z "$fx" ]; then
        fail "$name: scenario 1 fixture unavailable, skipping"
        return
    fi

    local bad=0
    local line path
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        path="${line:3}"
        case "$path" in
            ROADMAP.md) ;;
            .claude/logs/*) ;;
            *) bad=1 ;;
        esac
    done < <(git -C "$fx" status --porcelain)

    if [ "$bad" -eq 0 ]; then
        pass "$name: fixture git status touches only ROADMAP.md + .claude/logs/*"
    else
        fail "$name: fixture git status has unexpected changes outside ROADMAP.md/.claude/logs"
    fi
}

# ==========================================================================
# Scenario 8: --dry-run on a seeded fixture -> prints, writes nothing
# ==========================================================================

scenario_8() {
    local name="scenario8-dry-run"
    local fx
    fx="$(new_fixture)"
    seed_stale_load "$fx"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" --dry-run 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh --dry-run exited $ec: $out"
        return
    fi

    if printf '%s\n' "$out" | grep -q "^would file:"; then
        pass "$name: dry-run prints would-file lines"
    else
        fail "$name: expected would-file output, got: $out"
    fi

    if [ -f "$fx/.claude/logs/maintenance-ledger.jsonl" ]; then
        fail "$name: dry-run wrote a ledger file"
    else
        pass "$name: dry-run wrote no ledger file"
    fi

    if git -C "$fx" diff --quiet -- ROADMAP.md; then
        pass "$name: dry-run left ROADMAP.md unchanged"
    else
        fail "$name: dry-run modified ROADMAP.md"
    fi
}

# ==========================================================================
# Scenario 9: map check against a stub system-map.ts — exercises the
# report --json HIGH-severity filter + subject extraction in a controlled
# fixture (previously only ever run against the live repo).
# ==========================================================================

scenario_9() {
    local name="scenario9-map-check"
    local fx
    fx="$(new_fixture)"
    mkdir -p "$fx/scripts"
    # Stub CLI (plain JS is valid TS): `check` -> fresh (exit 0);
    # `report --json` -> one HIGH + one LOW finding.
    printf '%s\n' \
        'const mode = process.argv[2];' \
        'if (mode === "check") { process.exit(0); }' \
        'if (mode === "report") {' \
        '  console.log(JSON.stringify([' \
        '    { severity: "HIGH", kind: "unwired-hook", subject: "stub-hook.sh", detail: "x" },' \
        '    { severity: "LOW", kind: "bloat", subject: "stub-doc.md", detail: "y" }' \
        '  ]));' \
        '  process.exit(0);' \
        '}' \
        'process.exit(0);' \
        >"$fx/scripts/system-map.ts"
    printf '%s\n' "checks: map" >"$fx/.claude/maintenance-policy.yaml"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local line
    line="$(last_main_ledger_line "$fx")"
    local checks
    checks="$(ledger_get_checks_run "$line")"
    if [ "$checks" = "map" ]; then
        pass "$name: only the map check ran"
    else
        fail "$name: expected checks_run [map], got '$checks'"
    fi

    local dcount
    dcount="$(ledger_get_drafts_filed_count "$line")"
    if [ "$dcount" = "1" ]; then
        pass "$name: exactly one readiness draft filed"
    else
        fail "$name: expected 1 draft, got '$dcount' ($line)"
    fi

    local roadmap
    roadmap="$(cat "$fx/ROADMAP.md")"
    if printf '%s' "$roadmap" | grep -q "stub-hook.sh"; then
        pass "$name: HIGH subject cited in the draft"
    else
        fail "$name: HIGH subject stub-hook.sh missing from ROADMAP"
    fi
    if printf '%s' "$roadmap" | grep -q "stub-doc.md"; then
        fail "$name: LOW subject stub-doc.md leaked into the draft (should be HIGH-only)"
    else
        pass "$name: LOW subject correctly excluded"
    fi
    if printf '%s' "$roadmap" | grep -q "map:stub-hook.sh"; then
        pass "$name: fingerprint derived from HIGH subjects"
    else
        fail "$name: expected fingerprint map:stub-hook.sh"
    fi
}

# ==========================================================================
# Scenario 10: two tools both over the failure threshold -> BOTH drafted
# (regression for the single-winner bug that permanently lost a co-occurring
# second tool, since the ledger window advances every run).
# ==========================================================================

scenario_10() {
    local name="scenario10-failures-multi-tool"
    local fx
    fx="$(new_fixture)"
    local i
    for i in 1 2 3 4 5 6; do
        printf '2026-01-01T00:00:0%sZ FAIL tool=Bash\n' "$i" >>"$fx/.claude/logs/tool-failures.log"
    done
    for i in 1 2 3 4 5; do
        printf '2026-01-01T00:00:1%sZ FAIL tool=Read\n' "$i" >>"$fx/.claude/logs/tool-failures.log"
    done
    printf '%s\n' "checks: failures" >"$fx/.claude/maintenance-policy.yaml"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local roadmap
    roadmap="$(cat "$fx/ROADMAP.md")"
    if printf '%s' "$roadmap" | grep -q "recurring Bash failures"; then
        pass "$name: Bash failures drafted"
    else
        fail "$name: Bash failures draft missing"
    fi
    if printf '%s' "$roadmap" | grep -q "recurring Read failures"; then
        pass "$name: co-occurring Read failures also drafted (not lost)"
    else
        fail "$name: Read failures draft missing — single-winner regression"
    fi
}

# ==========================================================================
# Scenario 11: search-miss queries carrying secrets are redacted before they
# reach the committed draft (T58).
# ==========================================================================

scenario_11() {
    local name="scenario11-search-miss-redaction"
    local fx
    fx="$(new_fixture)"
    printf '%s\n' "checks: search-miss" >"$fx/.claude/maintenance-policy.yaml"
    local i
    # 5 zero-result queries, each embedding a FAKE secret-shaped token (test
    # fixtures only — scan:allow suppresses the scanner on these lines).
    printf '{"timestamp":"2026-01-01T00:00:01Z","query":"why is sk-ant-SHOULDNOTLEAK1234567890 failing","result_count":0}\n' >>"$fx/.claude/logs/search-log.jsonl"  # scan:allow
    printf '{"timestamp":"2026-01-01T00:00:02Z","query":"password=hunter2secretvalue error","result_count":0}\n' >>"$fx/.claude/logs/search-log.jsonl"  # scan:allow
    printf '{"timestamp":"2026-01-01T00:00:03Z","query":"ghp_ABCDEFGHIJKLMNOPQRST rate limit","result_count":0}\n' >>"$fx/.claude/logs/search-log.jsonl"  # scan:allow
    printf '{"timestamp":"2026-01-01T00:00:04Z","query":"token: aVeryLongOpaqueTokenValue1234567890ABCD","result_count":0}\n' >>"$fx/.claude/logs/search-log.jsonl"  # scan:allow
    printf '{"timestamp":"2026-01-01T00:00:05Z","query":"plain harmless query text","result_count":0}\n' >>"$fx/.claude/logs/search-log.jsonl"

    local out ec
    out=$(PROJECT_OS_ROOT="$fx" bash "$MAINTAIN_SH" 2>&1)
    ec=$?
    if [ "$ec" -ne 0 ]; then
        fail "$name: maintain.sh exited $ec: $out"
        return
    fi

    local roadmap
    roadmap="$(cat "$fx/ROADMAP.md")"
    if printf '%s' "$roadmap" | grep -q "Search recall gaps"; then
        pass "$name: search-miss draft filed"
    else
        fail "$name: expected a search-miss draft"
    fi
    local leaked=0
    for secret in "SHOULDNOTLEAK1234567890" "hunter2secretvalue" "ABCDEFGHIJKLMNOPQRST" "aVeryLongOpaqueTokenValue1234567890ABCD"; do
        if printf '%s' "$roadmap" | grep -qF "$secret"; then
            fail "$name: secret leaked into ROADMAP draft: $secret"
            leaked=1
        fi
    done
    if [ "$leaked" -eq 0 ]; then
        pass "$name: all secret-shaped substrings redacted from the draft"
    fi
    if printf '%s' "$roadmap" | grep -q "harmless query"; then
        pass "$name: non-secret query text preserved"
    else
        fail "$name: harmless query text was over-redacted or missing"
    fi
}

# ==========================================================================
# Scenario 12: session-start-maintain.sh auto-run hook — guards, debounce,
# policy disable, and the notice line on a run that files drafts.
# ==========================================================================

scenario_12() {
    local name="scenario12-auto-run-hook"
    local hook="$REPO_ROOT/.claude/hooks/session-start-maintain.sh"
    local fx out

    # (a) non-git fixture -> silent skip, no ledger created
    fx="$(mktemp -d)"
    TMP_DIRS+=("$fx")
    mkdir -p "$fx/.claude/logs" "$fx/scripts"
    cp "$REPO_ROOT/scripts/maintain.sh" "$fx/scripts/maintain.sh"
    out=$(PROJECT_OS_ROOT="$fx" bash "$hook" 2>&1)
    if [ -z "$out" ] && [ ! -f "$fx/.claude/logs/maintenance-ledger.jsonl" ]; then
        pass "$name: non-git root skipped silently"
    else
        fail "$name: non-git root should skip (out='$out')"
    fi

    # (b) linked-worktree shape (.git is a FILE) -> silent skip
    printf 'gitdir: /somewhere/else\n' >"$fx/.git"
    out=$(PROJECT_OS_ROOT="$fx" bash "$hook" 2>&1)
    if [ -z "$out" ] && [ ! -f "$fx/.claude/logs/maintenance-ledger.jsonl" ]; then
        pass "$name: worktree-style .git file skipped silently"
    else
        fail "$name: worktree root should skip (out='$out')"
    fi

    # (c) real fixture with auto_run_hours: 0 -> disabled, no run.
    # The hook runs $ROOT/scripts/maintain.sh, so install the script set into
    # the fixture like a real bootstrapped project.
    fx="$(new_fixture)"
    seed_stale_load "$fx"
    mkdir -p "$fx/scripts/lib"
    cp "$REPO_ROOT/scripts/maintain.sh" "$fx/scripts/"
    cp "$REPO_ROOT/scripts/maintain-draft.ts" "$fx/scripts/"
    cp "$REPO_ROOT/scripts/validate-roadmap.sh" "$fx/scripts/"
    cp "$REPO_ROOT/scripts/lib/dashboard-render.ts" "$fx/scripts/lib/"
    cp "$REPO_ROOT/scripts/lib/project-root.ts" "$fx/scripts/lib/"
    printf '%s\n' "auto_run_hours: 0" >"$fx/.claude/maintenance-policy.yaml"
    out=$(PROJECT_OS_ROOT="$fx" bash "$hook" 2>&1)
    if [ -z "$out" ] && [ ! -f "$fx/.claude/logs/maintenance-ledger.jsonl" ]; then
        pass "$name: auto_run_hours 0 disables the auto-run"
    else
        fail "$name: expected disabled auto-run (out='$out')"
    fi

    # (d) same fixture, auto-run enabled, no ledger yet -> runs, files drafts,
    #     prints the visible notice
    printf '%s\n' "auto_run_hours: 24" >"$fx/.claude/maintenance-policy.yaml"
    out=$(PROJECT_OS_ROOT="$fx" bash "$hook" 2>&1)
    if printf '%s' "$out" | grep -q "^Project OS maintenance auto-run: filed"; then
        pass "$name: first auto-run files drafts and prints the notice"
    else
        fail "$name: expected a filed-drafts notice, got '$out'"
    fi
    if [ -f "$fx/.claude/logs/maintenance-ledger.jsonl" ]; then
        pass "$name: auto-run wrote a ledger line"
    else
        fail "$name: auto-run left no ledger"
    fi

    # (e) immediate second invocation -> debounced (fresh ledger), silent
    out=$(PROJECT_OS_ROOT="$fx" bash "$hook" 2>&1)
    local lines
    lines=$(grep -c '"run_id"' "$fx/.claude/logs/maintenance-ledger.jsonl" 2>/dev/null || echo 0)
    if [ -z "$out" ] && [ "$lines" = "1" ]; then
        pass "$name: second invocation debounced (no new run)"
    else
        fail "$name: expected debounce (out='$out', main ledger lines=$lines)"
    fi
}

# ==========================================================================
# Main
# ==========================================================================

REAL_ROADMAP_STATUS_BEFORE="$(git -C "$REPO_ROOT" status --porcelain -- ROADMAP.md .claude/logs .claude/maintenance-lock 2>/dev/null)"

scenario_1
scenario_2
scenario_3
scenario_4
scenario_5
scenario_6
scenario_7
scenario_8
scenario_9
scenario_10
scenario_11
scenario_12

REAL_ROADMAP_STATUS_AFTER="$(git -C "$REPO_ROOT" status --porcelain -- ROADMAP.md .claude/logs .claude/maintenance-lock 2>/dev/null)"
if [ "$REAL_ROADMAP_STATUS_BEFORE" = "$REAL_ROADMAP_STATUS_AFTER" ]; then
    pass "scenario7-write-surface-real-repo: real repo ROADMAP.md/.claude/logs/lock untouched by the whole suite"
else
    fail "scenario7-write-surface-real-repo: real repo write-surface changed during the test suite run"
fi

echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "ALL SCENARIOS PASSED"
    exit 0
else
    echo "${FAIL_COUNT} SCENARIO ASSERTION(S) FAILED"
    exit 1
fi
