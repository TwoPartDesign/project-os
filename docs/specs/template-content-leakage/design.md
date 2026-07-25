# Design: Template Content Leakage
Created: 2026-07-24
Updated: 2026-07-24 — implemented on `claude/template-content-leakage-4sxcm0`; extended to cover companion defects C-H
Status: DRAFT (implementation complete, awaiting `/pm:approve`)
Brief: ./brief.md

## Implementation status

| Item | ROADMAP | State |
|---|---|---|
| A — seed tier (`templates/`) | #T97, #T98 | Implemented, verified end-to-end |
| A — manifest `seed_hashes` | #T99, #T100 | Implemented, verified |
| A — init Step 5b stub + Step 10 verification | #T104 | Implemented |
| B — `unlocalized-template-content` finding | #T101, #T102 | Implemented, fires correctly, silent in framework repo |
| Tests (+48) | #T103 | 50 unit + 23 smoke, all green |
| ADR + patterns entry | #T105 | Written |
| C — pre-push first-push guard | #T106 | Implemented, verified |
| D — feature slug | #T107 | Implemented |
| E — toolchain permissions | #T108 | Implemented |
| F — specs tracking policy | #T109 | Implemented |
| G — scratchpad, not `/tmp` heredoc | #T110 | Implemented |
| framework-patterns reference doc | #T111 | Implemented |
| H — `scan-rules.js` on Node 22 | #T112 | Diagnosed loudly; regex rewrite deferred with reasons |

Two naming notes against the original report:
- The finding `kind` is **`unlocalized-template-content`**, the name the report suggested. Internal
  function and file names keep `templateResidue` / `template-residue.test.ts`.
- The report proposed `docs/knowledge/project-os/` for relocated framework content. This design does
  not relocate anything: downstream projects never *receive* the framework's vault, so there is
  nothing in them to move, and this repo's own vault is correctly placed where it is. The
  "do not delete, relocate" instruction is honored by `templates/knowledge/framework-patterns.md`,
  which ships the five transferable patterns as **reference** rather than as a new project's
  asserted conventions.

## Architecture Decision

**Split the template's content tier from the framework's own knowledge vault, and make
the manifest record what was *shipped* rather than what currently *exists*.**

Three moves, in dependency order:

1. **Seed tier.** Add `templates/` to the framework repo holding near-empty,
   format-preserving seeds for every content-class file. `new-project.sh` copies
   `templates/knowledge/architecture.md → docs/knowledge/architecture.md` instead of
   copying its own live file. **Destination paths do not change**, so
   `generate-manifest.sh:49-56` and `update-project.sh:384-390` keep their hard-coded
   path lists intact. A fresh clone is correct by construction; there is nothing for
   init to repair.

2. **Write-once `seed_hashes`.** `.claude/manifest.json` gains a top-level
   `seed_hashes` block recording the bootstrap hash of each watched content file.
   Unlike `files`, it is **never recomputed** — `generate-manifest.sh` carries it
   forward verbatim. This survives `update-project.sh:599`, which regenerates the
   manifest from local files at the end of every `/tools:update` and would otherwise
   permanently blind any detector reading `files`.

3. **`template-residue` readiness finding.** `system-map.ts` gains two finders that
   compare each watched file's live sha256 against its `seed_hashes` entry. Equal hash
   after init has run = provably un-localized. It rides `maintain.sh`'s existing map
   check, which drafts on any `HIGH` finding (`maintain.sh:381-396`) — so the draft
   pipeline, cap, fingerprinting, and draft-only discipline are inherited with
   **zero changes to `maintain.sh`**.

### Why this shape

The framing that unlocks the design: **the Project OS repo is itself a Project OS
project.** Its `docs/knowledge/architecture.md` is not misplaced — it is exactly where
that project's architecture belongs. The defect is not the *location* of the framework's
knowledge; it is that `new-project.sh` treats a live vault as a template. Once the copy
is replaced with a seed, the framework's vault can stay where it is and every downstream
consumer (`knowledge-index.ts`, `audit-context.sh`, `memory-search.sh`,
`collectBloatFiles`, `/tools:handoff`) is untouched.

This also produces the discriminator the detector needs for free: **`templates/` exists
in the framework repo and nowhere else.** No heuristic, no upstream-URL sniffing.

## Alternatives Considered

| Approach | Pros | Cons | Why Not |
|---|---|---|---|
| **A. Init relocates framework content to `docs/knowledge/project-os/` and writes fresh files** (what was done by hand downstream) | Proven to work; fixes clones already on disk | Per-project manual repair of a template defect; runs *after* the wrong content has already been committed and possibly read; depends on an LLM correctly classifying 7 files every time; does nothing when init is skipped or interrupted; creates a `docs/knowledge/project-os/` tree in every project that then needs its own exclusion rules in `knowledge-index.ts`, `collectBloatFiles`, and `maintain.sh` staleness | Rejected as the primary fix. It treats the symptom in each clone rather than the cause in the template. Kept as the *manual remediation* recipe for existing clones, driven by the detector's draft. |
| **B. Ship the four files near-empty, move the framework's vault to `docs/knowledge/project-os/`** | Fresh clone correct by construction | Relocating the framework's own vault breaks `CLAUDE.md:@import`, `knowledge-index.ts:540`, `audit-context.sh:26,42`, `collectBloatFiles` (`system-map-lib.ts:544`), `memory-search.sh:21`, `maintain.sh` staleness scoping, and every `/tools:handoff` write path — for no benefit, since the framework's knowledge is correctly placed *for the framework* | Rejected. The user's stated constraint (keep the four filenames at `docs/knowledge/`) applies to the framework repo too, and B pays a large refactor cost to satisfy a requirement B′ satisfies for free. |
| **B′. Seed tier at `templates/`, framework vault stays put** *(chosen)* | Fresh clone correct by construction; zero destination-path changes; `templates/` doubles as the framework-repo discriminator; seeds are reviewable diffs | Adds a directory whose contents must not drift from the format contracts in the live files | Chosen. |
| **C. Init rewrites the files from collected answers + discovered PRD** | Produces genuinely project-specific content | An LLM writing 187 lines of architecture for a project that has not been designed yet reproduces the exact failure mode — confident, well-formed prose about a system that does not exist. Also still fails when init is skipped. | Rejected as the primary fix. **Adopted in a bounded slice**: init writes a short, honest stub from facts it already holds as ground truth (project name, one-liner, Round 2 stack answers) — see Step 5b below. Facts, not speculation. |
| **D. Detector as a sixth `maintain.sh` check rather than a system-map finding** | Independent of the map subsystem | Duplicates the draft-cap/fingerprint/ledger plumbing the map check already provides; `maintain.sh` is a 660-line bash file with hand-rolled JSON — a worse place for sha256 work than TypeScript with `node:crypto` | Rejected. |
| **E. Detector reads the manifest's existing `files` map only** | No manifest schema change | `update-project.sh:599` regenerates `files` from local content, so one `/tools:update` makes the check permanently vacuous | Rejected as the primary path; retained as a **fallback** for pre-fix clones that have not yet updated (see Data Model). |

## Constraint Analysis

| Constraint | Type | Verified | Notes |
|---|---|---|---|
| C1. `generate-manifest.sh` + `update-project.sh` hard-code the four `docs/knowledge/` paths | HARD | ✅ | `generate-manifest.sh:49-56`, `update-project.sh:384-390`, `new-project.sh:365-371`. B′ changes **source** paths in `new-project.sh` only; destinations are unchanged, so the other two need no path edits. `update-project.sh` gets one *unrelated* edit (dropping seeds from its update set). |
| C2. Zero new runtime dependencies | HARD | ✅ | `node:crypto` (stdlib, `createHash("sha256")`) and `sha256sum` (already required, `generate-manifest.sh:12-15`). |
| C3. Draft-only autonomy — maintenance never mutates canonical state | HARD | ✅ | Detector emits a `Finding`; `maintain.sh:597-652` files a `[?]` draft. No write path added. |
| C4. Detector must not fire in the Project OS repo | HARD | ✅ | `templates/knowledge/` exists only in the framework repo; `new-project.sh` never copies it (not in `FRAMEWORK_TREES`, `FRAMEWORK_FILES`, or `CONTENT_FILES`). Framework-repo `seed_hashes` are computed from the seeds, which differ from the live vault by construction. |
| C5. Must reach already-cloned projects | HARD | ⚠️ Partial | Clones that have **not** run `/tools:update` post-fix: covered by the `files` fallback. Clones that ran `/tools:update` **before** the fix shipped: their `files` entries were already overwritten with local hashes — no recoverable baseline. See Risks R4. |
| C6. `maintain.sh` map check only drafts on `HIGH` | HARD | ✅ | `maintain.sh:377-390` filters `"severity": "HIGH"`. `@import`ed / always-loaded files must be `HIGH` or the draft never fires. |
| C7. Bloat findings are deliberately excluded from `.maps.lock` hashed inputs | SOFT | ✅ | `system-map-lib.ts:537-558`. Residue follows the same rule — recomputed live on `report`, never part of drift detection, so editing prose does not trigger a pre-commit map heal. |
| C8. `generate-manifest.sh` builds JSON by string concatenation, no `jq` | HARD | ✅ | `:99-136`. Carrying `seed_hashes` forward requires grep/sed extraction with strict validation — see Security Considerations. |

## Assumptions

| Assumption | Status | Evidence |
|---|---|---|
| A1. `new-project.sh` runs `generate-manifest.sh` inside the *new* project, so the manifest records the seeds | VERIFIED | `new-project.sh:935-936` — `bash "$FULL_PATH/scripts/generate-manifest.sh"` |
| A2. `update-project.sh` regenerates the downstream manifest from local files | VERIFIED | `update-project.sh:599` |
| A3. `maintain.sh` files a `[?]` draft from `HIGH` map findings with no per-kind logic | VERIFIED | `maintain.sh:377-396` collects `HIGH` subjects generically; `add_finding` is kind-agnostic |
| A4. `CLAUDE.md` in a fresh clone retains `[YOUR_ROLE]`, `[YOUR_NAME]`, `[PRIMARY_STACK]` until init runs | VERIFIED | `new-project.sh:924` substitutes only `[PROJECT_NAME]`; `CLAUDE.template.md:4-8` has four tokens |
| A5. `.claude/rules/preferences.md` is manifest-hashed today (it is inside a `TEMPLATE_DIRS` tree) | VERIFIED | `generate-manifest.sh:37-44,139-148` walks `.claude/rules` |
| A6. `docs/knowledge/{roadmap-format,windows-bash-scanner,design-principles}.md`, `docs/product.md`, `docs/tech.md` are not copied to new projects | VERIFIED | Absent from `CONTENT_FILES` (`new-project.sh:363-372`) and from both `FRAMEWORK_*` lists |
| A7. No downstream project vendors a `templates/` directory of its own | UNVERIFIED | Assumption behind C4's discriminator. Mitigated by scoping the probe to `templates/knowledge/` specifically, not bare `templates/`. See Risks R3. |
| A8. `metrics.md`'s `## Template` block is the only part `/tools:metrics` needs to function on an empty project | UNVERIFIED | Not traced through `.claude/commands/tools/metrics.md`. Must be confirmed at build time. |

## Technical Approach

### Data Model

**`.claude/manifest.json` — new top-level `seed_hashes` block:**

```json
{
  "project_os_version": "v1.4.0",
  "generated": "2026-07-24T00:00:00Z",
  "upstream": "TwoPartDesign/project-os",
  "seed_hashes": {
    "docs/knowledge/architecture.md": "<sha256>",
    "docs/knowledge/patterns.md": "<sha256>",
    "docs/knowledge/decisions.md": "<sha256>",
    "docs/knowledge/bugs.md": "<sha256>",
    "docs/knowledge/metrics.md": "<sha256>",
    ".claude/rules/preferences.md": "<sha256>"
  },
  "files": { "...": "..." }
}
```

Semantics: `files` = "the framework files we maintain and may update"; `seed_hashes` =
"the one-time content we handed you at bootstrap, so we can tell whether you made it
yours." Only `files` is recomputed on regeneration.

**`generate-manifest.sh` resolution order for `seed_hashes` (first match wins):**

| # | Condition | Action | Which situation |
|---|---|---|---|
| 1 | `templates/knowledge/` exists locally | Hash the **seed** files, keyed by destination path | Framework repo. Live vault ≠ seeds → detector silent. Satisfies C4. |
| 2 | Existing manifest has a valid `seed_hashes` block | Copy forward **verbatim** | `/tools:update` regeneration. Satisfies A2 / defeats E's failure. |
| 3 | Existing manifest has `files` entries for watched paths | **Promote** those values into `seed_hashes` | One-time backfill for pre-fix clones on their first post-fix update. Satisfies C5. |
| 4 | No prior manifest | Hash the local watched files | Fresh bootstrap — the files on disk *are* the seeds `new-project.sh` just copied. |

### Key Interfaces

`scripts/lib/system-map-lib.ts`:

```ts
// Finding.kind union gains two members:
kind: "unwired-hook" | "orphan-script" | "dangling-ref" | "manifest-gap"
    | "bloat" | "template-residue" | "init-incomplete";

/**
 * Content-class files watched for template residue, with the severity each
 * carries. HIGH is reserved for files that reach the model on every turn —
 * `maintain.sh` only drafts on HIGH (maintain.sh:381).
 * This list is the ONLY set of paths ever read; manifest keys are never
 * iterated (see Security Considerations).
 */
export const RESIDUE_WATCHED: ReadonlyArray<{
  path: string;
  severity: "HIGH" | "MEDIUM";
  reason: string;
}> = [
  { path: "docs/knowledge/architecture.md", severity: "HIGH",   reason: "@import'ed into CLAUDE.md" },
  { path: "docs/knowledge/patterns.md",     severity: "HIGH",   reason: "@import'ed into CLAUDE.md" },
  { path: ".claude/rules/preferences.md",   severity: "HIGH",   reason: "always-loaded rule file" },
  { path: "docs/knowledge/decisions.md",    severity: "MEDIUM", reason: "read by design + idea research" },
  { path: "docs/knowledge/bugs.md",         severity: "MEDIUM", reason: "read during bug triage" },
  { path: "docs/knowledge/metrics.md",      severity: "MEDIUM", reason: "queried by /tools:metrics" },
];

/** True when CLAUDE.md still carries unfilled `[ALL_CAPS]` init placeholders. */
export function hasUnfilledPlaceholders(claudeMdContent: string | null): boolean;

/**
 * MEDIUM finding when init has not run. Emitted INSTEAD of residue findings —
 * an un-initialized project has one problem, not seven.
 */
export function findInitIncomplete(claudeMdContent: string | null): Finding[];

/**
 * Flags each RESIDUE_WATCHED file whose live sha256 still equals its recorded
 * seed hash. Returns [] (fail-quiet, never a false positive) when:
 *   - no baseline is available (no `seed_hashes` and no usable `files` entry),
 *   - the manifest is absent or unparseable,
 *   - `isFrameworkRepo` is true.
 */
export function findTemplateResidue(args: {
  manifestJsonText: string | null;
  /** sha256 of the live file, or null if it does not exist. */
  readHash: (path: string) => string | null;
  /** True when `templates/knowledge/` exists — the framework repo itself. */
  isFrameworkRepo: boolean;
}): Finding[];
```

Baseline lookup inside `findTemplateResidue`, per watched path: `seed_hashes[path]`,
else `files[path]` (the pre-fix-clone fallback), else skip that path.

Finding shape:

```
severity: HIGH
kind:     "template-residue"
subject:  "docs/knowledge/architecture.md"
detail:   "docs/knowledge/architecture.md is byte-identical to the Project OS template
           seed — it still describes the framework, not this project (@import'ed into
           CLAUDE.md). Replace it with this project's architecture."
```

`scripts/system-map.ts` — wired alongside the existing five finders at `:344-364`:

```ts
const claudeMd = source.readInput("CLAUDE.md");
if (hasUnfilledPlaceholders(claudeMd)) {
  findings.push(...findInitIncomplete(claudeMd));
} else {
  findings.push(...findTemplateResidue({
    manifestJsonText: manifestContent,          // already read at :356-358
    readHash: (p) => sha256OfWorkingTreeFile(root, p),
    isFrameworkRepo: existsSync(join(root, "templates", "knowledge")),
  }));
}
```

`sha256OfWorkingTreeFile` hashes the **working-tree** file with `node:crypto`, matching
how `sha256sum` produced the manifest entry. It must **not** use `ContentSource.readInput`,
which applies `normalizeContent()` — normalization would change the digest and break
equality with the manifest.

### File Changes

**New — `templates/` (framework repo only, never copied into projects):**

| File | Content |
|---|---|
| `templates/knowledge/architecture.md` | Frontmatter + `# System Architecture` + a one-line note that `/workflows:design` fills this in. No prose. |
| `templates/knowledge/patterns.md` | Frontmatter + `# Established Patterns` + the `## Format` block (the format contract is legitimate scaffold) + the "entries appended here" comment. Zero entries. |
| `templates/knowledge/decisions.md` | Frontmatter + `# Architectural Decision Records` + `## Format` block. Zero ADRs. |
| `templates/knowledge/bugs.md` | Frontmatter + `# Bug Root Causes` + `## Format` block. Zero entries. |
| `templates/knowledge/metrics.md` | `# Feature Metrics` + the `## Template` block **kept** (format example) + empty `## Completed Features`. |
| `templates/knowledge/kv.md` | Byte-identical to the current file — already a pure stub. |
| `templates/knowledge/skill-edit-rejections.md` | Byte-identical to the current file — a framework format contract, correct in any clone. |
| `templates/rules/preferences.md` | `## Communication` block kept; `## Coding` block reduced to `[preferred language]` / `[prettier/black/gofmt/etc.]` / `[jest/pytest/go test/etc.]` **placeholder tokens** — which pulls the file into init's existing Step 3 scan (`init.md:157-166` already lists it) and into init's Step 5 mapping table (`:361-363`), where those exact tokens are already defined. Class (b) becomes class (a). |

**Modified:**

| File | Change |
|---|---|
| `scripts/new-project.sh` | `CONTENT_FILES` sources repointed to `templates/…`; add the five missing referenced docs (`docs/knowledge/roadmap-format.md`, `docs/knowledge/windows-bash-scanner.md`, `docs/knowledge/design-principles.md`, `docs/product.md`, `docs/tech.md`); add `templates/rules/preferences.md → .claude/rules/preferences.md` and **exclude that one path from `copy_tree_safe` on `.claude/rules`** so CONTENT_FILES owns it in both modes. Fresh mode already runs the `CONTENT_FILES` loop after the tree loop (`:906-928`), so ordering is correct there. |
| `scripts/generate-manifest.sh` | Emit `seed_hashes` per the four-rule resolution table. `files` output unchanged. |
| `scripts/update-project.sh` | **Remove** the six `docs/knowledge/*.md` entries from `TEMPLATE_FILES` (`:384-390`). They are one-time seeds; keeping them means every template release offers to overwrite the project's real knowledge, or (post-fix) drops a useless `architecture.md.upstream` seed beside it. `.claude/rules/preferences.md` stays in the update set via `TEMPLATE_DIRS` but is now placeholder-bearing, so a localized copy correctly classifies as `CONFLICT`. |
| `scripts/lib/system-map-lib.ts` | `Finding.kind` union + `RESIDUE_WATCHED` + `hasUnfilledPlaceholders` + `findInitIncomplete` + `findTemplateResidue`. |
| `scripts/system-map.ts` | `sha256OfWorkingTreeFile` helper; wire both finders into `collectFindings`. |
| `.claude/commands/tools/init.md` | **Step 5b** (new): after placeholders are filled, write project-scoped stubs into `docs/knowledge/architecture.md` from facts already collected — project name, Round 1 one-liner, Round 2 stack — ending with "Detailed architecture is filled in by `/workflows:design`." Explicitly forbid speculating about components that do not exist. **Step 11** (new): run `node scripts/system-map.ts report --json`, filter `kind` in `{template-residue, init-incomplete}`, and print the result in the Step 10 report. **Anti-requirement, stated in bold**: init must never run `generate-manifest.sh` — regenerating after localization would rewrite `seed_hashes`' fallback source and blind the detector. |
| `docs/knowledge/patterns.md` (framework's own) | New entry: "Ship Seeds, Not Live Content" — the general rule that a template must never copy its own working state. |

**Deliberately unchanged:** `scripts/maintain.sh`, `.claude/maintenance-policy.yaml`,
`CLAUDE.template.md`, `scripts/knowledge-index.ts`, `scripts/audit-context.sh`,
`collectBloatFiles`, and the framework's own `docs/knowledge/*.md` locations.

### Dependencies

None. `node:crypto` and `sha256sum` are stdlib / already-required.

## Testing Strategy

Per `.claude/rules/tests.md`: every file runnable in isolation, no shared mutable state,
`[unit]_[scenario]_[expected]` naming, specific-value assertions, error-message
assertions, and — for the containment guard — **in-bounds indirection cases, not just
the obvious escape**.

`tests/system-map-lib.test.ts` (new cases):

- `findTemplateResidue_hashMatchesSeed_flagsHighForImportedFile`
- `findTemplateResidue_hashDiffersFromSeed_returnsEmpty`
- `findTemplateResidue_isFrameworkRepo_returnsEmpty`
- `findTemplateResidue_noSeedHashesButFilesEntryPresent_usesFilesFallback`
- `findTemplateResidue_noBaselineForPath_skipsThatPathWithoutFinding`
- `findTemplateResidue_manifestUnparseable_returnsEmptyAndDoesNotThrow`
- `findTemplateResidue_manifestContainsExtraKeys_readsOnlyWatchedPaths` — manifest
  carries `seed_hashes["../../etc/passwd"]` and `seed_hashes["docs/knowledge/../../.ssh/id_rsa"]`;
  assert `readHash` is invoked with exactly the six `RESIDUE_WATCHED` paths and nothing else
- `findTemplateResidue_watchedPathIsSymlinkToInScopeSibling_stillComparesResolvedContent` —
  `docs/knowledge/architecture.md` symlinked to `docs/knowledge/decisions.md` (an
  **in-bounds** target); assert the finding reflects the resolved content's hash
- `findTemplateResidue_prefixCollisionPath_notWatched` — `docs/knowledge/architecture.md.bak`
  and `docs/knowledge/architecture.md2` exist and match a seed hash; assert no finding
- `findTemplateResidue_missingFile_returnsEmptyForThatPath`
- `hasUnfilledPlaceholders_claudeMdWithProjectNameToken_returnsTrue`
- `hasUnfilledPlaceholders_claudeMdWithMarkdownCheckboxes_returnsFalse` — `[ ]`, `[x]`
- `hasUnfilledPlaceholders_claudeMdWithWikilinks_returnsFalse` — `[[decisions]]`
- `hasUnfilledPlaceholders_claudeMdAbsent_returnsFalse`
- `findInitIncomplete_placeholdersPresent_emitsSingleMediumFinding` — assert the
  detail string names the specific unfilled tokens
- `collectFindings_placeholdersPresent_emitsInitIncompleteAndNoResidue` — mutual exclusion

`tests/generate-manifest.test.sh` (new cases):

- `generateManifest_templatesKnowledgeExists_seedHashesMatchSeedsNotLiveFiles`
- `generateManifest_existingSeedHashes_copiedForwardByteIdentical` — regenerate twice
  after mutating the live files; assert `seed_hashes` unchanged
- `generateManifest_noSeedHashesButFilesPresent_promotesFilesEntries`
- `generateManifest_noPriorManifest_hashesLocalWatchedFiles`
- `generateManifest_seedHashesValueNotHex_entryDroppedAndWarned`
- `generateManifest_seedHashesKeyContainsQuote_entryDroppedAndWarned`

`tests/new-project.test.sh` (smoke suite extension):

- `newProject_freshBootstrap_knowledgeFilesContainNoFrameworkProse` — assert
  `grep -c "Project OS"` is 0 across the scaffolded `docs/knowledge/*.md` and
  `.claude/rules/preferences.md`
- `newProject_freshBootstrap_everyReferencedDocExists` — resolve every
  `docs/knowledge/*.md` and `docs/proposals/*.md` path referenced from the scaffolded
  `ROADMAP.md`, `CLAUDE.md`, and `.claude/rules/*.md`; assert each resolves
- `newProject_freshBootstrap_systemMapReportsNoResidueBeforeInit` — pre-init, expect
  `init-incomplete` and **no** `template-residue`
- `newProject_afterSimulatedInit_reportsResidueForUntouchedFiles`
- `newProject_adoptMode_existingPreferencesFileWins` — adopt into a repo that already
  has `.claude/rules/preferences.md`; assert the user's file holds the canonical path
  and the seed lands as `.upstream`

**Integration guard** — `frameworkRepo_systemMapReport_emitsNoTemplateResidue`, run in
the framework repo's own suite. This is the C4 regression canary.

## Security Considerations

1. **Path traversal via manifest keys.** `seed_hashes` keys are read from a JSON file on
   disk. `findTemplateResidue` must iterate `RESIDUE_WATCHED` and *look up* the manifest,
   never iterate manifest keys and read what they name. A manifest containing
   `"../../.ssh/id_rsa"` must cause zero filesystem reads outside the six watched paths.
   Covered by `findTemplateResidue_manifestContainsExtraKeys_readsOnlyWatchedPaths`.

2. **JSON injection into `generate-manifest.sh`.** The script builds JSON by string
   concatenation with no `jq` (`:99-136`), and rule 2 copies `seed_hashes` forward from
   an existing file. A hand-edited manifest whose value contains `"` or `\` would produce
   a corrupt or attacker-shaped manifest. **Every carried-forward pair must be validated
   before emission**: key must match a `RESIDUE_WATCHED` path exactly, value must match
   `^[a-f0-9]{64}$`. Anything else is dropped with a warning to stderr, not passed
   through `json_escape`.

3. **Symlinked watched paths.** A watched path may be a symlink. Hashing follows the
   link (matching `sha256sum`'s behavior, so manifest and detector agree). The risk is
   information disclosure via the finding's `detail` — so `detail` must contain only the
   watched path and a fixed message, **never** file content or the resolved target path.

4. **No new write paths.** Both finders are pure functions returning `Finding[]`.
   The only actor that writes is `maintain.sh`'s existing draft filer, which is
   already draft-only by design (`CLAUDE.md` Maintenance Invariants).

5. **Secret exposure in seeds.** The seeds are hand-authored near-empty files committed
   to a public template. They pass through the existing pre-commit secret scanner
   (`scripts/security-scanner.ts`) like any other file — no exemption is added.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| R1. Seeds drift from the live files' format contracts (frontmatter shape, `## Format` blocks), so appenders like `/tools:kv` and `skill-ledger.ts` break in new projects | Medium | High | Seeds are derived by *deleting entries* from the live files, never rewritten from scratch. Add a test asserting each seed's frontmatter keys and `## `-heading set match its live counterpart. |
| R2. `update-project.sh` no longer ships knowledge-file updates, so a future format change to `skill-edit-rejections.md`'s contract never reaches existing projects | Medium | Medium | Accepted. Those files are append-target content; a format migration needs a migration note in `CHANGELOG.md`, not a silent overwrite. Called out in the brief's Open Questions. |
| R3. A downstream project creates its own `templates/knowledge/` and silently self-exempts from the detector (A7) | Low | Medium | Probe `templates/knowledge/` specifically, not bare `templates/`. Additionally require `.claude/manifest.json`'s `upstream` to be absent-or-self before treating the repo as the framework. Document the exemption in the finding's absence, not silently. |
| R4. Clones that ran `/tools:update` before this fix have no recoverable baseline (C5) | Medium | Medium | Unfixable by hash. `/tools:update` release notes carry a one-time manual instruction; the `init-incomplete` finding still fires for any such project that never ran init. A content heuristic was considered and rejected as the fuzziness this design exists to avoid — flagged in the brief's Open Questions for the human to decide. |
| R5. `hasUnfilledPlaceholders` false-positives on legitimate `[ALL_CAPS]` prose in a customized `CLAUDE.md`, permanently suppressing residue findings | Low | High | This is the dangerous direction — a false positive here *silences* the real check. Narrow the pattern to the exact token set `CLAUDE.template.md` ships (`[PROJECT_NAME]`, `[YOUR_ROLE]`, `[YOUR_NAME]`, `[PRIMARY_STACK]`) rather than a generic `[A-Z_]+` regex. Deterministic and unambiguous. |
| R6. `normalizeContent()` applied on the detector path yields digests that never match `sha256sum` output, making the detector permanently silent | Medium | High | Silent-failure mode, so it needs a positive test, not just an absence test: `newProject_afterSimulatedInit_reportsResidueForUntouchedFiles` asserts a finding **is** produced end-to-end through the real `sha256sum`-generated manifest, including a CRLF-containing fixture. |
| R7. Adopt-mode `.claude/rules` tree exclusion for `preferences.md` is missed, so adopt keeps ours-wins and overwrites an adopted repo's real preferences | Medium | Medium | Explicit task + `newProject_adoptMode_existingPreferencesFileWins` test. `preferences.md` is content class, not framework-authority (`decisions.md` two-class policy) — the reclassification must be recorded as an ADR. |
| R8. Six new `HIGH` findings at once saturate `max_drafts_per_run: 3` and crowd out unrelated maintenance drafts | Low | Low | `maintain.sh:377-396` already coalesces *all* `HIGH` map subjects into **one** draft. Residue costs one draft slot total, not six. |
