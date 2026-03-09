---
description: "Bootstrap a new Project OS project from any Claude session — prompts for name and location, clones template, scaffolds structure, and opens a new Claude session ready for /tools:init"
---

# New Project Bootstrap

You are bootstrapping a brand-new Project OS project. Walk the user through this step-by-step with friendly progress output. Be conversational, not robotic.

## Step 1 — Gather inputs

Print: `[1/5] Gathering project details...`

Ask the user these questions **one at a time** (not all at once):

### Question 1 — Project name

Before asking, detect the current working directory:

```bash
pwd
```

Take the last path segment as the **CWD folder name** (e.g. `My Cool App` from `C:/Users/Jacob/Projects/My Cool App`).

Compute a **suggested name**: replace spaces and underscores with dashes, strip any characters not matching `[a-zA-Z0-9._-]`, collapse multiple dashes to one, strip leading/trailing dashes. Example: `"My Cool App"` → `"My-Cool-App"`.

If the suggested name is valid (matches `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`), ask:
> "What would you like to name your project? Based on your current folder, I'd suggest: `<suggested-name>`
> Press Enter to use it, or type a different name (letters, numbers, dashes, and dots only)."

If the CWD folder name is already valid (no spaces or special chars), still show it as the suggestion — it's the most natural default.

If no suggestion can be derived, ask plainly:
> "What would you like to name your project? (e.g. `my-app`, `cool-tool`)
> This becomes the folder name and project title — letters, numbers, dashes, and dots only."

Validate the final answer: must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`.

If invalid, explain why and ask again. Example: "That name contains spaces — folder names can't have spaces. Try something like `my-project`."

### Question 2 — Parent directory

Ask:
> "Where should the project folder be created? Give me the full path to the **parent** directory.
> For example: `C:/Users/Jacob/Projects` — your new folder will be created inside it."

Do **not** infer or assume a default path. The user must type a path explicitly.

Confirm: "Got it! I'll create `<name>` inside `<path>`. That means your project will be at: `<path>/<name>`"

#### Folder rename offer

After the user provides the parent path, check: does `<parent-path>/<cwd-folder-name>` match the CWD — i.e., is the user working **inside** a folder that has the same parent they just named, but with a different (space-containing) name than the project name?

Specifically: if `<parent-path>/<cwd-folder-name>` == CWD and `<cwd-folder-name>` != `<project-name>`, offer:

> "I noticed your current folder is named `<cwd-folder-name>` — but your project will be named `<project-name>`.
> Would you like me to rename this folder now? I'll copy all current files over and delete the old folder.
> (Y / N)"

- If **Y**: set `RENAME_FOLDER=true`. The old path is CWD, the new path is `<parent-path>/<project-name>`.
- If **N**: proceed normally (create `<project-name>` as a new folder inside `<parent-path>`).

Ask: "Ready to go?"

If yes, continue. If no, re-ask the relevant question.

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
