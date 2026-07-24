# Brief: Template Content Leakage
Created: 2026-07-24
Status: DRAFT

## Problem

`scripts/new-project.sh` seeds every new project by **copying Project OS's own live
knowledge vault** into it. Seven `docs/knowledge/*.md` files plus
`.claude/rules/preferences.md` arrive in a fresh clone already populated with
well-formed, confidently-written prose about *Project OS itself* — its hook chain,
its adoption policy, its manifest-hashing rule, its ship metrics.

`/tools:init` cannot see this. Init's entire discovery mechanism is a scan for
`[ALL_CAPS_IN_BRACKETS]` tokens (`init.md:157`). These files contain no placeholders,
so init reports success having never touched them.

The blast radius is not equal across files. `CLAUDE.template.md:19` and `:22` do:

```
## Architecture
@import docs/knowledge/architecture.md
## Active Conventions
@import docs/knowledge/patterns.md
```

So in every cloned project, "this project's architecture" resolves to 187 lines about
Project OS's hook chain, and "active conventions" resolves to Project OS's
ROADMAP↔Tasks dual-track pattern. `.claude/rules/preferences.md` is worse still — it is
always-loaded rather than imported, and it asserts `Language: Bash + TypeScript` and
`Testing: node --test, tests/ mirrors scripts/` as the project's ground truth.

Confirmed in the field: during `/workflows:idea` on Power-Hour-Rhythm-Game (a browser
rhythm game), a research agent flagged this unprompted as the top conflict — "a future
design agent that loads architecture.md expecting the game's architecture will get 188
lines about Project OS's own hook chain instead."

## Proposed Solution

Stop copying live content. Ship a `templates/` seed tier: `new-project.sh` copies
`templates/knowledge/*.md` and `templates/rules/preferences.md` into the same
destination paths, so a fresh clone is correct **by construction** rather than by
post-hoc repair. Destination paths are unchanged, so `generate-manifest.sh` and
`update-project.sh` keep their hard-coded path lists.

Add a zero-dep, zero-LLM detector as a new `system-map.ts` readiness finding kind
(`template-residue`): if a watched content file's sha256 still equals the hash the
manifest recorded at bootstrap, that file was provably never localized. It rides the
existing `maintain.sh` map check, so it inherits the draft cap, fingerprinting, and
draft-only discipline with no changes to `maintain.sh`.

Give `/tools:init` a closing verification step that runs the detector and reports
residue, so init stops claiming success on a project that will mislead the next agent.

## Success Criteria

- [ ] A project created by `new-project.sh` contains zero prose about Project OS in
      `docs/knowledge/*.md` or `.claude/rules/preferences.md`
- [ ] `@import docs/knowledge/architecture.md` in a fresh clone resolves to a
      project-scoped stub, not framework self-documentation
- [ ] `node scripts/system-map.ts report` emits a `template-residue` finding for every
      un-localized watched file, and **no** finding in the Project OS repo itself
- [ ] `maintain.sh` files a `[?]` draft when residue is present, with no edits to
      `maintain.sh`
- [ ] `generate-manifest.sh` and `update-project.sh` keep the four canonical
      `docs/knowledge/` filenames, or both are updated in the same commit
- [ ] `/tools:update` on an existing clone does not blind the detector
- [ ] `/tools:init` reports residue in its Step 10 summary

## Constraints

**Hard:**
- `generate-manifest.sh:49-56` and `update-project.sh:384-390` hard-code the four
  top-level knowledge paths. Any relocation of the canonical filenames requires
  lockstep edits to both, plus `new-project.sh:365-371`.
- Zero new runtime dependencies. Hashing must use `node:crypto` / `sha256sum`, both
  already in use.
- Draft-only autonomy: the maintenance loop files `[?]` drafts, never mutates
  canonical state (`CLAUDE.md` Maintenance Invariants).
- The detector must not fire in the Project OS repo, where framework content in
  `docs/knowledge/` is *correct*.
- Backward compatibility with already-cloned projects — the fix must reach them, which
  is the whole point of item 3.

**Soft:**
- Prefer adding a finding kind over adding a `maintain.sh` check (the map check already
  drafts on `HIGH`, `maintain.sh:341-396`).
- Prefer deterministic detection over LLM judgement.

## Non-Goals

- Rewriting `docs/knowledge/` content *quality* — this is about provenance, not prose.
- Auto-repairing existing clones. Detection files a draft; the human decides.
- Migrating Project OS's own vault out of `docs/knowledge/`. The framework repo is
  itself a Project OS project; its self-documentation belongs exactly where it is.
  The bug is the **copy**, not the location.
- Making `docs/knowledge/*.md` updatable via `/tools:update`. They are one-time seeds.

## Research Findings

*Research was performed in-session by direct source inspection rather than via the
`/tools:research` fan-out — the session's agent-dispatch policy prohibited sub-agent
spawning.*

### Full enumeration of what the template ships

Source of truth: `new-project.sh` `CONTENT_FILES` (`:363-372`), `FRAMEWORK_TREES`
(`:312-320`), and the fresh-mode copy loop (`:906-928`).

| Path | Lines | Verdict | Reasoning |
|---|---|---|---|
| `docs/knowledge/architecture.md` | 187 | **LEAK — critical** | Entirely Project OS: hook table (11 hooks), script table, module map, data-flow diagram. `@import`ed into `CLAUDE.md` → always loaded. |
| `docs/knowledge/patterns.md` | 120 | **LEAK — critical** | `@import`ed as "Active Conventions". Entries are Project OS build lore (ROADMAP↔Tasks dual-track, denylist→allowlist inversion). Header + `## Format` block are legitimate scaffold. |
| `docs/knowledge/decisions.md` | 176 | **LEAK — high** | ADRs on in-place adoption policy, `.upstream` manifest hashing, quarantine rules. Not imported, but `/workflows:design` and idea-phase research agents read it as "past decisions on similar problems" (`idea.md:26`). |
| `.claude/rules/preferences.md` | 15 | **LEAK — high** | Always-loaded, not imported. `## Coding` block asserts Project OS's stack/test runner as the project's. `## Communication` block is owner voice preference — transferable. Small file, disproportionate weight. |
| `docs/knowledge/bugs.md` | 76 | **LEAK — medium** | Project OS's own bug history (fabricated CDN SRI hash, etc.). Pollutes "have we hit this before?" triage. Some entries are near-universal lessons but are framed as this project's incidents. |
| `docs/knowledge/metrics.md` | 171 | **MIXED** | Header + `## Template` block = format example, **fine**. `## Completed Features` = Project OS's own ship metrics for `skill-optimization-loop`, `adopt-existing-project`, `self-maintenance`. `/tools:metrics` would report another project's velocity as this project's. **Leak below the `## Completed Features` heading.** |
| `docs/knowledge/kv.md` | 3 | **Fine** | Header + HTML comment only. Pure scaffold. |
| `docs/knowledge/skill-edit-rejections.md` | 31 | **Fine** | Format contract + hardening guidance for a framework mechanism that ships with the framework. Zero entries. Genuinely useful in any clone. |
| `ROADMAP.template.md` → `ROADMAP.md` | 36 | **Fine** | Pure format scaffold. |
| `.claude/maintenance-policy.yaml` | 55 | **Fine** | Framework tuning config, universally applicable. |
| `docs/maps/*` | — | **Fine** | Generated in place by `setup.sh`, never copied. |
| `docs/memory/`, `.claude/sessions/` | — | **Fine** | Created empty (`.gitkeep`). |

Not copied at all, and correctly so: `CHANGELOG.md`, `PROJECT_STATUS.md`, `README.md`,
`project-os-guide.md`, `docs/audits/`.

### A second, adjacent defect: dangling references in every clone

Three files ship pointing at files that `new-project.sh` never copies:

| Shipped file | Reference | Target copied? |
|---|---|---|
| `ROADMAP.md` (`:3`) | `docs/knowledge/roadmap-format.md` | **No** |
| `.claude/rules/bash.md` | `docs/knowledge/windows-bash-scanner.md` | **No** |
| `.claude/rules/bash.md` | `docs/proposals/pre-tool-approve-hook.md` | **No** |

This is the mirror image of class (b): framework *reference* docs that should ship but
don't. `docs/product.md` and `docs/tech.md` are also absent from `CONTENT_FILES` while
`init.md:74-75` and Step 6 assume they exist. Same root cause — `CONTENT_FILES` was
curated by hand and has drifted from what the rest of the system references.

### The detector signal is real, but `update-project.sh` destroys it

The manifest-hash idea works: `generate-manifest.sh:151-153` hashes every
`docs/knowledge/*.md` at bootstrap into `.claude/manifest.json`'s `files` map, and
`new-project.sh:936` runs it against the freshly-scaffolded project. So the manifest
genuinely records "what we shipped you."

**But `update-project.sh:599` regenerates the manifest from local files at the end of
every `/tools:update` run.** After one update, `files["docs/knowledge/architecture.md"]`
holds the *user's* hash, and hash-equality proves nothing. Any design that reads the
`files` map alone is one `/tools:update` away from permanent blindness.

This forces a separate, write-once `seed_hashes` block in the manifest that regeneration
carries forward verbatim rather than recomputing — see design.

### The detector must not fire on Project OS itself

In the framework repo, `docs/knowledge/architecture.md` *is* the source of truth and
its hash legitimately matches the manifest. A naive hash-equality check flags the
framework repo as 100% un-localized. The discriminator has to be structural, not
heuristic.

### Where a detector fits with least disturbance

`system-map-lib.ts:78-83` defines `Finding{severity, kind, subject, detail}`;
`system-map.ts:344-364` assembles findings from five finders. `findBloat` is the exact
precedent for what is needed: a **live-recomputed, report-only** finding that is
deliberately excluded from the `.maps.lock` hashed input set
(`system-map-lib.ts:537-558`), so prose edits don't trigger pre-commit map churn.

`maintain.sh:341-396` runs `system-map.ts report --json`, collects every `HIGH`-severity
subject, and files exactly one `[?]` draft. **A `HIGH` residue finding therefore reaches
the draft pipeline with zero `maintain.sh` changes**, inheriting the draft cap
(`max_drafts_per_run: 3`), the fingerprint dedup, and `--dry-run`.

### "Has init run?" is detectable

`init.md:155-176` replaces `[ALL_CAPS_OR_WORDS_IN_BRACKETS]` tokens across `CLAUDE.md`
and friends. `CLAUDE.template.md` ships with `[PROJECT_NAME]`, `[YOUR_ROLE]`,
`[YOUR_NAME]`, `[PRIMARY_STACK]`; `new-project.sh:924` pre-substitutes only
`[PROJECT_NAME]`. So residual bracket tokens in `CLAUDE.md` are a reliable
"init has not run" signal — and are worth their own separate, lower-severity finding
rather than being folded into the residue gate.

## Open Questions

- Should `docs/knowledge/metrics.md` seed keep the `## Template` block (format example,
  useful) while dropping `## Completed Features` entries? Design assumes yes.
- Should `.claude/rules/preferences.md`'s `## Communication` block survive into the
  seed? It is Jacob's voice preference, not Project OS's stack — arguably it *should*
  travel to his projects and *should not* be in a public template. Design assumes it
  survives, since every downstream project is his.
- Existing clones that have already run `/tools:update` post-fix have no recoverable
  seed baseline. Is a secondary heuristic (e.g. literal "Project OS" string match in
  `docs/knowledge/architecture.md`) worth adding as a fallback, or is that the
  LLM-adjacent fuzziness this design is trying to avoid?
- Should the dangling-reference gap (`roadmap-format.md`, `windows-bash-scanner.md`,
  `pre-tool-approve-hook.md`, `product.md`, `tech.md`) be fixed in this feature or
  split into its own? Design folds it in — it is the same `CONTENT_FILES` drift and
  the same one-line-per-file fix.
