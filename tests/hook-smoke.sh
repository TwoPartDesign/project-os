#!/bin/bash
# Smoke tests for PostToolUse / SessionEnd hooks.
# Usage: bash tests/hook-smoke.sh
#
# TWO THINGS THIS FILE USED TO GET WRONG, both fixed in #T145.
#
# It ran the hooks against the LIVE repo. session-end-cleanup.sh prunes
# `.compact-handoff-*` records older than seven days, and a test invoking it
# with a real project root was therefore able to delete the ownership records
# that pre-compact.sh reads — a test suite that quietly damages the state of the
# thing it is testing. It also touched and removed files directly in
# `$PROJECT_ROOT/.claude/logs/`. Every test now runs in its own temp project.
#
# It asserted only exit codes. Every hook here is advisory: each one runs
# `set -euo pipefail` with `trap 'exit 0' ERR`, which is a promise that it exits
# 0 no matter what happens inside it. Asserting exit 0 against a script whose
# whole design is to exit 0 is close to asserting nothing — 14 of the 15
# original assertions passed against hooks replaced by `exit 0` stubs. The exit
# codes are still checked, because a hook that hangs or exits non-zero would
# break Claude Code, but every hook now also has at least one assertion about
# what it DID: a file written, a file left alone, a subprocess invoked, a line
# on stderr.
#
# Mutation testing: point PROJECT_OS_TEST_HOOKS at a directory of deliberately
# broken hooks and every behavioural assertion must fail there. The stub control
# lives at tests/hook-smoke-negctl.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# The hooks under test. Overridable so the suite can be run against a mutant
# tree without editing it — the same mechanism tests/compaction-hooks.sh uses.
REAL_HOOKS="${PROJECT_OS_TEST_HOOKS:-$PROJECT_ROOT/.claude/hooks}"

PASS=0
FAIL=0
ERRORS=""

ok() {
    PASS=$((PASS + 1))
    echo "  PASS: $1"
}

nope() {
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}
  FAIL: $1"
    echo "  FAIL: $1"
}

assert_eq() {
    local name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then ok "$name"
    else nope "$name — expected [$expected], got [$actual]"; fi
}

assert_contains() {
    local name="$1" haystack="$2" needle="$3"
    case "$haystack" in
        *"$needle"*) ok "$name" ;;
        *) nope "$name — expected output to contain: $needle" ;;
    esac
}

assert_not_contains() {
    local name="$1" haystack="$2" needle="$3"
    case "$haystack" in
        *"$needle"*) nope "$name — output unexpectedly contained: $needle" ;;
        *) ok "$name" ;;
    esac
}

assert_file_exists() {
    local name="$1" path="$2"
    if [ -e "$path" ]; then ok "$name"; else nope "$name — expected to exist: $path"; fi
}

assert_file_absent() {
    local name="$1" path="$2"
    if [ -e "$path" ]; then nope "$name — expected NOT to exist: $path"; else ok "$name"; fi
}

# ── Sandbox ─────────────────────────────────────────────────────────────────
# Each hook derives its project root from its own location ($SCRIPT_DIR/../..),
# so a hook COPIED into <sandbox>/.claude/hooks/ reads and writes only inside
# the sandbox. That is the whole isolation mechanism — no environment variable
# redirects these hooks, and none should, since a root that a payload or a
# parent process can move is a root an untrusted repo can move.
SANDBOXES=()
cleanup() {
    local sb
    for sb in ${SANDBOXES+"${SANDBOXES[@]}"}; do
        [ -n "$sb" ] && rm -rf "$sb"
    done
}
trap cleanup EXIT

new_sandbox() {
    local sb h
    sb="$(mktemp -d)"
    SANDBOXES+=("$sb")
    mkdir -p "$sb/.claude/hooks" "$sb/.claude/logs" "$sb/.claude/sessions" "$sb/scripts"
    for h in _common.sh output-index.sh compact-suggest.sh tool-failure-log.sh \
             post-tool-use.sh session-end-cleanup.sh; do
        cp "$REAL_HOOKS/$h" "$sb/.claude/hooks/$h" 2>/dev/null || true
    done
    printf '%s' "$sb"
}

# run_hook <sandbox> <hook-name> <stdin> [VAR=val ...]
#   -> sets HOOK_EXIT, HOOK_OUT, HOOK_ERR
#
# stdout and stderr are captured separately: output-index.sh's advisory hint is
# a stderr line, and merging the streams would let a stdout write masquerade as
# it.
#
# Environment goes through `env`, not through a `VAR=val run_hook …` prefix. For
# a FUNCTION, bash keeps such an assignment in the shell after the call returns,
# so one test setting CONTEXT_FILTER_DISABLED=1 would silently disable indexing
# for every test that followed it — a whole section passing for the wrong
# reason. Passing it as an argument keeps the setting inside the one process
# that is supposed to see it.
HOOK_EXIT=0; HOOK_OUT=""; HOOK_ERR=""
run_hook() {
    local sb="$1" hook="$2" input="$3"
    shift 3
    local errf="$sb/.stderr"
    HOOK_EXIT=0
    HOOK_OUT=$(printf '%s' "$input" | env "$@" bash "$sb/.claude/hooks/$hook" 2>"$errf") || HOOK_EXIT=$?
    HOOK_ERR=$(cat "$errf" 2>/dev/null || true)
}

# A stand-in for scripts/knowledge-index.ts. The real one opens a SQLite
# database; what output-index.sh's own logic is responsible for is reading the
# threshold, comparing it against the output size, invoking the indexer, and
# emitting the hint. The stub records its argv so all four can be asserted
# without a database, and answers `config threshold_bytes` with a value small
# enough that a one-line fixture crosses it.
write_index_stub() {
    local sb="$1"
    cat > "$sb/scripts/knowledge-index.ts" <<'STUB'
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, '..', 'index-calls.log'), args[0] + '\n');
if (args[0] === 'config') console.log('100');
process.exit(0);
STUB
}

index_calls() {
    cat "$1/index-calls.log" 2>/dev/null || true
}

# Minimal valid hook payloads.
VALID_READ='{"tool_name":"Read","arguments":{"file_path":"/x/test.txt"},"output":"hello world","is_error":false}'
VALID_ERROR='{"tool_name":"Bash","arguments":{"command":"false"},"output":"failed","is_error":true}'
EMPTY_INPUT='{}'
INVALID_JSON='not json at all'

echo "=== Hook Smoke Tests ==="
echo ""

# ── output-index.sh ─────────────────────────────────────────────────────────
echo "output-index.sh:"

SB=$(new_sandbox)
write_index_stub "$SB"
BIG=$(printf 'x%.0s' $(seq 1 4000))
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"arguments\":{\"file_path\":\"/x/big.txt\"},\"output\":\"$BIG\",\"is_error\":false}"
assert_eq "outputIndex_largeOutput_exitsZero" 0 "$HOOK_EXIT"
assert_contains "outputIndex_largeOutput_invokesIndexer" "$(index_calls "$SB")" "index"
assert_contains "outputIndex_largeOutput_emitsHintOnStderr" "$HOOK_ERR" "Large output indexed"
# The hint is advisory context, not tool output. A hook that printed it on
# stdout would be corrupting the stream the tool result travels on.
assert_eq "outputIndex_hint_notOnStdout" "" "$HOOK_OUT"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh "$VALID_READ"
assert_eq "outputIndex_smallOutput_exitsZero" 0 "$HOOK_EXIT"
# `config` is read before the size comparison, so the stub IS invoked; what must
# not appear is an `index` call. Asserting on the log's content rather than its
# existence is what makes this discriminate.
assert_not_contains "outputIndex_smallOutput_doesNotIndex" "$(index_calls "$SB")" "index"
assert_not_contains "outputIndex_smallOutput_noHint" "$HOOK_ERR" "Large output indexed"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"arguments\":{\"file_path\":\"/x/big.txt\"},\"output\":\"$BIG\",\"is_error\":false}" \
    CONTEXT_FILTER_DISABLED=1
assert_eq "outputIndex_disabled_exitsZero" 0 "$HOOK_EXIT"
# The kill switch has to cut the work, not just the hint. If the indexer still
# ran, "disabled" would mean "silent", which is the opposite of the point.
assert_file_absent "outputIndex_disabled_indexerNeverInvoked" "$SB/index-calls.log"

SB=$(new_sandbox)
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"arguments\":{\"file_path\":\"/x/big.txt\"},\"output\":\"$BIG\",\"is_error\":false}"
assert_eq "outputIndex_noIndexScript_exitsZero" 0 "$HOOK_EXIT"
assert_not_contains "outputIndex_noIndexScript_noHint" "$HOOK_ERR" "Large output indexed"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh "$EMPTY_INPUT"
assert_eq "outputIndex_emptyJson_exitsZero" 0 "$HOOK_EXIT"
run_hook "$SB" output-index.sh "$INVALID_JSON"
assert_eq "outputIndex_invalidJson_exitsZero" 0 "$HOOK_EXIT"
assert_not_contains "outputIndex_invalidJson_doesNotIndex" "$(index_calls "$SB")" "index"

echo ""

# ── compact-suggest.sh ──────────────────────────────────────────────────────
# The forwarding, ownership and transcript-measurement behaviour of this hook is
# covered in depth by tests/compaction-hooks.sh. What is asserted here is the
# outermost contract — that a pressure signal reaches stdout as a well-formed
# PostToolUse response, and that it is issued once per compaction cycle.
echo "compact-suggest.sh:"

SB=$(new_sandbox)
printf '{"type":"user","message":{"content":"hello"}}\n' > "$SB/transcript.jsonl"
# The byte-growth branch, with the threshold lowered to something a one-line
# fixture crosses. The transcript carries no usage record, which is what selects
# that branch; the default 1.2 MB threshold would otherwise need a 1.2 MB file.
NUDGE_ENV=PROJECT_OS_COMPACT_NUDGE_BYTES=10
run_hook "$SB" compact-suggest.sh \
    "{\"session_id\":\"smoke1\",\"hook_event_name\":\"PostToolUse\",\"transcript_path\":\"$SB/transcript.jsonl\",\"tool_name\":\"Read\",\"output\":\"ok\",\"is_error\":false}" \
    "$NUDGE_ENV"
assert_eq "compactSuggest_pressure_exitsZero" 0 "$HOOK_EXIT"
assert_contains "compactSuggest_pressure_emitsAdditionalContext" "$HOOK_OUT" \
    '"hookEventName":"PostToolUse"'
assert_contains "compactSuggest_pressure_namesTheHandoffCommand" "$HOOK_OUT" "/tools:handoff"
assert_file_exists "compactSuggest_pressure_spendsTheCycleMarker" \
    "$SB/.claude/logs/.compact-nudged-smoke1"

# Second firing, same cycle. One nudge per compaction cycle is the whole reason
# the marker exists; a hook that re-emitted would spend context on every tool
# call for the rest of the session.
run_hook "$SB" compact-suggest.sh \
    "{\"session_id\":\"smoke1\",\"hook_event_name\":\"PostToolUse\",\"transcript_path\":\"$SB/transcript.jsonl\",\"tool_name\":\"Read\",\"output\":\"ok\",\"is_error\":false}" \
    "$NUDGE_ENV"
assert_eq "compactSuggest_secondFiringSameCycle_emitsNothing" "" "$HOOK_OUT"

SB=$(new_sandbox)
run_hook "$SB" compact-suggest.sh "$EMPTY_INPUT"
assert_eq "compactSuggest_emptyJson_exitsZero" 0 "$HOOK_EXIT"
# No transcript to measure means no basis for a pressure claim. Emitting here
# would be a nudge invented from nothing.
assert_eq "compactSuggest_emptyJson_emitsNothing" "" "$HOOK_OUT"

echo ""

# ── tool-failure-log.sh ─────────────────────────────────────────────────────
echo "tool-failure-log.sh:"

SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$VALID_ERROR"
assert_eq "toolFailureLog_isError_exitsZero" 0 "$HOOK_EXIT"
assert_contains "toolFailureLog_isError_logsToolName" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "FAIL tool=Bash"
# The hook's contract is that it never records content. A log line carrying the
# command or the output would be a privacy regression that an exit code cannot
# see.
assert_not_contains "toolFailureLog_isError_doesNotLogOutput" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "failed"

SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$VALID_READ"
assert_eq "toolFailureLog_nonError_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "toolFailureLog_nonError_writesNothing" \
    "$SB/.claude/logs/tool-failures.log"

SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$INVALID_JSON"
assert_eq "toolFailureLog_invalidJson_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "toolFailureLog_invalidJson_writesNothing" \
    "$SB/.claude/logs/tool-failures.log"

SB=$(new_sandbox)
# tool_name is attacker-influenced in the sense that matters here: it reaches an
# append-only log a human reads. The sanitizer keeps [[:alnum:]_-], so the
# separators that would forge a second entry are dropped rather than escaped.
run_hook "$SB" tool-failure-log.sh \
    '{"tool_name":"Bash; rm -rf /","arguments":{},"output":"x","is_error":true}'
LOGGED=$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)
assert_contains "toolFailureLog_punctuationInToolName_strippedNotEscaped" \
    "$LOGGED" "FAIL tool=Bashrm-rf"
assert_eq "toolFailureLog_punctuationInToolName_stillOneLine" 1 \
    "$(printf '%s\n' "$LOGGED" | grep -c 'FAIL tool=')"

echo ""

# ── post-tool-use.sh ────────────────────────────────────────────────────────
echo "post-tool-use.sh:"

SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"arguments\":{\"file_path\":\"$SB/note.md\"},\"output\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_inProjectFile_exitsZero" 0 "$HOOK_EXIT"
# A .md file matches no formatter branch, so the only observable effect is that
# the hook got PAST containment. That is the thing worth asserting: the log
# directory is created after resolve_project_path returns, and never before it.
assert_file_exists "postToolUse_inProjectFile_reachesLogDirSetup" "$SB/.claude/logs"

SB=$(new_sandbox)
OUTSIDE=$(mktemp -d)
SANDBOXES+=("$OUTSIDE")
printf 'x\n' > "$OUTSIDE/elsewhere.md"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"arguments\":{\"file_path\":\"$OUTSIDE/elsewhere.md\"},\"output\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_outOfProjectFile_exitsZero" 0 "$HOOK_EXIT"
# The containment check has to be the FIRST thing with an effect. If the log
# directory appeared here, the hook would be doing work on behalf of a path it
# is about to reject.
assert_file_absent "postToolUse_outOfProjectFile_noSideEffect" "$SB/.claude/logs"

SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
# Windows delivers file_path as a native backslash path, and the runtime's JSON
# escaping doubles each separator. Unconverted, `[ -f ]` fails and the hook
# silently formats nothing — the same silent no-op that
# canonicalize_payload_path exists to prevent one layer down.
WINPATH=$(printf '%s' "$SB/note.md" | sed 's|/|\\\\|g')
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"arguments\":{\"file_path\":\"$WINPATH\"},\"output\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_backslashPayloadPath_exitsZero" 0 "$HOOK_EXIT"
assert_file_exists "postToolUse_backslashPayloadPath_stillResolved" "$SB/.claude/logs"

SB=$(new_sandbox)
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh "$EMPTY_INPUT"
assert_eq "postToolUse_emptyJson_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "postToolUse_emptyJson_noSideEffect" "$SB/.claude/logs"

echo ""

# ── session-end-cleanup.sh ──────────────────────────────────────────────────
echo "session-end-cleanup.sh:"

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
touch "$LOGS/.tool-count-smoke1" "$LOGS/.tool-count-smoke1.lock"
touch "$LOGS/.compact-cycle-smoke1" "$LOGS/.compact-handoff-smoke1"
touch "$LOGS/.tool-count-other"
touch -d '8 days ago' "$LOGS/.tool-count-ancient" 2>/dev/null || touch "$LOGS/.tool-count-ancient"
run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
assert_eq "sessionEnd_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "sessionEnd_ownCounter_removed" "$LOGS/.tool-count-smoke1"
assert_file_absent "sessionEnd_ownCounterLock_removed" "$LOGS/.tool-count-smoke1.lock"
assert_file_absent "sessionEnd_ownCycleMarker_removed" "$LOGS/.compact-cycle-smoke1"
# The one marker deliberately NOT removed: pre-compact.sh reads ownership
# records across sessions, so deleting this at SessionEnd would un-claim the
# handoff the moment the session exits.
assert_file_exists "sessionEnd_ownHandoffRecord_deliberatelyKept" "$LOGS/.compact-handoff-smoke1"
assert_file_exists "sessionEnd_freshForeignCounter_notPruned" "$LOGS/.tool-count-other"

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
if touch -d '8 days ago' "$LOGS/.tool-count-ancient" 2>/dev/null; then
    run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
    assert_file_absent "sessionEnd_staleForeignCounter_pruned" "$LOGS/.tool-count-ancient"
else
    echo "  SKIP: sessionEnd_staleForeignCounter_pruned (touch -d unsupported)"
fi

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
touch "$LOGS/.tool-count-evil"
touch "$SB/.tool-count-evil"
# session_id lands in a filename. `../../.tool-count-evil` sanitizes to
# `.tool-countevil` — every separator and dot dropped — so neither the intended
# escape nor the in-directory file of that name is what gets deleted. Asserting
# BOTH is the point: a sanitizer that merely stripped `..` would leave the
# escape working through the slashes.
run_hook "$SB" session-end-cleanup.sh '{"session_id":"../../.tool-count-evil","reason":"exit"}'
assert_eq "sessionEnd_traversalSessionId_exitsZero" 0 "$HOOK_EXIT"
assert_file_exists "sessionEnd_traversalSessionId_nothingDeletedOutsideLogDir" "$SB/.tool-count-evil"
assert_file_exists "sessionEnd_traversalSessionId_nothingDeletedInsideEither" "$LOGS/.tool-count-evil"

SB=$(new_sandbox)
run_hook "$SB" session-end-cleanup.sh "$EMPTY_INPUT"
assert_eq "sessionEnd_emptyJson_exitsZero" 0 "$HOOK_EXIT"
run_hook "$SB" session-end-cleanup.sh "$INVALID_JSON"
assert_eq "sessionEnd_invalidJson_exitsZero" 0 "$HOOK_EXIT"

SB=$(new_sandbox)
rm -rf "$SB/.claude/logs"
run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
assert_eq "sessionEnd_noLogDir_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "sessionEnd_noLogDir_doesNotCreateOne" "$SB/.claude/logs"

echo ""

# ── Summary ─────────────────────────────────────────────────────────────────
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    printf '%s\n' "$ERRORS"
    exit 1
fi

exit 0
