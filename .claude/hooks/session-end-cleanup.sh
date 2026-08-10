#!/bin/bash
# SessionEnd hook: clean up per-session artifacts in .claude/logs/
# - removes this session's .tool-count-<session_id> counter and its .lock
# - prunes counter/lock files older than 7 days from sessions that never
#   fired a SessionEnd (crashes, container reclaims)
# - opportunistically rotates the append-only logs
# Advisory hook — never surfaces errors, always exits 0.

set -euo pipefail
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

LOG_DIR="$(get_project_root)/.claude/logs"
[ -d "$LOG_DIR" ] || exit 0

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(echo "$INPUT" | grep -oE '"session_id"\s*:\s*"[^"]*"' | sed 's/.*"session_id"[^"]*"//;s/".*//' | head -1 || true)
# Sanitize: allow only alphanumeric, hyphen, underscore (matches compact-suggest.sh)
SESSION_ID=$(echo "$SESSION_ID" | tr -cd '[:alnum:]_-')

if [ -n "$SESSION_ID" ]; then
    rm -f "$LOG_DIR/.tool-count-$SESSION_ID" "$LOG_DIR/.tool-count-$SESSION_ID.lock"
    # Compaction-pressure markers written by compact-suggest.sh / pre-compact.sh.
    # These three are session-private — nothing outside the owning session ever
    # reads them, so they die with it.
    rm -f "$LOG_DIR/.compact-base-$SESSION_ID" "$LOG_DIR/.compact-nudged-$SESSION_ID" "$LOG_DIR/.compact-cycle-$SESSION_ID"

    # The nudge claim is a DIRECTORY, not a file — compact-suggest.sh arbitrates
    # concurrent firings with an atomic `mkdir`, because mkdir is the only one of
    # `touch`/`>`/`[ -f ]` that fails for the loser. Being a directory is why it
    # was missed here and why none of the `-type f` prunes below could ever have
    # collected it: it was cleared by pre-compact.sh alone, so a session that
    # died in the sliver between the mkdir and the delivery leaked it forever.
    #
    # Leaking it is not merely untidy, it is fail-closed. A leftover claim makes
    # the next `mkdir` fail, and the hook reads that failure as "another firing
    # is already delivering this nudge" and exits silently — so every subsequent
    # nudge in any session reusing that id is suppressed, and only a compaction
    # clears it, by which point the nudge that should have preceded it is gone.
    # That is the "the cycle is simply lost" outcome the design refuses.
    #
    # rmdir, not rm -rf: the claim is a pure mutex and is always empty. If it
    # somehow is not, something else owns that path and deleting its contents is
    # not this hook's business.
    rmdir "$LOG_DIR/.compact-nudging-$SESSION_ID" 2>/dev/null || true

    # .compact-handoff-* is deliberately NOT removed here. It is the one marker
    # read ACROSS sessions: it records which session authored which handoff, and
    # since #T144 it is the ENTIRE basis on which pre-compact.sh decides whether
    # a handoff may steer a compaction summary — there is no discovery fallback
    # behind it any more. Deleting it at SessionEnd un-claims this session's
    # handoffs the moment it exits, and the handoff outlives the session that
    # wrote it: a resumed or concurrent session compacting afterwards would find
    # nothing claimed and forward nothing, silently losing the instruction. The
    # handoff outlives the session; the record of who wrote it has to outlive it
    # too.
    #
    # The 7-day prune below is what eventually collects it, and that expiry is
    # now a real cost rather than a free one — a pruned claim means a handoff
    # that stops being forwarded. It is accepted because the alternative is an
    # unbounded log directory, and because the loss is announced: pre-compact.sh
    # names the unclaimed file in the checkpoint and says it was not forwarded.
fi

# Prune stale markers from sessions that never cleaned up (>7 days old)
find "$LOG_DIR" -maxdepth 1 -name '.tool-count-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-base-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-nudged-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-cycle-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-handoff-*' -type f -mtime +7 -delete 2>/dev/null || true
# -type d, matching what the claim actually is. `-delete` rmdir's an empty
# directory, which this always is. This is the backstop for the case the block
# above cannot reach: a crash or container reclaim that fires no SessionEnd at
# all. The residual gap is a session resumed under the same id within the 7-day
# window after such a crash — it stays silenced until the next compaction. That
# is accepted rather than papered over with an age-based steal in
# compact-suggest.sh, which would race two concurrent firings back into the
# double-nudge the mkdir exists to prevent.
find "$LOG_DIR" -maxdepth 1 -name '.compact-nudging-*' -type d -mtime +7 -delete 2>/dev/null || true

# Opportunistic rotation of the append-only logs
rotate_log "$LOG_DIR/activity.jsonl"
rotate_log "$LOG_DIR/tool-failures.log"
rotate_log "$LOG_DIR/format-errors.log"

exit 0
