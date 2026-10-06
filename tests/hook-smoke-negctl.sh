#!/bin/bash
# Negative control for tests/hook-smoke.sh.
# Usage: bash tests/hook-smoke-negctl.sh
#
# A test that passes on both a fixed and a broken tree is vacuous until proven
# otherwise, and the previous version of hook-smoke.sh was the worked example:
# it asserted exit codes against five hooks that all run `trap 'exit 0' ERR`, so
# 14 of its 15 assertions passed against hooks replaced by `exit 0`. This script
# is what keeps that from happening again.
#
# Two mutants:
#
#   1. STUB — every hook replaced by `exit 0`. Two kinds of assertion are
#      EXPECTED to survive, and neither is a defect: the `_exitsZero` liveness
#      checks, and the negative assertions (`_writesNothing`, `_noSideEffect`,
#      `_doesNotIndex`, `_nothingDeleted…`), which a hook that does nothing at
#      all trivially satisfies. A negative assertion carries weight only next to
#      its positive twin on the same hook — `_writesNothing` means something
#      because `_logsToolName` is there to fail. Every assertion that names an
#      EFFECT must appear in the FAIL list.
#
#   2. RAW-PATH — the real hooks, with post-tool-use.sh's payload path taken
#      unconverted (the pre-fix spelling). Exactly one assertion must fail:
#      postToolUse_backslashPayloadPath_stillResolved. A mutant that fails more
#      than its one target is not isolating anything.
#
#   3. IS-ERROR-GATE — tool-failure-log.sh gating on an `is_error` grep again,
#      the pre-#T213 spelling from when it rode PostToolUse. The native
#      PostToolUseFailure payload carries no `is_error`, so every assertion that
#      expects a logged failure must die, and the mutant must kill exactly those
#      and nothing else — the negative assertions (invalid JSON, empty JSON) and
#      the settings-wiring check are untouched by it.
#
#   4. NO-DRAIN — read_hook_payload stops at the bound without consuming the
#      rest. The hook itself still works, which is exactly why this needs a
#      control: the damage is to the WRITER, which takes EPIPE, and it shows up
#      only because the suite pipes the payload in under `set -o pipefail`. Must
#      kill postToolUse_payloadPastBound_exitsZero. It also kills the truncation
#      notice, because the same `wc -c` both drains and counts — this is the one
#      mutant here with two victims per hook, and it is meant to: post-tool-use
#      and post-write-session each lose _payloadPastBound_exitsZero and
#      _filePathBeyondBound_saysSoOnStderr.
#
#   5. SILENT-TRUNCATION — the stderr notice for a file_path that fell outside
#      the window removed. The bound's blind spot is defensible only while it is
#      audible; this proves the assertion that keeps it so. Must kill
#      postToolUse_filePathBeyondBound_saysSoOnStderr and its post-write-session
#      twin (the Write path's "not scrubbing" notice is removed too).
#
#   6. NO-CONTAINMENT — resolve_project_path's root comparison disabled
#      (#T202). Every path that exists is then "ours". Must kill exactly the
#      out-of-repo assertions on post-tool-use.sh: the Write one and the
#      bashEditDiff outside, prefix-collision, symlink-to-outside, parent-dir
#      symlink and `..`-escape ones. The session scrub keeps its own
#      .claude/sessions/ prefix check, so no post-write-session assertion dies.
#
#   7. SCRUB-NO-CONTAINMENT — post-write-session.sh's Bash branch scrubs the
#      raw payload path with no canonicalization, no containment and no
#      session-scope check. Must kill exactly the scrub-scope assertions:
#      outside, prefix-collision, in-repo non-session file, and `..` through
#      sessions/ to an outside file.
#
#   8. SCRUB-SCOPE-ONLY — post-write-session.sh's Bash branch keeps the
#      .claude/sessions/ scope check but takes the raw payload path
#      (`RESOLVED="$BASH_EDITED"`): no canonicalization, no containment. Only
#      a path spelled under sessions/ that leaves the root can tell, so it must
#      kill exactly the `..`-through-sessions case and the sessions/ symlink to
#      an outside file. The symlink case tells only because it also asserts the
#      link is still a link: scrub-secrets.sh does not write through it, it
#      replaces it with a regular file, so the outside file is intact either
#      way and the content check alone cannot see this mutant. Mutant 7 kills
#      it for the same reason.

# THIS SCRIPT'S OWN PASS CONDITION. A negative control that cannot fail is the
# same vacuous test it exists to prevent, and until #T170 this was one: it ran
# under `set -uo` with no `-e`, printed the mutants' results, and exited 0 on
# whatever they were. Every expectation in the comments above is now checked —
# each mutant must FAIL hook-smoke.sh, and must kill exactly the assertions it
# claims to target — and a mismatch, or any error building a mutant, exits 1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS="$PROJECT_ROOT/.claude/hooks"
WORK="$(mktemp -d)"
# Every mutant is a COPY under $WORK that the suite is pointed at with
# PROJECT_OS_TEST_HOOKS; the repo's own hooks are never edited. The trap is what
# makes that true on the failure paths too.
trap 'rm -rf "$WORK"' EXIT

HOOK_NAMES="_common.sh output-index.sh compact-suggest.sh tool-failure-log.sh post-tool-use.sh session-end-cleanup.sh post-write-session.sh log-activity.sh"

CTL_FAIL=0

# ctl_fail <case> <detail> — the control did not behave as documented. Recorded
# rather than fatal, so one run reports every broken mutant instead of the first.
ctl_fail() {
    CTL_FAIL=$((CTL_FAIL + 1))
    echo "NEGCTL FAIL [$1]: $2"
}

# fatal <case> <detail> — the mutant could not be built or the suite did not
# run. Nothing downstream means anything after this, so stop.
fatal() {
    echo "NEGCTL ERROR [$1]: $2"
    exit 1
}

oneline() { printf '%s' "$1" | tr '\n' ' '; }

# failed_names <log> — names of the assertions that failed, deduped. hook-smoke
# prints each FAIL twice (inline, then in its summary), so `sort -u` is load
# bearing rather than cosmetic.
failed_names() {
    grep '^  FAIL: ' "$1" | sed 's/^  FAIL: //; s/ — .*$//' | sort -u || true
}

# passed_names <log> — names of the assertions that survived.
passed_names() {
    grep '^  PASS: ' "$1" | sed 's/^  PASS: //; s/ — .*$//' | sort -u || true
}

# check_suite_ran <case> <log> — a mutant that crashes the suite before it
# reports would otherwise read as "everything was killed".
check_suite_ran() {
    if ! grep -q '^=== Results ===' "$2"; then
        echo "--- last 20 lines of the run ---"
        tail -n 20 "$2"
        fatal "$1" "hook-smoke.sh never reached its summary — the run itself broke"
    fi
}

# ── Mutant 1: stubs ─────────────────────────────────────────────────────────
STUB="$WORK/stub"
mkdir -p "$STUB"
for h in $HOOK_NAMES; do
    printf '#!/bin/bash\nexit 0\n' > "$STUB/$h"
done

# The survivors the header licenses: liveness (`_exitsZero`) and the negative
# assertions, which a hook that does nothing at all trivially satisfies. Any
# other survivor is an assertion that names an EFFECT and passed against a stub,
# which is the exact defect this file exists to catch.
STUB_SURVIVORS_OK='_(exitsZero|notOnStdout|doesNotIndex|noHint|indexerNeverInvoked|emitsNothing|doesNotLog[A-Za-z]*|writesNothing|noSideEffect|deliberatelyKept|notPruned|nothingDeleted[A-Za-z]*|doesNotCreateOne)$'

# Explicit, not pattern-matched: hook-smoke.sh's "payload schema" block greps
# the repo's own source (this file and $PROJECT_ROOT/.claude/hooks) rather than
# $REAL_HOOKS/the sandboxed hooks, by design — a mutant tree would let it pass
# vacuously (see the comment above it in hook-smoke.sh). It is therefore
# invariant across every mutant here, stub included: nothing this script builds
# changes what it checks, so it is always expected to survive.
#
# notifyPhaseChange_windowsTerminalOnly_exit0StderrLineNoStdout is the same
# shape: notify-phase-change.sh is not in HOOK_NAMES, so it is never copied
# into a mutant dir, and the assertion runs it from $PROJECT_ROOT/.claude/hooks
# directly rather than $REAL_HOOKS. It is therefore invariant here too.
STUB_STATIC_SURVIVORS="payloadSchema_fixturesInThisFile_nameToolInputAndToolResponse
payloadSchema_hookScripts_readToolInputAndToolResponse
toolFailureLog_settingsWiring_registeredOnlyOnPostToolUseFailure
activityLog_settingsWiring_modelSwitchedOnPostModelSwitch
bashEditDiff_settingsWiring_bothHooksOnBashMatcher
notifyPhaseChange_windowsTerminalOnly_exit0StderrLineNoStdout"

echo "=== mutant 1: all hooks stubbed to \`exit 0\` ==="
STUB_STATUS=0
PROJECT_OS_TEST_HOOKS="$STUB" bash "$SCRIPT_DIR/hook-smoke.sh" > "$WORK/stub.out" 2>&1 || STUB_STATUS=$?
echo "exit: $STUB_STATUS"
check_suite_ran "mutant 1" "$WORK/stub.out"
echo "--- surviving assertions (must all be _exitsZero / liveness / negative) ---"
passed_names "$WORK/stub.out"
echo "--- killed ---"
failed_names "$WORK/stub.out"
if [ "$STUB_STATUS" -eq 0 ]; then
    ctl_fail "mutant 1" "hook-smoke.sh PASSED against hooks that do nothing at all"
fi
STUB_UNEXPECTED="$(passed_names "$WORK/stub.out" | grep -Ev "$STUB_SURVIVORS_OK" | grep -Fxv "$STUB_STATIC_SURVIVORS" || true)"
if [ -n "$STUB_UNEXPECTED" ]; then
    ctl_fail "mutant 1" "effect assertions survived the stubs: $(oneline "$STUB_UNEXPECTED")"
fi
if [ -z "$(failed_names "$WORK/stub.out")" ]; then
    ctl_fail "mutant 1" "the stubs killed no assertion at all"
fi
echo ""

# ── Shared mutant plumbing ──────────────────────────────────────────────────
# build_mutant <dir> — copies the real hooks; the caller then edits one.
build_mutant() {
    local dir="$1" h
    mkdir -p "$dir"
    for h in $HOOK_NAMES; do
        cp "$HOOKS/$h" "$dir/$h"
    done
}

# run_mutant <label> <dir> <expected-victim>... — runs the suite against the
# mutant and holds it to both halves of the contract: the suite must FAIL, and
# it must kill EXACTLY the named assertions. More than the target means the
# mutant isolates nothing; fewer means the sabotage did not bite.
run_mutant() {
    local label="$1" dir="$2"
    shift 2
    local log="$dir.out" status=0 expected actual
    echo "=== $label ==="
    PROJECT_OS_TEST_HOOKS="$dir" bash "$SCRIPT_DIR/hook-smoke.sh" > "$log" 2>&1 || status=$?
    echo "exit: $status"
    echo "--- killed (expect exactly: $*) ---"
    failed_names "$log"
    check_suite_ran "$label" "$log"
    if [ "$status" -eq 0 ]; then
        ctl_fail "$label" "hook-smoke.sh PASSED against this mutant — it proves nothing"
    fi
    expected="$(printf '%s\n' "$@" | sort -u)"
    actual="$(failed_names "$log")"
    if [ "$expected" != "$actual" ]; then
        ctl_fail "$label" "killed [$(oneline "$actual")] — expected exactly [$(oneline "$expected")]"
    fi
    echo ""
}

# ── Mutant 2: post-tool-use.sh without payload-path conversion ──────────────
RAW="$WORK/rawpath"
build_mutant "$RAW"
# Revert the one line under test.
sed -i 's|^FILE=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")$|FILE=$(extract_file_path "$INPUT")|' "$RAW/post-tool-use.sh"
# The guard looks for the CODE line, not the identifier: the fix ships with a
# comment explaining itself, and grepping the bare name matched that comment and
# reported an applied mutant as unapplied.
if grep -q '^FILE=.*canonicalize_payload_path' "$RAW/post-tool-use.sh"; then
    fatal "mutant 2" "NOT APPLIED — the conversion line was not reverted"
fi

run_mutant "mutant 2: post-tool-use.sh takes the payload path unconverted" \
    "$RAW" "postToolUse_backslashPayloadPath_stillResolved"

# ── Mutant 3: the #T213 failure-event move ──────────────────────────────────
# Mutant 3 is #T213's regression: the hook is moved off PostToolUse and no longer
# looks for `is_error`. The mutant restores the gate by rewriting the one line
# that reads the name, in a pass over the file rather than sed, because the
# replacement is three lines of shell full of quotes.
GATE="$WORK/is-error-gate"
build_mutant "$GATE"
# stdin is single-use, so the gate slurps it once and the name is read from the
# copy — which is also the unbounded slurp the old hook avoided; irrelevant to
# what this mutant is for.
cat > "$WORK/gate-block.txt" <<'GATEBLOCK'
PAYLOAD=$(cat)
printf '%s\n' "$PAYLOAD" | grep -qaE '"is_error"[[:space:]]*:[[:space:]]*true' || exit 0
TOOL_NAME_RAW=$(printf '%s\n' "$PAYLOAD" | grep -aoE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | sed -n '1p' || true)
GATEBLOCK
GATE_TMP="$WORK/is-error-gate.new"
: > "$GATE_TMP"
while IFS= read -r line; do
    case "$line" in
        'TOOL_NAME_RAW=$(grep -aoE'*) cat "$WORK/gate-block.txt" >> "$GATE_TMP" ;;
        *) printf '%s\n' "$line" >> "$GATE_TMP" ;;
    esac
done < "$GATE/tool-failure-log.sh"
cp "$GATE_TMP" "$GATE/tool-failure-log.sh"
if ! grep -q 'is_error' "$GATE/tool-failure-log.sh"; then
    fatal "mutant 3" "NOT APPLIED — the is_error gate is not in the mutant"
fi
run_mutant "mutant 3: tool-failure-log.sh gates on is_error again" \
    "$GATE" \
    "toolFailureLog_nativeFailure_logsToolName" \
    "toolFailureLog_punctuationInToolName_strippedNotEscaped" \
    "toolFailureLog_punctuationInToolName_stillOneLine" \
    "toolFailureLog_largeToolInput_stillLogged"

# ── Mutants 4-5: the #T148 payload bound ────────────────────────────────────
NODRAIN="$WORK/no-drain"
build_mutant "$NODRAIN"
# Drop the `wc -c` that consumes the remainder. It also reports the count, so
# this mutant necessarily takes the truncation flag with it — it kills TWO
# assertions, and that is stated rather than papered over.
sed -i 's|^    rest=$(wc -c 2>/dev/null.*|    rest=0|' "$NODRAIN/_common.sh"
# Anchored to the CODE line. `wc -c` also appears in the comment above it
# explaining why the drain is there, and grepping the bare command reported an
# applied mutant as unapplied — the same way mutant 2's guard did before it was
# anchored.
if grep -q '^    rest=$(wc -c' "$NODRAIN/_common.sh"; then
    fatal "mutant 4" "NOT APPLIED — the drain is still there"
fi
# Two victims, for the reason stated at the top: the same `wc -c` both drains
# and counts, so removing it takes the truncation notice with it.
run_mutant "mutant 4: read_hook_payload does not drain the remainder" \
    "$NODRAIN" "postToolUse_payloadPastBound_exitsZero" \
    "postToolUse_filePathBeyondBound_saysSoOnStderr" \
    "postWriteSession_payloadPastBound_exitsZero" \
    "postWriteSession_filePathBeyondBound_saysSoOnStderr"

SILENT="$WORK/silent-truncation"
build_mutant "$SILENT"
sed -i '/post-tool-use: payload exceeded/d' "$SILENT/post-tool-use.sh"
sed -i '/post-write-session: payload exceeded/d' "$SILENT/post-write-session.sh"
if grep -q 'not formatting' "$SILENT/post-tool-use.sh" || grep -q 'not scrubbing' "$SILENT/post-write-session.sh"; then
    fatal "mutant 5" "NOT APPLIED — the notice is still there"
fi
run_mutant "mutant 5: truncated file_path degrades silently" \
    "$SILENT" "postToolUse_filePathBeyondBound_saysSoOnStderr" \
    "postWriteSession_filePathBeyondBound_saysSoOnStderr"

# ── Mutant 6: containment removed (#T202) ───────────────────────────────────
NOCONTAIN="$WORK/no-containment"
build_mutant "$NOCONTAIN"
sed -i 's|^    if \[\[ "$resolved" != "$project_root"/\* \]\]; then$|    if false; then|' "$NOCONTAIN/_common.sh"
if ! grep -q '^    if false; then$' "$NOCONTAIN/_common.sh"; then
    fatal "mutant 6" "NOT APPLIED — the containment comparison is still there"
fi
run_mutant "mutant 6: resolve_project_path does not check containment" \
    "$NOCONTAIN" "postToolUse_outOfProjectFile_noSideEffect" \
    "postToolUse_bashEditDiffOutsideRepo_noSideEffect" \
    "postToolUse_bashEditDiffPrefixCollision_noSideEffect" \
    "postToolUse_bashEditDiffSymlinkToOutside_noSideEffect" \
    "postToolUse_bashEditDiffParentDirSymlink_noSideEffect" \
    "postToolUse_bashEditDiffDotDotEscape_noSideEffect" \
    "postToolUse_bashEditDiffWindowsPathOutsideRoot_noSideEffect"

# ── Mutant 7: scrub without containment on the Bash branch (#T202) ─────────
SCRUBRAW="$WORK/scrub-no-containment"
build_mutant "$SCRUBRAW"
sed -i 's#^        RESOLVED=$(resolve_project_path "$(canonicalize_payload_path "$BASH_EDITED")") || continue$#        bash "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$BASH_EDITED"; continue#' \
    "$SCRUBRAW/post-write-session.sh"
if ! grep -q 'scrub-secrets.sh" "$BASH_EDITED"; continue$' "$SCRUBRAW/post-write-session.sh"; then
    fatal "mutant 7" "NOT APPLIED — the Bash branch still resolves its paths"
fi
run_mutant "mutant 7: post-write-session.sh Bash branch scrubs uncontained paths" \
    "$SCRUBRAW" "postWriteSession_bashEditDiffNonSessionFile_noSideEffect" \
    "postWriteSession_bashEditDiffOutsideRepo_noSideEffect" \
    "postWriteSession_bashEditDiffPrefixCollision_noSideEffect" \
    "postWriteSession_bashEditDiffDotDotThroughSessions_noSideEffect" \
    "postWriteSession_bashEditDiffSessionSymlinkToOutside_noSideEffect"

# ── Mutant 8: scrub scope check kept, containment dropped (#T202) ───────────
SCOPEONLY="$WORK/scrub-scope-only"
build_mutant "$SCOPEONLY"
sed -i 's#^        RESOLVED=$(resolve_project_path "$(canonicalize_payload_path "$BASH_EDITED")") || continue$#        RESOLVED="$BASH_EDITED"#' \
    "$SCOPEONLY/post-write-session.sh"
if ! grep -q '^        RESOLVED="$BASH_EDITED"$' "$SCOPEONLY/post-write-session.sh"; then
    fatal "mutant 8" "NOT APPLIED — the Bash branch still resolves its paths"
fi
run_mutant "mutant 8: post-write-session.sh Bash branch keeps scope, drops containment" \
    "$SCOPEONLY" "postWriteSession_bashEditDiffDotDotThroughSessions_noSideEffect" \
    "postWriteSession_bashEditDiffSessionSymlinkToOutside_noSideEffect"

# ── Verdict ─────────────────────────────────────────────────────────────────
echo "=== negative control ==="
if [ "$CTL_FAIL" -gt 0 ]; then
    echo "  $CTL_FAIL check(s) failed — see the NEGCTL FAIL lines above."
    echo "  Either hook-smoke.sh lost an assertion, or a mutant no longer applies."
    exit 1
fi
echo "  all 8 mutants behaved as documented — hook-smoke.sh detects broken hooks"
exit 0
