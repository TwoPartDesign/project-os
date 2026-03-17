---
description: "First-run project setup — find blank variables, ask questions, fill them in using memory for recommendations"
---

# Project Init

You are performing **first-run project initialization**. Your job is to discover every unfilled placeholder in this project, gather answers from the user, and write them in — leaving a fully configured project ready for work.

## Step 1: Load memory for recommendations

Check two sources for context on past project setups:

1. **Global auto memory**: Read `~/.claude/projects/*/memory/MEMORY.md` if accessible, or check the persistent memory path known from the current environment.
2. **Vault**: Read `docs/memory/` — look for any files named `project-profiles.md`, `stack-decisions.md`, or similar.

Extract from memory (if anything found):
- What languages/stacks have been used before?
- What testing tools?
- What formatters?
- Any patterns like "always use X for Y type of project"?

If nothing found in memory, note it and proceed — you will build recommendations from the conversation instead.

## Step 1b: Discover existing project docs

Before asking any questions, scan the project for existing documentation that might already answer them. This reduces how much the user has to type.

### Locations to check (in priority order)

1. **README.md** / **README.rst** — often has project name, description, and stack
2. **docs/product.md** — may have vision/scope already filled
3. **docs/tech.md** — may have stack decisions already filled
4. **docs/specs/** — any spec files that describe the feature set
5. **PRD.md**, **prd.md**, `docs/PRD.md`, `docs/prd.md` — external product requirements doc
6. **SPEC.md**, `docs/SPEC.md` — external spec
7. **package.json** — reveals language (Node/TS), framework, test runner, formatter
8. **pyproject.toml** / **setup.py** — reveals Python stack
9. **go.mod** — reveals Go stack
10. **Cargo.toml** — reveals Rust stack
11. ***.md** files in the project root (any docs the user may have dropped in)

Use Glob to find which of these exist, then Read any that do.

### Extract from found docs

Build a pre-fill map from what you find:

| Field | Extraction hint |
|---|---|
| Project name | README `#` heading, package.json `name`, or folder name |
| Description / one-liner | README first paragraph, package.json `description` |
| Stack (language/runtime) | `package.json` → Node/TS, `pyproject.toml` → Python, `go.mod` → Go, etc. |
| Framework | `package.json` dependencies (`next`, `express`, `fastapi`, etc.) |
| Database | Dependencies or tech doc mentions (`sqlite`, `postgres`, `prisma`, etc.) |
| Test runner | `package.json` `scripts.test`, `devDependencies` (`vitest`, `jest`, `pytest`) |
| Formatter | `devDependencies` or config files (`prettier`, `eslint`, `black`) |
| Scope / v0.1 | PRD or spec "scope", "MVP", or "v0.1" sections |
| Out of scope | PRD "out of scope" or "non-goals" sections |

Store extracted values in a pre-fill map. Any field with a confident value from docs is **pre-filled** — show it for confirmation in Step 4 rather than asking from scratch.

**Conflict resolution — docs vs memory**: When a doc-derived value (e.g. `package.json` says Jest) conflicts with a memory-based recommendation (e.g. memory says always use Vitest), surface both and ask which to use. Don't silently pick one.

### Summarize what was found

Before proceeding to Step 2, briefly tell the user:

> "Found existing docs: [list of files]. Pre-filled: [field list]. Will ask about: [remaining fields]."

If no relevant docs found, note it and proceed normally.

## Step 2: Global CLAUDE.md (optional, lightweight)

This step is **optional**. All functional behavior — bash rules, model routing, workflow — is handled at the project level. The global config only adds cross-project identity and safety rules.

Check if `global-CLAUDE.md` exists in the project root. If it does not exist, skip this step entirely.

If it exists, attempt to read `~/.claude/CLAUDE.md` (on Windows: `C:\Users\<username>\.claude\CLAUDE.md`).

### 2a — No existing global config

If `~/.claude/CLAUDE.md` does not exist, ask:
> "No global `~/.claude/CLAUDE.md` found. Project OS includes a minimal one with your name and safety rules. Create it? (Recommended — takes 10 seconds)"
>
> 1. **Yes** — create `~/.claude/CLAUDE.md` from `global-CLAUDE.md`
> 2. **Skip** — all project features work without it

If yes: copy `global-CLAUDE.md` to `~/.claude/CLAUDE.md`. Add it to the placeholder scan in Step 3.

### 2b — Existing global config found

Parse both files into their `##` sections. Build a comparison:

| Section | In global-CLAUDE.md | In ~/.claude/CLAUDE.md | Status |
|---|---|---|---|
| [section name] | yes/no | yes/no | Match / Missing / Differs |

Present this table to the user, then ask:

> "Your `~/.claude/CLAUDE.md` already exists. How would you like to handle `global-CLAUDE.md`?"
>
> 1. **Merge** — Add sections from `global-CLAUDE.md` that are missing from your file. Existing sections are untouched.
> 2. **Replace** — Overwrite `~/.claude/CLAUDE.md` with `global-CLAUDE.md` (you will re-fill placeholders in Step 4).
> 3. **Review section-by-section** — Walk through each differing section and choose keep/replace per section.
> 4. **Skip** — Leave `~/.claude/CLAUDE.md` as-is. *(default)*

Execute the chosen option:

- **Merge**: For each section marked "Missing", append it to `~/.claude/CLAUDE.md`.
- **Replace**: Copy `global-CLAUDE.md` to `~/.claude/CLAUDE.md`.
- **Review**: For each section where Status is "Missing" or "Differs", show the two versions side by side and ask "Keep yours / Use template / Skip". Apply answers.
- **Skip**: Do nothing.

After any write operation, confirm: "Global config updated at `~/.claude/CLAUDE.md`."

### 2c — Include global config in placeholder scan

If `~/.claude/CLAUDE.md` was written or updated, add it to the placeholder scan in Step 3.

## Step 3: Scan for placeholders

Search the following files and directories for any text matching the pattern `[ALL_CAPS_OR_WORDS_IN_BRACKETS]`:

- `CLAUDE.md`
- `ROADMAP.md`
- `docs/product.md`
- `docs/tech.md`
- `docs/knowledge/architecture.md`
- `docs/knowledge/decisions.md`
- `docs/knowledge/patterns.md`
- `.claude/rules/preferences.md`

Build a deduplicated list of every unique placeholder found, e.g.:
- `[PROJECT_NAME]`
- `[YOUR_NAME]`
- `[PRIMARY_STACK]`
- `[DATE]`
- etc.

Also note which files each placeholder appears in — you will need to replace it in all locations.

## Step 4: Ask about the project (one round at a time)

**Formatting rule — ALWAYS use numbered picklists for questions with finite options.** Format them exactly like this so Claude Code renders them as a selectable list:

```
> "Question text?"
>
> 1. Option A
> 2. Option B
> 3. Option C *(default)*
```

For open-ended questions (name, description, etc.) use a plain prompt. Within a round, you may include a picklist and one or two open-ended questions in the same message — but keep them clearly separated. Never mix questions from different rounds in the same message.

**One round at a time.** Present a round, wait for answers, then proceed to the next. Do NOT skip ahead or combine rounds.

**For any field already pre-filled in Step 1b**: show the extracted value as the default and ask for confirmation rather than asking from scratch:

```
> Found project name `NightOwl` from README. Correct? (Enter to confirm, or type the correct name)
```

**Skip an entire round** if all its fields are pre-filled and confirmed.

---

### Round 1 — Identity

In a single message, ask only the fields not pre-filled. Open-ended fields (name, description) go above or below the picklist as plain prompts:

- "What is the project name?" *(if not pre-filled)*
- "One sentence: what does it do?" *(if not pre-filled)*

> What type of project is this? *(if not pre-filled)*
>
> 1. Web app (frontend + backend)
> 2. API / backend service
> 3. CLI tool
> 4. Library / package
> 5. Data pipeline
> 6. Automation / scripting
> 7. Other

---

### Round 2 — Stack

Present your recommendations based on memory findings (e.g. "Based on your past projects you've used TypeScript + Vitest — recommend the same here"). For any field pre-filled from docs, show detected value for confirmation. Ask only fields not pre-filled.

For language/runtime, use a picklist if the project type suggests standard choices:

> Primary language and runtime?
>
> 1. TypeScript / Node.js
> 2. Python 3.x
> 3. Go
> 4. Rust
> 5. Bash / shell scripts
> 6. Other (I'll specify)

For framework, database, formatter, and test runner — offer a short picklist based on the detected language, with memory-based recommendations marked *(recommended)*. E.g. for TypeScript:

> Test runner?
>
> 1. Vitest *(recommended — used in past projects)*
> 2. Jest
> 3. None
> 4. Other

---

### Round 3 — Scope (only if docs/product.md is empty AND not pre-filled from PRD/spec)

Ask open-ended:
1. "What's the one-liner for this project?" (for docs/product.md)
2. "What does v0.1 look like — the smallest useful version?"
3. "What's explicitly OUT of scope for now?"

Skip Round 3 entirely if `docs/product.md` already has content beyond the template comment, OR if a PRD/spec doc in Step 1b provided all three fields.

### Round 4 — Feature Toggles

Present both toggles in the same message, each as its own numbered picklist block.

> **Knowledge interface** — The project ships with an Obsidian vault config (`.obsidian/`). Use Obsidian-style formatting for the knowledge vault? (wikilinks like `[[decisions]]` + YAML frontmatter, readable in both Claude and Obsidian)
>
> 1. Yes — Obsidian-compatible formatting *(wikilinks + frontmatter)*
> 2. No — Plain markdown only *(default)*

> **Context7 live docs** — MCP server that fetches up-to-date library docs at query time. Useful for fast-moving frameworks. Security wrapper + PostToolUse validation hook already configured.
>
> 1. Yes — Enable Context7 *(adds `.mcp.json`; hook activates automatically)*
> 2. No — Skip *(default)*

Record answers as `FEATURE_OBSIDIAN` (yes/no) and `FEATURE_CONTEXT7` (yes/no).

### Round 5 — Model Hierarchy

Ask:

> "Which Claude subscription tier are you on? This sets the model routing for orchestration and sub-agents."
>
> 1. **Max** — Opus for orchestration, Sonnet for sub-agents
> 2. **Pro** — Sonnet for orchestration, Haiku for sub-agents *(default)*
> 3. **Custom** — I'll specify models manually

If **Custom**, ask:
- Orchestration model ID (e.g. `claude-opus-4-6`, `claude-sonnet-4-6`)
- Sub-agent model ID (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`)

Record as:
- `MODEL_ORCHESTRATION` — the primary/orchestration model ID
- `MODEL_SUBAGENT` — the sub-agent model ID

Standard tier mappings:
| Tier | Orchestration | Sub-agent |
|---|---|---|
| Max | `claude-opus-4-6` | `claude-sonnet-4-6` |
| Pro | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` |

### Round 6 — Code Review Tool (optional)

Ask:

> "Do you use an external code review tool? This adds review instructions to `.claude/rules/code-review.md`."
>
> 1. **Codex** — OpenAI Codex CLI (invoked via `codex` in PowerShell/terminal)
> 2. **GitHub Copilot CLI** — `gh copilot` suggestions
> 3. **Other** — I'll describe it
> 4. **None / Skip** — Claude handles reviews internally *(default)*

If **None / Skip**: skip to Step 5. No file is created.

If **Codex**:
- Record as `CODE_REVIEW_TOOL=codex`

If **GitHub Copilot CLI**:
- Record as `CODE_REVIEW_TOOL=copilot`

If **Other**:
- Ask: "How do you invoke it? (command + any flags)"
- Record as `CODE_REVIEW_TOOL=other`, `CODE_REVIEW_COMMAND=[command]`

Create `.claude/rules/code-review.md` with the appropriate content:

**Codex:**
```markdown
# Code Reviews

Use Codex for code review and checks.
- Always use the wrapper script: `bash scripts/codex-review.sh --prompt-file ./codex-prompt.txt`
- Write prompts to project root (`./codex-prompt.txt`) using the Write tool — never use `/tmp/` or heredocs
- Optional flags: `--diff-from BRANCH` (appends git diff), `--mode danger-full-access` (default: read-only)
- Never invoke `codex exec` directly — the wrapper handles stdin piping and temp files
- Clean up prompt file after: `rm ./codex-prompt.txt`
```

**GitHub Copilot CLI:**
```markdown
# Code Reviews

Use GitHub Copilot CLI for code suggestions.
- Explain code: `gh copilot explain "..."`
- Suggest fixes: `gh copilot suggest "..."`
```

**Other:**
```markdown
# Code Reviews

Use <command> for code review.
```

Replace `<command>` with the actual invocation the user provided before writing the file.

## Step 5: Fill in all placeholders

Using the answers collected, replace every placeholder found in Step 2.

Standard mappings:
- `[PROJECT_NAME]` → project name from Round 1
- `[YOUR_NAME]` → owner name (ask once if not already known; check memory for the owner's name from past project profiles)
- `[PRIMARY_STACK]` → language + framework + db, e.g. `TypeScript / Next.js / SQLite`
- `[DATE]` or `[TODAY]` → today's date in `YYYY-MM-DD` format
- `[preferred language]` → language from Round 2
- `[prettier/black/gofmt/etc.]` → formatter from Round 2
- `[jest/pytest/go test/etc.]` → test runner from Round 2

For each file containing placeholders, make all replacements in a single edit pass.

Also apply model routing from Round 5: update the `## Model Routing` section of `CLAUDE.md` to reflect the chosen models:

```markdown
## Model Routing
- **Orchestration & design**: [MODEL_ORCHESTRATION]
- **Sub-agent implementation**: [MODEL_SUBAGENT] (via `CLAUDE_CODE_SUBAGENT_MODEL`)
```

Set `CLAUDE_CODE_SUBAGENT_MODEL=[MODEL_SUBAGENT]` in `.claude/models.env` (create the file if it doesn't exist):

```bash
# Model routing — managed by /tools:init and /tools:set-models
export CLAUDE_CODE_SUBAGENT_MODEL=[MODEL_SUBAGENT]
export CLAUDE_ORCHESTRATION_MODEL=[MODEL_ORCHESTRATION]
```

Tell the user how to activate sub-agent routing in their shell profile:

- **bash/zsh**: `echo 'source /path/to/project/.claude/models.env' >> ~/.bashrc`
- **PowerShell**: Add `. /path/to/project/.claude/models.env` to `$PROFILE` (or set the env vars manually in PowerShell)

## Step 5a: Apply feature toggles

### Obsidian (if FEATURE_OBSIDIAN = yes)

Append this section to `CLAUDE.md`:

```markdown
## Obsidian

This project's knowledge vault is Obsidian-compatible. Follow these rules when working with `docs/knowledge/` files:
- Use `[[wikilinks]]` when cross-referencing knowledge files (e.g. `[[decisions]]`, `[[patterns]]`)
- Preserve YAML frontmatter at the top of every knowledge file — never remove or overwrite it
- Tags live in frontmatter (`tags: [decisions, adr]`), not inline — don't add `#hashtags` to knowledge files

To browse the vault: open this project folder in Obsidian → graph view, backlinks, and tag pane are ready immediately.
```

### Context7 (if FEATURE_CONTEXT7 = yes)

1. Detect the operating system. On Windows, `npx` must be wrapped with `cmd /c` to execute correctly.

   Create `.mcp.json` at the project root with the appropriate config:

   **Windows** (`%OS% == Windows_NT` or `uname` contains "MINGW"/"MSYS"/"CYGWIN"/"Windows"):
   ```json
   {
     "mcpServers": {
       "context7": {
         "command": "cmd",
         "args": ["/c", "npx", "-y", "@upstash/context7-mcp@latest"]
       }
     }
   }
   ```

   **Mac / Linux**:
   ```json
   {
     "mcpServers": {
       "context7": {
         "command": "npx",
         "args": ["-y", "@upstash/context7-mcp@latest"]
       }
     }
   }
   ```

2. Append this section to `CLAUDE.md`:

```markdown
## MCP Tools

### Context7
Context7 is enabled for this project. Use it to fetch up-to-date library documentation before implementing against third-party APIs.

- Tool: `resolve-library-id` — find the Context7 library ID for a package
- Tool: `get-library-docs` — fetch current docs for a resolved library ID
- Security: all Context7 calls are governed by `.claude/security/mcp-allowlist.json` — only `api.context7.com` and `registry.npmjs.org` are permitted network destinations
- Allowed tools: `resolve-library-id`, `get-library-docs` only
```

## Step 6: Populate product and tech docs (if empty)

If `docs/product.md` contains only the template comment, replace it with content from Round 3 answers **or** from the pre-fill map if a PRD/spec was discovered in Step 1b. When using a discovered PRD, note the source file in a comment at the top of the doc.

```markdown
# Product Vision

## One-Liner
[answer from Round 3]

## Problem
[what it solves, from the one sentence in Round 1]

## v0.1 Scope
[answer from Round 3]

## Out of Scope (v0.1)
[answer from Round 3]
```

If `docs/tech.md` contains only the template comment, replace it with:

```markdown
# Technical Decisions

## Stack
- Language: [language]
- Runtime: [runtime]
- Framework: [framework or "none"]
- Database: [database or "none"]
- Formatter: [formatter]
- Test runner: [test runner]

## Rationale
[1-2 sentences on why this stack for this project]
```

## Step 7: Save project profile to memory

Append a new entry to `docs/memory/project-profiles.md` (create it if it doesn't exist):

```markdown
## [PROJECT_NAME]
- **Date**: [TODAY]
- **Type**: [project type]
- **Stack**: [PRIMARY_STACK]
- **Formatter**: [formatter]
- **Test runner**: [test runner]
- **One-liner**: [one sentence description]
- **Features**: Obsidian=[yes/no], Context7=[yes/no]
- **Code review**: [Codex/Copilot/other/none]
- **Model tier**: [Max/Pro/Custom] — orchestration=[MODEL_ORCHESTRATION], sub-agent=[MODEL_SUBAGENT]
```

This record will be available as a recommendation source for future projects. In Round 5, offer the saved tier as the default recommendation for the next project.

## Step 8: Install /tools:new-project globally

Run the install script to make `/tools:new-project` available in any Claude session (not just this project):

```bash
bash scripts/install-global-commands.sh
```

If the script succeeds, note: "`/tools:new-project` installed globally — available from any directory."

If the script fails (e.g. missing file, permissions), note the failure but continue — it is non-blocking. The user can run it manually later.

## Step 9: Initialize git (if needed)

Check if `.git/` exists. If not, ask:
> "No git repo detected. Initialize one now?"

If yes:
```bash
git init
git add .
```
Then write the commit message to `/tmp/commit-msg.txt` and commit:
```bash
# Write message first (avoids inline shell injection with special chars in project name)
cat > /tmp/commit-msg.txt << 'EOF'
chore: initialize project — [PROJECT_NAME]
EOF
git commit -F /tmp/commit-msg.txt
```

## Step 10: Report

Summarize what was done:

> **Project initialized: [PROJECT_NAME]**
>
> **Global config** (`~/.claude/CLAUDE.md`): [copied / merged / replaced / skipped]
> **Placeholders filled**: [N] across [M] files
> **Docs updated**: [list]
> **Features enabled**:
> - Obsidian vault: [enabled — wikilinks + frontmatter active / disabled]
> - Context7 MCP: [enabled — `.mcp.json` created / disabled]
> - Code review: [Codex / GitHub Copilot CLI / other / none — Claude handles reviews internally]
> **Model routing** ([Max/Pro/Custom]):
> - Orchestration: [MODEL_ORCHESTRATION]
> - Sub-agents: [MODEL_SUBAGENT] (`CLAUDE_CODE_SUBAGENT_MODEL`)
> - Config: `.claude/models.env` — source in shell profile to activate
> **Global commands**: [installed — `/tools:new-project` available everywhere / failed — run `bash scripts/install-global-commands.sh` manually]
> **Memory updated**: `docs/memory/project-profiles.md`
> **Git**: [initialized / already exists]
>
> Ready to build. Start with `/pm:prd [feature]` or `/workflows:idea [feature]`.
