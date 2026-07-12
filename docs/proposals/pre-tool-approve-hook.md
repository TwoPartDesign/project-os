# Proposal: PreToolUse Auto-Approval Hook

**Status: PROPOSED — requires manual installation by the repo owner.**

This hook was deliberately NOT installed automatically. It emits
`permissionDecision: "allow"`, which bypasses permission prompts — a
permission-widening change that Claude Code's safety layer (correctly)
requires a human to review and activate directly. Read the script below,
then install it yourself if you accept the policy.

## Problem

Sub-agents cannot answer permission prompts. When the permission matcher
can't map a Bash command to a `permissions.allow` rule — compound commands,
quoted Windows paths, pipes, `$()` — it falls back to a prompt, and a
background sub-agent stalls or fails there. The old 218-line
`.claude/rules/bash.md` worked around this by teaching every agent to avoid
the trigger patterns, at a large per-session context cost.

## Solution

Encode the trust policy once, programmatically. A PreToolUse hook inspects
each Bash command before the permission system sees it:

- **Allow** — every segment of the command matches an enumerated safe
  pattern (git subcommands, project scripts, scripts-in-files under /tmp,
  read-only utilities). Compound forms of safe commands are approved even
  though the permission matcher can't parse them.
- **Deny** — catastrophic patterns (recursive rm at `/` or home, plain
  `git push --force`, device writes, fork bombs, curl-pipe-to-shell).
- **No opinion** (the default) — anything with command substitution,
  process substitution, backgrounding, `eval`/`exec`/`source`, or any
  unrecognized segment falls through to the normal permission prompt.

The failure direction is always toward the status quo (a prompt), never
toward silent approval. Keep the allowlist in sync with
`permissions.allow` in `.claude/settings.json` — one policy, two
enforcement points.

## Installation (manual, after review)

1. Copy the script below to `.claude/hooks/pre-tool-approve.sh` and
   `chmod +x` it.
2. Register it in `.claude/settings.json`:
   ```json
   "hooks": {
     "PreToolUse": [
       {
         "matcher": "Bash",
         "hooks": [
           { "type": "command", "command": "bash \".claude/hooks/pre-tool-approve.sh\"" }
         ]
       }
     ]
   }
   ```
3. Restart the session. Verify with a compound safe command
   (`git status && git diff` should not prompt) and an unsafe one
   (`sed -i ...` should still prompt).
4. On Windows: when a command you trust still prompts, add ONE pattern to
   `safe_segment()` instead of re-adding avoidance rules to bash.md.

## The script

```bash
#!/usr/bin/env bash
# pre-tool-approve.sh — PreToolUse auto-approval policy for Bash commands.
#
# WHY: sub-agents cannot answer permission prompts. When the permission
# matcher can't map a command to an allow rule (compound commands, quoted
# paths, pipes — especially on Windows), it prompts, and a background
# sub-agent stalls or fails there. This hook encodes the project's trust
# policy programmatically so sanctioned commands are approved without a
# prompt, on every platform.
#
# CONTRACT (PreToolUse, matcher "Bash"):
#   - stdout {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#     "permissionDecision":"allow","permissionDecisionReason":...}}  → no prompt
#   - permissionDecision "deny"                                      → blocked
#   - exit 0 with no output → no opinion; the normal permission flow applies
#
# POLICY SHAPE: strict allowlist. A compound command is approved only if
# EVERY segment (split on && || ; | and newlines) matches a safe pattern.
# Commands with command substitution, process substitution, backgrounding,
# eval/exec/source, or unrecognized segments produce NO opinion — they fall
# through to the normal prompt. Worst case is the status quo, never a new
# hole. Catastrophic patterns are denied outright.

set -uo pipefail  # deliberately no -e: this hook must never crash a tool call

INPUT=$(cat 2>/dev/null) || exit 0
command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ "$TOOL_NAME" = "Bash" ] || exit 0

CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

emit() { # $1=allow|deny  $2=reason
    jq -cn --arg d "$1" --arg r "$2" \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
    exit 0
}

# ---------- 1. Hard denies (checked against the whole raw command) ----------

if printf '%s' "$CMD" | grep -qE 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)' &&
   printf '%s' "$CMD" | grep -qE '(^|[[:space:]])(/|/\*|~|~/\*|\$HOME)([[:space:]]|$)'; then
    emit deny "recursive rm targeting / or home is blocked by project policy"
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push[^|;&]*[[:space:]]--force([[:space:]]|$)'; then
    emit deny "git push --force is blocked; use --force-with-lease (will prompt)"
fi
if printf '%s' "$CMD" | grep -qE '\bmkfs|\bdd[[:space:]]+[^;|&]*of=/dev/|>[[:space:]]*/dev/sd|:\(\)[[:space:]]*\{|chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/([[:space:]]|$)'; then
    emit deny "destructive device/system operation blocked by project policy"
fi
if printf '%s' "$CMD" | grep -qE '(curl|wget)[^|;&]*\|[[:space:]]*(ba|z|da)?sh'; then
    emit deny "piping downloaded content into a shell is blocked by project policy"
fi

# ---------- 2. Constructs this policy won't reason about → no opinion ----------

case "$CMD" in
    *'$('*|*'`'*|*'<('*|*'>('*) exit 0 ;;
esac
if printf '%s' "$CMD" | grep -qE '(^|[[:space:]])(eval|exec|source)([[:space:]]|$)'; then exit 0; fi
STRIPPED=$(printf '%s' "$CMD" | sed -e 's/&&/AND/g' -e 's/[0-9]*>&[0-9]*/RD/g')
case "$STRIPPED" in
    *'&'*) exit 0 ;;
esac

# ---------- 3. Segment allowlist ----------

safe_segment() { # $1 = one command segment, trimmed
    local seg="$1"
    [ -z "$seg" ] && return 0

    # Output redirection is only safe into /tmp or /dev/null
    if printf '%s' "$seg" | grep -q '>'; then
        printf '%s' "$seg" | grep -qE '>>?[[:space:]]*(/tmp/|/dev/null)' || return 1
    fi

    # git: optional -C <path> (quoted or bare), then a sanctioned subcommand
    if printf '%s' "$seg" | grep -qE '^git([[:space:]]+-C[[:space:]]+("[^"]*"|[^[:space:]]+))?[[:space:]]+(status|diff|log|show|add|commit|push|pull|fetch|checkout|switch|branch|restore|stash|worktree|rm|mv|rev-parse|ls-files|describe|blame|shortlog|tag|remote)([[:space:]]|$)'; then
        return 0
    fi
    # Project tooling and scripts-in-files (the sanctioned way to run anything complex)
    if printf '%s' "$seg" | grep -qE '^bash[[:space:]]+("[^"]*"|[^[:space:]]+)?(scripts/|tests/|\.claude/hooks/|/tmp/)'; then
        return 0
    fi
    if printf '%s' "$seg" | grep -qE '^node[[:space:]]+(scripts/|/tmp/)'; then return 0; fi
    if printf '%s' "$seg" | grep -qE '^python3?[[:space:]]+/tmp/[^[:space:]]+\.py([[:space:]]|$)'; then return 0; fi
    if printf '%s' "$seg" | grep -qE '^npm[[:space:]]+(test$|run[[:space:]]+[a-zA-Z0-9:_-]+$)'; then return 0; fi
    if printf '%s' "$seg" | grep -qE '^jq[[:space:]]'; then return 0; fi
    if printf '%s' "$seg" | grep -qE '^chmod[[:space:]]+\+x[[:space:]]+(scripts/|tests/|\.claude/|/tmp/)'; then return 0; fi
    # mkdir: relative paths (inside the project) or /tmp
    if printf '%s' "$seg" | grep -qE '^mkdir[[:space:]]+(-p[[:space:]]+)?("?[^/"[:space:]]|"?/tmp/)'; then return 0; fi
    # Read-only utilities
    if printf '%s' "$seg" | grep -qE '^(grep|rg|cat|ls|head|tail|wc|sort|uniq|cut|tr|echo|printf|pwd|which|file|stat|du|df|date|uname|basename|dirname|realpath|sha256sum|md5sum|diff|comm|column|nl|true|test|\[)([[:space:]]|$)'; then
        return 0
    fi
    return 1
}

ALL_SAFE=1
while IFS= read -r seg; do
    seg="${seg#"${seg%%[![:space:]]*}"}"
    seg="${seg%"${seg##*[![:space:]]}"}"
    if ! safe_segment "$seg"; then
        ALL_SAFE=0
        break
    fi
done < <(printf '%s' "$CMD" | sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/;/\n/g' -e 's/|/\n/g')

if [ "$ALL_SAFE" -eq 1 ]; then
    emit allow "matched project auto-approval policy (.claude/hooks/pre-tool-approve.sh)"
fi

# No opinion — fall through to the normal permission flow
exit 0
```

## Review checklist before installing

- [ ] Every pattern in `safe_segment()` is something you'd approve by hand
- [ ] The deny list matches your definition of catastrophic
- [ ] You understand that `bash /tmp/...` approval means any file an agent
      Writes to /tmp can execute without a prompt (the Write tool itself is
      already allowed — this is the scripts-in-files workflow)
- [ ] `.claude/settings.json` `permissions.allow` and this policy agree
- [ ] Test on your Windows machine: known-trigger commands from
      `docs/knowledge/windows-bash-scanner.md` now auto-approve or prompt
      as expected
