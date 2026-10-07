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

/** The ask rules update-project.sh itself requires before a cross-project apply (#T271). */
const UPDATER_REQUIRED_ASK_RULES = [
  "Bash(*update-project.sh*--project*--apply*)",
  "Bash(*update-project.sh*--apply*--project*)",
];

const newProjectSrc = readFileSync(
  resolve(ROOT, "scripts/new-project.sh"),
  "utf-8",
);

/**
 * Models the documented Bash-rule matching (Claude Code permissions docs, read
 * 2026-10-07): a `*` stands in for any text, and a trailing " *" also matches
 * the bare command only when it is the rule's sole wildcard.
 */
function ruleMatches(rule: string, command: string): boolean {
  const pattern = rule.slice("Bash(".length, -1);
  const body = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  if (new RegExp(`^${body}$`, "s").test(command)) return true;
  const soleTrailingWildcard =
    pattern.endsWith(" *") && pattern.indexOf("*") === pattern.length - 1;
  return soleTrailingWildcard && command === pattern.slice(0, -2);
}

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
    // #T265, design D6: `Bash(bash scripts/update-project.sh*)` is pre-approved,
    // and with --project that prefix would cover writing into another project.
    // An ask rule outranks an allow rule, so --project with --apply prompts.
    // #T271 (D6 amendment): the unanchored pair covers other spellings of the
    // script path.
    const required = [
      "Bash(bash scripts/update-project.sh*--project*--apply*)",
      "Bash(bash scripts/update-project.sh*--apply*--project*)",
      ...UPDATER_REQUIRED_ASK_RULES,
    ];
    deepStrictEqual(
      required.filter((rule) => !ASK.includes(rule)),
      [],
      "settings.json must ask before a cross-project updater apply, in both flag orders (design D6)",
    );
    // The allow entry stays: a dry run writes nothing and remains pre-approved.
    ok(
      ALLOW.includes("Bash(bash scripts/update-project.sh*)"),
      "the updater's allow entry must stay so dry runs remain pre-approved",
    );
  });

  it("shippedSettings_updaterRequiredAskRules_namedByTheUpdater", () => {
    // #T271: update-project.sh refuses --project with --apply unless this
    // checkout's settings hold these two rules as written. The guard and the
    // script ship in different files, so pin that they name the same strings.
    // Only code lines count: a rule named in a comment requires nothing.
    const codeLines = readFileSync(
      resolve(ROOT, "scripts/update-project.sh"),
      "utf-8",
    )
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"));
    const named = new Set(
      codeLines.flatMap(
        (line) => line.match(/Bash\(\*update-project\.sh[^)"']*\)/g) ?? [],
      ),
    );
    deepStrictEqual(
      [...named].sort(),
      [...UPDATER_REQUIRED_ASK_RULES].sort(),
      "update-project.sh must require exactly the ask rules that settings.json ships",
    );
  });

  it("shippedSettings_syncHooksWithTarget_asks", () => {
    // #T271: `Bash(bash scripts/sync-hooks.sh*)` is pre-approved, and with a
    // target argument the script writes hooks and settings wiring into another
    // project. The rule has more than one wildcard, so its trailing " *" needs
    // a real argument: a sync of this checkout (no target) stays pre-approved.
    deepStrictEqual(
      ["Bash(bash *sync-hooks.sh* *)"].filter((rule) => !ASK.includes(rule)),
      [],
      "settings.json must ask before sync-hooks.sh runs with a target",
    );
    ok(
      ALLOW.includes("Bash(bash scripts/sync-hooks.sh*)"),
      "the sync-hooks allow entry must stay so a sync of this checkout remains pre-approved",
    );
  });

  it("shippedSettings_askRules_promptOnCrossProjectWritesOnly", () => {
    // ruleMatches models the documented matching, not the permission engine.
    // The table pins what the rules are meant to catch and what they must
    // leave alone: an ask rule outranks allow, so a stray match stalls a
    // sub-agent on an ordinary git command.
    const asks = (command: string) =>
      ASK.some((rule) => ruleMatches(rule, command));
    const cases: Array<[string, boolean]> = [
      ["bash scripts/update-project.sh --project ../x --apply", true],
      ["bash scripts/update-project.sh --apply --major --project ../x", true],
      ['bash ./scripts/update-project.sh --project "../x" --apply', true],
      [
        'bash "C:/a b/scripts/update-project.sh" --local-upstream up --project x --apply',
        true,
      ],
      ["bash scripts/update-project.sh --project ../x", false],
      ["bash scripts/update-project.sh --apply", false],
      ['bash scripts/sync-hooks.sh "../x"', true],
      ["bash ./scripts/sync-hooks.sh ../x", true],
      ["bash scripts/sync-hooks.sh", false],
      ["git add scripts/sync-hooks.sh tests/hook-smoke.sh", false],
      ["git diff -- scripts/sync-hooks.sh .claude/settings.json", false],
    ];
    deepStrictEqual(
      cases
        .filter(([command, expected]) => asks(command) !== expected)
        .map(([command]) => command),
      [],
      "each listed command must prompt, or stay quiet, as its row says",
    );
    deepStrictEqual(
      ASK.filter((rule) => ALLOW.includes(rule)),
      [],
      "an ask rule must not also be an allow rule",
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
