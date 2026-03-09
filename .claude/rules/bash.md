# Bash Command Rules (Windows / Spaces in Paths)

Claude Code's security scanner flags several common shell patterns on Windows. These rules prevent false-positive security prompts.

## Security Prompt Triggers

The scanner flags these patterns - mostly false positives on machines with spaces in paths:

- **Quoted characters in flag names** - any `"..."` in the command. Worsens with `&&`
- **Newlines that could separate commands** - multi-line scripts or loops
- **`$()` command substitution** - any `$(...)` inline
- **Backslash-escaped whitespace** - `path\ with\ spaces`
- **Piped commands** - `command | command`, even `ls | grep`
- **Output redirection in compound command** - `2>/dev/null`, `>file`, `>>file` combined with `cd &&` or `;`
- **PowerShell multiline** - `cd "path" && powershell -Command "multiline..."` triggers multiple checks at once

## No `&&` with Quoted Strings - EVER

Any `&&`-chained command containing quoted strings triggers a security prompt. This includes `cd "path" && command`, `find "path" && find "path"`, or any two commands joined with `&&` where either contains quotes.

**All of these trigger security prompts:**
- `cd "path" && command` - "bare repository attack" + "ambiguous syntax"
- `find "path/..." -type f && echo "---"` - "quoted characters in flag names"
- `command "arg" && command "arg"` - any `&&` + quotes combination

**Never:**
```bash
cd "C:/Users/<username>/Projects/my-project" && git status
cd "C:/Users/<username>/Projects/my-project" && find . -name "*.ts"
find "path/one" -type f && find "path/two" -type f
```

**Instead:**
- **git** → `git -C "C:/Users/<username>/Projects/my-project" status`
- **find** → `find "C:/Users/<username>/Projects/my-project" -name "*.ts"`
- **File search** → use the **Glob** tool instead of `find`
- **Content search** → use the **Grep** tool instead of `grep`/`rg`
- **Read files** → use the **Read** tool instead of `cat`/`head`/`tail`
- **Edit files** → use the **Edit** tool instead of `sed`/`awk`
- **Create files** → use the **Write** tool instead of `echo` redirection
- **Multiple commands** → use **separate Bash tool calls**. NEVER chain with `&&`, `||`, or `;`

## Mitigation Strategies (prefer in this order)

1. **Relative paths** - `./scripts/foo.sh` has no spaces, needs no quotes, no prompt. Use absolute paths only when the working directory isn't the project root
2. **Single-line loops** - `for f in ./*.sh; do ...; done` on one line avoids the newline check
3. **Replace loop+`$()` with dedicated tools** - the scanner flags `$()` anywhere, including inside loops
   - File existence → **Glob** tool (no shell needed)
   - Line counts → `wc -l file1 file2 file3 ...` with an **explicit list** (no `$(...)`)
   - File content → **Read** tool
   - Pattern: `for i in 1 2 3; do echo "$(wc -l < "path/T${i}/file")"; done` → use Glob to confirm existence, then a single `wc -l path/T1/file path/T2/file path/T3/file` call
4. **Split `$()` into two Bash calls** - run the subcommand first to capture output, then use the literal result in the next call. Never embed `$(command)` in a longer command
5. **Pre-approve in `.claude/settings.json`** - use `permissions.allow` (not `allowedTools`; that doesn't exist). Glob `*` supported with word boundaries
   ```json
   { "permissions": { "allow": ["Bash(bash ./scripts/*)", "Bash(for * in *)", "Bash(wc -l *)"] } }
   ```
   Project-level: `.claude/settings.json` | Personal overrides: `.claude/settings.local.json`

## Paths

- ALWAYS use forward slashes: `C:/Users/<username>/...` not `C:\Users\<username>\...`
- ALWAYS double-quote absolute paths with spaces
- NEVER backslash-escape spaces: `path\ with\ spaces` triggers a security prompt
- NEVER use `--flag="value"` - use `--flag "value"` (space-separated)
- Prefer **relative paths** when working dir is project root
- **Next.js `[[...routes]]`**: Use the Write tool to create files inside these dirs; `mkdir` triggers the glob safety check

**Never:**
```bash
find /c/Users/<username>/Desktop/Claude\ Projects/my-project/src -type f
ls -la /c/Users/<username>/Desktop/Claude\ Projects/my-project/
```

**Instead - always double-quote:**
```bash
find "/c/Users/<username>/Desktop/Claude Projects/my-project/src" -type f
ls -la "/c/Users/<username>/Desktop/Claude Projects/my-project/"
```

Better yet, use **Glob** for file search, **Read** for directory listing. No shell needed.

## Pipes (`|`)

Claude Code flags `command | command` as potentially unsafe. Even `ls | grep` will prompt.

**Never:**
```bash
ls -la /path/to/project/ | grep -E "next.config|\.env"
find . -name "*.ts" | head -20
```

**Instead - use dedicated tools:**
- `ls | grep pattern` → **Glob** tool with the pattern directly
- `find | grep` → **Grep** tool
- `cat file | grep` → **Grep** tool on the file
- If unavoidable, pre-approve: `{ "permissions": { "allow": ["Bash(ls * | grep *)"] } }`

## Output Redirection in Compound Commands

Claude Code flags `2>/dev/null`, `>file`, or `>>file` combined with `cd &&` or `;` as "compound command contains cd with output redirection - path resolution bypass."

**Never:**
```bash
cd "C:/path/to/project" && bash .claude/hooks/script.sh arg 2>/dev/null; echo "done"
```

**Instead - use absolute path, separate calls, drop the redirection:**
```bash
bash "C:/path/to/project/.claude/hooks/script.sh" "arg"
```

- Run scripts with their full absolute path - no `cd` needed
- Drop `2>/dev/null` unless the noise is truly unbearable; if it is, pre-approve in `.claude/settings.json`
- Replace `;` separators with separate Bash tool calls

## PowerShell

`cd "path" && powershell -Command "multiline..."` hits multiple triggers at once:
- `cd &&` compound command
- `2>&1` redirection
- Multiline string inside `-Command "..."`

**Never:**
```bash
cd "C:/path/project" && powershell -Command "codex exec -s read-only 'long
multiline
prompt'" 2>&1
```

**Instead - two steps:**

1. Write the prompt to a temp file (separate Bash call):
```bash
cat > /tmp/codex-prompt.txt << 'EOF'
Review all TypeScript source files in src/ and tests/ for: ...
EOF
```

2. Run PowerShell with `-WorkingDirectory` (no `cd &&`) and read the file:
```bash
powershell -WorkingDirectory "C:/path/project" -Command "codex exec -s read-only (Get-Content /tmp/codex-prompt.txt -Raw)"
```

Key fixes:
- `-WorkingDirectory "path"` replaces `cd "path" &&` - no compound command
- Prompt in a temp file avoids multiline string in the command
- Drop `2>&1` - or pre-approve: `{ "permissions": { "allow": ["Bash(powershell *)"] } }`

## Sub-Agent Inheritance

Sub-agents do not inherit CLAUDE.md. When spawning sub-agents that will run Bash commands, always include these bash rules in the sub-agent prompt.

## Git-Specific

- For git commits, write message to `/tmp/commit-msg.txt` then `git commit -F /tmp/commit-msg.txt`
- Use `git -C "path"` instead of `cd "path" && git ...`

## Agent Rules

<!-- source-hash: 66b18dbb96aec8d63125001d0ab7d57adb15e9a5961779a0aebc15858373b50d -->

- Never chain commands with `&&`, `||`, or `;` — use separate Bash tool calls
- Never use `&&` with quoted strings (includes `cd "path" && command`)
- Always use forward slashes in paths: `C:/Users/...` not `C:\Users\...`
- Always double-quote absolute paths with spaces: `"C:/path with spaces/file"`
- Never backslash-escape spaces in paths: avoid `path\ with\ spaces`
- Never embed `$(...)` inline — split into two Bash calls
- Never use `--flag="value"` — use `--flag "value"` (space-separated)
- Never pipe commands (`|`) — use Glob, Grep, or Read tools instead
- Never combine output redirection (`2>/dev/null`, `>file`, `>>file`) with compound commands (`cd &&`, `;`)
- Run scripts with full absolute paths — no `cd` needed
- Use `git -C "path" command` instead of `cd "path" && git command`
- Use relative paths when working directory is project root
- Use single-line loops only — no newlines: `for f in *.sh; do ...; done`
- Use dedicated tools for operations: Glob (file search), Grep (content search), Read (file content), Write (create files)
- For multi-step operations: write temporary files to `/tmp/` then reference them in subsequent calls
- Use `git commit -F /tmp/commit-msg.txt` for commit messages instead of inline `-m`
- Use `powershell -WorkingDirectory "path" -Command "..."` instead of `cd "path" && powershell -Command "..."`
