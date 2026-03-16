# /tools:update — Check for and apply Project OS updates

Check the upstream Project OS repository for compatible updates and apply them safely.

## Behavior

1. Run `bash scripts/update-project.sh` (dry run first) to see what would change
2. Show the user the update report — classify files as:
   - **Safe to update**: Local file untouched since install → auto-replace
   - **New files**: Added upstream, don't exist locally → auto-add
   - **Conflicts**: Modified both locally and upstream → save `.upstream` for review
   - **Unchanged**: Already current or user-customized with no upstream changes
3. If the user approves, run `bash scripts/update-project.sh --apply`
4. For conflicts, help the user diff and merge `.upstream` files
5. After resolving, regenerate manifest: `bash scripts/generate-manifest.sh`

## Flags (pass via $ARGUMENTS)

- `--target VERSION` — target a specific version (e.g., `--target v2.3`)
- `--major` — allow major version upgrades (default: same major only)

## Important

- NEVER auto-apply without showing the report first
- NEVER touch ROADMAP.md, CLAUDE.md, docs/specs/, docs/memory/, or src/
- Always create backups before applying (script does this automatically)
- The manifest at `.claude/manifest.json` tracks what was installed and when

## Requirements

- `gh` CLI must be installed and authenticated
- Project must have been bootstrapped from Project OS (or have a manifest)
