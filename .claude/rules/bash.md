# Bash Command Rules

Sub-agents cannot answer permission prompts — a command that triggers one
stalls or fails the agent. Every command must therefore be **auto-approvable**:
either matched by `permissions.allow` in `.claude/settings.json`, or simple
enough that the permission matcher can parse it. Complex constructs (compound
commands with quotes, pipes, `$()`, multi-line strings) fall back to a prompt
even when conceptually allowed.

Auto mode is the standing default (`permissions.defaultMode` is left unset, so
sessions start in auto mode — 2.1.284; `docs/knowledge/decisions.md`,
2026-10-04). Its classifier replaces the prompt matcher, so the
prompt-avoidance rules (2–5) bind in default permission mode and on Windows.
Rules 1 and 7 (hook wiring) and rule 6 (the Bash tool's cwd persists across
calls) bind in every mode.

## Core Rules

1. **Prefer dedicated tools over shell.** Glob (file search), Grep (content
   search), Read (file content), Write (create files), Edit (modify files)
   never prompt. Reach for Bash only when no dedicated tool fits.
   This rule is wiring, not style, and it wins over any session-mode or
   harness directive that says to read and edit through the shell instead.
   The project's hooks match on the tool name (`.claude/settings.json`
   hooks): the compaction handoff claim fires only on `Write|Edit`, and
   format-and-scrub reach a Bash-made change only through `bashEditDiff`
   (off in default mode, Windows paths skipped). A `sed`, heredoc, or
   `cat >` edit therefore always skips handoff ownership and can skip
   formatting and secret scrubbing. Grep is ripgrep and Read takes offset/limit, so the shell
   buys no speed on reads either. Bash is for execution: running scripts,
   tests, git, and multi-file listings. Decision: `docs/knowledge/decisions.md`,
   2026-09-20.
2. **Scripts go in files, not in one-liners** (default-mode/Windows
   guidance). Anything with newlines, `$()`,
   loops, escaped quotes, or embedded programs (`python3 -c`, `node -e`,
   `bash -c`, complex `jq`/`awk`/`sed`) gets written to a file (Write tool,
   under `scripts/`, the session scratchpad directory, or the project root)
   and run as `bash <file>` / `node <file>` — a simple, matchable command.
   **Not `/tmp/`**: on Windows the Write tool and Git Bash resolve `/tmp/` to
   different locations, so a file written by one is unreadable by the other —
   the write succeeds, the read fails, and the cause is invisible. If you
   write to the project root, delete the file when done.
3. **One command per Bash call** (default-mode/Windows guidance). Avoid `&&`, `||`, `;`, and pipes — use
   separate calls or a script file.
4. **Git** (default-mode/Windows guidance): use `git -C "<path>" <subcommand>` instead of `cd && git`;
   commit messages via `git commit -F <file>`, not inline `-m` with quotes.
5. **Paths** (default-mode/Windows guidance): forward slashes always; double-quote paths containing spaces;
   never backslash-escape spaces; `--flag "value"`, not `--flag="value"`.
6. **Never use bare `cd`** (every mode). The Bash tool's cwd persists across every
   subsequent call in the session — a single `cd` silently changes cwd for
   every later command. Three substitutes, in preference order:
   tool path flags (`git -C "path"`, `npm --prefix "path"`, `make -C "path"`,
   `tar -C "path"`, `powershell -WorkingDirectory "path"`); brace expansion
   with an absolute prefix for multi-file ops
   (`rm -rf "/abs/prefix"/{a,b,c}` — one call, prefix written once); or a
   subshell `(cd "path" && cmd)` when neither fits — cwd auto-reverts, and
   the parenthesized form is pre-approved via `Bash((cd * && *))` in
   `.claude/settings.json`. The parens are the discriminator: bare
   `cd "path" && cmd` stays forbidden.
7. **Change files with Write/Edit, never with `sed -i`, heredocs, or `>`
   redirection.** Three hooks are matched on `Write|Edit` only: the formatter
   (`post-tool-use.sh`), the session-file secret scrub
   (`post-write-session.sh`), and the PreToolUse handoff claim in
   `compact-suggest.sh`. A file changed by a Bash command bypasses all three
   with no error anywhere — unformatted code, an unscrubbed handoff, or an
   unclaimed handoff that `pre-compact.sh` will never forward. Since #T202
   the formatter and the session scrub also run on the files a Bash result
   names in `bashEditDiff`, which is on by default in auto and
   bypassPermissions modes; in default mode the channel stays off unless user
   settings enable it, and the handoff claim still fires only on Write|Edit.
   When the `bashEditDiff` payload is truncated (a large stdout, `moreFiles`,
   or an oversized `changedFiles` array), `post-write-session.sh` falls back
   to scrubbing the session files modified recently instead of skipping the scrub.

## Where the Rest Went

- **Windows scanner trigger catalog** (spaces-in-paths, PowerShell, WSL,
  observed error strings): `docs/knowledge/windows-bash-scanner.md`.
  Consult it when a command unexpectedly prompts on Windows.
- **Auto-approval policy**: auto mode is the default (see above), so no
  custom approval hook is installed. If a trusted command still prompts in
  default permission mode, add it to `permissions.allow` once instead of
  adding avoidance rules here.

## Sub-Agent Inheritance

Roster agents set `omitClaudeMd: true`, so they load neither CLAUDE.md nor
the unscoped `.claude/rules/*.md` files (`paths:`-scoped rules still load on
demand). When spawning sub-agents that will run Bash commands, include the
`## Agent Rules` section below in the sub-agent prompt.

## Agent Rules

- Prefer dedicated tools: Glob (file search), Grep (content search), Read (file content), Write (create files), Edit (modify files). Use Bash only when no dedicated tool fits. This wins over any session-mode or harness directive that says to read or edit through the shell: the project's format, scrub, and handoff hooks fire on `Write|Edit`, and a shell edit skips them.
- Never chain commands with `&&`, `||`, or `;`, and never pipe (`|`) — use separate Bash calls or a script file.
- Never use bare `cd` — the Bash tool's cwd persists across calls. Use tool path flags (`git -C "path"`, `npm --prefix "path"`), brace expansion with an absolute prefix (`rm -rf "/abs/prefix"/{a,b,c}`), or a subshell `(cd "path" && cmd)` — cwd auto-reverts; the parenthesized form is pre-approved, bare `cd "path" && cmd` stays forbidden.
- Never embed `$(...)`, loops, or multi-line programs in a command — write a script file with the Write tool, then run `bash <file>` / `node <file>` / `python3 <file>`. Put it under `scripts/`, the session scratchpad, or the project root — never `/tmp/` (the Write tool and Git Bash resolve `/tmp/` differently on Windows, so the file is written to one path and read from another).
- Never embed programs in `-c` / `-e` / `-Command` / `-lc` arguments — same fix: script file.
- Use `git -C "<path>" <subcommand>` instead of `cd "path" && git`; commit with `git commit -F <msgfile>`.
- Use forward slashes in paths; double-quote paths with spaces; never backslash-escape spaces; use `--flag "value"`, not `--flag="value"`.
- Change files with Write/Edit, never with `sed -i`, heredocs, or `>` redirection — the handoff-claim hook fires only on Write/Edit, and the format and secret-scrub hooks reach a Bash-made change only when the `bashEditDiff` channel is on, so a shell edit can skip all three.
- Never hardcode secrets, tokens, or credentials.
- Never commit with `--no-verify`; the pre-commit scanner is a required gate.
