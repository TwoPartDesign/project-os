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

## Step 2: Global CLAUDE.md merge

Check if `global-CLAUDE.md` exists in the project root. If it does not exist, skip this step entirely.

If it exists:

### 2a — Read both files

- Read `global-CLAUDE.md` (the template shipped with Project OS)
- Attempt to read `~/.claude/CLAUDE.md` (the user's actual global config)
  - On Windows this resolves to `C:\Users\<username>\.claude\CLAUDE.md`
  - Use the home directory of the current user

### 2b — No existing global config

If `~/.claude/CLAUDE.md` does not exist, tell the user:
> "No global `~/.claude/CLAUDE.md` found. This project includes a recommended one (`global-CLAUDE.md`). Copy it to `~/.claude/CLAUDE.md`?"

If yes: copy `global-CLAUDE.md` to `~/.claude/CLAUDE.md`. Note it for the Step 2 placeholder scan — the user will fill in its placeholders as part of Step 4. Skip to Step 3.

### 2c — Existing global config found

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
> 4. **Skip** — Leave `~/.claude/CLAUDE.md` as-is.

Execute the chosen option:

- **Merge**: For each section marked "Missing", append it to `~/.claude/CLAUDE.md`.
- **Replace**: Copy `global-CLAUDE.md` to `~/.claude/CLAUDE.md`.
- **Review**: For each section where Status is "Missing" or "Differs", show the two versions side by side and ask "Keep yours / Use template / Skip". Apply answers.
- **Skip**: Do nothing.

After any write operation, confirm: "Global config updated at `~/.claude/CLAUDE.md`."

### 2d — Include global config in placeholder scan

If `~/.claude/CLAUDE.md` was written or updated in this step, add it to the list of files to scan for placeholders in Step 3 so any `[BRACKET]` values get filled in during Step 4.

## Step 3: Scan for placeholders

Search the following files and directories for any text matching the pattern `[ALL_CAPS_OR_WORDS_IN_BRACKETS]`:

- `CLAUDE.md`
- `ROADMAP.md`
- `docs/product.md`
- `docs/tech.md`
- `docs/knowledge/architecture.md`
- `docs/knowledge/decisions.md`
- `docs/knowledge/patterns.md`

Build a deduplicated list of every unique placeholder found, e.g.:
- `[PROJECT_NAME]`
- `[YOUR_NAME]`
- `[PRIMARY_STACK]`
- `[DATE]`
- etc.

Also note which files each placeholder appears in — you will need to replace it in all locations.

## Step 4: Ask about the project (2-3 questions at a time)

Start with the high-level questions. Do NOT ask everything at once.

### Round 1 — Identity
Ask:
1. What is the project name?
2. What type of project is this? (web app, CLI tool, API/backend, library, data pipeline, automation script, other)
3. One sentence: what does it do?

### Round 2 — Stack
Present your recommendations based on memory findings (e.g. "Based on your past projects you've used TypeScript + Vitest — recommend the same here unless this is a different type of project"). Then ask:

1. Primary language and runtime (e.g. TypeScript/Node, Python/3.12, Go 1.22)
2. Framework, if any (e.g. Next.js, FastAPI, Express, none)
3. Database, if any (e.g. SQLite, Postgres, none)
4. Formatter and test runner (offer recommendations from memory or defaults)

### Round 3 — Scope (only if docs/product.md is empty)
Ask:
1. What's the one-liner for this project? (for docs/product.md)
2. What does v0.1 look like — the smallest useful version?
3. What's explicitly OUT of scope for now?

Skip Round 3 if `docs/product.md` already has content beyond the template comment.

### Round 4 — Feature Toggles

Ask these two questions together:

1. **Knowledge interface** — The project ships with an Obsidian vault config (`.obsidian/`). Do you want Claude to use Obsidian-style formatting for the knowledge vault? This means wikilinks like `[[decisions]]` and YAML frontmatter preserved in knowledge files — readable in both Claude and Obsidian.
   - `Y` — Use Obsidian-compatible formatting (wikilinks + frontmatter)
   - `N` — Plain markdown only (no wikilinks, no frontmatter)

2. **Context7 live docs** — Context7 is an MCP server that fetches up-to-date library documentation at query time. Useful for fast-moving frameworks. A security wrapper is already configured at `.claude/security/mcp-allowlist.json`, and a `PostToolUse` hook at `.claude/hooks/post-mcp-validate.sh` automatically validates every Context7 response for suspicious content and size.
   - `Y` — Enable Context7 (adds `.mcp.json` to project root; hook activates automatically)
   - `N` — Skip

Record answers as `FEATURE_OBSIDIAN` (yes/no) and `FEATURE_CONTEXT7` (yes/no).

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

   **Windows** (`%OS% == Windows_NT` or `uname` contains "MINGW"/"CYGWIN"/"Windows"):
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

If `docs/product.md` contains only the template comment, replace it with:

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
```

This record will be available as a recommendation source for future projects.

## Step 8: Initialize git (if needed)

Check if `.git/` exists. If not, ask:
> "No git repo detected. Initialize one now?"

If yes:
```bash
git init
git add .
git commit -m "chore: initialize project — [PROJECT_NAME]"
```

## Step 9: Report

Summarize what was done:

> **Project initialized: [PROJECT_NAME]**
>
> **Global config** (`~/.claude/CLAUDE.md`): [copied / merged / replaced / skipped]
> **Placeholders filled**: [N] across [M] files
> **Docs updated**: [list]
> **Features enabled**:
> - Obsidian vault: [enabled — wikilinks + frontmatter active / disabled]
> - Context7 MCP: [enabled — `.mcp.json` created / disabled]
> **Memory updated**: `docs/memory/project-profiles.md`
> **Git**: [initialized / already exists]
>
> Ready to build. Start with `/pm:prd [feature]` or `/workflows:idea [feature]`.
