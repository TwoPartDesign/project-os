---
description: "Bootstrap a new Project OS project from any Claude session — prompts for name and location, clones template, scaffolds structure, and opens a new Claude session ready for /tools:init"
---

# New Project Bootstrap

You are bootstrapping a brand-new Project OS project. Walk the user through this step-by-step with friendly progress output. Be conversational, not robotic.

## Step 1 — Gather inputs

Print: `[1/5] Gathering project details...`

### Detect and classify CWD

Before asking anything, detect the current working directory and classify it:

```bash
pwd
```

Then check what kind of directory this is. Run these checks:

1. **Is CWD an existing Project OS project?** Check if `.claude/manifest.json` exists in CWD. (This is the Project OS marker — a bare `CLAUDE.md` no longer counts; a repo with only a `CLAUDE.md` is adoptable, see Case E.)
2. **Is CWD a projects parent directory?** Check if CWD contains subdirectories that have `.git/` or `.claude/manifest.json` inside them (i.e., it holds multiple projects). Also match if the folder name contains "Projects" or "repos" (case-insensitive).
3. **Is CWD an empty or near-empty folder?** (no `.git/`, no `.claude/manifest.json`, few or no files)
4. **Is CWD a non-empty codebase that isn't Project OS?** True when checks 1 and 3 are both false — there's real content here (code, a `.git/`, maybe even a plain `CLAUDE.md`), but no `.claude/manifest.json`.

Use these results to classify CWD into one of five cases. Evaluate in this order — first match wins: check 2 → **Case A**; else check 1 → **Case B**; else check 3 → **Case C**; else check 4 → **Case E**; else → **Case D**.

#### Case A — CWD is a projects parent directory

The user is already where projects live. Use CWD as the parent path — don't ask for it.

Print:
> "Looks like you're in a projects folder (`<cwd-path>`). I'll create the new project here."

Jump straight to **Question 1 — Project name** (skip Question 2).

#### Case B — CWD is an existing Project OS project

Detected via `.claude/manifest.json`. The user is inside a project already. They probably want to create a sibling.

Print:
> "You're inside an existing project (`<cwd-folder-name>`). I'll create the new project alongside it in `<parent-of-cwd>`."

Set parent path to the parent of CWD. Jump to **Question 1 — Project name** (skip Question 2).

#### Case C — CWD is an empty or near-empty folder

The user may have pre-created the folder for their project. Offer to use it directly.

Take the last path segment as the **CWD folder name**. Compute a **suggested name**: replace spaces and underscores with dashes, strip characters not matching `[a-zA-Z0-9._-]`, collapse multiple dashes, strip leading/trailing dashes.

Print:
> "You're in an empty folder (`<cwd-folder-name>`). Want to turn this into your new project?"
>
> 1. **Yes** — use this folder (project name: `<suggested-name>`, location: `<parent-of-cwd>`)
> 2. **No** — I'll pick a different name and location

If **Yes**: set project name to the suggested name and parent path to parent of CWD. Skip both questions — jump to the **Confirm and proceed** step.

If **No**: proceed to Question 1 and Question 2 as normal (Case D).

#### Case E — non-empty codebase, not Project OS

The folder has real content (code, a `.git/`, maybe even a plain `CLAUDE.md`) but no `.claude/manifest.json` — it isn't a Project OS project yet. Offer to adopt it in place, preserving everything, or fall back to sibling-folder creation.

Take the last path segment as the **CWD folder name**.

Print:
> "This folder (`<cwd-folder-name>`) already has content, but it isn't set up with Project OS yet. I can:"
>
> 1. **Adopt this folder** — set up Project OS *in this folder*, preserving everything that's already here
> 2. **Create a new project instead** — leave this folder alone and set up a fresh project in a sibling folder

If **2 — Create a new project instead**: proceed to Question 1 and Question 2 as normal (same behavior as Case D — no assumptions, ask both questions).

If **1 — Adopt this folder**: run the **adopt flow** below instead of the normal Steps 2-6 further down this file. Adoption is self-contained — do not also run the bootstrap Steps 2-6 for this session.

##### Adopt flow

Print: `[1/6] Downloading the latest Project OS template from GitHub...`

Run (same mechanics as Step 2 below):
```bash
rm -rf /tmp/project-os-bootstrap
git clone https://github.com/TwoPartDesign/project-os.git /tmp/project-os-bootstrap
```

If the clone fails, print the same message as Step 2 and **stop**.

Print: `[2/6] Checking what adoption would do (dry run)...`

Run:
```bash
bash /tmp/project-os-bootstrap/scripts/new-project.sh --adopt "<cwd-path>" --dry-run
```

Echo the full plan to the user. Call out the **DEMOTED** and **UNREVIEWED-EXECUTABLE** sections prominently — these are files that previously held execution authority in this folder (a pre-existing `.claude/settings.json`, git hooks, `scripts/*` files) and need a manual review pass after adoption.

**If the dry run refuses with a nested-repo error** (this folder has no `.git` of its own but resolves inside a parent git repo): surface the choice —
> "This folder is nested inside another git repository. Adopting here would create a repo-in-a-repo. Proceed anyway?"
>
> 1. **Yes** — re-run with `--allow-nested`
> 2. **No** — stop here; suggest a different folder, or sibling-folder creation (option 2 above) instead

If **Yes**, re-run the dry run with the flag added and echo the updated plan:
```bash
bash /tmp/project-os-bootstrap/scripts/new-project.sh --adopt "<cwd-path>" --dry-run --allow-nested
```
If **No**, **stop** the adopt flow entirely.

**If the dry run refuses because `.claude/manifest.json` already exists** or **because a symlink was found under a template-managed path**, print the refusal message verbatim and **stop** — do not offer a retry (see error-handling table below).

Ask: "Proceed with adoption? (Y/N)"

If **N**: confirm nothing was changed and **stop**.

If **Y**: print `[3/6] Adopting Project OS into this folder...` and run the real (non-dry) command — add `--allow-nested` only if that branch was taken above:
```bash
bash /tmp/project-os-bootstrap/scripts/new-project.sh --adopt "<cwd-path>"
```

Echo the final adopt report in full (CREATED / CONFLICT / DEMOTED / UNREVIEWED-EXECUTABLE / quarantined git hooks / commit status). If the report says the commit was skipped because the git index already had staged changes, tell the user their staged changes were left untouched and to review + commit both sets of changes manually.

Print: `[4/6] Cleaning up temporary files...`
```bash
rm -rf /tmp/project-os-bootstrap
```

Print: `[5/6] Detecting your stack...`
```bash
node scripts/detect-stack.ts
```
Show the detected stack summary (language, package manager, framework, database, test runner, formatter, confidence) to the user.

Print: `[6/6] Done!`
> "Project OS is now set up in `<cwd-path>`. Type `/tools:init` to finish setup — it'll use the detected stack to help fill in your project variables."

Hand off to `/tools:init` (same closing UX as the other cases). Skip Step 5's new-terminal logic — you're already in the target directory.

#### Case D — Unknown / none of the above

None of Cases A, B, C, or E matched. No assumptions. Ask both questions.

---

### Question 1 — Project name

Compute a **suggested name** from the CWD folder name (if not already set by Case C): replace spaces and underscores with dashes, strip characters not matching `[a-zA-Z0-9._-]`, collapse multiple dashes, strip leading/trailing dashes.

If a suggestion is available, ask:
> "What should the project be called? I'd suggest `<suggested-name>` based on your current folder — or type a different name."
> *(letters, numbers, dashes, and dots only)*

If no suggestion can be derived, ask:
> "What should the project be called? (e.g. `my-app`, `cool-tool`)"
> *(letters, numbers, dashes, and dots only — this becomes the folder name)*

Validate: must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`. If invalid, explain why and re-ask.

### Question 2 — Parent directory

**Skip this question if already resolved by Case A, B, or C.**

Ask:
> "Where should I create it? Give me the full path to the parent directory."
> *(e.g. `C:/Users/<username>/Projects` — the project folder gets created inside it)*

### Confirm and proceed

Print: "I'll create `<project-name>` at `<parent-path>/<project-name>`."

#### Folder rename offer

Check: does `<parent-path>/<cwd-folder-name>` match CWD, and is `<cwd-folder-name>` different from `<project-name>`? If so, the user is inside a folder that should be renamed.

> "Your current folder is `<cwd-folder-name>` but the project will be `<project-name>`. Want me to rename this folder?"
>
> 1. **Yes** — rename it
> 2. **No** — create a new folder instead

- If **Yes**: set `RENAME_FOLDER=true`. Old path = CWD, new path = `<parent-path>/<project-name>`.
- If **No**: proceed normally.

If the folder rename doesn't apply (names match, or CWD isn't the target), skip this entirely.

Ask: "Ready to go? (Y/N)"

#### Rename execution (if RENAME_FOLDER=true)

Before cloning the template, execute the rename.

First, verify the destination does not already exist:

```bash
[ -d "<parent-path>/<project-name>" ] && echo "EXISTS"
```

If the destination exists, print:
> "Cannot rename — a folder named `<project-name>` already exists at `<parent-path>`. Remove it first or choose a different name."

Then **stop**.

Otherwise, copy then delete:

```bash
cp -r "<cwd-path>/." "<parent-path>/<project-name>"
rm -rf "<cwd-path>"
```

Print: `  - Renamed folder: <cwd-folder-name> → <project-name>`

If the copy fails, print a friendly error and stop. Do **not** delete the original until the copy succeeds.
If the copy succeeds but the delete fails, warn but continue — the duplicate old folder is harmless.

---

## Step 2 — Clone template

Print: `[2/5] Downloading the latest Project OS template from GitHub...`

Run:
```bash
rm -rf /tmp/project-os-bootstrap
git clone https://github.com/TwoPartDesign/project-os.git /tmp/project-os-bootstrap
```

If the clone fails, print:
> "Could not download the template. Check your internet connection and try again.
> (If GitHub is unreachable, you can manually clone the repo and run `scripts/new-project.sh` yourself.)"

Then **stop** — do not proceed.

---

## Step 3 — Bootstrap the project structure

Print: `[3/5] Building your project structure...`

Print: `  - Running setup script...`

Run:
```bash
bash /tmp/project-os-bootstrap/scripts/new-project.sh <project-name> <parent-path>
```

Where `<project-name>` is the name from Step 1 and `<parent-path>` is the parent directory from Step 1.

If the script exits with a non-zero code, capture the error output and print:
> "Something went wrong during setup.
> Error: <captured error message>
>
> Common causes:
> - The target directory already exists
> - You don't have write permission to that location
> - The setup script has a bug (check `/tmp/project-os-bootstrap/scripts/new-project.sh`)"

Then **stop**.

---

## Step 4 — Cleanup

Print: `[4/5] Cleaning up temporary files...`

Run:
```bash
rm -rf /tmp/project-os-bootstrap
```

---

## Step 5 — Open Claude in the new project

Print: `[5/5] Opening your new project in Claude...`

The full project path is: `<parent-path>/<project-name>`

Attempt to open a new terminal window with Claude running in that directory:

```bash
cmd.exe /c "start /D \"<full-project-path>\" cmd /k claude"
```

**Important**: Use the literal backslash path format for `cmd.exe /D` (e.g. `C:\Users\YourName\Projects\my-app`). Convert forward slashes in the project path to backslashes for this command only. The `claude` command is resolved from PATH — no hardcoded binary path.

If the command fails or the environment is not Windows, print this fallback instead:
> "Could not open automatically. To get started:
>   1. Open a new terminal
>   2. Run: `cd "<full-project-path>"`
>   3. Run: `claude`
>   4. Then type: `/tools:init`"

---

## Step 6 — Summary

If the auto-open (Step 5) succeeded, print:

```
Done! Your project "<name>" is ready.

A new Claude window has opened in: <full-project-path>

In that window, type /tools:init to finish setting up your project.
That step will ask you a few questions about your project (stack, language, etc.)
and get everything configured for you.
```

If the auto-open failed (manual fallback was shown instead), print:

```
Done! Your project "<name>" is ready at: <full-project-path>

Follow the steps above to open it in Claude, then type /tools:init to finish setup.
```

---

## Error handling summary

| Situation | Action |
|---|---|
| Invalid project name | Explain why, re-ask |
| CWD name has spaces | Suggest sanitized version as default name |
| User accepts folder rename | cp -r then rm -rf; stop if cp fails before deleting |
| git clone fails | Friendly message, stop |
| new-project.sh fails | Show error, stop |
| cmd.exe unavailable | Print manual instructions |
| Target dir already exists | new-project.sh will catch it; surface its error |
| Target already has `.claude/manifest.json` (Case E adopt refused) | `--adopt` exits refusing to overwrite an existing Project OS project; print the refusal and point the user to `/tools:update` instead; stop |
| Symlink found under a template-managed destination path or ancestor during adopt | `--adopt` hard-fails before writing anything; print the offending path verbatim and stop — do not retry automatically |
| Nested-repo detected during adopt (no local `.git`, resolves inside a parent repo) without `--allow-nested` | Surface the choice per the adopt flow above; re-run with `--allow-nested` only on explicit user "Yes" |
| Git index has staged changes at adopt-commit time | The adopt commit is skipped (never `git add .`); print the CREATED file list and tell the user to review and commit both sets of changes manually |
