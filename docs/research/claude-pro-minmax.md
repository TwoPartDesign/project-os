# Research: claude-pro-minmax
**Date**: 2026-02-20
**Confidence**: High
**Source**: https://github.com/move-hoon/claude-pro-minmax

---

## Summary

`claude-pro-minmax` (CPMM) is a CLI scaffold optimized around a single constraint: **Claude Pro plan quota efficiency**. Its core thesis is "minimize waste, maximize validated work" — every design choice flows from that. It is NOT a workflow methodology tool; it's an operational discipline layer.

Project OS and CPMM have different primary concerns. Project OS is a **spec-driven development methodology** (how to build the right thing, correctly). CPMM is a **token economics system** (how to do it cheaply). They complement more than they overlap — but the overlap that does exist (agents, session management, hooks) is worth reviewing for gaps.

The repo has genuine tactical value in: its hooks automation system, output cost philosophy, failure analysis patterns, and secret scrubbing. The rest is either duplicated or irrelevant.

---

## Detailed Findings

### What CPMM Does

**Model Routing (overlaps with Project OS)**
- Haiku → Sonnet → Opus escalation ladder
- Escalation is manual: `/do` fails twice → user decides to `/do-sonnet`
- 2-retry hard cap enforced as a principle in CLAUDE.md ("Pass@1 + 2-Retry Cap")
- Downshift after resolving blockers (don't stay on expensive models)

**Command Set (14 commands)**
- `/do` — batch plan+build+verify in one shot for simple tasks (1-3 files)
- `/plan` — @planner → @builder chain for medium tasks (4-5 files)
- `/dplan` — deep planning with Perplexity/context7 for complex research
- `/do-sonnet`, `/do-opus` — explicit model escalation
- `/review` — post-implementation quality check
- `/watch` — file-watching mode
- `/session-save`, `/session-load` — overlaps with our `/tools:handoff` and `/tools:catchup`
- `/compact-phase` — compress current context by phase
- `/load-context` — explicit context loading (backend/frontend templates)
- `/learn` — save learned patterns to `~/.claude/skills/learned/`
- `/analyze-failures` — post-failure structured analysis
- `/llms-txt` — generate llms.txt for library docs

**Hooks System (11 hooks — Project OS has 1)**
- `tool-failure-log.sh` — silently logs every tool failure to `~/.claude/logs/tool-failures.log`
- `retry-check.sh` — detects repeated failures, enforces 2-retry cap
- `compact-suggest.sh` — fires advisory at 25, 50, 75 tool invocations; auto-compact at 75% context usage
- `pre-compact.sh` — saves state before compaction
- `post-edit-format.sh` — auto-formatter after file edits (we have this)
- `readonly-check.sh` — blocks writes to protected files
- `critical-action-check.sh` — intercepts destructive commands
- `session-start.sh` / `session-cleanup.sh` — session lifecycle automation
- `stop-collect-context.sh` — captures context snapshot on Stop signal
- `notification.sh` — desktop notification on task completion

**Scripts/Abstractions**
- `verify.sh` — single entry point for all verification (never call `npm test`/`cargo test` directly)
- `runtime/detect.sh` — detects project runtime from filesystem signals, no manual build-file reading
- `scrub-secrets.js` — 15+ pattern secret detection, scrubs before session saves
- `snapshot.sh` — git-based atomic snapshot before risky operations

**Output Cost Philosophy**
- "Output costs 5x Input — keep agent responses short"
- `CLI --json | jq` preferred over MCP tools (filtered output reduces tokens)
- `mgrep` over `grep` (~50% output reduction claim)
- Response budget controls in agent definitions
- Learned patterns indexed at session start to prevent rework

**CLAUDE.md Kernel**
- Very compact (single file, ~1KB)
- Explicit table for verification thresholds by change type
- Explicit agent routing table with model and question limits

---

## Overlap With Project OS

| Feature | Project OS | CPMM | Notes |
|---|---|---|---|
| Model routing | ✅ settings.json | ✅ CLAUDE.md kernel | Equivalent |
| Agent personas | ✅ 6 agents | ✅ 4 agents (planner, dplanner, builder, reviewer) | Equivalent |
| Session save/load | ✅ /tools:handoff, /tools:catchup | ✅ /session-save, /session-load | Equivalent |
| Post-edit formatting | ✅ hooks/post-tool-use.sh | ✅ post-edit-format.sh | Equivalent |
| Research command | ✅ /tools:research | ✅ /dplan via @dplanner | Equivalent |
| Workflow phases | ✅ 6-phase SDD | ❌ flat /do, /plan, /dplan | Project OS is richer |
| PM commands | ✅ /pm:prd, /pm:epic, /pm:status | ❌ none | Project OS only |
| Adversarial review | ✅ 3 reviewers | ✅ 1 @reviewer | Project OS is richer |
| Knowledge vault | ✅ .claude/knowledge/ | ❌ skills/learned/ only | Project OS is richer |
| Obsidian integration | ✅ | ❌ | Project OS only |
| **Hooks automation** | ⚠️ 1 hook | ✅ 11 hooks | **CPMM is richer** |
| **Failure analysis** | ❌ | ✅ /analyze-failures + tool-failure-log | **CPMM only** |
| **Retry cap enforcement** | ❌ | ✅ retry-check.sh | **CPMM only** |
| **Context compaction** | ❌ | ✅ /compact-phase + compact-suggest | **CPMM only** |
| **Secret scrubbing** | ❌ | ✅ scrub-secrets.js | **CPMM only** |
| **verify.sh pattern** | ❌ | ✅ | **CPMM only** |
| **Output cost discipline** | ❌ | ✅ explicit in CLAUDE.md | **CPMM only** |
| **Learned skills indexing** | ❌ | ✅ /learn + session-start index | **CPMM only** |

---

## Open Questions

1. Are the CPMM hooks designed for global (`~/.claude/hooks/`) or per-project installation? If global, they'd conflict with any project-level hooks.
2. Does the `scrub-secrets.js` run as a pre-commit hook or a pre-session-save hook? Need to check install.sh for wiring.
3. The `compact-suggest.sh` at 25/50/75 tool invocations — is this noise in practice or genuinely useful signal?
4. `/learn` saves patterns to `~/.claude/skills/learned/` — how does this interact with our `.claude/knowledge/` vault pattern?

---

## Recommendation

**Selectively adopt 4-5 ideas. Don't wholesale import.**

### High Value — Adopt

1. **Output cost principle in CLAUDE.md** — Add a line to the project constitution: "Output costs 5x input. Keep agent responses short. Prefer `CLI --json | jq` over full MCP output." This is free to adopt and changes agent behavior immediately.

2. **2-retry cap + escalation protocol** — Add to CLAUDE.md or a new `.claude/rules/escalation.md`: after 2 failures, stop and escalate rather than retrying indefinitely. Also add the downshift principle.

3. **Secret scrubbing on session saves** — Port or reference `scrub-secrets.js` logic into our session handoff hook. We currently have no secret detection before saving `.claude/sessions/` YAML files.

4. **Tool failure logging hook** — Add a hook that logs tool failures to `.claude/logs/tool-failures.log`. Cheap to implement, enables the `/analyze-failures` pattern.

5. **compact-suggest logic** — Add a hook that warns at 75% context usage. Context blowout is a real pain point in long sessions.

### Medium Value — Consider

6. **`/analyze-failures` command** — Useful for post-session learning. Could integrate with our `/tools:handoff` to include a failure summary.

7. **Learned skills indexing at session start** — Modify `/tools:catchup` to also index `.claude/knowledge/` at session start to surface relevant patterns. We do this somewhat but not explicitly.

8. **verify.sh pattern** — Relevant when Project OS is used for actual code projects. Add a note in `/tools:init` to scaffold this for multi-language projects.

### Low Value — Skip

- `mgrep` — external dependency, marginal benefit
- Perplexity API integration — requires paid API key, we use WebSearch
- `runtime/detect.sh` — only useful for multi-language repos
- Korean documentation — not relevant
- `project-templates/` — we have our own template system
- `/watch` mode — situational
- `llms-txt` — niche use case
