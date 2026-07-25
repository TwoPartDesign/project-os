# templates/ — content seeds for new projects

Everything in this directory is **content the framework hands a new project once**,
at bootstrap. It is copied by `scripts/new-project.sh` (`CONTENT_FILES`) into the
destination paths below and then belongs entirely to that project.

| Seed | Destination in a new project |
|---|---|
| `templates/knowledge/*.md` | `docs/knowledge/*.md` |
| `templates/rules/preferences.md` | `.claude/rules/preferences.md` |
| `templates/docs/product.md` | `docs/product.md` |
| `templates/docs/tech.md` | `docs/tech.md` |

## Why this directory exists

`new-project.sh` used to seed new projects by copying **this repo's own live**
`docs/knowledge/*.md` and `.claude/rules/preferences.md`. Since `CLAUDE.md` does
`@import docs/knowledge/architecture.md`, every cloned project loaded ~190 lines
about Project OS's own hook chain as *its* architecture — confidently written,
well-formed, and about the wrong system. `/tools:init` could not see it, because
its entire discovery mechanism is a scan for `[ALL_CAPS_IN_BRACKETS]` and these
files contain prose, not placeholders.

See `docs/specs/template-content-leakage/design.md`.

## Rules for editing seeds

1. **Never paste this project's content into a seed.** Seeds carry *format
   contracts* (frontmatter keys, `## Format` / `## Template` blocks, the
   "entries appended here" comment) and nothing else. If a sentence would be
   false in someone else's repo, it does not belong here.
2. **Derive by deletion.** When a live file's format contract changes, copy the
   live file and delete its entries — do not rewrite the seed from scratch.
   `tests/template-seeds.test.ts` asserts frontmatter keys and format blocks
   still match their live counterparts.
3. **`templates/knowledge/` is the framework-repo discriminator.** Its presence
   is how `scripts/system-map.ts` knows it is running in Project OS itself and
   must not report `template-residue`. Do not copy this directory into a
   downstream project, and do not rename it without updating
   `RESIDUE_WATCHED`'s guard in `scripts/lib/system-map-lib.ts` and
   `SEED_SOURCES` in `scripts/generate-manifest.sh`.
4. **Adding a seed is a three-file change**: the seed itself,
   `CONTENT_FILES` in `scripts/new-project.sh`, and — if the destination should
   be watched for residue — `RESIDUE_WATCHED` plus `SEED_SOURCES`.
