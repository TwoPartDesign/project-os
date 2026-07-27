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

Before asking any questions, gather everything that might already answer them — from a deterministic stack detector and from a scan of the project's own docs. This reduces how much the user has to type.

### Detect the stack

Run the stack detector first. It is the **single source of truth** for manifest-derived fields — do not hand-read `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc. yourself; the detector already does this deterministically and safely (read-only, never executes project code):

```bash
node scripts/detect-stack.ts .
```

It prints one JSON object to stdout, e.g.:

```json
{
  "language": "typescript", "package_manager": "pnpm", "framework": "next",
  "database": "sqlite", "test_runner": "vitest", "formatter": "prettier",
  "confidence": "high", "signals": ["package.json", "pnpm-lock.yaml", "deps:next", "devDeps:vitest"],
  "fallback_used": false
}
```

JSON field mapping:

| JSON field | Pre-fill field | Notes |
|---|---|---|
| `language` | Stack (language/runtime) | nullable; e.g. `"typescript"`, `"python"`, `"go"`, `"rust"`, `"ruby"`, `"php"`, `"csharp"` |
| `package_manager` | Stack (context) | nullable; e.g. `"npm"`, `"pnpm"`, `"poetry"`, `"uv"` |
| `framework` | Framework | nullable; e.g. `"next"`, `"fastapi"`, `"django"` |
| `database` | Database | nullable; e.g. `"prisma"`, `"sqlite3"`, `"pg"` |
| `test_runner` | Test runner | nullable; e.g. `"vitest"`, `"jest"`, `"pytest"` |
| `formatter` | Formatter | nullable; e.g. `"prettier"`, `"black"`, `"ruff"` |
| `confidence` | — | `"high"` (manifest + lockfile matched) / `"medium"` (manifest only) / `"low"` (nothing matched) |
| `signals` | — | file/key names that produced the result (never values) — cite these when presenting the pre-fill, e.g. "detected via package.json + pnpm-lock.yaml + deps:next" |
| `fallback_used` | — | `true` exactly when `confidence` is `"low"` — triggers the census fallback below |

Any non-null field is **pre-filled** — show it with its `confidence` for confirmation in Step 4 rather than asking from scratch (e.g. "Detected TypeScript / pnpm / Next.js / Vitest — high confidence, from package.json + pnpm-lock.yaml"). `medium`-confidence values are still pre-filled, just flag them as less certain.

### Census fallback (when confidence is low)

If `confidence` is `"low"` (`fallback_used: true` — no manifest matched at all), the detector alone can't name a language. Fall back to an extension census to produce a **suggestion**, never a pre-fill:

1. Glob `**/*.{ts,tsx,js,py,go,rs,rb,php,cs,sh}` from the project root.
2. Skip these directories entirely: `.git`, `node_modules`, `dist`, `build`, `vendor`, `.venv`, `target`.
3. Count matches per extension.
4. The extension with the most matches is a *suggestion* — present it to the user for confirmation in Round 2 (e.g. "No manifest found, but most files are `.py` — Python?"). Unlike a `medium`/`high`-confidence detector value, a census result is **never auto-committed** as a pre-fill; it must be confirmed like any unanswered question.

### Locations to check for docs (in priority order)

1. **README.md** / **README.rst** — often has project name and description
2. **docs/product.md** — may have vision/scope already filled
3. **docs/tech.md** — may have stack decisions already filled
4. **docs/specs/** — any spec files that describe the feature set
5. **PRD.md**, **prd.md**, `docs/PRD.md`, `docs/prd.md` — external product requirements doc
6. **SPEC.md**, `docs/SPEC.md` — external spec
7. ***.md** files in the project root (any docs the user may have dropped in)

Use Glob to find which of these exist, then Read any that do.

### Extract from found docs

Build a pre-fill map from what you find:

| Field | Extraction hint |
|---|---|
| Project name | README `#` heading, or folder name |
| Description / one-liner | README first paragraph |
| Scope / v0.1 | PRD or spec "scope", "MVP", or "v0.1" sections |
| Out of scope | PRD "out of scope" or "non-goals" sections |

Merge these into the same pre-fill map used for the detector's fields. Any field with a confident value from docs is **pre-filled** — show it for confirmation in Step 4 rather than asking from scratch.

**Conflict resolution — detector vs docs vs memory**: A field can now have up to three candidate values — the detector's manifest-derived value, a doc-derived value, and a memory-based recommendation (e.g. detect-stack reports `test_runner: "jest"`, `docs/tech.md` says "we use Mocha", and memory recommends "always use Vitest"). When any two of these disagree, surface *all* values found and their sources, and ask the user which to use. Don't silently pick one.

### Summarize what was found

Before proceeding to Step 2, briefly tell the user:

> "Detected stack: [language/framework/etc., with confidence]. Found existing docs: [list of files]. Pre-filled: [field list]. Will ask about: [remaining fields]."

If detection found nothing and no relevant docs were found, note it and proceed normally.

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

Present your recommendations based on memory findings (e.g. "Based on your past projects you've used TypeScript + Vitest — recommend the same here"). For any field pre-filled in Step 1b (from the detector, docs, or a census suggestion), show the value for confirmation. Ask only fields not pre-filled.

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
- Orchestration model ID — prefer a bare alias (`opus`/`sonnet`/`haiku`, or `fable` for the Fable/Mythos tier), which always resolves to the latest model in that family. Pin a dated ID (e.g. `claude-opus-4-8`) only when you need a specific version.
- Sub-agent model ID — same: prefer a bare alias (`sonnet`/`haiku`) over a dated ID.

Record as:
- `MODEL_ORCHESTRATION` — the primary/orchestration model ID
- `MODEL_SUBAGENT` — the sub-agent model ID

Standard tier mappings (bare aliases so routing always tracks the latest release):
| Tier | Orchestration | Sub-agent |
|---|---|---|
| Max | `opus` (or `fable` for the hardest design work) | `sonnet` |
| Pro | `sonnet` | `haiku` |

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

Using the answers collected, replace every placeholder found in Step 3.

Standard mappings:
- `[PROJECT_NAME]` → project name from Round 1
- `[YOUR_NAME]` → owner name (ask once if not already known; check memory for the owner's name from past project profiles)
- `[YOUR_ROLE]` → the owner's role, e.g. `Solo developer`
- `[PRIMARY_STACK]` → language + framework + db, e.g. `TypeScript / Next.js / SQLite`
- `[FORMATTER]` → formatter from Round 2 (used in `.claude/rules/preferences.md`)
- `[TEST_RUNNER]` → test runner from Round 2, with its layout convention if any, e.g. `vitest (tests/ mirrors src/)`
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

Set the models in `.claude/settings.json` (create the file if it doesn't exist, preserving any existing keys):

```json
{
  "model": "[MODEL_ORCHESTRATION]",
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "[MODEL_SUBAGENT]"
  }
}
```

- `"model"` sets the orchestration/session model (aliases like `"opus"` resolve to the current Opus)
- `env.CLAUDE_CODE_SUBAGENT_MODEL` routes sub-agent tasks

Settings take effect on the next Claude Code session — no shell profile changes needed.

## Step 5b: Seed the knowledge vault from facts you already have

`docs/knowledge/*.md` ship as **near-empty seeds** from `templates/` — they contain format
contracts and nothing else, so there is no framework prose to clean up. Your job here is narrow:
replace the architecture seed's placeholder body with the few things you now know as fact.

Write `docs/knowledge/architecture.md`, preserving its YAML frontmatter:

```markdown
# System Architecture

[PROJECT_NAME] — [one-liner from Round 1].

## Stack
- Language / runtime: [from Round 2]
- Framework: [from Round 2, or "none"]
- Database: [from Round 2, or "none"]
- Test runner: [from Round 2]

## High-Level Structure

_Not yet designed. `/workflows:design` fills this in per feature._

## Module Map

| Module | Path | Purpose |
|--------|------|---------|
```

**Hard rule: write facts, never inferences.** Do not invent components, layers, directories, or
data flows the project does not yet have. An empty section is correct and honest; a plausible
invented architecture is the exact failure this seeding exists to prevent — an LLM reads it as
ground truth and designs against a system that does not exist. If a PRD or spec was discovered in
Step 1b and states real architecture, cite it: `Source: docs/PRD.md §3`.

Leave `decisions.md`, `patterns.md`, `bugs.md`, `metrics.md`, and `kv.md` **untouched**. They are
append-only logs; the correct content for a brand-new project is zero entries. `/workflows:design`
writes ADRs, `/workflows:review` writes patterns, `/workflows:ship` writes metrics.

**DO NOT run `bash scripts/generate-manifest.sh` at any point in this command.** The manifest's
`seed_hashes` block is the baseline the `unlocalized-template-content` readiness check compares
against. Regenerating the manifest after you have localized files would re-record your localized
content as the seed baseline and permanently blind that check for this project. Init never
regenerates the manifest — only `new-project.sh` (at bootstrap) and `update-project.sh` do.

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

## Step 5c: Grant toolchain permissions for the detected stack

**Why this step exists.** `permissions.allow` in the shipped `.claude/settings.json` enumerates
git subcommands and every template script by name, but has no entry for any *project* toolchain.
Sub-agents cannot answer permission prompts (`.claude/rules/bash.md`), so the first
`npm install` inside `/workflows:build` **stalls the agent** — a silent hang, not a visible
failure. You are the only step that knows the stack, so you are the only place this can be fixed.

Read `.claude/settings.json`, then **append** stack-appropriate entries to `permissions.allow`
(preserve every existing entry — never rewrite the array wholesale).

Follow the restrictive-allow posture from the 2026-07-12 ADR: grant **per-subcommand** prefixes,
never a blanket `Bash(npm *)`. Grant only what the confirmed stack actually needs.

| Stack (from Round 2) | Entries to add |
|---|---|
| Node / npm | `Bash(npm install:*)`, `Bash(npm ci:*)`, `Bash(npm run:*)`, `Bash(npm test:*)`, `Bash(npx:*)` |
| Node / pnpm | `Bash(pnpm install:*)`, `Bash(pnpm run:*)`, `Bash(pnpm test:*)`, `Bash(pnpm dlx:*)` |
| Node / yarn | `Bash(yarn install:*)`, `Bash(yarn run:*)`, `Bash(yarn test:*)` |
| Vite / Vitest | `Bash(npx vite:*)`, `Bash(npx vitest:*)` |
| Python / pip | `Bash(pip install:*)`, `Bash(python -m pytest:*)`, `Bash(pytest:*)` |
| Python / uv | `Bash(uv sync:*)`, `Bash(uv run:*)` |
| Python / poetry | `Bash(poetry install:*)`, `Bash(poetry run:*)` |
| Go | `Bash(go build:*)`, `Bash(go test:*)`, `Bash(go mod:*)`, `Bash(go vet:*)` |
| Rust | `Bash(cargo build:*)`, `Bash(cargo test:*)`, `Bash(cargo check:*)`, `Bash(cargo clippy:*)` |

Two rules:
- **Never add a bare interpreter** (`Bash(node:*)`, `Bash(python:*)`, `Bash(bash:*)`). Those are
  arbitrary code execution, not a toolchain grant.
- **Never add a publish or deploy verb** (`npm publish`, `cargo publish`, `gh release`,
  `terraform apply`). Those stay interactive on purpose.

Report what was added in Step 10 so the owner can audit it.

### Record the Node floor the framework's own tooling needs

Everything under `scripts/*.ts` runs on Node's type stripping and requires
**Node >= 22.18**. `scripts/setup.sh` now checks this at activation and refuses to
proceed on an older runtime — but nothing in a cloned project *declares* the
requirement in a machine-readable way, so version managers (nvm, volta, asdf, CI
images) cannot honour it.

This is deliberately **not** shipped as a template file. A `package.json` copied into
every clone would be wrong twice over: it would put one in Python, Go, and Rust
projects that should not have one, and in `--adopt` mode it would collide with the
target's real `package.json` and leave a spurious `package.json.upstream` behind. You
know the stack, so you are the right place to decide.

**If the stack from Round 2 is Node/JavaScript/TypeScript:**

Ensure `package.json` exists and carries the floor. If it already exists, **merge**
this key and preserve every other field verbatim — never rewrite the file:

```json
{
  "engines": {
    "node": ">=22.18"
  }
}
```

Also add `.nvmrc` containing `22.18` if the project uses nvm.

**If the stack is anything else (Python, Go, Rust, Ruby, shell-only):**

Do **not** create a `package.json`. Record the requirement in `docs/tech.md` instead,
under the Stack section:

```markdown
- Tooling runtime: Node >=22.18 (required by Project OS's own scripts/*.ts —
  security scanner, knowledge index, system map. Independent of this project's
  own language.)
```

Either way, state in the Step 10 report which of the two you did.

## Step 5d: State the docs/specs tracking policy out loud

The shipped `.gitignore` contains:

```
docs/specs/*
!docs/specs/.gitkeep
```

That is defensible for disposable planning notes and **wrong** for any project whose specs *are*
the research. Left unmentioned it causes silent data loss: a PRD with market analysis, licensing
investigation, and a full decision log can exist on exactly one disk while `git status` reports a
clean tree — actively concealing it.

Do not decide this silently. Ask:

> **Version-control your specs?** `docs/specs/` currently holds briefs, designs, task plans, and
> any PRD. The shipped `.gitignore` excludes it, so those files would exist only on this machine
> and `git status` would still look clean.
>
> 1. **Track specs** — remove the ignore rule; ignore only `docs/specs/**/scratch/` *(recommended — specs are usually the most valuable documents in the repo)*
> 2. **Keep specs untracked** — leave the ignore rule as shipped *(you accept they live on one disk)*
> 3. **Track specs, ignore per-task context** — track briefs/designs/tasks, ignore `docs/specs/**/tasks/*/context.md` (regenerable by `/workflows:plan`)

Apply the answer by editing `.gitignore`:

- **Option 1**: replace the `docs/specs/*` / `!docs/specs/.gitkeep` pair with `docs/specs/**/scratch/`
- **Option 2**: leave unchanged, and say plainly in Step 10: "docs/specs/ is NOT version-controlled."
- **Option 3**: replace with `docs/specs/**/tasks/*/context.md`

If the repo already has untracked files under `docs/specs/`, name them in the prompt — those are
the files at risk right now.

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

If yes, run these as **separate** Bash calls (`.claude/rules/bash.md`: one command per call, no
`&&` chaining):

```bash
git init
```
```bash
git add .
```

Then commit with a message file. Two rules from `.claude/rules/bash.md` apply, and the previous
version of this step broke both:

- **Use the Write tool, not a heredoc.** `cat > file << 'EOF'` is exactly the multi-line embedded
  construct bash.md says to avoid — it falls back to a permission prompt, which a sub-agent
  cannot answer.
- **Never use `/tmp/`.** On Windows the Write tool and Git Bash resolve `/tmp/` to *different*
  places, so the file is written to one path and `git commit -F` reads from another, which fails.
  Write to the session scratchpad directory if one is available, otherwise to the project root and
  delete it afterwards.

Write the message with the Write tool to `<scratchpad>/commit-msg.txt` (or `./commit-msg.txt` if
no scratchpad exists):

```
chore: initialize project — [PROJECT_NAME]
```

Then commit, passing that exact path:

```bash
git commit -F "<scratchpad>/commit-msg.txt"
```

If you wrote to the project root, remove it afterwards:

```bash
rm ./commit-msg.txt
```

## Step 10: Verify — assert, do not summarize

**Do not skip this step, and do not report success before running it.** Every step above reports
what it *wrote*. None of them check whether the project you just initialized would mislead the next
agent that reads it. That is the actual acceptance criterion for this command, and it is
mechanically checkable:

```bash
node scripts/system-map.ts report --json
```

Filter the findings for these two `kind` values:

| `kind` | Meaning | Expected after a successful init |
|---|---|---|
| `init-incomplete` | `CLAUDE.md` still has unfilled `[PLACEHOLDER]` tokens | **none** — Step 5 should have filled them all |
| `unlocalized-template-content` | A watched content file still hashes identical to the template seed it shipped as | none for `docs/knowledge/architecture.md` (Step 5b wrote it) and `.claude/rules/preferences.md` (Step 5 filled its placeholders) |

Then act on the result:

- **`init-incomplete` present** → Step 5 missed a placeholder. Read `CLAUDE.md`, fill the tokens
  the finding names, and re-run the check. Do not report success while this finding exists.
- **`unlocalized-template-content` on `architecture.md` or `preferences.md`** → the file you were
  supposed to write is still byte-identical to its seed. Go back to Step 5b / Step 5 and actually
  write it.
- **`unlocalized-template-content` on `decisions.md` / `patterns.md` / `bugs.md` / `metrics.md`**
  → **expected and correct.** Those are append-only logs and a new project genuinely has zero
  entries. Do not write filler to silence them; they clear naturally as
  `/workflows:design`, `/workflows:review`, and `/workflows:ship` append real entries. Report them
  as informational.
- **Command unavailable** (no Node, missing `scripts/system-map.ts`) → say so explicitly in the
  report rather than silently omitting the verification line.

If `scripts/system-map.ts` is absent, fall back to a manual assertion: grep `CLAUDE.md` for
`[PROJECT_NAME]`, `[YOUR_ROLE]`, `[YOUR_NAME]`, `[PRIMARY_STACK]` and confirm zero matches.

## Step 11: Report

Summarize what was done. The **Verification** block is not optional — it is the part that says
whether this init actually succeeded:

> **Project initialized: [PROJECT_NAME]**
>
> **Global config** (`~/.claude/CLAUDE.md`): [copied / merged / replaced / skipped]
> **Placeholders filled**: [N] across [M] files
> **Docs updated**: [list]
> **Knowledge vault**: `docs/knowledge/architecture.md` seeded from stack answers; decisions/patterns/bugs/metrics left empty (append-only)
> **Features enabled**:
> - Obsidian vault: [enabled — wikilinks + frontmatter active / disabled]
> - Context7 MCP: [enabled — `.mcp.json` created / disabled]
> - Code review: [Codex / GitHub Copilot CLI / other / none — Claude handles reviews internally]
> **Model routing** ([Max/Pro/Custom]):
> - Orchestration: [MODEL_ORCHESTRATION]
> - Sub-agents: [MODEL_SUBAGENT] (`CLAUDE_CODE_SUBAGENT_MODEL`)
> - Config: `.claude/settings.json` — applies on next session
> **Toolchain permissions added** (Step 5c): [list the exact `permissions.allow` entries, or "none — no toolchain detected"]
> **docs/specs tracking** (Step 5d): [tracked, ignoring scratch/ / NOT version-controlled — specs live only on this machine / tracked, per-task context ignored]
> **Global commands**: [installed — `/tools:new-project` available everywhere / failed — run `bash scripts/install-global-commands.sh` manually]
> **Memory updated**: `docs/memory/project-profiles.md`
> **Git**: [initialized / already exists]
>
> **Verification** (`node scripts/system-map.ts report`):
> - `init-incomplete`: [none — all placeholders filled / N found and fixed / CHECK UNAVAILABLE]
> - `unlocalized-template-content`: [none / N informational — empty append-only logs: decisions, patterns, bugs, metrics]
>
> Ready to build. Start with `/pm:prd [feature]` or `/workflows:idea [feature]`.
