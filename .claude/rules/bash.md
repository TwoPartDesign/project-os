# Bash Command Rules (Windows / Spaces in Paths)

Claude Code's security scanner flags several common shell patterns on Windows. These rules prevent false-positive security prompts.

## Security Prompt Triggers

The scanner flags these patterns - mostly false positives on machines with spaces in paths:

- **Quoted characters in flag names** - any `"..."` in the command. Worsens with `&&`
- **Newlines that could separate commands** - multi-line scripts or loops
- **`$()` command substitution** - any `$(...)` inline
- **`${}` parameter expansion** - any `${var}` or `${i}` in a command, including inside for loops (e.g. `mkdir -p "path/T${i}"`)
- **Backslash-escaped whitespace** - `path\ with\ spaces`
- **Piped commands** - `command | command`, even `ls | grep`
- **Output redirection in compound command** - `2>/dev/null`, `>file`, `>>file` combined with `cd &&` or `;`
- **Scripts embedded in `-c` / `-e` / `-Command` args** - any mini-program inside `python3 -c "..."`, `node -e "..."`, `bash -c "..."`, `powershell -Command "..."`, `wsl bash -lc "..."`, or complex `jq '...'` / `awk '...'` filters. Triggers vary by content: newlines + `#` → "newline followed by # can hide arguments," `$(...)` inside → "contains simple_expansion," `\"` inside → "consecutive quote characters," pipe-into-loop → "unhandled node type: string." **One fix covers all:** write the script to a file, run the file.
- **Consecutive quote characters at word start** - single-quoted strings that begin with a double-quote, e.g. `'"key":'` in a grep pattern. Fix: use the **Grep** tool instead of shell `grep`

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

## Never Use Bare `cd` — cwd Persists Across Bash Calls

The Bash tool's working directory **persists across every subsequent call** in the session. A single `cd "out"` to shorten a long path silently changes cwd for every Bash call after it, including ones you don't expect (e.g. `du -sh` or `ls` later sees `out/` as root). This is a documented behavior of the Bash tool, not a bug.

**Never:**
```bash
cd "out" && rm -rf a b c d
cd "C:/long/path with spaces/project" && npm run build
```

**Three substitutes — pick the first that fits:**

1. **Tool-specific path flags** (best when available):
   - `git -C "path" <cmd>`
   - `npm --prefix "path" <cmd>` (also works for `npm run --prefix "path" build`)
   - `make -C "path" <target>`
   - `tar -C "path" -xzf archive.tgz`
   - `pytest --rootdir "path" tests/`
   - `powershell -WorkingDirectory "path" -File script.ps1`

2. **Brace expansion with absolute prefix** (best for multi-file `rm`/`cp`/`mv`/`ls` where you'd otherwise `cd` to avoid retyping the prefix):
   ```bash
   rm -rf "/c/Users/<username>/Desktop/Claude Projects/my-project/out"/{a,b,c,d,e.db,f.db}
   ```
   One call. Absolute path written once. No cwd change. The shell expands `{a,b,c}` before invoking `rm`.

3. **Subshell `(cd "path" && cmd)`** (when neither fits — cwd auto-reverts when the subshell exits):
   ```bash
   (cd web/icons && npm install && npm run build)
   ```
   The parent shell's cwd is untouched. Requires the `Bash((cd * && *))` allowlist entry in `.claude/settings.json` to avoid the `&&`+quotes security prompt; the parens are the discriminator (bare `cd "path" && cmd` stays forbidden).

If you ever do use bare `cd` (you shouldn't), end the same Bash call with `; cd "$OLDPWD"` to restore — but prefer one of the three patterns above.

## Mitigation Strategies (prefer in this order)

1. **Relative paths** - `./scripts/foo.sh` has no spaces, needs no quotes, no prompt. Use absolute paths only when the working directory isn't the project root
2. **Single-line loops** - `for f in ./*.sh; do ...; done` on one line avoids the newline check
3. **Replace loop+`$()` with dedicated tools** - the scanner flags `$()` anywhere, including inside loops
   - File existence → **Glob** tool (no shell needed)
   - Line counts → `wc -l file1 file2 file3 ...` with an **explicit list** (no `$(...)`)
   - File content → **Read** tool
   - Pattern: `for i in 1 2 3; do echo "$(wc -l < "path/T${i}/file")"; done` → use Glob to confirm existence, then a single `wc -l path/T1/file path/T2/file path/T3/file` call
3a. **`${}` parameter expansion in loops** - `for i in 1 2 3; do mkdir -p "path/T${i}"; done` triggers on `${i}`. Options:
   - Pre-approve the specific pattern: `{ "permissions": { "allow": ["Bash(for * in *; do mkdir *; done)"] } }`
   - Or spell out all paths explicitly in a single `mkdir -p path/T1 path/T2 path/T3` call (no loop needed)
   - `$var` (no braces) does NOT trigger — use `$i` instead of `${i}` when the brace form isn't needed for disambiguation
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

## Scripts Go in Files, Not in `-c`

Any mini-program embedded inside a quoted `-c`, `-e`, `-Command`, or `-lc` argument is hostile to the scanner. Different content triggers different messages, but **the fix is always the same: write the script to a file, run the file.**

This applies to:
- `python3 -c "..."`, `node -e "..."`, `bun -e "..."`
- `bash -c "..."`, `sh -c "..."`, `wsl bash -lc "..."`
- `powershell -Command "..."` with multi-line content
- `jq '...'`, `awk '...'`, `sed '...'` with complex filters
- Piping into `while read` loops with `$()` inside the body

**Never:**
```bash
# Triggers "newline followed by # can hide arguments" + "simple_expansion" + pipe
cat file.json | python3 -c "
import sys, json
d = json.load(sys.stdin)
# comment here
print(d.get('usage', {}))
" 2>/dev/null

# Triggers "unhandled node type: string" (pipe into while with $())
find "path" | head -5 | while read f; do echo "$f: $(wc -c < "$f") bytes"; done

# Triggers "consecutive quote characters" (escaped quotes in jq filter)
wsl bash -lc "jq '{x: .foo | select(.y != \"\")}' /path/file.json"

# Triggers "cd && compound" + "multiline string" + "redirection"
cd "C:/path" && powershell -Command "codex exec 'long
multiline
prompt'" 2>&1
```

**Instead — two Bash calls:**

1. Write the script to `/tmp/` using the **Write** tool (not heredoc, which also triggers prompts):
   - `/tmp/inspect.py` for Python
   - `/tmp/script.js` for Node
   - `/tmp/filter.jq` for jq
   - `/tmp/script.ps1` for PowerShell

2. Run the file directly:
```bash
python3 /tmp/inspect.py /path/to/file.json
node /tmp/script.js
jq -f /tmp/filter.jq /path/to/file.json
powershell -WorkingDirectory "C:/path/project" -File /tmp/script.ps1
```

**Substitution table:**

| Instead of | Use |
|---|---|
| `python3 -c "<multi-line>"` | Write `/tmp/script.py`, then `python3 /tmp/script.py` |
| `node -e "<multi-line>"` | Write `/tmp/script.js`, then `node /tmp/script.js` |
| `jq '<complex filter>'` | Write `/tmp/filter.jq`, then `jq -f /tmp/filter.jq file.json` |
| `awk '<complex prog>'` | Write `/tmp/prog.awk`, then `awk -f /tmp/prog.awk file` |
| `powershell -Command "<multi-line>"` | Write `/tmp/script.ps1`, then `powershell -File /tmp/script.ps1` |
| `wsl bash -lc "jq '...'"` | `wsl jq '...'` directly (no `bash -lc` wrapper needed) |
| `find \| while read f; do ...; done` | Use **Glob** tool to list files, then a script that takes paths as args |

**PowerShell working directory:** use `powershell -WorkingDirectory "path" -File /tmp/script.ps1` — never `cd "path" && powershell`. Drop `2>&1` or pre-approve `Bash(powershell *)` in settings.

**Key principle:** if the code inside the quoted arg has newlines, `#` comments, `$()`, or escaped quotes, it belongs in a file.

## Sub-Agent Inheritance

Sub-agents do not inherit CLAUDE.md. When spawning sub-agents that will run Bash commands, always include these bash rules in the sub-agent prompt.

## Git-Specific

- For git commits, write message to `/tmp/commit-msg.txt` then `git commit -F /tmp/commit-msg.txt`
- Use `git -C "path"` instead of `cd "path" && git ...`

## Agent Rules

<!-- source-hash: dbff43230b1430d219207a30ac771b892cac0ed9216e25deea712b4665c0d626 -->

- Never use bare `cd` — the Bash tool's cwd persists across calls, so a single `cd` silently changes cwd for every subsequent call. Three substitutes:
  1. Tool path flags: `git -C "path"`, `npm --prefix "path"`, `make -C "path"`, `tar -C "path"`, `powershell -WorkingDirectory "path"`
  2. Brace expansion for multi-file ops: `rm -rf "/abs/prefix"/{a,b,c}` — one call, prefix written once
  3. Subshell `(cd "path" && cmd)` when neither fits — cwd auto-reverts. Pre-approved via `Bash((cd * && *))` in `.claude/settings.json`. Parens are the discriminator; bare `cd "path" && cmd` stays forbidden
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
- Never embed multi-line scripts in `-c`, `-e`, `-Command`, or `-lc` args — write the script to `/tmp/script.{py,js,jq,awk,ps1}` via the Write tool, then run the file. Applies to `python3 -c`, `node -e`, `bash -c`, `wsl bash -lc`, `powershell -Command`, and jq/awk/sed with complex filters
- Use `powershell -WorkingDirectory "path" -File /tmp/script.ps1` instead of `cd "path" && powershell -Command "..."`
