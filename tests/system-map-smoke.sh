#!/usr/bin/env bash
# Smoke tests for scripts/system-map.ts.
# Each scenario builds its own isolated fixture git repo under a fresh
# mktemp -d (so the CLI's `.claude`-upward root resolution lands in the
# fixture, not this repo), runs the REAL scripts/system-map.ts against it,
# and cleans up after itself — no shared mutable state between scenarios.
# Usage: bash tests/system-map-smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEM_MAP="$PROJECT_ROOT/scripts/system-map.ts"

PASS=0
FAIL=0
ERRORS=""

pass() {
    local name="$1"
    PASS=$((PASS + 1))
    echo "  PASS: $name"
}

fail() {
    local name="$1"
    local detail="$2"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  FAIL: $name\n$detail"
    echo "  FAIL: $name"
}

assert_eq() {
    local name="$1" expected="$2" actual="$3" detail="$4"
    if [ "$expected" = "$actual" ]; then
        pass "$name"
    else
        fail "$name" "expected [$expected], got [$actual]\n$detail"
    fi
}

# Builds a minimal fixture git repo at $1: .claude/settings.json wiring one
# hook, one hook file, one command md referencing a script, and a scripts/
# file. Repo-relative paths only, forward slashes.
make_fixture() {
    local dir="$1"
    mkdir -p "$dir/.claude/hooks"
    mkdir -p "$dir/.claude/commands/tools"
    mkdir -p "$dir/scripts"

    printf '%s\n' \
        '{' \
        '  "hooks": {' \
        '    "PostToolUse": [' \
        '      {' \
        '        "matcher": "Write",' \
        '        "hooks": [' \
        '          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/demo-hook.sh\"" }' \
        '        ]' \
        '      }' \
        '    ]' \
        '  }' \
        '}' \
        > "$dir/.claude/settings.json"

    printf '#!/bin/bash\necho demo hook v1\n' > "$dir/.claude/hooks/demo-hook.sh"

    printf '%s\n' \
        '# Demo command' \
        '' \
        'Run it:' \
        '```' \
        'bash scripts/demo.sh' \
        '```' \
        > "$dir/.claude/commands/tools/demo.md"

    printf '#!/bin/bash\necho demo script\n' > "$dir/scripts/demo.sh"

    (cd "$dir" && git init -q && git config user.email "test@example.com" && git config user.name "Test" && git add -A && git commit -q -m "fixture: initial")
}

echo "=== system-map.ts Smoke Tests ==="
echo ""

# --- Scenario 1: generate is deterministic; check exits 0 -------------------
echo "Scenario 1: generate -> check exit 0; regenerate byte-identical"

FIXTURE_1="$(mktemp -d)"
make_fixture "$FIXTURE_1"

set +e
OUT_1A="$(cd "$FIXTURE_1" && node "$SYSTEM_MAP" generate 2>&1)"
EXIT_1A=$?
set -e
assert_eq "generate_freshFixture_exitsZero" "0" "$EXIT_1A" "$OUT_1A"

for f in system-map.md module-graph.mmd .maps.lock; do
    if [ -f "$FIXTURE_1/docs/maps/$f" ]; then
        pass "generate_freshFixture_writes_$f"
    else
        fail "generate_freshFixture_writes_$f" "docs/maps/$f not found"
    fi
done

set +e
OUT_1B="$(cd "$FIXTURE_1" && node "$SYSTEM_MAP" check 2>&1)"
EXIT_1B=$?
set -e
assert_eq "check_freshFixture_exitsZero" "0" "$EXIT_1B" "$OUT_1B"

cp "$FIXTURE_1/docs/maps/system-map.md" "$FIXTURE_1/system-map.md.bak"
cp "$FIXTURE_1/docs/maps/module-graph.mmd" "$FIXTURE_1/module-graph.mmd.bak"
cp "$FIXTURE_1/docs/maps/.maps.lock" "$FIXTURE_1/.maps.lock.bak"

set +e
OUT_1C="$(cd "$FIXTURE_1" && node "$SYSTEM_MAP" generate 2>&1)"
EXIT_1C=$?
set -e
assert_eq "generate_rerun_exitsZero" "0" "$EXIT_1C" "$OUT_1C"

if cmp -s "$FIXTURE_1/docs/maps/system-map.md" "$FIXTURE_1/system-map.md.bak"; then
    pass "generate_rerun_systemMapByteIdentical"
else
    fail "generate_rerun_systemMapByteIdentical" "system-map.md differs across runs"
fi
if cmp -s "$FIXTURE_1/docs/maps/module-graph.mmd" "$FIXTURE_1/module-graph.mmd.bak"; then
    pass "generate_rerun_moduleGraphByteIdentical"
else
    fail "generate_rerun_moduleGraphByteIdentical" "module-graph.mmd differs across runs"
fi
if cmp -s "$FIXTURE_1/docs/maps/.maps.lock" "$FIXTURE_1/.maps.lock.bak"; then
    pass "generate_rerun_lockByteIdentical"
else
    fail "generate_rerun_lockByteIdentical" ".maps.lock differs across runs"
fi

rm -rf "$FIXTURE_1"
echo ""

# --- Scenario 2: mutation -> drift -> heal -----------------------------------
echo "Scenario 2: mutate hook -> check exit 3; check --heal -> exit 0; check -> exit 0"

FIXTURE_2="$(mktemp -d)"
make_fixture "$FIXTURE_2"
(cd "$FIXTURE_2" && node "$SYSTEM_MAP" generate >/dev/null 2>&1)

printf '#!/bin/bash\necho demo hook v2 MUTATED\n' > "$FIXTURE_2/.claude/hooks/demo-hook.sh"

set +e
OUT_2A="$(cd "$FIXTURE_2" && node "$SYSTEM_MAP" check 2>&1)"
EXIT_2A=$?
set -e
assert_eq "check_afterMutation_exitsThree" "3" "$EXIT_2A" "$OUT_2A"

set +e
OUT_2B="$(cd "$FIXTURE_2" && node "$SYSTEM_MAP" check --heal 2>&1)"
EXIT_2B=$?
set -e
assert_eq "checkHeal_afterMutation_exitsZero" "0" "$EXIT_2B" "$OUT_2B"

set +e
OUT_2C="$(cd "$FIXTURE_2" && node "$SYSTEM_MAP" check 2>&1)"
EXIT_2C=$?
set -e
assert_eq "check_afterHeal_exitsZero" "0" "$EXIT_2C" "$OUT_2C"

rm -rf "$FIXTURE_2"
echo ""

# --- Scenario 3: partial staging is honored by precommit (index-derived) ----
echo "Scenario 3: partial staging -> precommit heals from the INDEX, not the working tree"

FIXTURE_3="$(mktemp -d)"
make_fixture "$FIXTURE_3"
(cd "$FIXTURE_3" && node "$SYSTEM_MAP" generate >/dev/null 2>&1)
(cd "$FIXTURE_3" && git add -A && git commit -q -m "fixture: committed maps")

# Stage one version of the hook (distinct marker), then edit it again
# unstaged with a DIFFERENT marker. precommit must derive content from the
# staged blob only.
printf '#!/bin/bash\necho STAGED_MARKER_AAA\n' > "$FIXTURE_3/.claude/hooks/demo-hook.sh"
(cd "$FIXTURE_3" && git add .claude/hooks/demo-hook.sh)
printf '#!/bin/bash\necho UNSTAGED_MARKER_BBB\n' > "$FIXTURE_3/.claude/hooks/demo-hook.sh"

set +e
OUT_3A="$(cd "$FIXTURE_3" && node "$SYSTEM_MAP" precommit 2>&1)"
EXIT_3A=$?
set -e
assert_eq "precommit_partialStaging_exitsZero" "0" "$EXIT_3A" "$OUT_3A"

CACHED_NAMES="$(cd "$FIXTURE_3" && git diff --cached --name-only)"
if grep -q "^docs/maps/" <<<"$CACHED_NAMES"; then
    pass "precommit_partialStaging_docsMapsStaged"
else
    fail "precommit_partialStaging_docsMapsStaged" "docs/maps not in cached diff:\n$CACHED_NAMES"
fi

# Idempotence: commit the healed state (demo-hook.sh committed as AAA), then
# run precommit AGAIN while the working tree still has the UNSTAGED BBB edit
# dirty. If precommit were working-tree-derived, this second run would see
# demo-hook.sh's working-tree content (BBB) diverge from the committed lock
# (AAA), detect "drift", and re-stage docs/maps with a changed .maps.lock.
# Since precommit reads the INDEX (which still says AAA, matching the
# committed lock), it must find the map fresh and touch nothing.
(cd "$FIXTURE_3" && git commit -q -m "fixture: healed maps")
cp "$FIXTURE_3/docs/maps/system-map.md" "$FIXTURE_3/system-map.md.presecond"
cp "$FIXTURE_3/docs/maps/.maps.lock" "$FIXTURE_3/.maps.lock.presecond"

set +e
OUT_3B="$(cd "$FIXTURE_3" && node "$SYSTEM_MAP" precommit 2>&1)"
EXIT_3B=$?
set -e
assert_eq "precommit_secondRun_exitsZero" "0" "$EXIT_3B" "$OUT_3B"

if cmp -s "$FIXTURE_3/docs/maps/system-map.md" "$FIXTURE_3/system-map.md.presecond"; then
    pass "precommit_secondRun_systemMapUnchanged"
else
    fail "precommit_secondRun_systemMapUnchanged" "system-map.md changed on a no-op precommit re-run"
fi

if cmp -s "$FIXTURE_3/docs/maps/.maps.lock" "$FIXTURE_3/.maps.lock.presecond"; then
    pass "precommit_secondRun_lockUnchanged"
else
    fail "precommit_secondRun_lockUnchanged" ".maps.lock changed on a no-op precommit re-run (would prove working-tree-derivation, not index-derivation)"
fi

SECOND_RUN_CACHED="$(cd "$FIXTURE_3" && git diff --cached --name-only)"
if [ -z "$SECOND_RUN_CACHED" ]; then
    pass "precommit_secondRun_nothingNewlyStaged"
else
    fail "precommit_secondRun_nothingNewlyStaged" "expected empty cached diff, got:\n$SECOND_RUN_CACHED"
fi

rm -rf "$FIXTURE_3"
echo ""

# --- Scenario 4: CRLF vs LF produce identical .maps.lock ---------------------
echo "Scenario 4: CRLF fixture input -> .maps.lock identical to the LF variant"

FIXTURE_4A="$(mktemp -d)"
make_fixture "$FIXTURE_4A"
printf '#!/bin/bash\necho lf variant\n' > "$FIXTURE_4A/.claude/hooks/demo-hook.sh"
(cd "$FIXTURE_4A" && node "$SYSTEM_MAP" generate >/dev/null 2>&1)

FIXTURE_4B="$(mktemp -d)"
make_fixture "$FIXTURE_4B"
printf '#!/bin/bash\r\necho lf variant\r\n' > "$FIXTURE_4B/.claude/hooks/demo-hook.sh"
(cd "$FIXTURE_4B" && node "$SYSTEM_MAP" generate >/dev/null 2>&1)

if cmp -s "$FIXTURE_4A/docs/maps/.maps.lock" "$FIXTURE_4B/docs/maps/.maps.lock"; then
    pass "generate_crlfVsLf_lockIdentical"
else
    fail "generate_crlfVsLf_lockIdentical" "CRLF and LF fixtures produced different .maps.lock"
fi

rm -rf "$FIXTURE_4A" "$FIXTURE_4B"
echo ""

# --- Scenario 5: real repo (READ-ONLY) ----------------------------------------
# Only `check` and `report` run against the real repo — both are read-only.
# `generate` is deliberately NOT run here: it would overwrite the committed
# docs/maps/* as a side effect of the test suite (a fixture-isolation
# violation, and a corruption risk if generate ever regresses). Determinism
# of `generate` is already covered by the isolated fixtures in scenarios 1-4.
# `check` must exit 0 (committed maps fresh) OR 3 (drift from uncommitted
# working-tree edits — normal mid-development) — NOT 1 (generator error). We
# assert "not a generator error" so the test isn't fragile to uncommitted
# state; the pre-commit hook enforces freshness at commit time.
echo "Scenario 5: real repo check (0|3, not 1) -> report exit 0 (read-only)"

set +e
OUT_5B="$(node "$SYSTEM_MAP" check 2>&1)"
EXIT_5B=$?
set -e
if [ "$EXIT_5B" = "0" ] || [ "$EXIT_5B" = "3" ]; then
    pass "realRepo_check_noGeneratorError"
else
    fail "realRepo_check_noGeneratorError" "expected exit 0 or 3, got $EXIT_5B: $OUT_5B"
fi

set +e
OUT_5C="$(node "$SYSTEM_MAP" report 2>&1)"
EXIT_5C=$?
set -e
assert_eq "realRepo_report_exitsZero" "0" "$EXIT_5C" "$OUT_5C"

echo ""

# --- Scenario 6: always-loaded budget wiring in runFindings ------------------
# Guards the push of findAlwaysLoadedOverBudget results into `report`: the unit
# tests cover the function, only this exercises the wiring.
echo "Scenario 6: 16,004-byte unscoped rule -> report names it as over the always-loaded budget"

FIXTURE_6="$(mktemp -d)"
make_fixture "$FIXTURE_6"
mkdir -p "$FIXTURE_6/.claude/rules"
# 16004 bytes of spaces = 4001 tokens at 4 bytes per token, one over budget.
printf '%*s' 16004 '' > "$FIXTURE_6/.claude/rules/big.md"
# 12004 bytes = 3001 tokens: over the old 2500 budget, under the pinned 4000.
printf '%*s' 12004 '' > "$FIXTURE_6/.claude/rules/mid.md"
(cd "$FIXTURE_6" && git add -A && git commit -q -m "fixture: big always-loaded rule")

set +e
OUT_6="$(cd "$FIXTURE_6" && node "$SYSTEM_MAP" report 2>&1)"
EXIT_6=$?
set -e
assert_eq "report_bigUnscopedRule_exitsZero" "0" "$EXIT_6" "$OUT_6"
if [[ "$OUT_6" == *".claude/rules/big.md is always loaded and is approximately 4001 tokens"* ]]; then
    pass "report_bigUnscopedRule_namesFileAndTokens"
else
    fail "report_bigUnscopedRule_namesFileAndTokens" "report output lacks the always-loaded finding:\n$OUT_6"
fi
if [[ "$OUT_6" == *"always-loaded-over-budget"* ]]; then
    pass "report_bigUnscopedRule_namesFindingKind"
else
    fail "report_bigUnscopedRule_namesFindingKind" "report output lacks always-loaded-over-budget:\n$OUT_6"
fi
if [[ "$OUT_6" != *"mid.md is always loaded"* ]]; then
    pass "report_3001TokenRule_notReportedAsOverBudget"
else
    fail "report_3001TokenRule_notReportedAsOverBudget" "a 3,001-token rule is under the 4000-token budget but was reported:\n$OUT_6"
fi

rm -rf "$FIXTURE_6"
echo ""

# --- Scenario 7: relative hook command wiring in runFindings ------------------
# Guards the push of findRelativeHookCommands results into `report` (#T244).
echo "Scenario 7: settings.json hook command without \$CLAUDE_PROJECT_DIR -> report flags it"

FIXTURE_7="$(mktemp -d)"
make_fixture "$FIXTURE_7"
printf '%s\n' \
    '{' \
    '  "hooks": {' \
    '    "PostToolUse": [' \
    '      { "hooks": [ { "type": "command", "command": "bash .claude/hooks/demo-hook.sh" } ] }' \
    '    ]' \
    '  }' \
    '}' > "$FIXTURE_7/.claude/settings.json"
(cd "$FIXTURE_7" && git add -A && git commit -q -m "fixture: relative hook command")

set +e
OUT_7="$(cd "$FIXTURE_7" && node "$SYSTEM_MAP" report 2>&1)"
EXIT_7=$?
set -e
assert_eq "report_relativeHookCommand_exitsZero" "0" "$EXIT_7" "$OUT_7"
if [[ "$OUT_7" == *"relative-hook-command"* && "$OUT_7" == *".claude/hooks/demo-hook.sh"* ]]; then
    pass "report_relativeHookCommand_namesKindAndHook"
else
    fail "report_relativeHookCommand_namesKindAndHook" "report output lacks relative-hook-command finding:\n$OUT_7"
fi

rm -rf "$FIXTURE_7"
echo ""

# --- Scenario 8: malformed settings.json does not abort report ----------------
echo "Scenario 8: truncated settings.json -> report still exits 0"

FIXTURE_8="$(mktemp -d)"
make_fixture "$FIXTURE_8"
printf '%s\n' '{"hooks": ' > "$FIXTURE_8/.claude/settings.json"
(cd "$FIXTURE_8" && git add -A && git commit -q -m "fixture: malformed settings")

set +e
OUT_8="$(cd "$FIXTURE_8" && node "$SYSTEM_MAP" report 2>&1)"
EXIT_8=$?
set -e
assert_eq "report_malformedSettings_exitsZero" "0" "$EXIT_8" "$OUT_8"

rm -rf "$FIXTURE_8"
echo ""

# --- Summary ------------------------------------------------------------------
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
