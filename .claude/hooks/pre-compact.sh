#!/bin/bash
# PreCompact hook: forward the session's drafted compact instruction to the
# compaction summarizer, and save a filesystem-derived checkpoint as a fallback.
#
# Receives JSON on stdin: {"session_id":..., "trigger":"auto"|"manual",
#                          "transcript_path":..., "custom_instructions":...}
#
# STDOUT CONTRACT — read this before changing any `printf` below.
# The runtime collects the stdout of every successful PreCompact hook into
# `newCustomInstructions` and merges it into the compaction's own custom
# instructions (after the user's, separated by a blank line). Whatever this
# script prints therefore becomes guidance for the summarizer. Two consequences:
#   1. Print plain text only. Do NOT print a JSON envelope — it would be
#      forwarded verbatim as instructions.
#   2. Print nothing when there is nothing useful to say. Empty output is
#      filtered out by the runtime; noise is not.
#
# This hook does NOT block. Blocking is possible (exit 2) but pointless here:
# on the auto path the block reason reaches only a debug log, never Claude, so
# it defers compaction without telling anyone why. The nudge that actually
# causes a handoff to be written lives in compact-suggest.sh (PostToolUse),
# which can inject `additionalContext` into Claude's context.
#
# Advisory hook — never surfaces errors to Claude Code.

set -euo pipefail
trap 'exit 0' ERR

# ── Kill switch ─────────────────────────────────────────────────────────────
# Shared with compact-suggest.sh, deliberately: the two hooks are one feature,
# and disabling half of it — forwarding without nudging, or the reverse — is a
# state nobody wants to debug. One variable turns the whole gate off for a
# single run without editing tracked configuration.
#
# Written as an `if` rather than `[ … ] && exit 0`. Both are correct here —
# bash exempts a command in a non-final position of an && list from `set -e`
# and from the ERR trap, so the unset case falls through either way (verified,
# not assumed). The `if` is used because the exemption is a subtlety a reader
# has to recall to be sure, and a guard whose safety depends on remembering a
# `set -e` corner case is one edit away from not having it.
if [ -n "${PROJECT_OS_COMPACT_DISABLE:-}" ]; then
    exit 0
fi

# `pwd -P`: PROJECT_ROOT below is prefix-compared against paths that came back
# from resolve_project_path, which canonicalizes with realpath. A logical root
# and a physical candidate never compare equal on a checkout reached through a
# symlink, and the whole feature then silently declines every handoff.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

source "$SCRIPT_DIR/_common.sh"

SESSIONS_DIR="$PROJECT_ROOT/.claude/sessions"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
ROADMAP="$PROJECT_ROOT/ROADMAP.md"

# A handoff older than this is treated as describing earlier work, not the
# state being compacted away now.
HANDOFF_MAX_AGE_MIN="${PROJECT_OS_HANDOFF_MAX_AGE_MIN:-30}"

# Debounce for the checkpoint FILE WRITE only — never for the stdout
# contribution below, which must be emitted on every compaction.
CHECKPOINT_DEBOUNCE_MIN=10

# Escape a value for a double-quoted YAML scalar. Backslash goes first, so the
# escapes introduced after it are not themselves re-escaped.
#
# EVERY double-quoted scalar in the checkpoint built from data this hook did not
# author has to go through here. The checkpoint is one document: an unescaped
# character anywhere in it does not corrupt one field, it makes the whole file
# unparseable, and the next session loses the objective, the in-progress tasks
# and the handoff pointer along with the offending value. The path list learned
# that from an accented filename; the ROADMAP-derived values below are the same
# hazard from a source the reader controls even more directly — a task
# description reading `- [-] Fix the C:\path parser #T1` ends the scalar's
# escape sequence at `\p` and takes the document with it.
#
# TAB AND NEWLINE ARE NOT THE CONTROL CHARACTERS THAT REACH HERE. They were the
# two that got named, but a double-quoted YAML scalar forbids the whole C0 range
# (YAML 1.2 §5.7: only x09, x0A and x0D are permitted anywhere in a stream, and
# a literal x0A/x0D still terminates a single-line scalar). `git status -z`
# hands back raw bytes and a filename may legally contain any of them on POSIX;
# a ROADMAP line may contain any of them too. The one that actually shows up is
# CARRIAGE RETURN, which was missing outright — ROADMAP.md is CRLF in this very
# repository, so every value sliced out of it carries a trailing \r into a
# double-quoted scalar and breaks the document. Below x20 there is no
# single-character escape for most of the range, so the general case has to be
# \uXXXX; \t and \r keep their short forms because they are the common ones and
# the short form is what a human reading the checkpoint expects.
#
# Pure bash, no subprocess. This runs once per entry in the `git status` loop,
# so a `sed` pipeline here would be a fork per changed file for a function whose
# whole job is a fixed set of substitutions. `${v//…}` cannot express a byte
# RANGE, hence the explicit list — it is long, but it is a closed set that will
# never grow, and it costs no process.
#
# Backslash first, so the escapes introduced after it are not re-escaped. The
# rest are order-independent: each pattern is a single byte that no other
# expansion here produces.
yaml_escape() {
    local v="$1"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//$'\t'/\\t}"
    v="${v//$'\n'/\\n}"
    v="${v//$'\r'/\\r}"
    # No NUL arm. A bash variable cannot hold a NUL byte — the value is
    # truncated at it long before this function sees one — and `$'\x00'` is the
    # EMPTY STRING, so `${v//$'\x00'/…}` would match between every character and
    # interleave the replacement through the whole value.
    v="${v//$'\x01'/\\u0001}"
    v="${v//$'\x02'/\\u0002}"; v="${v//$'\x03'/\\u0003}"
    v="${v//$'\x04'/\\u0004}"; v="${v//$'\x05'/\\u0005}"
    v="${v//$'\x06'/\\u0006}"; v="${v//$'\x07'/\\a}"
    v="${v//$'\x08'/\\b}";     v="${v//$'\x0b'/\\v}"
    v="${v//$'\x0c'/\\f}";     v="${v//$'\x0e'/\\u000e}"
    v="${v//$'\x0f'/\\u000f}"; v="${v//$'\x10'/\\u0010}"
    v="${v//$'\x11'/\\u0011}"; v="${v//$'\x12'/\\u0012}"
    v="${v//$'\x13'/\\u0013}"; v="${v//$'\x14'/\\u0014}"
    v="${v//$'\x15'/\\u0015}"; v="${v//$'\x16'/\\u0016}"
    v="${v//$'\x17'/\\u0017}"; v="${v//$'\x18'/\\u0018}"
    v="${v//$'\x19'/\\u0019}"; v="${v//$'\x1a'/\\u001a}"
    v="${v//$'\x1b'/\\e}";     v="${v//$'\x1c'/\\u001c}"
    v="${v//$'\x1d'/\\u001d}"; v="${v//$'\x1e'/\\u001e}"
    v="${v//$'\x1f'/\\u001f}"; v="${v//$'\x7f'/\\u007f}"
    printf '%s' "$v"
}

mkdir -p "$SESSIONS_DIR" "$LOG_DIR"

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(session_id_from_json "$INPUT")
TRANSCRIPT=$(json_string_field "$INPUT" transcript_path)

TIMESTAMP_FILE=$(date +%Y-%m-%d-%H%M)
TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CHECKPOINT_FILE="$SESSIONS_DIR/auto-checkpoint-$TIMESTAMP_FILE.yaml"

# ── Locate the freshest handoff ─────────────────────────────────────────────
# MUST run before the cycle marker is touched below. The freshness rule reads
# that marker's mtime, so resetting it first would make every handoff look
# older than the current cycle and nothing would ever be forwarded.
#
# Freshness is "written during the current compaction cycle": the marker is
# touched at each compaction, so -newer than it means "since the last
# compaction". That is the question actually being asked, and it needs no
# tuning — a slow session that took two hours between handoff and compaction
# still qualifies, and a handoff from before the last compaction never does.
# The age window is the fallback for the first compaction of a session, when
# no marker exists yet.
#
# Filenames are handoff-YYYY-MM-DD-HHMMSS-<token>.yaml, so lexical order is
# chronological and `sort | tail -1` is portable where find -printf is not. The
# token is a collision-resistant suffix, not an identifier this hook reads — it
# sits after the full timestamp precisely so it cannot perturb that ordering.
# Names written before the suffix existed (…-HHMM.yaml) still sort correctly
# against it — but only in byte order, so the sort is pinned to LC_ALL=C. A
# UTF-8 locale collates punctuation weakly, which would rank the legacy
# `…-1400.yaml` above `…-140030-42.yaml` written thirty seconds later.
# -type f rejects symlinks; resolve_project_path enforces containment before
# any read.
#
# Timestamps alone cannot tell two sessions apart, and a second session working
# in the same checkout writes into the same directory. compact-suggest.sh
# records the path of any handoff THIS session wrote, so that record is
# consulted first; the glob remains for handoffs written by other means. Both
# paths obey the same freshness rule — ownership does not license forwarding a
# handoff this session wrote before the previous compaction.
CYCLE_FILE="$LOG_DIR/.compact-cycle-$SESSION_ID"
OWNED_FILE="$LOG_DIR/.compact-handoff-$SESSION_ID"

# The record holds every handoff this session wrote, appended in order, so the
# last line that still exists and is fresh is the one to forward.
#
# "Fresh" means the same thing on both branches, and it has to. An earlier
# version accepted an owned handoff of ANY age whenever the cycle marker was
# missing, on the reasoning that no marker means no compaction has happened
# yet. But missing-marker is not the same as recently-written, and the glob
# fallback below applies the age window in exactly that situation. Two ways the
# gap was reachable: a session that wrote a handoff and then worked for hours
# before its first compaction, and — more sharply — a session resuming after
# SessionEnd, since cleanup removes the session-private cycle marker while
# deliberately keeping the cross-session ownership record. Claims outliving
# markers is what makes the second case possible, so the retention fix that
# introduced it is the reason this branch now has to check age for itself.
#
# `read -r … || [ -n "$OWNED" ]` because a plain `read` loop DISCARDS a final
# line with no trailing newline: read returns non-zero at EOF and the loop exits
# with the value it just assigned unexamined. The record is appended to by a
# hook that can be killed mid-write, so an unterminated last line is reachable —
# and it is the newest claim, the one that matters most. The same shape guards
# the foreign-record loop below, where dropping a line means failing to exclude
# another session's handoff and forwarding its instruction here.
#
# `\r` is stripped for the same class of reason: the record can be written by a
# hook whose stdout was redirected through a Windows text-mode filter, and a
# trailing carriage return makes the path fail every `-f` test and every
# newline-framed comparison while looking correct in any output.
HANDOFF=""
if [ -f "$OWNED_FILE" ]; then
    while IFS= read -r OWNED || [ -n "$OWNED" ]; do
        OWNED="${OWNED%$'\r'}"
        [ -n "$OWNED" ] || continue
        # Containment BEFORE the path can become the answer, not after it
        # already is. This check used to live below the loop, applied once to
        # whatever value the loop settled on — so a single claim pointing
        # outside the project root was accepted here and nulled there, and the
        # discovery fallback, which is gated on HANDOFF still being empty,
        # never ran. One bad line starved forwarding permanently, for every
        # future compaction of the session. Skipping it here lets discovery
        # proceed exactly as if the claim had never been recorded.
        #
        # resolve_project_path subsumes the `-f` test it replaces: it requires a
        # regular file, resolves symlinks, and rejects anything that lands
        # outside the root.
        OWNED=$(resolve_project_path "$OWNED") || continue
        if [ -f "$CYCLE_FILE" ]; then
            [ "$OWNED" -nt "$CYCLE_FILE" ] || continue
        else
            # Same window, same tool as the fallback branch: -maxdepth 0 makes
            # find test this one path rather than descend anything.
            [ -n "$(find "$OWNED" -maxdepth 0 -mmin -"$HANDOFF_MAX_AGE_MIN" 2>/dev/null)" ] || continue
        fi
        HANDOFF="$OWNED"
    done < "$OWNED_FILE"
fi

if [ -z "$HANDOFF" ]; then
    if [ -f "$CYCLE_FILE" ]; then
        CANDIDATES=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name 'handoff-*.yaml' -newer "$CYCLE_FILE" 2>/dev/null | LC_ALL=C sort || true)
    else
        CANDIDATES=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name 'handoff-*.yaml' -mmin -"$HANDOFF_MAX_AGE_MIN" 2>/dev/null | LC_ALL=C sort || true)
    fi

    # Every session in this checkout writes its ownership record into the same
    # log directory, so a handoff another session claimed is identifiable even
    # from here. Skipping those makes the fallback safe in the case that
    # motivated ownership tracking; what remains unattributed is a handoff no
    # session claimed, which is the pre-existing behaviour.
    #
    # EVERY line of each foreign record counts, not just the newest: a session
    # that wrote two handoffs this cycle claims both, and reading only the last
    # would leave its earlier one looking unattributed and forwardable here.
    #
    # CLAIMED is newline-framed on both sides and matched with the newlines
    # included, so `/s/handoff-1.yaml` cannot be satisfied by a claim on
    # `/s/handoff-1.yaml` written under a longer directory prefix.
    CLAIMED=$'\n'
    for OWNERSHIP_RECORD in "$LOG_DIR"/.compact-handoff-*; do
        [ -f "$OWNERSHIP_RECORD" ] || continue
        case "$OWNERSHIP_RECORD" in
            */".compact-handoff-$SESSION_ID") continue ;;
        esac
        while IFS= read -r OTHER || [ -n "$OTHER" ]; do
            OTHER="${OTHER%$'\r'}"
            [ -n "$OTHER" ] || continue
            CLAIMED="$CLAIMED$OTHER"$'\n'
        done < "$OWNERSHIP_RECORD"
    done

    # Ascending order, so the last one accepted is the newest unclaimed handoff.
    while IFS= read -r CANDIDATE; do
        [ -n "$CANDIDATE" ] || continue
        case "$CLAIMED" in
            *$'\n'"$CANDIDATE"$'\n'*) continue ;;
        esac
        HANDOFF="$CANDIDATE"
    done <<< "$CANDIDATES"
fi
if [ -n "$HANDOFF" ]; then
    HANDOFF=$(resolve_project_path "$HANDOFF") || HANDOFF=""
fi

# ── Extract its compact_instruction scalar ──────────────────────────────────
# awk reads the file directly — no pipe from another command.
#
# (No apostrophes in this program — it is a single-quoted bash string, and one
# would terminate it mid-awk. \047 is the apostrophe where the program needs it.)
#
# Three things the previous four-line version got wrong, all of them silent:
#
# 1. A FLOW SCALAR was discarded. `compact_instruction: "one line"` is valid
#    YAML and is what a hand-edited handoff most often contains, but the key
#    line was matched and then `next`-ed, so the value on it was never read.
#    The result was not an error — it was an empty instruction, which reads
#    downstream as "this session wrote no handoff" and produced a checkpoint
#    note saying so while the handoff sat next to it.
# 2. `sub(/^  /, "")` stripped EXACTLY two spaces. A block scalar indented four
#    (equally valid, and what most YAML formatters emit) kept two spaces on
#    every line, so the forwarded instruction arrived as a code block.
# 3. A duplicated key CONCATENATED. Both blocks were captured into one value,
#    producing text belonging to neither. The first occurrence now wins and the
#    rest are ignored — deterministic, and the one reading that can never
#    invent a sentence the author did not write.
#
# The indent is taken from the first content line and removed from all of them,
# so any consistent indentation works and relative indentation inside the block
# survives.
COMPACT_INSTRUCTION=""
if [ -n "$HANDOFF" ]; then
    COMPACT_INSTRUCTION=$(awk '
        /^compact_instruction:/ {
            if (grab || done) { grab = 0; done = 1; next }
            rest = $0
            sub(/^compact_instruction:[[:space:]]*/, "", rest)
            sub(/[[:space:]]+$/, "", rest)
            # `|`, `>` and their chomping and indentation indicators introduce a
            # block; anything else on the line IS the value.
            if (rest != "" && rest !~ /^[|>][0-9+-]*$/) {
                if (rest ~ /^".*"$/ || rest ~ /^\047.*\047$/) {
                    rest = substr(rest, 2, length(rest) - 2)
                }
                print rest
                done = 1
                next
            }
            grab = 1
            indent = -1
            next
        }
        grab && /^[^[:space:]]/ { grab = 0; done = 1 }
        grab {
            if ($0 ~ /^[[:space:]]*$/) { print ""; next }
            if (indent < 0) {
                match($0, /^[[:space:]]*/)
                indent = RLENGTH
            }
            print substr($0, indent + 1)
        }
    ' "$HANDOFF" 2>/dev/null || true)
fi

# Drop a placeholder that was never filled in.
case "$COMPACT_INSTRUCTION" in
    *"[A /compact instruction tuned"*) COMPACT_INSTRUCTION="" ;;
esac

# ── System map: observe, never heal ─────────────────────────────────────────
# `check` re-hashes working-tree inputs against .maps.lock and exits 3 on
# drift. It writes nothing without --heal, and healing here would be wrong:
# the map's source of authority is the git index, and mid-build drift is
# expected rather than actionable.
#
# Gate on exit code 3 SPECIFICALLY, not on "nonzero". `check` uses 3 for drift
# and 1 for its own failure — a missing .maps.lock, an unparseable one, a Node
# that starts but throws. Treating every nonzero as drift reports "the system
# map is stale" for a checker that never got far enough to have an opinion,
# which sends the summarizer looking for a divergence that does not exist and
# hides the real fault (the checker is broken) behind a plausible one. An
# unreadable checker is not evidence about the map, so it is reported as
# neither drifted nor clean.
MAP_DRIFTED=0
if node_available "system map drift check" 2>/dev/null; then
    MAP_RC=0
    (cd "$PROJECT_ROOT" && node scripts/system-map.ts check >/dev/null 2>&1) || MAP_RC=$?
    # `if`, not `[ … ] && MAP_DRIFTED=1`: an && list whose left side fails is
    # the last command of this block, and leaving a compound statement with a
    # nonzero status under `set -e` plus an ERR trap is not worth the two saved
    # characters.
    if [ "$MAP_RC" -eq 3 ]; then
        MAP_DRIFTED=1
    fi
fi

# ── Checkpoint (debounced) ──────────────────────────────────────────────────
RECENT=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name "auto-checkpoint-*.yaml" -mmin -"$CHECKPOINT_DEBOUNCE_MIN" 2>/dev/null | head -1 || true)

if [ -z "$RECENT" ]; then
    # Phase from ROADMAP markers: [-] means build, [~] means review.
    # ROADMAP tasks are markdown list items — "- [-] Task #T1" — so the marker
    # is never at the start of the line. Patterns that anchored [-] to
    # line-start-plus-whitespace matched nothing, and every checkpoint recorded
    # phase "ad-hoc" / feature "none" regardless of what was in flight.
    HAS_BUILD=$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?\[-\]' "$ROADMAP" 2>/dev/null || true)
    HAS_REVIEW=$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?\[~\]' "$ROADMAP" 2>/dev/null || true)
    HAS_BUILD="${HAS_BUILD:-0}"
    HAS_REVIEW="${HAS_REVIEW:-0}"

    if [ "$HAS_BUILD" -gt 0 ]; then
        PHASE="build"
    elif [ "$HAS_REVIEW" -gt 0 ]; then
        PHASE="review"
    else
        PHASE="ad-hoc"
    fi

    # The feature owning the first in-progress task. An earlier version tracked
    # a per-section `found_task` flag and printed it at the next heading, which
    # reset the flag every time a new `## Feature:` heading appeared — so an
    # in-progress task in an early section was forgotten as soon as a later
    # section without one was read, and FEATURE came out "none". Printing at the
    # first marker instead removes the state that could be lost.
    FEATURE=$(awk '
        /^## Feature:/ { current = substr($0, index($0, ":") + 2); next }
        /^[[:space:]]*([-*][[:space:]]+)?\[[-~]\]/ {
            if (current != "") { print current; exit }
        }
    ' "$ROADMAP" 2>/dev/null | head -1 || true)
    FEATURE="${FEATURE#"${FEATURE%%[![:space:]]*}"}"
    FEATURE="${FEATURE%"${FEATURE##*[![:space:]]}"}"
    [ -z "$FEATURE" ] && FEATURE="none"

    IN_PROGRESS_RAW=$(awk '
        /^[[:space:]]*([-*][[:space:]]+)?\[-\]/ {
            line = $0
            sub(/^[[:space:]]*([-*][[:space:]]+)?\[-\][[:space:]]*/, "", line)
            sub(/[[:space:]]+#T[0-9]+.*$/, "", line)
            if (length(line) > 0) print line
        }
    ' "$ROADMAP" 2>/dev/null || true)

    # git status --porcelain, not git diff --name-only: the latter reports
    # neither staged nor untracked files, so a session that staged all its work
    # recorded an empty modified_files exactly when it had most to lose.
    #
    # --untracked-files=all because the default collapses a wholly untracked
    # directory to a single `?? dir/` entry. A session that built a new feature
    # under a new directory is precisely the one with the most to preserve, and
    # it would have handed the next session a directory name instead of the
    # files it just wrote. Ignored paths stay excluded either way, so this
    # expands what is already reported rather than widening the set.
    #
    # -z, and read through process substitution rather than a variable. Without
    # -z, git applies C-style quoting to any path outside plain ASCII: under the
    # default core.quotePath, `café.txt` is reported as `"caf\303\251.txt"`.
    # Stripping the surrounding quotes — all the previous version did — left the
    # octal escapes in place, and `\3` is not a legal escape inside a
    # double-quoted YAML scalar, so the checkpoint failed to parse *as a whole*.
    # One accented filename cost the session every other field in the file:
    # objective, in-progress tasks, handoff pointer. Untracked paths are the
    # ones most likely to be freshly created with a human-typed name, so the
    # expansion above walked straight into it.
    #
    # core.quotePath=false was not enough: it un-quotes non-ASCII only, and
    # leaves `"`, `\`, newline and tab quoted and escaped. -z disables quoting
    # entirely and emits paths as raw bytes. It cannot be captured with $( ),
    # which drops NUL bytes, hence the process substitution.

    IN_PROGRESS_YAML=""
    TASK_LIST=""
    if [ -n "$IN_PROGRESS_RAW" ]; then
        while IFS= read -r task_desc; do
            [ -z "$task_desc" ] && continue
            SAFE_DESC=$(yaml_escape "$task_desc")
            IN_PROGRESS_YAML="${IN_PROGRESS_YAML}    - description: \"${SAFE_DESC}\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
            if [ -n "$TASK_LIST" ]; then
                TASK_LIST="${TASK_LIST}; ${task_desc}"
            else
                TASK_LIST="$task_desc"
            fi
        done <<< "$IN_PROGRESS_RAW"
    fi

    if [ -z "$IN_PROGRESS_YAML" ]; then
        IN_PROGRESS_YAML="    - description: \"(none)\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
        TASK_LIST="(none)"
    fi

    MODIFIED_FILES_YAML=""
    while IFS= read -r -d '' entry; do
        [ -z "$entry" ] && continue
        st="${entry:0:2}"
        fpath="${entry:3}"
        # Under -z a rename or copy is two records — `XY <new>\0<old>\0` — not
        # one `old -> new` string. The destination arrives first, which is the
        # one worth recording, so the origin is read and dropped. Leaving it
        # unread would have made the *previous* filename the next entry, with
        # its status bytes taken from whatever the path happened to start with.
        case "$st" in
            R*|C*|?R|?C) IFS= read -r -d '' _origpath || true ;;
        esac
        [ -z "$fpath" ] && continue
        case "$st" in
            "??"*) ctype="created" ;;
            *D*)   ctype="deleted" ;;
            A*)    ctype="created" ;;
            *)     ctype="modified" ;;
        esac
        # -z hands back raw bytes, which is the point — and raw bytes are not
        # limited to the handful of characters a double-quoted scalar reserves.
        # A POSIX filename may contain any byte except `/` and NUL, so the whole
        # C0 range is in scope; yaml_escape covers it. (`st` goes through the
        # same function: it is two bytes of `git status` output, which is not
        # attacker-controlled today, but it is interpolated into a quoted scalar
        # exactly like the path is and there is no reason for the two to differ.)
        SAFE_PATH=$(yaml_escape "$fpath")
        SAFE_ST=$(yaml_escape "$st")
        MODIFIED_FILES_YAML="${MODIFIED_FILES_YAML}  - path: \"${SAFE_PATH}\"
    change_type: ${ctype}
    summary: \"uncommitted change (git status ${SAFE_ST})\"
"
    done < <(git -C "$PROJECT_ROOT" status --porcelain -z --untracked-files=all 2>/dev/null || true)

    # Three states, not two. Keying the note on COMPACT_INSTRUCTION alone
    # collapsed "no handoff exists" into the same sentence as "a handoff exists
    # and its instruction did not parse" — so the one failure a reader could act
    # on was reported as the one they cannot, and the file sitting right there
    # went unmentioned. Whoever reads the checkpoint is the person who can open
    # it; name it.
    if [ -n "$COMPACT_INSTRUCTION" ]; then
        HANDOFF_NOTE="Rich handoff available at ${HANDOFF#"$PROJECT_ROOT/"}"
    elif [ -n "$HANDOFF" ]; then
        HANDOFF_NOTE="A handoff exists at ${HANDOFF#"$PROJECT_ROOT/"} but carries no compact_instruction; read it directly."
    else
        HANDOFF_NOTE="No fresh handoff was written before this compaction; decisions and rationale from this session were not captured."
    fi

    # rename(2), not a truncating redirect at the final path.
    #
    # `>` FOLLOWS a symlink sitting at its target, and this target is guessable
    # to the minute. A branch that commits `.claude/sessions/auto-checkpoint-
    # <minute>.yaml` as a tracked symlink — git tracks symlinks, and `.gitignore`
    # does not suppress checkout of a tracked path — had the first compaction
    # truncate and overwrite whatever it pointed at, with partly attacker-chosen
    # content: a ROADMAP heading reached a file outside `.claude/`. Every READ in
    # this hook goes through resolve_project_path; this write went through
    # nothing. The debounce that would otherwise have noticed a pre-existing
    # object uses `find -type f`, which does not match symlinks at all, so the
    # single guard in front of the write was blind to exactly the object that
    # defeats it.
    #
    # Writing to a temp name in the same directory and renaming over the target
    # closes it without a check-then-write race: rename does not follow a symlink
    # in its final component, so a planted link is REPLACED rather than followed,
    # and the checkpoint is still written. Refusing outright was the other
    # option and is worse — it lets anyone who can add one file suppress
    # checkpointing for that minute, which is the silent-decline failure this
    # feature keeps having to fix. Same directory, so the rename is same-
    # filesystem and therefore atomic.
    #
    # `-type f` in the debounce is left alone deliberately. Now that the write
    # cannot follow a link, a symlink at the checkpoint path is not a checkpoint
    # this session wrote, and treating it as one would let a planted link
    # satisfy the debounce and suppress the real write — trading the overwrite
    # for the suppression.
    CHECKPOINT_TMP="$SESSIONS_DIR/.auto-checkpoint-$$.tmp"
    # Unlinks a stale temp, or a link planted at the temp name; `rm` removes the
    # link itself and never the target.
    rm -f "$CHECKPOINT_TMP"
    {
        printf 'timestamp: "%s"\n' "$TIMESTAMP_ISO"
        printf 'phase: "%s"\n' "$PHASE"
        printf 'feature: "%s"\n' "$(yaml_escape "$FEATURE")"
        printf '\n'
        printf 'objective: |\n'
        printf '  Auto-checkpoint before context compaction\n'
        printf '\n'
        printf 'progress:\n'
        printf '  completed: []\n'
        printf '  in_progress:\n'
        printf '%s' "$IN_PROGRESS_YAML"
        printf '\n'
        printf 'decisions: []\n'
        printf '\n'
        printf 'modified_files:\n'
        if [ -n "$MODIFIED_FILES_YAML" ]; then
            printf '%s' "$MODIFIED_FILES_YAML"
        else
            printf '  []\n'
        fi
        printf '\n'
        printf 'blockers: []\n'
        printf '\n'
        printf 'next_steps:\n'
        printf '  - priority: 1\n'
        printf '    action: "Resume with /tools:catchup"\n'
        printf '    context: "Auto-checkpoint captured before compaction"\n'
        printf '\n'
        printf 'context_notes: |\n'
        printf '  This checkpoint was auto-generated by the PreCompact hook.\n'
        printf '  %s\n' "$HANDOFF_NOTE"
        if [ "$MAP_DRIFTED" -eq 1 ]; then
            printf '  System map drifted at compaction time — it describes committed state.\n'
        fi
        printf '\n'
        # Literal block scalar, so FEATURE and TASK_LIST go in RAW — do not
        # route these through yaml_escape. A block scalar takes its content
        # verbatim; escaping would put a literal backslash into the summarizer's
        # instructions. Only the indentation matters, and both values are built
        # from `read -r` lines, so neither can contain a newline to break it.
        printf 'compact_instruction: |\n'
        printf '  Working on %s. In-progress tasks: %s.\n' "$FEATURE" "$TASK_LIST"
    } > "$CHECKPOINT_TMP"
    # Explicit `if`: a bare `mv` that fails would fire the ERR trap and exit 0
    # from a script whose ACTUAL job — forwarding the instruction to the
    # summarizer — is still below this block. A checkpoint that cannot be
    # written is worth losing; the forwarding is not.
    if mv -f "$CHECKPOINT_TMP" "$CHECKPOINT_FILE" 2>/dev/null; then
        :
    else
        rm -f "$CHECKPOINT_TMP"
    fi
fi

# ── Contribute to the compaction instructions ───────────────────────────────
# Plain text only. Silence when there is nothing worth saying.
if [ -n "$COMPACT_INSTRUCTION" ]; then
    printf '%s\n' "$COMPACT_INSTRUCTION"
    printf '\n'
    printf 'Session state for this work is saved at %s — read it with /tools:catchup before resuming.\n' "${HANDOFF#"$PROJECT_ROOT/"}"
    if [ "$MAP_DRIFTED" -eq 1 ]; then
        printf 'The system map at docs/maps/ is drifted: it describes committed state, not the working tree. Re-read hook and command wiring from source before trusting it.\n'
    fi
elif [ "$MAP_DRIFTED" -eq 1 ]; then
    printf 'The system map at docs/maps/ is drifted: it describes committed state, not the working tree. Re-read hook and command wiring from source before trusting it.\n'
fi

# ── Open the next compaction cycle ──────────────────────────────────────────
# Each cycle earns one nudge and accepts handoffs written after this point.
# The cycle marker is touched only here, never by compact-suggest.sh, so
# nothing can move the boundary mid-cycle.
#
# LAST, not before the forwarding above. Touching the marker closes the current
# cycle: the handoff just forwarded stops being "fresh", and the nudge marker is
# cleared. Done first, an abort in between — the hook's 30-second timeout, a
# failed write, the ERR trap — retires the cycle without the instruction ever
# reaching the summarizer, and nothing revisits it. Done last, the failure mode
# inverts to re-forwarding the same instruction at the next compaction, which
# is a duplicate rather than a loss. The discovery above already read
# CYCLE_FILE's old mtime, so ordering it after changes nothing it depends on.
touch "$CYCLE_FILE" 2>/dev/null || true
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    wc -c < "$TRANSCRIPT" > "$LOG_DIR/.compact-base-$SESSION_ID" 2>/dev/null || true
fi
rm -f "$LOG_DIR/.compact-nudged-$SESSION_ID"
# The nudge CLAIM as well as the marker. compact-suggest.sh arbitrates
# concurrent firings by creating this directory and releases it itself when the
# emit fails, but a firing killed between the two leaves it behind, and a
# leftover claim silences the nudge for every later cycle. Retiring the cycle is
# the one moment that is unambiguously safe to clear it: no firing of this
# session's hook is mid-emit while the runtime is blocked in PreCompact.
rmdir "$LOG_DIR/.compact-nudging-$SESSION_ID" 2>/dev/null || true

exit 0
