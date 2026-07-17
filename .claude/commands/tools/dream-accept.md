---
description: "Accept a staged /tools:dream consolidation proposal and swap it into docs/memory"
---

# Dream Accept

Promotes a staged `/tools:dream` output into `docs/memory/`, after you've reviewed
`diff.md` and are satisfied with the proposed changes. This is the only command that
writes to `docs/memory/*.md` as part of the dream workflow — `/tools:dream` itself is
strictly read-only against that directory.

## Usage
`/tools:dream-accept <timestamp>`

`<timestamp>` must match the staging directory created by `/tools:dream`, e.g.
`2026-07-16-1530`.

## Step 1: Validate the argument

If no timestamp argument was given:
> "Usage: `/tools:dream-accept <timestamp>`. Run `/tools:dream` first if you don't have a staged proposal, or check `docs/memory/.dream-output/` for available timestamps."

Stop here if the argument is missing. Otherwise pass it through unmodified — the
underlying script re-validates the format itself and will reject anything malformed.

## Step 2: Run the accept script

Run:

```
bash scripts/dream-accept.sh <timestamp>
```

This one command does everything: recovers any interrupted prior swap, validates the
timestamp format, backs up the current `docs/memory/*.md` to
`docs/memory/.archive/<timestamp>/`, copies the staged files into `docs/memory/`,
rebuilds the knowledge index, and removes the staging directory.

## Step 3: Report

Relay the script's own output verbatim to the user — it already reports what was
archived, what was applied, and whether the index rebuild succeeded. If the script
exited non-zero, surface the error message and stop; do not attempt to work around a
failure by manually copying files.
