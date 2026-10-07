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
5. After resolving, regenerate the manifest with the version the updater printed in its "Next steps": `bash scripts/generate-manifest.sh <version>`. Without the version the manifest keeps an existing `-dev` marker, else takes the project's own latest git tag, or "unknown". After a `--local-upstream` run the printed version is `local:<dirname>`; pass the real version instead (#T268)

## Flags (pass via $ARGUMENTS)

- `--target VERSION` — target a specific version (e.g., `--target v2.3`)
- `--major` — allow major version upgrades (default: same major only)
- `--hooks-only` — sync only hooks and settings.json from the template repo (no version check, no gh required)
- `--diff-upstream` — show upstream commits not yet adopted, grouped by area (no version check, no gh required — see below)
- `--project DIR` — update another Project OS project from this checkout (see below)

## --hooks-only Mode

For projects that just need missing hooks (e.g., `output-index.sh`, `compact-suggest.sh`, `tool-failure-log.sh` errors), run:

```
bash scripts/sync-hooks.sh [TARGET_PROJECT_PATH]
```

This copies all hooks from the Project OS template to the target project, adds any missing ones, and preserves locally-modified hooks by saving upstream versions as `.upstream`. Also syncs `settings.json` hook definitions if the target has stale wiring.

When `--hooks-only` is passed via $ARGUMENTS:
1. Ask the user which project to sync (or use the path from $ARGUMENTS)
2. Run `bash scripts/sync-hooks.sh "TARGET_PATH"`. With a target the command asks for confirmation first (an `ask` rule), because it writes into another project. The prompt depends on that rule being in `.claude/settings.json`; the script does not check for it
3. Report what was added/updated/conflicted

## --diff-upstream Mode

Surfaces community-evolved changes in upstream Project OS that this project hasn't pulled in yet — the "what's new upstream" check, distinct from the version-based update flow above. Groups upstream commits touching `.claude/` and `scripts/` by area (command / skill / hook / agent / rule / script).

This mode never fetches over the network mid-run. It reads a local clone of the upstream repo (the "upstream cache") if one exists:

```
git clone https://github.com/TwoPartDesign/project-os.git ~/.project-os-upstream-cache
```

Refresh it later with `git -C ~/.project-os-upstream-cache pull`. Override the path with the `PROJECT_OS_UPSTREAM_CACHE` env var. If no cache is found, the script prints these setup instructions and exits 0 — it never errors just because the cache is missing.

When `--diff-upstream` is passed via $ARGUMENTS:
1. Run `bash scripts/update-project.sh --diff-upstream`
2. Present the grouped commit list to the user
3. This mode is read-only — it never modifies files. Use `--target` + `--apply`, or manual cherry-picking, to actually adopt anything.

## Updating another project (`--project DIR`)

`bash scripts/update-project.sh --project DIR` runs this checkout's updater against the Project OS project at DIR. Use it when a project's own updater is too old to trust: the updater in this checkout decides what the update may change, not the one in the project.

- It is for a project you own. On `--apply` with no conflicts, the target's own `scripts/generate-manifest.sh` and `scripts/system-map.ts` run. It is not a way to vet an unknown repository.
- Run it from a checkout at the release tag you are installing. An updater that lists a script the release lacks exits 1.
- Use the published release. A Windows checkout passed as `--local-upstream` misclassifies files on line endings.
- `--apply` under the flag asks for confirmation (`ask` rules in `.claude/settings.json`). A dry run does not. The rules match the command text, whatever the path to the script, so they stop an unreviewed apply and are not a boundary around the script. They cover the Bash tool only, and a command that passes the flags through a variable (`"$@"`) is not caught.
- The updater refuses `--project` with `--apply` unless `permissions.ask` in this checkout's `.claude/settings.json` holds the two path-independent rules (`settings.local.json` and user settings do not count). After an update that left `.claude/settings.json.upstream`, merge its `ask` block first.
- A project with no `.claude/manifest.json` is refused. Bring it in with `bash scripts/new-project.sh --adopt DIR` instead.

When `--project` is passed via $ARGUMENTS:
1. Run the dry run first: `bash scripts/update-project.sh --project "DIR"`, with `--target` or `--major` as given
2. Show the report, including its `Project:` line, and confirm the target with the user
3. Only then run it again with `--apply`
4. If the apply reports conflicts, resolve them in DIR, then run the manifest command from the updater's "Next steps" exactly as printed. It names DIR's own `scripts/generate-manifest.sh` by absolute path. The relative form in step 5 of Behavior would restamp this checkout's manifest with the other project's version

## Important

- NEVER auto-apply without showing the report first
- NEVER touch ROADMAP.md, CLAUDE.md, docs/specs/, docs/memory/, or src/
- Always create backups before applying (script does this automatically)
- The manifest at `.claude/manifest.json` tracks what was installed and when

## Requirements

- Full update: `gh` CLI must be installed and authenticated; project must have been bootstrapped from Project OS (or have a manifest)
- `--hooks-only`: No `gh` required — works directly from local template repo
- `--diff-upstream`: No `gh` required, no network mid-run — needs a local upstream cache (see above); degrades gracefully with setup instructions if absent
