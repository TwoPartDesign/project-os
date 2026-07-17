---
type: knowledge
tags: [decisions, adr]
description: Architecture decision records — what was decided, why, and what was rejected
links: "[[architecture]], [[patterns]]"
date: "2026-07-12"
---

# Architectural Decision Records

## Format
Each entry: Date, Decision, Context, Alternatives Considered, Rationale

---

<!-- Entries get appended here by workflows and handoff commands -->

## 2026-02-24 — Strategic Repositioning: "Governance Layer" Framing

**Decision**: Reframe Project OS identity from "spec-driven scaffold" to "solo-developer governance layer for AI-driven development" across README, CLAUDE.md, design-principles.md, architecture.md, and project-os-guide.md.

**Context**: The "spec-driven" framing undersold the system's actual value. Project OS enforces phase checkpoints, adversarial quality gates, and human approval at every transition — that's governance, not just scaffolding. The "Bleeding-Edge" branding in project-os-guide.md was informal and undermined credibility. Version bumped to 2.1 to reflect the dashboard and governance narrative.

**Alternatives Considered**:
- Keep current framing, add a "governance" section — rejected: additive bloat, doesn't fix the headline problem
- Full rename/rebrand — rejected: too disruptive, risks breaking @import references and external links

**Rationale**: Additive reframing: preserve all existing content and structure, replace only the positioning language. The five target files receive surgical edits; no file paths, skill identifiers, or structural elements change. The `spec-driven-dev` skill identifier is deliberately preserved (changing identifiers is a breaking change).

**Implementation note**: T15 triggered a fallback path — `grep "Type: Personal"` found 9 matches across scripts/docs (not just CLAUDE.md), so `Identity:` was added as a new field rather than replacing `Type:`. Post-review, `Identity:` was renamed to `Role:` to eliminate a nested naming collision with the `## Identity` section heading.

---

## 2026-04-04 — Zero-Dep Security Scanner Over Gitleaks Binary

**Decision**: Implement secret detection as a zero-dep Node.js module (`scripts/security-scanner.ts` + `scripts/lib/scan-rules.js`) rather than shelling out to a gitleaks binary.

**Context**: Project OS needed pre-commit secret scanning to enforce the "never hardcode secrets" rule automatically. Gitleaks is the gold standard for secret detection rules, but distributing a Go binary violates the zero-external-dependency principle.

**Alternatives Considered**:
- **Gitleaks binary** — rejected: requires separate binary install/distribution, breaks zero-dep
- **Gitleaks via npm wrapper** — rejected: adds npm dependency, wrapper packages are often stale
- **Inline bash grep patterns** — rejected: no test-case framework, unmaintainable at 200+ rules, no entropy detection

**Rationale**: Porting gitleaks rules to a JS module (documented via upstream commit hash `gitleaks@256f6479` in the file header) keeps everything in-tree, testable via `test-rules` subcommand, and zero-dep. Trade-off: 24 gitleaks PCRE patterns couldn't convert to JS RegExp (scanner handles gracefully as SKIP), and 222 upstream rules lack inline test cases (accepted tech debt — rules are battle-tested upstream). The 14 custom PII/privacy rules all have test cases.

---

## 2026-04-06 — Hand-Rolled MCP Server Over SDK for Web Fetch

**Decision**: Build the web-fetch MCP server with a hand-rolled JSON-RPC 2.0 stdio transport (~150 lines) instead of using `@modelcontextprotocol/sdk`.

**Context**: Project OS needed a web content preprocessor that replaces raw HTML with extracted Markdown *before* it hits the context window. PostToolUse hooks are advisory-only (can't modify output), so an MCP server was the only integration point. The MCP SDK pulls in zod and multiple transports (~2MB), breaking the zero-dep principle.

**Alternatives Considered**:
- **`@modelcontextprotocol/sdk` + zod** — rejected: ~2MB runtime dep, breaks zero-dep
- **PostToolUse hook on native WebFetch** — rejected: hooks are advisory-only, raw HTML still consumes tokens
- **Vendored Readability + Turndown + linkedom** — rejected: 285KB of external code, vendoring is deps by another name

**Rationale**: MCP stdio protocol is simple (newline-delimited JSON-RPC 2.0). Custom extractor validated by spike T18 at 95% avg token reduction (target was 80%). Zero npm deps maintained. Trade-off: DNS rebinding not mitigated at application layer (Node's fetch() doesn't accept pre-resolved IPs) — documented as known v1 limitation.

**Update (2026-04-08)**: Extracted to standalone repo `web-fetch-mcp/` — the MCP server has no dependency on Project OS internals, and bundling it coupled two unrelated concerns. The extraction landed in commit `d2f7cec`. (Standalone repo link: TODO — to be added by the owner; not recorded anywhere in-tree.)

---

## 2026-07-12 — Staleness-Audit Remediation: Native Primitives, Claude 5 Routing, Restrictive Permissions

**Decision**: Remediate the 2026-07-11 staleness audit (`docs/audits/2026-07-11-staleness-audit.md`) in one branch (T17–T32) with four policy decisions:

1. **Native-primitives migration** — `/workflows:build` and `/workflows:ship` run on native worktree isolation and native Task scheduling (`addBlockedBy` dependencies) instead of hand-rolled wave computation, `unblocked-tasks.sh`, and the worktree copy-out recovery dance. The adapter layer collapses: the no-op `claude-code.sh` and dead `aider`/`amp`/`gemini` stubs are deleted; `codex.sh` remains as the only external adapter (documented as running without worktree isolation); default dispatch is the native Task tool. ROADMAP.md stays the governance/approval record; native Tasks own execution state.
2. **Model routing policy** — orchestration and design on the primary session model (`settings.json` `"model"`, currently Opus 4.8; Fable 5 for the hardest design work); sub-agent implementation defaults to `claude-sonnet-5` (`CLAUDE_CODE_SUBAGENT_MODEL`); `claude-haiku-4-5-20251001` for cheap, tightly-scoped mechanical tasks via `(model:)` annotations. Escalation ladder: Haiku 4.5 → Sonnet 5 → Opus 4.8 → Fable 5. The inert `CLAUDE_ORCHESTRATION_MODEL`/`models.env` mechanism is removed.
3. **Permissions: restrictive-allow posture** — blanket `Bash(git *)`/`Bash(npm *)`-style grants (each an arbitrary-code-execution vector) replaced with allows scoped to specific subcommands; stop relying on a single-string deny-list as a safety net.
4. **bash.md slimmed; auto-approval as proposal** — the Windows security-scanner workaround catalog moves out of the always-loaded `.claude/rules/bash.md` into `docs/knowledge/windows-bash-scanner.md`; a PreToolUse auto-approval hook is written up as `docs/proposals/pre-tool-approve-hook.md` and deliberately NOT installed — hooks that auto-approve tool calls require explicit owner opt-in.

**Context**: The repo sat idle ~3 months (last commit 2026-04-14) while the platform shipped the Claude 5 family, native worktrees, Task scheduling, and background subagents. The audit found frozen model routing, non-functional MCP validation, security-theater permissions, and hand-rolled systems duplicating native features.

**Alternatives Considered**:
- **Keep the adapter layer with updated model IDs** — rejected: `claude-code.sh` was a verified no-op; the indirection had no remaining function on the default path
- **Delete `codex.sh` too** — rejected: competitive review still uses external Codex dispatch
- **Install the auto-approval hook directly** — rejected: silently auto-approving tool calls is a security posture change the owner must make explicitly
- **Keep manual wave scheduling as a fallback** — rejected in favor of ROADMAP-marker fallback already documented in the ROADMAP↔Tasks dual-track pattern

**Rationale**: Every hand-rolled system replaced here now has a strictly better native equivalent, and each deletion shrinks the always-loaded context (a core principle: context is noise). Governance value — gates, markers, adversarial review — is preserved untouched; only the execution plumbing changed.

---

## 2026-07-16 — Dashboard Kanban: Shared Render Lib + Linear-Parse Mandate

**Decision**: Ship the Kanban Board tab as a server-rendered fragment (`/api/kanban`) reusing the dashboard's existing htmx/SSE panel idiom, with three durable policies:

1. **Single ROADMAP parser for the dashboard** — `parseRoadmap`/`esc`/marker maps/`renderKanban` live in `scripts/lib/dashboard-render.ts`; `dashboard-server.ts` imports them. No fourth regex implementation (dashboard.sh and validate-roadmap.sh remain independent bash counters/validators by design).
2. **Linear-parse mandate** — no unbounded-backtracking regex may scan a full ROADMAP line or title. Three quadratic shapes were found and fixed during this feature's review cycles (repeatable-annotation group, internal-whitespace flood, nested `(depends:` flood — the latter two pre-existing). Parsing is index-based (`lastIndexOf` + anchored validation on small bounded slices); four regression tests pin the attack shapes.
3. **Marker completeness** — the board renders all seven canonical markers; `[>]` Racing and unknown-marker "Other" columns render only when non-empty (never silently dropped, never wasting width). `(model:)`/`(agent:)` annotations are now tolerated by the parser and documented in roadmap-format.md (the `(model:)` annotation was previously undocumented).

**Context**: Deferred backlog wish (#T37) executed via the first end-to-end `/workflows:mvp` run (#T38), which exercised auto-rebuild on review failure and the 2-attempt hard stop (third round user-authorized).

**Alternatives Considered**:
- **CDN Kanban library (jkanban)** — rejected: stale since 2020, drag-and-drop dead weight for a read-only board, fights the server-rendered-fragment idiom
- **Per-column htmx endpoints** — rejected: ROADMAP invalidates atomically; 6x requests for no gain
- **Escaping in renderers** — rejected: parse-time `esc()` already established; double-escaping forbidden and pinned by test

**Rationale**: A drop-in fourth instance of the established panel pattern costs zero new dependencies. The review cycles turned a UI feature into a hardening pass on the parser every panel shares — worth more than the board itself.
