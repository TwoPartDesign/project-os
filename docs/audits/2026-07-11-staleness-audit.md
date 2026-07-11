# Project OS Staleness Audit — 2026-07-11

**Scope:** Full repo — model routing, workflows, worktrees, agent orchestration, hooks, scripts, rules, docs, templates.
**Method:** 4 parallel audit passes (workflow commands/agents/skills, hooks/scripts/settings, docs/templates/rules, current-platform verification against Claude Code docs).
**Repo state audited:** `bd8910f` (last commit 2026-04-14 — ~3 months idle; history spans 2026-03-04 → 2026-04-14).

---

## Executive summary

Project OS was built against the Claude 4.x generation and the early-2026 Claude Code feature set. Since then the platform shipped the **Claude 5 family** (`claude-fable-5`, `claude-sonnet-5`), **Opus 4.8**, native **worktree isolation**, **background subagents**, **workflow orchestration**, **auto-memory**, and **skills as the successor to command markdown**. The repo's core value proposition — governance gates, spec-first workflow, ROADMAP conventions — is not stale. What *is* stale falls into five buckets:

1. **Model routing is frozen at the 4.6 generation** (settings, tier tables, escalation ladder, adapter defaults) and internally contradictory (docs say Haiku sub-agents; settings say `claude-sonnet-4-6`).
2. **Several security/validation mechanisms don't actually work** (MCP validation hook has a dead error branch and wrong exit codes; the permissions deny-list is trivially bypassable while the allow-list grants arbitrary code execution).
3. **Hand-rolled infrastructure now duplicates native Claude Code features** (worktree recovery, adapter dispatch layer, wave scheduling, session handoff, context filtering, memory indexing).
4. **Hooks silently no-op** in several places due to outdated assumptions about hook I/O (stderr vs `additionalContext` JSON), removed tools (`MultiEdit`), and an undocumented env var.
5. **Docs/status/manifest drift**: PROJECT_STATUS, ROADMAP, CHANGELOG, architecture.md, and manifest.json disagree with each other and with the file tree.

---

## 1. Critical — broken or security-relevant (fix first)

### 1.1 MCP output validation is effectively non-functional
- `.claude/hooks/post-mcp-validate.sh:19-33` — runs under `set -euo pipefail`; if `jq` fails, the script exits before the `if [ $? -ne 0 ]` fallback ever runs. The intended "fail-safe on parse error" branch is dead code.
- `post-mcp-validate.sh` + `.claude/security/validate-mcp-output.sh` exit with code **1** to "surface a warning to Claude." In current Claude Code only **exit 2** (or `hookSpecificOutput.additionalContext` JSON on stdout) feeds hook output back to the model. The injection/security alerts never reach Claude's context.
- `validate-mcp-output.sh:9` — allowlist path is relative (`.claude/security/mcp-allowlist.json`) even though `$PROJECT_ROOT` is computed on line 13; invoked from any other cwd, every MCP response is blocked for the wrong reason.
- `validate-mcp-output.sh:47-49` — the validator **mutates the input file in place** on oversize content (`head -c` + `mv`), a destructive side effect that can also split UTF-8 mid-codepoint.

### 1.2 Permissions model is security theater
- `.claude/settings.json:26` — `"deny": ["Bash(rm -rf /)"]` blocks exactly one literal string. `rm -rf /*`, `rm -fr /`, `rm -rf ~`, `rm --recursive --force /` all pass.
- `.claude/settings.json:5-17` — `Bash(git *)`, `Bash(npm *)`, `Bash(npx *)`, `Bash(find *)`, `Bash(sed *)`, `Bash(awk *)` each allow arbitrary code execution (`find -exec sh -c`, GNU `sed` `e` command, `awk system()`, npm lifecycle scripts), making the deny-list moot. Scope allows to specific subcommands and drop the blanket `sed`/`awk`/`find` grants.

### 1.3 Codex adapter isolation claim is false
- `.claude/agents/adapters/INTERFACE.md:87-92` claims worktree isolation as a security mitigation for the Codex `danger-full-access` adapter, but `codex.sh:21` declares `"supports_isolation": false` and `workflows/build.md:202` confirms non-Claude adapters bypass the Task tool entirely. The documented mitigation does not exist.

---

## 2. Model & routing staleness

| Location | Current content | Problem |
|---|---|---|
| `.claude/settings.json:29` | `CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-4-6"` | Superseded ID. Current: `claude-sonnet-5` (or `claude-haiku-4-5-20251001` for cheap tier). |
| `.claude/commands/tools/set-models.md:30-37`, `init.md:249-260` | Tier tables: Max = `claude-opus-4-6`, Pro = `claude-sonnet-4-6` | Both IDs superseded (`claude-opus-4-8`, `claude-sonnet-5`); no mention of the Fable/Mythos tier. |
| `.claude/rules/escalation.md:8-14` | Ladder "Haiku → Sonnet → Opus", "default to Haiku" | Loaded into every session; ignores the current lineup (Haiku 4.5 → Sonnet 5 → Opus 4.8 → Fable 5). |
| `CLAUDE.md:42-43`, `CLAUDE.template.md:39-40`, `README.md:156-162`, `project-os-guide.md:92-94`, `docs/knowledge/design-principles.md:79-84`, `architecture.md:60` | "Sub-agent implementation: Haiku" | Contradicts live settings (sonnet-4-6). `PROJECT_STATUS.md:42` admits the contradiction; never propagated. |
| `set-models.md:47`, `init.md:345` | Writes `CLAUDE_ORCHESTRATION_MODEL` to `.claude/models.env` | **Not a real Claude Code env var** — inert. Orchestration model belongs in `settings.json` `"model"`. |
| `.claude/agents/adapters/INTERFACE.md:33,54,67`, `claude-code.sh:20,127`, `workflows/build.md:113,170,190` | `model_default: haiku`, `ADAPTER_MODEL=haiku` fallbacks | Pre-5 cost assumption hard-coded across the adapter contract. |
| `codex.sh:20,255` | `model_default: o4-mini` | Outdated OpenAI model ID. |
| `gemini.sh:15` | `gemini-2.5-pro` | Likely outdated (stub, low priority). |
| `design-principles.md:113`, `CLAUDE.md:19`, `README.md` | "Output costs 5x input" / "Haiku 4x cheaper than Sonnet" | Pricing ratios shifted across the Claude 5 family; reframe as rule-of-thumb or drop. |

**Also verify:** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (`settings.json:30`) no longer appears in current settings docs — confirm with `/doctor` or remove. The `.claude/models.env` + "source in `~/.bashrc`" mechanism (`set-models.md:44-57`, `init.md:340-351`) doesn't work on Claude Code on the web and should move into `settings.json`.

**New settings worth adopting:** `effortLevel`, `fallbackModel` (up to 3 fallbacks), auto-memory settings.

---

## 3. Hand-rolled systems now natively provided

| Hand-rolled system | Native replacement | Notes |
|---|---|---|
| Agent adapter layer (`.claude/agents/adapters/`, `build.md:106-202`) | Agent tool with per-call `model:` + `isolation: "worktree"` | `claude-code.sh:129-165` is a **no-op**: it writes `prompt.md`, records `result=pass`, and never invokes Claude. The default path already dispatches via the Task tool, making the indirection vestigial. `aider`/`amp`/`gemini` are dead "v2.1+" stubs. |
| Worktree recovery pattern (`patterns.md:34-45`), `preserve-sessions.sh`, manual cleanup (`ship.md:81`, `build.md:253`) | Native worktree isolation with auto-cleanup; `EnterWorktree` | The "worktree agents don't persist changes" bug this works around is fixed; the copy-out dance is obsolete. |
| Manual wave scheduling (`build.md:90-104`) + `scripts/unblocked-tasks.sh` + `max_concurrent_agents` queueing | Native Tasks dependencies (`addBlockedBy`) + background subagents; Workflow orchestration for deterministic fan-out | Dual bookkeeping (native Tasks **and** ROADMAP markers with a reconciliation protocol, `build.md:60-88`) accepts drift by design. Keep ROADMAP as the governance record, but let native Tasks own execution state. |
| Session handoff YAML (`/tools:handoff`, `/tools:catchup`, `.claude/sessions/`, `session-management` skill) | Native context compaction, session resume, auto-saved transcripts, auto-memory | Reframe as a supplement (the governance narrative), not a replacement for conversation continuity. |
| Context-filter + FTS5 knowledge index (`context-filter.sh`, `knowledge-index.ts`, `output-index.sh`) | Native context management + memory | Still has value for cross-session search, but the "route large outputs through filtering" premise predates current context handling. |
| Manual research fan-out (3 overlapping specs: `workflows/idea.md:24-34`, `tools/research.md:12-24`, `agents/researcher.md`) | Agent tool parallel spawning | Three near-duplicate implementations that can drift; consolidate to one. |
| Phase-change notification hooks called by hand throughout workflows | Task notifications, `SendMessage`, new hook events (`TaskCreated`, `TaskCompleted`, `SubagentStop`) | |
| Agent-rules sha256 caching (`build.md:36-58`, `sync-agent-rules.sh`) | Skills with frontmatter + native context injection | Elaborate machinery to inject rules into sub-agents. |

**Skills format:** all four `.claude/skills/*/SKILL.md` files lack YAML frontmatter (`name:`/`description:`) — the modern SKILL.md format expects it. Commands (`.claude/commands/*.md`) still work but skills are the recommended format going forward; the current split duplicates content (`session-management` ↔ `tools:handoff`/`catchup`; `spec-driven-dev` ↔ `workflows:*`).

**Not yet adopted (opportunities):** SessionStart hooks (useful for Claude Code on the web), `PostCompact`/`SubagentStart`/`TaskCreated` hook events, plugins/marketplace packaging (Project OS itself is a natural plugin), background agents (`claude --bg`), `/rewind`, fallback models.

---

## 4. Hooks & scripts — bugs and degradation

Beyond §1.1 (all shell scripts pass `bash -n`; `node` v22.22, `jq`, `bun` present; `sqlite3` CLI and `gh` absent):

- **Silent no-op hook advisories** — `output-index.sh:130,134` and `compact-suggest.sh:44-47` print advisories to stderr with exit 0, assuming stderr enters Claude's context. It doesn't (transcript-only). Emit `hookSpecificOutput.additionalContext` JSON on stdout instead (as `pre-compact.sh:175` already does correctly).
- **`MultiEdit` removed** — `settings.json:82,91` matchers `"Write|Edit|MultiEdit"` reference a tool that no longer exists. Harmless but dead; use `"Write|Edit"`.
- **Threshold contradiction** — `compact-suggest.sh:2-3` assumes autocompact at 50%; `settings.json:30` sets 75. The 20/35 tool-call warning thresholds were tuned to the wrong number.
- **Manifest/sync drift cluster**:
  - `.claude/manifest.json` (generated 2026-03-14) is missing `pre-compact.sh`, `security/allowlist.json`, and `scripts/lib/scan-rules.js` — the update system won't manage them.
  - `generate-manifest.sh:48-64` omits `sync-hooks.sh` while `update-project.sh:279` includes it → perpetual CONFLICT on every update run.
  - `observation-parser.ts` and `security-scanner.ts` are in **no** manifest/sync/copy list (`new-project.sh:77-79` copies only two of four .ts files) → bootstrapped projects get hooks referencing scripts they never receive; degrades silently.
- **TS runner fragility** — four `.ts` scripts run via bare `node file.ts` (needs Node ≥22.18 for default type-stripping + `node:sqlite`), with no `package.json`, engines pin, version guard, or fallback. Header comments say "Node 22.16+", which is itself wrong. On older Node, hooks silently no-op and `install-hooks.sh` hard-fails.
- **No test runner defined** — `tests/knowledge-index.test.ts` uses `node:test` but nothing wires it up (no `package.json`, no CI); it can rot undetected.
- **Unbounded log growth** — per-session `.tool-count-*` files never cleaned; `activity.jsonl`, `tool-failures.log`, `format-errors.log` append forever with no rotation. A SessionEnd hook (now available) is the natural cleanup point.
- **flock-absent race** — `compact-suggest.sh`, `log-activity.sh`, `tool-failure-log.sh` fall back to unlocked writes when `flock` is missing (default on macOS).
- **Dead code** — `.claude/archive-sessions.sh` is wired to nothing and hard-codes a `handoff-2026-02-*` date window; one-shot code that should be deleted or generalized.
- **`mcp-allowlist.json:12`** — `audit_date: 2026-02-19` with monthly cadence is ~5 months overdue; `integrity_hash` empty; `blocked_capabilities` declarative-only (unenforced).
- **`scrub-secrets.sh` fallback patterns** (lines 42-76) predate newer token formats — only bites on the degraded (no-Node) path, which is exactly when it matters.

**Clean:** no dangling references to the extracted web-fetch MCP server were found in hooks/settings — the `WebFetch` matchers refer to the built-in tool. The `docs/knowledge/metrics.md:24-42` web-fetch metrics block is the one leftover: it documents code that no longer lives here, and no pointer to the extracted repo exists anywhere (decisions.md:49-62 says "extracted to standalone repo" with no URL).

---

## 5. Docs, status, and template drift

- **Version incoherence:** CHANGELOG stops at v2.0 (2026-02-23); guide says v2.1; decisions.md says v2.1; PROJECT_STATUS says v2.2. CHANGELOG is missing three releases' worth of entries (strategic repositioning, security scanner, adaptive-memory, web-fetch).
- **PROJECT_STATUS.md** — "Last Updated: 2026-04-05" predates the repo's own newest feature (web-fetch extraction). T9 (adaptive-memory tests+docs) has been "first priority next session" since March; `tests/observation-parser.test.ts` promised by the design doc does not exist. ROADMAP.md:37 still shows T9 `[-]` In Progress.
- **ROADMAP.md** — `## Completed` section is empty despite multiple shipped features (the ship workflow's "move to Completed" step isn't happening). The agent-teams spike `#T1` (line 65: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) targets an experiment flag for what is now a shipped native feature — rescope or close.
- **Knowledge-vault freshness metadata lies both ways:** `architecture.md`, `patterns.md`, `decisions.md`, `bugs.md` all carry frontmatter `date: "2026-03-03"` while their bodies contain April edits. Per the repo's own 90-day staleness rule they'd self-flag `[STALE]` despite newer content — the freshness system distrusts its own inputs.
- **architecture.md module map** is a stale subset: lists 3 of 11 hooks and ~5 of ~20 scripts.
- **CHANGELOG component counts** (8 workflow commands / 8 tools / 8 hooks / 49 components) — actual: 10 / 11 / 11.
- **Adapter status contradiction:** INTERFACE.md says Codex adapter is "fully functional"; guide (283-286, 656-661) and CHANGELOG still say "stub (v2.1+), only claude-code functional."
- **"Zero external dependencies" claim** (README:3,7,15) vs Node 22 requirement, Bun dashboard, Context7 MCP, codex CLI — reframe as "no runtime services."
- **Placeholder rot in live files:** `CLAUDE.md:8` `Owner: [YOUR_NAME]` unfilled in the live constitution; `.claude/rules/preferences.md:11-13` `[preferred language]`/`[prettier/...]`/`[jest/...]` unfilled and loaded every session; `docs/product.md`, `docs/tech.md`, `docs/knowledge/kv.md` are empty stubs. (Template files' placeholders are correct and should stay.)
- **`init.md:319`** references "Step 2" for the placeholder scan; it's Step 3.
- **`/tmp` policy contradiction:** `build.md:47-48`, `context-filter` skill, and `init.md:492-498` all use `/tmp` while the code-review rule init generates forbids it.

### `.claude/rules/bash.md` deserves a special call-out
218 lines, loaded into **every session** and explicitly copied into every sub-agent prompt. It is (a) entirely Windows/spaces-in-paths/PowerShell-specific while this repo runs on Linux, and (b) built on reverse-engineered security-scanner error strings from a specific past build ("bare repository attack", "unhandled node type: string"). If the scanner has since been tuned, the file mis-trains every agent into avoiding ordinary safe shell (no pipes, no `&&`, write-every-one-liner-to-a-file) — a large behavioral tax on possibly false premises. It also contradicts `settings.json`, which pre-allows `grep`/`find`/`git` wildcards. Recommendation: verify current scanner behavior, then either gut it or gate it behind a Windows-only toggle (init.md already has `FEATURE_*` toggles).

---

## 6. Prioritized action plan

**P0 — correctness & security (small diffs, high value)**
1. Fix MCP validation: exit codes (1→2 or JSON `additionalContext`), dead `set -e` branch, absolute allowlist path, no in-place mutation.
2. Rework permissions: scope the Bash allow-list to specific subcommands; stop relying on the single-string deny.
3. Resolve the Codex adapter isolation contradiction (document that `danger-full-access` runs unisolated, or actually isolate it).

**P1 — model routing sweep (one pass, many files)**
4. `settings.json`: subagent model → current ID; verify/remove `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`; add `effortLevel`/`fallbackModel`; update `Write|Edit|MultiEdit` matchers.
5. Update tier tables (`set-models.md`, `init.md`), escalation ladder, CLAUDE.md/README/guide/design-principles routing sections to the Claude 5 lineup; delete the inert `CLAUDE_ORCHESTRATION_MODEL` and the `.claude/models.env` shell-sourcing mechanism.
6. Fix the Haiku-vs-Sonnet sub-agent contradiction everywhere (PROJECT_STATUS.md:42 already flags it).

**P2 — modernize orchestration**
7. Collapse the adapter layer for the default path: dispatch sub-agents natively (per-agent `model:`, `isolation: "worktree"`); delete the no-op `claude-code.sh` and dead stubs; keep `codex.sh` only if competitive review still uses it.
8. Drop worktree-recovery/preserve-sessions workarounds; adopt native worktree lifecycle.
9. Converge task execution state on native Tasks (ROADMAP stays the governance/approval record); retire manual wave computation.
10. Add frontmatter to the four SKILL.md files; migrate high-traffic commands to skills; deduplicate skills↔commands content.

**P3 — hygiene**
11. Regenerate manifest.json; unify `generate-manifest.sh`/`update-project.sh`/`new-project.sh` file lists (add the missing `.ts` engines).
12. Add a `package.json` with engines pin + test script (or standardize on `bun`); add Node-version guard in hooks.
13. Log rotation + SessionEnd cleanup hook for `.claude/logs/`.
14. Reconcile CHANGELOG/PROJECT_STATUS/ROADMAP versions; close or rescope T9 and the agent-teams spike; move shipped features to Completed.
15. Fill live-file placeholders (CLAUDE.md owner, preferences.md, product.md/tech.md) or delete the stubs.
16. Gate or gut `.claude/rules/bash.md` after verifying current scanner behavior; fix vault frontmatter dates; add the extracted web-fetch repo URL to decisions.md and archive its metrics block.

---

*Generated by a 4-way parallel audit on 2026-07-11. Platform facts verified against code.claude.com docs and the Claude models overview; items marked "verify" are version-dependent and should be confirmed with `/doctor` on the user's installed Claude Code build.*
