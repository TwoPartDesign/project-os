// tests/shipped-settings.test.ts
// .claude/settings.json is copied VERBATIM into every project (it is a
// FRAMEWORK_FILES entry in scripts/new-project.sh), so this repo's own
// development conveniences leak into every clone unless something checks.
//
// This is the same defect class as the docs/knowledge content leak, one tier
// up: not prose about the framework, but *permissions* for paths only the
// framework has. Two had drifted in — `Bash(bash tests/*)` and
// `Bash(bash scripts/new-project.sh*)` — neither of which exists in a clone.
//
// Framework-only permissions belong in .claude/settings.local.json, which is
// gitignored and therefore never ships.

import { describe, it } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const settings = JSON.parse(
  readFileSync(resolve(ROOT, ".claude/settings.json"), "utf-8"),
) as { permissions?: { allow?: string[]; ask?: string[] } };
const ALLOW = settings.permissions?.allow ?? [];
const ASK = settings.permissions?.ask ?? [];

const newProjectSrc = readFileSync(
  resolve(ROOT, "scripts/new-project.sh"),
  "utf-8",
);

/** Paths new-project.sh actually copies, per its own file lists. */
function isShippedPath(path: string): boolean {
  // scripts/lib/** and the .claude trees are copied wholesale.
  if (path.startsWith("scripts/lib/")) return true;
  if (path.startsWith(".claude/hooks/")) return true;
  if (path.startsWith(".claude/security/")) return true;
  return newProjectSrc.includes(`"${path}"`);
}

describe("shipped settings.json carries no framework-only permissions", () => {
  it("shippedSettings_everyScriptPermission_namesAFileCloneesReceive", () => {
    // Extract the `scripts/foo.sh` / `scripts/foo.ts` out of each Bash(...) entry.
    const orphans: string[] = [];
    for (const entry of ALLOW) {
      const m = /(?:bash|node) (scripts\/[A-Za-z0-9._-]+\.(?:sh|ts))/.exec(
        entry,
      );
      if (!m) continue;
      if (!isShippedPath(m[1]))
        orphans.push(`${entry}  ->  ${m[1]} is never copied`);
    }
    strictEqual(
      orphans.length,
      0,
      `settings.json pre-approves scripts a clone never receives:\n  ${orphans.join("\n  ")}\n` +
        `Move these to .claude/settings.local.json (gitignored) instead.`,
    );
  });

  it("shippedSettings_hasNoBlanketTestsDirectoryGrant", () => {
    // `Bash(bash tests/*)` is a blanket exec grant over a directory the
    // scaffold does not even create, and it contradicts the restrictive-allow
    // posture adopted in the 2026-07-12 ADR.
    ok(
      !ALLOW.includes("Bash(bash tests/*)"),
      "Bash(bash tests/*) is a framework-only blanket grant; keep it in settings.local.json",
    );
  });

  it("shippedSettings_noCompoundCdAllowRules", () => {
    // #T239: `(cd * && *)` / `(cd * ; *)` approve nothing in default mode
    // (probe-verified), so they are dead rules and mislead the reader.
    deepStrictEqual(
      ALLOW.filter(
        (e) => e === "Bash((cd * && *))" || e === "Bash((cd * ; *))",
      ),
      [],
    );
  });

  it("shippedSettings_hookOnlyScripts_haveNoAllowEntry", () => {
    // #T238: hook commands bypass permissions, so only hook scripts that a
    // command or doc also runs by hand keep an allow entry.
    const manual = [
      "Bash(bash .claude/hooks/notify-phase-change.sh*)",
      "Bash(bash .claude/hooks/log-activity.sh*)",
    ];
    deepStrictEqual(
      ALLOW.filter((e) => e.includes(".claude/hooks/")),
      manual,
    );
  });

  it("shippedSettings_crossProjectUpdaterApply_asksInBothFlagOrders", () => {
    // #T265: `Bash(bash scripts/update-project.sh*)` is pre-approved, and with
    // --project that prefix would cover writing into another project. An ask
    // rule outranks an allow rule, so --project with --apply always prompts.
    const required = [
      "Bash(bash scripts/update-project.sh*--project*--apply*)",
      "Bash(bash scripts/update-project.sh*--apply*--project*)",
    ];
    deepStrictEqual(
      required.filter((rule) => !ASK.includes(rule)),
      [],
      "settings.json must ask before a cross-project updater apply, in both flag orders",
    );
    // The allow entry stays: a dry run writes nothing and remains pre-approved.
    ok(
      ALLOW.includes("Bash(bash scripts/update-project.sh*)"),
      "the updater's allow entry must stay so dry runs remain pre-approved",
    );
  });

  it("shippedSettings_localOverrideStaysGitignored", () => {
    // The escape hatch only works if it never ships. If this file stops being
    // ignored, framework-only permissions start leaking again by another route.
    const gitignore = readFileSync(resolve(ROOT, ".gitignore"), "utf-8");
    ok(
      gitignore.includes(".claude/settings.local.json"),
      ".claude/settings.local.json must stay gitignored so local overrides never ship",
    );
    // And new-project.sh must not COPY it. Check the copy lists specifically:
    // the bare string also appears in new-project.sh's embedded .gitignore
    // template (which is exactly where it SHOULD appear), so a plain
    // `includes` match fails against the file's own correct behaviour.
    // NOTE `[^"\n]` not `[^"]`: a negated class still matches newlines, so the
    // first version spanned from an unrelated quote several lines away and
    // reported a copy-list entry that does not exist.
    const copyListed = /"[^"\n]*settings\.local\.json[^"\n]*"/.test(
      newProjectSrc,
    );
    ok(
      !copyListed,
      "new-project.sh must never list settings.local.json in FRAMEWORK_FILES or CONTENT_FILES",
    );
    ok(
      /^\.claude\/settings\.local\.json$/m.test(newProjectSrc),
      "new-project.sh's .gitignore template should still ignore settings.local.json in new projects",
    );
  });

  it("shippedSettings_frameworkStillHasItsOwnOverrideDocumented", () => {
    // Not a hard requirement (the file is gitignored, so a fresh clone of the
    // framework will not have it) -- but if it exists here it must be valid
    // JSON, otherwise Claude Code silently ignores the whole file.
    const local = resolve(ROOT, ".claude/settings.local.json");
    if (!existsSync(local)) return;
    const parsed = JSON.parse(readFileSync(local, "utf-8")) as {
      permissions?: { allow?: string[] };
    };
    ok(
      Array.isArray(parsed.permissions?.allow),
      "settings.local.json must contain permissions.allow if it exists",
    );
  });
});
