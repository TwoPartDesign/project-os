// tests/template-residue.test.ts
// Unit tests for the template-residue detector in scripts/lib/system-map-lib.ts
// (RESIDUE_WATCHED, INIT_PLACEHOLDER_TOKENS, unfilledPlaceholders,
// hasUnfilledPlaceholders, findInitIncomplete, findTemplateResidue).
//
// Pattern follows tests/system-map.test.ts: node:test + node:assert, one
// describe block per exported function, each test fully self-contained with
// explicit setup (no shared mutable state, no beforeEach).
//
// Security-guard coverage per .claude/rules/tests.md: the containment tests
// cover in-bounds indirection (a manifest key naming an in-scope sibling, and
// prefix-collision paths), not only the obvious ../.. escape.

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  RESIDUE_WATCHED,
  INIT_PLACEHOLDER_TOKENS,
  unfilledPlaceholders,
  hasUnfilledPlaceholders,
  findInitIncomplete,
  findTemplateResidue,
} from "../scripts/lib/system-map-lib.ts";

const SEED_A = "a".repeat(64);
const SEED_B = "b".repeat(64);
const LOCAL_C = "c".repeat(64);

/** A manifest with only a seed_hashes block. */
function seedManifest(entries: Record<string, string>): string {
  return JSON.stringify({ seed_hashes: entries, files: {} });
}

// ==========================================================================
// RESIDUE_WATCHED — the severity contract maintain.sh depends on
// ==========================================================================

describe("RESIDUE_WATCHED", () => {
  it("residueWatched_importedAndAlwaysLoadedFiles_areHigh", () => {
    // maintain.sh:381 only files a [?] draft for HIGH findings. If any of
    // these three drops to MEDIUM the detector becomes report-only for the
    // files that reach the model on every single turn.
    const high = RESIDUE_WATCHED.filter((w) => w.severity === "HIGH").map(
      (w) => w.path,
    );
    deepStrictEqual(high.slice().sort(), [
      ".claude/rules/preferences.md",
      "docs/knowledge/architecture.md",
      "docs/knowledge/patterns.md",
    ]);
  });

  it("residueWatched_remainingFiles_areMedium", () => {
    const medium = RESIDUE_WATCHED.filter((w) => w.severity === "MEDIUM").map(
      (w) => w.path,
    );
    deepStrictEqual(medium.slice().sort(), [
      "docs/knowledge/bugs.md",
      "docs/knowledge/decisions.md",
      "docs/knowledge/metrics.md",
    ]);
  });

  it("residueWatched_everyEntry_hasNonEmptyReason", () => {
    for (const w of RESIDUE_WATCHED) {
      ok(
        w.reason.length > 0,
        `${w.path} has an empty reason, which would produce a bare detail string`,
      );
    }
  });
});

// ==========================================================================
// unfilledPlaceholders / hasUnfilledPlaceholders
// ==========================================================================

describe("hasUnfilledPlaceholders", () => {
  it("hasUnfilledPlaceholders_claudeMdWithProjectNameToken_returnsTrue", () => {
    strictEqual(
      hasUnfilledPlaceholders("# Constitution\n- Project: [PROJECT_NAME]\n"),
      true,
    );
  });

  it("unfilledPlaceholders_scaffoldedClaudeMd_returnsThreeRemainingTokens", () => {
    // new-project.sh:924 substitutes only [PROJECT_NAME]; the other three
    // survive until /tools:init runs.
    const scaffolded =
      "- Project: RhythmTest\n- Role: [YOUR_ROLE]\n- Owner: [YOUR_NAME]\n- Stack: [PRIMARY_STACK]\n";
    deepStrictEqual(unfilledPlaceholders(scaffolded), [
      "[YOUR_ROLE]",
      "[YOUR_NAME]",
      "[PRIMARY_STACK]",
    ]);
  });

  it("hasUnfilledPlaceholders_claudeMdWithMarkdownCheckboxes_returnsFalse", () => {
    strictEqual(hasUnfilledPlaceholders("- [ ] todo\n- [x] done\n"), false);
  });

  it("hasUnfilledPlaceholders_claudeMdWithWikilinks_returnsFalse", () => {
    strictEqual(
      hasUnfilledPlaceholders("See [[decisions]] and [[patterns]].\n"),
      false,
    );
  });

  it("hasUnfilledPlaceholders_claudeMdWithUnrelatedAllCapsBrackets_returnsFalse", () => {
    // The dangerous direction: a false positive here classifies an
    // initialized project as un-initialized and SUPPRESSES every residue
    // finding. A fixed token list cannot be tripped by the user's own prose.
    strictEqual(
      hasUnfilledPlaceholders(
        "Ship [MVP] first. [TODO] revisit [WIP] items. See [T1].\n",
      ),
      false,
    );
  });

  it("hasUnfilledPlaceholders_claudeMdAbsent_returnsFalse", () => {
    strictEqual(hasUnfilledPlaceholders(null), false);
  });

  it("initPlaceholderTokens_matchesClaudeTemplateTokenSet", () => {
    deepStrictEqual(INIT_PLACEHOLDER_TOKENS.slice().sort(), [
      "[PRIMARY_STACK]",
      "[PROJECT_NAME]",
      "[YOUR_NAME]",
      "[YOUR_ROLE]",
    ]);
  });
});

// ==========================================================================
// findInitIncomplete
// ==========================================================================

describe("findInitIncomplete", () => {
  it("findInitIncomplete_placeholdersPresent_emitsSingleMediumFinding", () => {
    const findings = findInitIncomplete(
      "- Owner: [YOUR_NAME]\n- Stack: [PRIMARY_STACK]\n",
    );
    strictEqual(findings.length, 1);
    strictEqual(findings[0].severity, "MEDIUM");
    strictEqual(findings[0].kind, "init-incomplete");
    strictEqual(findings[0].subject, "CLAUDE.md");
  });

  it("findInitIncomplete_placeholdersPresent_detailNamesEachUnfilledToken", () => {
    const detail = findInitIncomplete(
      "- Owner: [YOUR_NAME]\n- Stack: [PRIMARY_STACK]\n",
    )[0].detail;
    ok(
      detail.includes("[YOUR_NAME]"),
      `detail must name the unfilled token, got: ${detail}`,
    );
    ok(
      detail.includes("[PRIMARY_STACK]"),
      `detail must name the unfilled token, got: ${detail}`,
    );
    ok(
      detail.includes("2 unfilled"),
      `detail must state the count, got: ${detail}`,
    );
    ok(
      detail.includes("/tools:init"),
      `detail must name the remedy command, got: ${detail}`,
    );
  });

  it("findInitIncomplete_noPlaceholders_returnsEmpty", () => {
    deepStrictEqual(findInitIncomplete("- Owner: Jacob Nickel\n"), []);
  });

  it("findInitIncomplete_claudeMdAbsent_returnsEmpty", () => {
    deepStrictEqual(findInitIncomplete(null), []);
  });
});

// ==========================================================================
// findTemplateResidue — detection
// ==========================================================================

describe("findTemplateResidue", () => {
  it("findTemplateResidue_hashMatchesSeed_flagsHighForImportedFile", () => {
    const findings = findTemplateResidue({
      manifestJsonText: seedManifest({
        "docs/knowledge/architecture.md": SEED_A,
      }),
      readHash: (p) => (p === "docs/knowledge/architecture.md" ? SEED_A : null),
      isFrameworkRepo: false,
    });
    strictEqual(findings.length, 1);
    strictEqual(findings[0].severity, "HIGH");
    strictEqual(findings[0].kind, "unlocalized-template-content");
    strictEqual(findings[0].subject, "docs/knowledge/architecture.md");
  });

  it("findTemplateResidue_hashMatchesSeed_detailNamesPathAndRemedy", () => {
    const detail = findTemplateResidue({
      manifestJsonText: seedManifest({ "docs/knowledge/decisions.md": SEED_A }),
      readHash: () => SEED_A,
      isFrameworkRepo: false,
    })[0].detail;
    ok(
      detail.includes("docs/knowledge/decisions.md"),
      `detail must name the path, got: ${detail}`,
    );
    ok(
      detail.includes("byte-identical"),
      `detail must state the evidence, got: ${detail}`,
    );
    ok(
      detail.includes("Replace it with this project's own content."),
      `detail must state the remedy, got: ${detail}`,
    );
  });

  it("findTemplateResidue_hashDiffersFromSeed_returnsEmpty", () => {
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: seedManifest({
          "docs/knowledge/architecture.md": SEED_A,
        }),
        readHash: () => LOCAL_C,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_allSixWatchedPathsUnlocalized_flagsAllSix", () => {
    const entries: Record<string, string> = {};
    for (const w of RESIDUE_WATCHED) entries[w.path] = SEED_A;
    const findings = findTemplateResidue({
      manifestJsonText: seedManifest(entries),
      readHash: () => SEED_A,
      isFrameworkRepo: false,
    });
    strictEqual(findings.length, 6);
    strictEqual(findings.filter((f) => f.severity === "HIGH").length, 3);
  });

  it("findTemplateResidue_isFrameworkRepo_returnsEmpty", () => {
    // Project OS's own docs/knowledge/ legitimately holds framework content.
    const entries: Record<string, string> = {};
    for (const w of RESIDUE_WATCHED) entries[w.path] = SEED_A;
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: seedManifest(entries),
        readHash: () => SEED_A,
        isFrameworkRepo: true,
      }),
      [],
    );
  });
});

// ==========================================================================
// findTemplateResidue — baseline resolution
// ==========================================================================

describe("findTemplateResidue baseline resolution", () => {
  it("findTemplateResidue_noSeedHashesButFilesEntryPresent_usesFilesFallback", () => {
    // Pre-seed_hashes clone that has not yet run /tools:update.
    const manifest = JSON.stringify({
      files: { "docs/knowledge/patterns.md": SEED_B },
    });
    const findings = findTemplateResidue({
      manifestJsonText: manifest,
      readHash: () => SEED_B,
      isFrameworkRepo: false,
    });
    strictEqual(findings.length, 1);
    strictEqual(findings[0].subject, "docs/knowledge/patterns.md");
  });

  it("findTemplateResidue_seedHashesPresent_takesPrecedenceOverFilesEntry", () => {
    // files[] holds the post-update local hash; seed_hashes holds the truth.
    // Matching files[] must NOT produce a finding.
    const manifest = JSON.stringify({
      seed_hashes: { "docs/knowledge/patterns.md": SEED_A },
      files: { "docs/knowledge/patterns.md": LOCAL_C },
    });
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: manifest,
        readHash: () => LOCAL_C,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_noBaselineForPath_skipsThatPathWithoutFinding", () => {
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: JSON.stringify({ seed_hashes: {}, files: {} }),
        readHash: () => SEED_A,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_baselineNotASha256_skipsThatPath", () => {
    // A hand-edited or truncated value must never be trusted as a baseline.
    for (const bogus of [
      "",
      "not-a-hash",
      SEED_A.toUpperCase(),
      SEED_A.slice(0, 63),
      `${SEED_A}0`,
    ]) {
      deepStrictEqual(
        findTemplateResidue({
          manifestJsonText: seedManifest({
            "docs/knowledge/architecture.md": bogus,
          }),
          readHash: () => bogus,
          isFrameworkRepo: false,
        }),
        [],
        `value ${JSON.stringify(bogus)} must not be accepted as a baseline`,
      );
    }
  });

  it("findTemplateResidue_missingFile_returnsEmptyForThatPath", () => {
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: seedManifest({
          "docs/knowledge/architecture.md": SEED_A,
        }),
        readHash: () => null,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_manifestAbsent_returnsEmpty", () => {
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: null,
        readHash: () => SEED_A,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_manifestUnparseable_returnsEmptyAndDoesNotThrow", () => {
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: '{"seed_hashes": {',
        readHash: () => SEED_A,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_seedHashesNotAnObject_returnsEmptyAndDoesNotThrow", () => {
    for (const shape of [
      '{"seed_hashes": null}',
      '{"seed_hashes": "x"}',
      '{"seed_hashes": []}',
      "null",
      "42",
    ]) {
      deepStrictEqual(
        findTemplateResidue({
          manifestJsonText: shape,
          readHash: () => SEED_A,
          isFrameworkRepo: false,
        }),
        [],
        `manifest shape ${shape} must be tolerated`,
      );
    }
  });
});

// ==========================================================================
// findTemplateResidue — containment
//
// The detector reads paths from a JSON file on disk. It must look manifest
// entries UP against the fixed RESIDUE_WATCHED list, never iterate manifest
// keys and read whatever they name.
// ==========================================================================

describe("findTemplateResidue containment", () => {
  it("findTemplateResidue_manifestContainsTraversalKeys_readsOnlyWatchedPaths", () => {
    const manifest = seedManifest({
      "../../.ssh/id_rsa": SEED_A,
      "docs/knowledge/../../../etc/passwd": SEED_A,
      "/etc/shadow": SEED_A,
      "docs/knowledge/architecture.md": SEED_A,
    });
    const probed: string[] = [];
    findTemplateResidue({
      manifestJsonText: manifest,
      readHash: (p) => {
        probed.push(p);
        return SEED_A;
      },
      isFrameworkRepo: false,
    });
    // Only architecture.md has a baseline here, so it is the only path the
    // detector has any reason to read. The contract under test is the
    // negative one: nothing the manifest NAMES may ever be probed.
    const watched = new Set(RESIDUE_WATCHED.map((w) => w.path));
    deepStrictEqual(probed, ["docs/knowledge/architecture.md"]);
    for (const p of probed) {
      ok(watched.has(p), `probed ${p}, which is not in RESIDUE_WATCHED`);
    }
    for (const injected of [
      "../../.ssh/id_rsa",
      "docs/knowledge/../../../etc/passwd",
      "/etc/shadow",
    ]) {
      ok(
        !probed.includes(injected),
        `manifest-supplied key ${injected} must never be probed`,
      );
    }
  });

  it("findTemplateResidue_manifestNamesInScopeSibling_doesNotWidenTheProbeSet", () => {
    // In-bounds indirection: the extra key points at a REAL, in-scope file
    // (a sibling under docs/knowledge/) rather than an obvious escape. It
    // must still be ignored — being in-scope is not the same as being watched.
    const manifest = seedManifest({
      "docs/knowledge/design-principles.md": SEED_A,
      "docs/knowledge/roadmap-format.md": SEED_A,
      ".claude/rules/bash.md": SEED_A,
    });
    const probed: string[] = [];
    const findings = findTemplateResidue({
      manifestJsonText: manifest,
      readHash: (p) => {
        probed.push(p);
        return SEED_A;
      },
      isFrameworkRepo: false,
    });
    deepStrictEqual(
      findings,
      [],
      "unwatched in-scope siblings must never produce findings",
    );
    ok(
      !probed.includes("docs/knowledge/design-principles.md"),
      "must not probe an unwatched sibling",
    );
    ok(
      !probed.includes(".claude/rules/bash.md"),
      "must not probe an unwatched rules file",
    );
  });

  it("findTemplateResidue_prefixCollisionPaths_notWatched", () => {
    // `docs/knowledge/architecture.md.bak` and `...md2` share a prefix with a
    // watched path. A startsWith-style match would flag them; exact-key
    // lookup must not.
    const manifest = seedManifest({
      "docs/knowledge/architecture.md.bak": SEED_A,
      "docs/knowledge/architecture.md2": SEED_A,
      "docs/knowledge/architecture.markdown": SEED_A,
      ".claude/rules/preferences.md.upstream": SEED_A,
    });
    deepStrictEqual(
      findTemplateResidue({
        manifestJsonText: manifest,
        readHash: () => SEED_A,
        isFrameworkRepo: false,
      }),
      [],
    );
  });

  it("findTemplateResidue_detailNeverEchoesFileContentOrResolvedTarget", () => {
    // A watched path may be a symlink; hashing follows it, but the finding
    // must disclose neither the content nor where the link pointed.
    const secret = "AKIAIOSFODNN7EXAMPLE super secret payload";
    const findings = findTemplateResidue({
      manifestJsonText: seedManifest({
        ".claude/rules/preferences.md": SEED_A,
      }),
      readHash: () => SEED_A,
      isFrameworkRepo: false,
    });
    strictEqual(findings.length, 1);
    const detail = findings[0].detail;
    ok(!detail.includes(secret), "detail must not echo file content");
    // The watched relpath is expected and useful. What must never appear is an
    // ABSOLUTE path — that is what a resolved symlink target would look like.
    ok(
      detail.includes(".claude/rules/preferences.md"),
      `detail must name the watched relpath, got: ${detail}`,
    );
    for (const abs of ["/home/", "/tmp/", "/Users/", "/etc/", "C:\\"]) {
      ok(
        !detail.includes(abs),
        `detail must not contain the absolute path prefix ${abs}`,
      );
    }
  });
});
