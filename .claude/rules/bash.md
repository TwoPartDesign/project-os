# Bash Command Rules

Sub-agents cannot answer permission prompts — a command that triggers one
stalls or fails the agent. Every command must therefore be **auto-approvable**:
either matched by `permissions.allow` in `.claude/settings.json`, or simple
enough that the permission matcher can parse it. Complex constructs (compound
commands with quotes, pipes, `$()`, multi-line strings) fall back to a prompt
even when conceptually allowed.

## Core Rules

1. **Prefer dedicated tools over shell.** Glob (file search), Grep (content
   search), Read (file content), Write (create files), Edit (modify files)
   never prompt. Reach for Bash only when no dedicated tool fits.
2. **Scripts go in files, not in one-liners.** Anything with newlines, `$()`,
   loops, escaped quotes, or embedded programs (`python3 -c`, `node -e`,
   `bash -c`, complex `jq`/`awk`/`sed`) gets written to a file (Write tool,
   under `scripts/` or `/tmp/`) and run as `bash <file>` / `node <file>` —
   a simple, matchable command.
3. **One command per Bash call.** Avoid `&&`, `||`, `;`, and pipes — use
   separate calls or a script file.
4. **Git**: use `git -C "<path>" <subcommand>` instead of `cd && git`;
   commit messages via `git commit -F <file>`, not inline `-m` with quotes.
5. **Paths**: forward slashes always; double-quote paths containing spaces;
   never backslash-escape spaces; `--flag "value"`, not `--flag="value"`.

## Where the Rest Went

- **Windows scanner trigger catalog** (spaces-in-paths, PowerShell, WSL,
  observed error strings): `docs/knowledge/windows-bash-scanner.md`.
  Consult it when a command unexpectedly prompts on Windows.
- **Auto-approval policy**: a PreToolUse hook proposal at
  `docs/proposals/pre-tool-approve-hook.md` approves sanctioned commands
  programmatically so sub-agents never hit prompts for trusted operations.
  If a trusted command still prompts, extend that policy once instead of
  adding avoidance rules here.

## Sub-Agent Inheritance

Sub-agents do not inherit CLAUDE.md. When spawning sub-agents that will run
Bash commands, include the `## Agent Rules` section below in the sub-agent
prompt.

## Agent Rules

- Prefer dedicated tools: Glob (file search), Grep (content search), Read (file content), Write (create files), Edit (modify files). Use Bash only when no dedicated tool fits.
- Never chain commands with `&&`, `||`, or `;`, and never pipe (`|`) — use separate Bash calls or a script file.
- Never embed `$(...)`, loops, or multi-line programs in a command — write a script file with the Write tool, then run `bash <file>` / `node <file>` / `python3 <file>`.
- Never embed programs in `-c` / `-e` / `-Command` / `-lc` arguments — same fix: script file.
- Use `git -C "<path>" <subcommand>` instead of `cd "path" && git`; commit with `git commit -F <msgfile>`.
- Use forward slashes in paths; double-quote paths with spaces; never backslash-escape spaces; use `--flag "value"`, not `--flag="value"`.
