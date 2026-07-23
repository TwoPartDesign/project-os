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

## 2026-07-17 — In-Place Adoption: Two-Class Collision Policy + Quarantine

**Decision**: `scripts/new-project.sh --adopt <target-dir>` extends the existing bootstrap scaffold (not a parallel script) to adopt Project OS into a pre-existing repo, governed by four rules:

1. **Two-class collision policy.** Every template path is either **framework-authority** (`.claude/**`, `scripts/**` — these carry execution/prompt authority: settings.json auto-runs hooks, scripts/hooks are executed, commands/skills/rules steer the LLM) or **content** (`CLAUDE.md`, `ROADMAP.md`, `docs/knowledge/*.md`, `.gitignore` — never executed). On collision, framework-authority paths are **ours-wins**: Project OS's file takes the canonical path, the pre-existing file is preserved byte-for-byte as `<file>.pre-adopt` and loudly flagged in the adopt report for manual merge. Content paths are **user-wins**: the user's file keeps the canonical path, ours lands as `<file>.upstream` (the same convention `update-project.sh` already uses). No class ever destroys bytes — everything survives at its canonical path, a suffixed copy, or (for non-colliding orphans under `.claude/**`) a mirrored `.claude.pre-adopt/` quarantine tree.
2. **`.gitignore` marker-block merge.** Template entries are appended as a marker-delimited block (`# >>> project-os >>>` / `# <<< project-os <<<`), deduped against existing lines (comparison normalizes trailing `\r`, appended block matches the file's dominant line ending); if the marker block already exists, its content is rewritten in place rather than re-appended. Idempotent across repeated adopt runs.
3. **Manifest `.upstream`-hashing rule.** `generate-manifest.sh`'s `hash_file` hashes `<path>.upstream` instead of `<path>` when present, so the manifest always records Project OS's content rather than whichever file occupies the canonical path. Without this, a content-path conflict would hash the user's file, and the next `update-project.sh` run would see `local==manifest` and classify it `SAFE_UPDATE` — silently overwriting the user's file (`update-project.sh:442-444`). Framework-authority paths need no such rule since ours already occupies the canonical path.
4. **Git-hook quarantine (`--no-chain`) instead of default chaining.** The scanner's hook installer normally renames a pre-existing hook to `<hook>.local` and has the installed hook auto-chain to it. In adopt mode, `install-hooks.sh`/`security-scanner.ts` run with `--no-chain`: existing unmarked hooks are renamed `<hook>.pre-adopt` and never invoked, and listed in the adopt report. Default (non-adopt) bootstrap keeps chaining.

**Accepted residual risk**: pre-existing non-template scripts under `scripts/**` are left in place (moving them risks breaking a repo's own build) but are enumerated in the adopt report's UNREVIEWED-EXECUTABLE section — the template's `settings.json` pre-approves `bash scripts/*` / `node scripts/*`, so a hostile doc could in principle steer a later session into running one without a fresh permission prompt. Accepted for v1 with loud reporting; recommended follow-up (narrow the blanket `scripts/*` allows to enumerated template script names) is to be filed as a `[?]` draft at ship time, not bundled into this feature. Follow-up shipped as #T76: `.claude/settings.json`'s `bash scripts/*` / `node scripts/*` / `bash .claude/hooks/*` blanket allows were replaced with one enumerated entry per template-owned script and wired hook — any new template script or hook added to `TEMPLATE_SCRIPTS` (`scripts/generate-manifest.sh`) / `FRAMEWORK_FILES(_OPTIONAL)` (`scripts/new-project.sh`) / the `hooks` block must add a matching `permissions.allow` line in the same change or it will hit a permission prompt instead of running silently.

**Context**: The threat model is a hostile repo crafted to look adoptable — it could pre-plant a `.claude/settings.json` whose hooks auto-execute next session, a `scripts/setup.sh` that the adopt sequence itself would then run, or git hooks that fire on the adopt commit. This design decision went through 3 adversarial review rounds (REJECT → REJECT → APPROVE-WITH-REVISIONS) before landing.

**Alternatives Considered**:
- **Preserve-everything-in-place** (rev 1: user's file always wins the canonical path, even for framework-authority paths) — **rejected by adversarial round 1** (2 CRITICALs): this left a hostile pre-existing `.claude/settings.json` and git hooks live and executable, and the adopt sequence would itself invoke the target repo's own `setup.sh`/`generate-manifest.sh` on collision.
- **Hard-fail on any framework-path collision** — rejected: terrible first-run UX for plain-Claude-Code repos that legitimately already have a `.claude/settings.json` or command files; demote-and-report preserves content while keeping adoption one-shot.
- **Separate `adopt-project.sh` script** — rejected: duplicates the template copy list, adding a fourth sync list alongside `generate-manifest.sh`/`new-project.sh`/`update-project.sh` (documented drift risk).
- **Reuse `update-project.sh`'s 3-way merge engine** — rejected: no manifest exists at adopt time, so the engine degenerates to "exists = conflict" for zero gain over a purpose-built policy.

**Rationale**: Safety belongs in the writer (`copy_safe()` inside `new-project.sh`), not the calling skill — the collision policy is enforced regardless of what `/tools:new-project`'s UX layer checked (Sole-Writer Self-Enforcement, per the 2026-07-16 self-maintenance ADR). The two-class split maps directly onto "what can execute or steer the LLM" vs. "what cannot," which is the actual security boundary, not an arbitrary directory list. The `.upstream`/`.pre-adopt` suffix conventions reuse `update-project.sh`'s existing vocabulary rather than inventing new ones. This aligns with the 2026-07-12 restrictive-permissions ADR: no execution authority is granted without explicit owner opt-in.

## 2026-07-17 — System-map bloat inputs are intentionally not hashed

**Decision**: `scripts/system-map.ts` reads CLAUDE.md + `docs/knowledge/*.md` for its bloat check but does NOT include them in the hashed input set (`.maps.lock`). Editing those docs therefore does not register as map drift.

**Context**: The map's freshness guarantee is enforced only at pre-commit (regenerate-and-heal). If prose docs were hashed inputs, every `decisions.md`/`patterns.md`/`architecture.md` edit — i.e. most doc commits — would trigger a pre-commit map heal.

**Alternatives**: (a) Hash the bloat inputs → always-accurate bloat freshness, but constant heal churn on doc edits for a LOW-severity advisory. (b) Exclude them, recompute bloat live on every `report`/`check` → no churn; a bloat finding is only re-surfaced when the map regenerates for another reason or when `report` is run on demand (the maintenance loop runs it every pass).

**Rationale**: Chose (b). Bloat is an advisory nudge, not a gate; the maintenance loop and on-demand `report` both recompute it live, so it never goes truly stale where it matters. Avoiding heal churn on ordinary doc edits is worth more than drift-detecting a soft threshold. Documented in `collectBloatFiles()`'s docstring so it reads as a choice, not an oversight (#T59).

## 2026-07-16 — Self-Maintenance: Deterministic Maps + Draft-Only Autonomy

**Decision**: Add framework self-maintenance in four parts, all zero-dep and template-portable: (1) a deterministic **system map** (`system-map.ts` + `lib/system-map-lib.ts`) of the framework's own wiring — settings→hooks, command/skill→script refs, imports, manifest coverage — with graph findings (unwired hooks, orphans, dangling refs, manifest gaps, bloat); (2) **pre-commit auto-heal** — the generated hook regenerates maps from the git INDEX and re-stages them, healing drift rather than blocking (only generator/scan errors block); (3) a **dream pass** (`/tools:dream`) for non-destructive memory consolidation with volatility tiers, provenance, and human-gated contradictions; (4) a **draft-only maintenance loop** (`maintain.sh`) that runs deterministic checks and files `[?]` ROADMAP drafts — never mutating canonical state.

**Context**: The 2026-07-11 staleness audit found the framework rots its own wiring (manifest drift, doc contradictions). Two research passes (an uploaded report + a 149-digest corpus sweep) converged on: deterministic generation + freshness guarantee for maps, and human-gated (not auto-applying) autonomy for maintenance. Framework-first framing (Project OS is cloned into many projects) ruled out machine-specific coupling.

**Alternatives Considered**:
- **LLM-driven maintenance loop** — rejected: the checks are deterministic (hashes, counts, staleness queries); an LLM adds cost, nondeterminism, and the unattended-agent incident class the research documents. Judgment is routed to the human who reviews the drafts.
- **Drift = fail the commit** (the uploaded report's model) — rejected for deterministic artifacts: heal + stage instead; fail only on generator error.
- **PostToolUse map regen** — rejected: rebuild storms (the research's own cited warning); pre-commit + on-demand gives the freshness guarantee without the churn.
- **beads / second task store, embeddings, MCP memory servers, approve-token gating, Stop-hook handoff enforcement** — all rejected (see `docs/specs/self-maintenance/research.md`): ROADMAP `#TN` graph is the task-graph-as-memory; FTS5 + grep win at this scale; `/pm:approve` + `/tools:dream-accept` already gate mutations.

**Rationale**: The maps are trustworthy because they're generated from source; the loop is safe because its only write surface is `[?]` drafts + a ledger + dream staging, structurally bounded by a human-owned policy file it reads but never writes. Draft-only autonomy is a deliberate differentiator against the industry trend toward less human-in-the-loop (Anthropic RSI essay, GPT-5.6 self-training — both in the corpus). Embeddings stay deferred but now **measured**: search-miss instrumentation logs zero-result queries so the "defer until lexical recall fails" policy is an instrument, not a hope.

**Review note**: The 3-reviewer adversarial pass found 3 HIGH (raw-fingerprint injection in the loop's only ROADMAP writer; map check lacking fixture coverage; uncommitted governance record) — all verified and fixed in-cycle. Lesson recorded: **a general-purpose CLI that is "the only trusted writer" must self-enforce sanitization** — call-site safety is incidental and brittle.

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

---

## 2026-07-22 — Skill-Optimization Loop: Tiered Amendment to Draft-Only Autonomy

**Decision**: The 2026-07-16 draft-only-autonomy ADR is amended. Automated instruction-file mutation is sanctioned **only** via `scripts/skill-apply.ts --auto`, and only when all six of its deterministic conditions hold — checked in order, each verified against live platform state rather than trusted from the proposal's own claims. Any single failing condition causes the exact refusal message quoted below and falls back to standard human-approved filing:

1. `auto refused: policy off` — the `skill_auto_apply` policy flag (`.claude/maintenance-policy.yaml`, read via `scripts/lib/policy.ts`) must be on; it defaults **off**.
2. `auto refused: op must be delete|replace` — the proposal's operation must be `delete` or `replace`; `add` is never auto-eligible.
3. `auto refused: target must be under .claude/commands/ or .claude/skills/ (rules excluded from auto)` — the canonical target path must resolve under `.claude/commands/` or `.claude/skills/` only; `.claude/rules/` is excluded from auto even though a human-approved standard apply may target it.
4. `auto refused: size increased` — `estimateTokens(newContent)` must not exceed `estimateTokens(originalContent)`.
5. `auto refused: no live dangling-ref finding for target` — a live `node scripts/system-map.ts report --json` run must report at least one `dangling-ref` finding whose `subject` equals `pathToId(target)`.
6. `auto refused: edit does not correspond to the dead reference` — `checkAutoCorrespondence` (`scripts/lib/skill-apply-lib.ts`) must confirm the finding's missing-target string genuinely occurs in the proposal's anchor, using deterministic line-wise semantics (both strings EOL-normalized to `\n` first) over **boundary-delimited** occurrences only (the character immediately before/after a match, when present, must not be in `[A-Za-z0-9._$-]` — so `scripts/dead-ref.sh` occurring inside `scripts/dead-ref.sh.bak` never counts as a match): a dead-ref-bearing line is first checked for entanglement — if excising its boundary-matched dead-ref occurrence(s) leaves a residue containing any `[A-Za-z0-9]` character (word content of any kind — not merely a second reference matching some enumerated path shape), the whole check fails closed regardless of `op`; only a residue of pure whitespace and syntax (list markers, backticks, quotes, brackets, punctuation) is tolerated. Otherwise an auto-`delete` is eligible only when EVERY non-blank anchor line contains the dead ref, and an auto-`replace` is eligible only when `proposedText` equals EXACTLY the anchor's lines with the dead-ref-bearing lines removed, in the same relative order, with zero other changes tolerated (an empty `proposedText` is valid only when every anchor line qualified for removal). This is what stops an anchor elsewhere in the same file, a wide anchor that merely *contains* the dead ref alongside unrelated content, a `.bak`-style substring collision, or a single line that entangles the dead reference with ANY other live content (not just a second reference of a recognized shape) — from smuggling an unrelated edit through, or silently deleting a live reference, under cover of a real finding. (An earlier version of this condition instead checked the residue against an enumerated denylist of five path-prefix shapes — provably unsound, since a live reference of any other shape was invisible to it; round 3 inverted it to this closed allowlist of tolerated residue.)

Beyond the eligibility test itself: every successful auto-apply lands as a **separate, individually revertible commit** carrying the full proposal block in the commit body as the durable evidence record; every auto-apply also files a **retroactive `[?]` acknowledgement draft** through the normal `/pm:approve` gate, so the governance record is never silently bypassed. Everything outside this six-condition class — every other proposal from `/tools:reflect`, regardless of tier label — remains draft-only, exactly as the 2026-07-16 ADR specified.

**2026-07-23 implementation-review hardening**: an adversarial implementation review against the shipped `scripts/skill-apply.ts` found condition 6's substring-only check still permitted a wide `replace` anchor to smuggle arbitrary unrelated content through (closed by the line-wise semantics above) and found that an in-bounds symlink target could pass containment while fs/git operations diverged onto two different paths (closed by refusing any symlink target outright and deriving every subsequent operation from one canonical path).

**Context**: Owner decision, 2026-07-22, expanding the feature brief's original scope (ship-only trigger, manual apply after approval) to add the review-FAIL and rebuild triggers and the narrow auto tier. The cautionary evidence for keeping the auto class deterministic rather than LLM-judged: SkillOpt's own ungated-ablation run collapsed from a 0.554 baseline score to 0.026 over six unattended nights — a concrete demonstration of what unsupervised instruction-file drift looks like when nothing scores the outcome.

**Alternatives Considered**:
- **Full auto-apply, or auto-apply with a post-hoc veto window** — rejected: there is no scorer in this system able to catch a degrading edit before or shortly after it lands; the SkillOpt ablation is exactly the failure mode this would reproduce.
- **LLM-judged eligibility** (let the reflecting model decide when a proposal is safe to auto-apply) — rejected: steerable by prompt injection in the very artifacts being reflected on, and it would be a judge ruling on the safety of its own claims — no independent check.
- **Ship-only reflection** (keep the trigger scope as originally briefed) — rejected: review-FAIL and rebuild are the strongest failure signals available and the brief's ship-only scope missed both entirely.
- **Manual apply after every approval, no auto tier at all** — rejected: friction on a mechanical, narrowly-scoped fix class decays into approved-but-never-applied drafts; the six conditions make the mechanical case machine-checkable, so gating it behind a human click adds no safety, only decay.

**Rationale**: Mechanics are automated; judgment stays human. The six conditions were hardened over two adversarial design-review rounds (13 findings total, all resolved) — round 2's lone CRITICAL was exactly a correspondence bypass: a `replace` could smuggle unrelated content into a file that merely *had* a dangling reference somewhere else in it. That finding became condition 6 (`checkAutoCorrespondence`), backed by a pinned fixture regression test so the bypass can't silently regress.
