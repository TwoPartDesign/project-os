// tests/template-seeds.test.ts
// Integrity tests for the templates/ content-seed tier.
//
// These guard the two ways the seed split can silently rot:
//   1. A seed drifts from its live counterpart's FORMAT CONTRACT (frontmatter
//      keys, `## Format` / `## Template` blocks), so appenders like
//      /tools:kv and scripts/skill-ledger.ts break in every new project.
//   2. Framework prose leaks back into a seed — the original bug.
//
// Plus the cross-file invariant that the watched-path list in
// scripts/generate-manifest.sh (SEED_WATCHED) matches RESIDUE_WATCHED in
// scripts/lib/system-map-lib.ts. Those two lists live in different languages
// and cannot import each other, so nothing but a test keeps them in sync.
//
// node:test + node:assert, each test self-contained, real files read from disk.

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RESIDUE_WATCHED } from "../scripts/lib/system-map-lib.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Seed path -> the live framework file whose format contract it must preserve. */
const SEED_PAIRS: ReadonlyArray<{ seed: string; live: string }> = [
  {
    seed: "templates/knowledge/architecture.md",
    live: "docs/knowledge/architecture.md",
  },
  {
    seed: "templates/knowledge/patterns.md",
    live: "docs/knowledge/patterns.md",
  },
  {
    seed: "templates/knowledge/decisions.md",
    live: "docs/knowledge/decisions.md",
  },
  { seed: "templates/knowledge/bugs.md", live: "docs/knowledge/bugs.md" },
  { seed: "templates/knowledge/metrics.md", live: "docs/knowledge/metrics.md" },
  { seed: "templates/knowledge/kv.md", live: "docs/knowledge/kv.md" },
  {
    seed: "templates/knowledge/skill-edit-rejections.md",
    live: "docs/knowledge/skill-edit-rejections.md",
  },
  {
    seed: "templates/rules/preferences.md",
    live: ".claude/rules/preferences.md",
  },
];

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

/** YAML frontmatter keys, in order, or [] when the file has no frontmatter block. */
function frontmatterKeys(content: string): string[] {
  if (!content.startsWith("---\n")) return [];
  const end = content.indexOf("\n---\n", 3);
  if (end === -1) return [];
  const keys: string[] = [];
  for (const line of content.slice(4, end + 1).split("\n")) {
    const m = /^([a-z_]+):/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** `## ` / `### ` heading texts, in order. */
function headings(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    if (line.startsWith("## ") || line.startsWith("### "))
      out.push(line.trim());
  }
  return out;
}

// ==========================================================================
// Seeds exist and are wired
// ==========================================================================

describe("templates/ seed tier", () => {
  it("templateSeeds_everyDeclaredSeed_existsOnDisk", () => {
    for (const { seed } of SEED_PAIRS) {
      ok(existsSync(resolve(ROOT, seed)), `missing seed: ${seed}`);
    }
  });

  it("templateSeeds_everySeedIsReferencedByNewProjectContentFiles", () => {
    // A seed nobody copies is dead weight; a CONTENT_FILES entry pointing at a
    // nonexistent seed hard-fails bootstrap.
    const script = read("scripts/new-project.sh");
    for (const { seed } of SEED_PAIRS) {
      ok(
        script.includes(`"${seed}|`),
        `${seed} is not wired into new-project.sh CONTENT_FILES`,
      );
    }
  });

  it("templateSeeds_knowledgeDirIsTheFrameworkRepoDiscriminator", () => {
    // scripts/system-map.ts treats templates/knowledge/ existing as "this IS
    // Project OS". If the directory is renamed, the framework repo starts
    // reporting residue against itself.
    ok(
      existsSync(resolve(ROOT, "templates", "knowledge")),
      "templates/knowledge/ must exist in the framework repo",
    );
    ok(
      read("scripts/system-map.ts").includes('"templates", "knowledge"'),
      "system-map.ts must probe templates/knowledge/ as the framework-repo discriminator",
    );
  });
});

// ==========================================================================
// Format-contract preservation
// ==========================================================================

describe("seed format contracts", () => {
  it("templateSeeds_frontmatterKeys_matchLiveCounterpartMinusDate", () => {
    // Seeds deliberately omit `date:` — an unfilled placeholder date would
    // corrupt knowledge-index freshness math, and extractDate() falls back to
    // the git first-commit date, which is accurate for a new project.
    for (const { seed, live } of SEED_PAIRS) {
      const liveKeys = frontmatterKeys(read(live)).filter((k) => k !== "date");
      deepStrictEqual(
        frontmatterKeys(read(seed)),
        liveKeys,
        `frontmatter drift between ${seed} and ${live}`,
      );
    }
  });

  it("templateSeeds_seedsNeverCarryADateField", () => {
    for (const { seed } of SEED_PAIRS) {
      ok(
        !frontmatterKeys(read(seed)).includes("date"),
        `${seed} must not pin a date`,
      );
    }
  });

  it("templateSeeds_formatBlockHeadings_survive", () => {
    // The `## Format` / `## Template` / `## Entry Format` headings are the
    // contract the append paths and the human writing entries rely on.
    const required: Record<string, string[]> = {
      "templates/knowledge/patterns.md": ["## Format"],
      "templates/knowledge/decisions.md": ["## Format"],
      "templates/knowledge/bugs.md": ["## Format"],
      "templates/knowledge/metrics.md": [
        "## Template",
        "## Completed Features",
      ],
      "templates/knowledge/skill-edit-rejections.md": ["## Entry Format"],
      "templates/rules/preferences.md": ["## Communication", "## Coding"],
    };
    for (const [seed, needed] of Object.entries(required)) {
      const found = headings(read(seed));
      for (const h of needed) {
        ok(found.includes(h), `${seed} lost its "${h}" heading`);
      }
    }
  });

  it("templateSeeds_metricsTemplateBlock_isByteIdenticalToLive", () => {
    // metrics.md is the one MIXED file: its `## Template` block is a format
    // example that is correct everywhere, while `## Completed Features`
    // entries are this project's own history. The example must not drift.
    const block = (content: string): string => {
      const start = content.indexOf("## Template");
      const end = content.indexOf("## Completed Features");
      ok(
        start !== -1 && end !== -1 && end > start,
        "metrics.md must have Template then Completed Features",
      );
      return content.slice(start, end).trim();
    };
    strictEqual(
      block(read("templates/knowledge/metrics.md")),
      block(read("docs/knowledge/metrics.md")),
    );
  });

  it("templateSeeds_metricsSeed_hasNoCompletedFeatureEntries", () => {
    const seed = read("templates/knowledge/metrics.md");
    const after = seed.slice(seed.indexOf("## Completed Features"));
    ok(
      !after.includes("### Feature:"),
      "the metrics seed must ship zero completed-feature entries",
    );
  });

  it("templateSeeds_skillEditRejectionsSeed_hasNoEntries", () => {
    // skill-ledger.ts greps for `## <date> — <fingerprint>` headings below the
    // `---` separator; a seeded entry would be read as a real rejection.
    const seed = read("templates/knowledge/skill-edit-rejections.md");
    const after = seed.slice(seed.indexOf("## Hardening"));
    ok(
      !/^## \d{4}-\d{2}-\d{2}/m.test(after),
      "the skill-edit-rejections seed must ship zero dated rejection entries",
    );
  });
});

// ==========================================================================
// No framework prose — the original bug
// ==========================================================================

describe("seed content provenance", () => {
  it("templateSeeds_noSeedMentionsThisFrameworkAsItsOwnSubject", () => {
    // Seeds may reference Project OS mechanisms in an HTML comment aimed at
    // the reader (e.g. "CLAUDE.md @imports this file"), but must never assert
    // framework facts as the PROJECT's facts in body prose. Proxy check: no
    // body line outside comments names the framework or its internals.
    const banned = [
      "Project OS",
      "hook chain",
      "ROADMAP↔Tasks",
      "maintain.sh",
      "skill-apply",
    ];
    // skill-edit-rejections.md is exempt BY CLASSIFICATION, not by convenience:
    // it is not project content at all, it is the format contract + sole-writer
    // rule for a framework mechanism (scripts/skill-ledger.ts) that ships
    // unchanged to every project. Naming skill-apply.ts there is correct in any
    // repo — same reasoning as the framework reference docs
    // (roadmap-format.md, windows-bash-scanner.md). See the brief's
    // enumeration table, which classifies this file "Fine".
    const contractOnlySeeds = new Set([
      "templates/knowledge/skill-edit-rejections.md",
    ]);
    for (const { seed } of SEED_PAIRS) {
      if (contractOnlySeeds.has(seed)) continue;
      const body = read(seed).replace(/<!--[\s\S]*?-->/g, "");
      for (const phrase of banned) {
        ok(
          !body.includes(phrase),
          `${seed} body prose mentions "${phrase}" — framework content leaking into a seed`,
        );
      }
    }
  });

  it("templateSeeds_architectureSeed_assertsNoArchitecture", () => {
    const seed = read("templates/knowledge/architecture.md");
    ok(
      seed.includes("_Not documented yet._"),
      "the architecture seed must state that nothing is documented yet",
    );
    ok(
      !/^\|\s*(Workflow|Hooks|Scripts)\b/m.test(seed),
      "the architecture seed must ship no populated module rows",
    );
  });

  it("templateSeeds_preferencesSeed_usesPlaceholdersNotThisProjectsStack", () => {
    const seed = read("templates/rules/preferences.md");
    for (const token of ["[PRIMARY_STACK]", "[FORMATTER]", "[TEST_RUNNER]"]) {
      ok(
        seed.includes(token),
        `the preferences seed must carry ${token} so /tools:init fills it`,
      );
    }
    ok(
      !seed.includes("node --test"),
      "the preferences seed must not name this project's test runner",
    );
    ok(
      !seed.includes("Bash + TypeScript"),
      "the preferences seed must not name this project's stack",
    );
  });

  it("templateSeeds_everySeedIsSmall", () => {
    // A seed that grows past a few hundred bytes of prose is drifting back
    // toward being content rather than scaffold.
    for (const { seed } of SEED_PAIRS) {
      const bytes = read(seed).length;
      ok(
        bytes < 2000,
        `${seed} is ${bytes} bytes — seeds must stay near-empty scaffold`,
      );
    }
  });
});

// ==========================================================================
// Cross-file watched-path invariant
// ==========================================================================

describe("watched-path list sync", () => {
  it("watchedPaths_generateManifestSeedWatched_matchesResidueWatched", () => {
    // SEED_WATCHED (bash) writes the baselines that RESIDUE_WATCHED (TS)
    // reads. A path in one but not the other means either an unhashed watched
    // file (detector silently skips it) or an orphan manifest entry.
    const script = read("scripts/generate-manifest.sh");
    const block = script.slice(
      script.indexOf("SEED_WATCHED=("),
      script.indexOf(")", script.indexOf("SEED_WATCHED=(")),
    );
    const bashPaths = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    deepStrictEqual(
      bashPaths.slice().sort(),
      RESIDUE_WATCHED.map((w) => w.path)
        .slice()
        .sort(),
      "generate-manifest.sh SEED_WATCHED and system-map-lib.ts RESIDUE_WATCHED have diverged",
    );
  });

  it("watchedPaths_everyWatchedPathIsSeededByNewProject", () => {
    // A watched path with no CONTENT_FILES entry can never be residue,
    // because nothing ever seeded it.
    const script = read("scripts/new-project.sh");
    for (const w of RESIDUE_WATCHED) {
      ok(
        script.includes(`|${w.path}"`),
        `${w.path} is watched for residue but never seeded by new-project.sh`,
      );
    }
  });

  it("watchedPaths_everyWatchedPathIsExcludedFromUpdates", () => {
    // update-project.sh must never offer a seed as a template update.
    const script = read("scripts/update-project.sh");
    const block = script.slice(
      script.indexOf("SEED_EXCLUDE=("),
      script.indexOf(")", script.indexOf("SEED_EXCLUDE=(")),
    );
    for (const w of RESIDUE_WATCHED) {
      ok(
        block.includes(`"${w.path}"`),
        `${w.path} is a seed but is not in update-project.sh SEED_EXCLUDE`,
      );
    }
  });

  it("watchedPaths_noWatchedPathRemainsInUpdateTemplateFiles", () => {
    const script = read("scripts/update-project.sh");
    const start = script.indexOf("TEMPLATE_FILES=(");
    const block = script.slice(start, script.indexOf(")", start));
    for (const w of RESIDUE_WATCHED) {
      ok(
        !block.includes(w.path),
        `${w.path} is still listed in update-project.sh TEMPLATE_FILES`,
      );
    }
  });

  it("watchedPaths_frameworkReferenceDocsAreShippedButNotWatched", () => {
    // These describe the FRAMEWORK's own contracts, identical in every
    // project, so staying byte-identical to the template is the expected
    // steady state — watching them would produce a permanent false positive.
    const referenceDocs = [
      "docs/knowledge/roadmap-format.md",
      "docs/knowledge/windows-bash-scanner.md",
      "docs/knowledge/design-principles.md",
      "docs/proposals/pre-tool-approve-hook.md",
    ];
    const script = read("scripts/new-project.sh");
    const watched = new Set(RESIDUE_WATCHED.map((w) => w.path));
    for (const doc of referenceDocs) {
      ok(
        script.includes(`|${doc}"`),
        `${doc} is referenced by shipped files but not copied to new projects`,
      );
      ok(
        !watched.has(doc),
        `${doc} is a framework reference doc and must not be watched for residue`,
      );
      ok(
        existsSync(resolve(ROOT, doc)),
        `${doc} does not exist, so bootstrap would hard-fail`,
      );
    }
  });
});

// ==========================================================================
// Dangling-reference closure for a scaffolded project
// ==========================================================================

describe("shipped-file reference closure", () => {
  it("referenceClosure_docsKnowledgePathsNamedByShippedFiles_areAllSeededOrCopied", () => {
    // Every docs/knowledge/*.md and docs/proposals/*.md path mentioned by a
    // file that ships to new projects must itself ship, or a fresh clone has
    // a dangling reference. This is the check that would have caught
    // ROADMAP.md -> roadmap-format.md and bash.md -> windows-bash-scanner.md.
    const shipped = [
      "ROADMAP.template.md",
      "CLAUDE.template.md",
      ...readdirSync(resolve(ROOT, ".claude/rules")).map(
        (f) => `.claude/rules/${f}`,
      ),
    ];
    const newProject = read("scripts/new-project.sh");
    const referenced = new Set<string>();
    for (const rel of shipped) {
      if (!existsSync(resolve(ROOT, rel))) continue;
      for (const m of read(rel).matchAll(
        /(docs\/(?:knowledge|proposals)\/[A-Za-z0-9._-]+\.md)/g,
      )) {
        referenced.add(m[1]);
      }
    }
    ok(
      referenced.size > 0,
      "expected to find at least one docs/ reference in the shipped files",
    );
    for (const ref of referenced) {
      ok(
        newProject.includes(`|${ref}"`),
        `${ref} is referenced by a shipped file but new-project.sh never copies it — dangling ref in every clone`,
      );
    }
  });
});
