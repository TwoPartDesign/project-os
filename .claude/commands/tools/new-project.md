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

1. **Is CWD an existing Project OS project?** Check if `CLAUDE.md` exists in CWD.
2. **Is CWD a projects parent directory?** Check if CWD contains subdirectories that have `.git/` or `CLAUDE.md` inside them (i.e., it holds multiple projects). Also match if the folder name contains "Projects" or "repos" (case-insensitive).
3. **Is CWD an empty or near-empty folder?** (no `.git/`, no `CLAUDE.md`, few or no files)

Use these results to classify CWD into one of four cases:

#### Case A — CWD is a projects parent directory

The user is already where projects live. Use CWD as the parent path — don't ask for it.

Print:
> "Looks like you're in a projects folder (`<cwd-path>`). I'll create the new project here."

Jump straight to **Question 1 — Project name** (skip Question 2).

#### Case B — CWD is an existing Project OS project

The user is inside a project already. They probably want to create a sibling.

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

#### Case D — Unknown / none of the above

No assumptions. Ask both questions.

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
