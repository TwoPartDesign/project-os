// tests/system-map.test.ts
// Unit tests for scripts/lib/system-map-lib.ts (normalizeContent, sha256,
// extractHookWiring, extractScriptRefs, extractImports, buildGraph,
// dependents, findUnwiredHooks, findOrphanScripts, findDanglingRefs,
// findManifestGaps, findBloat, pathToId, collectBloatFiles).
// Pattern follows tests/dashboard-render.test.ts: node:test + node:assert, one
// describe block per exported function, each test self-contained (no shared
// state across tests).

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, notStrictEqual, ok } from "node:assert";
import { createHash } from "node:crypto";
import {
  normalizeContent,
  sha256,
  extractHookWiring,
  extractScriptRefs,
  extractImports,
  buildGraph,
  dependents,
  findUnwiredHooks,
  findOrphanScripts,
  findDanglingRefs,
  findManifestGaps,
  findBloat,
  classify,
  idFor,
  pathToId,
  collectBloatFiles,
} from "../scripts/lib/system-map-lib.ts";
import type { MapNode, MapEdge, BloatContentSource } from "../scripts/lib/system-map-lib.ts";

// ==========================================================================
// normalizeContent
// ==========================================================================

describe("normalizeContent", () => {
  it("normalizeContent_crlfVsLf_sha256Identical", () => {
    const lf = "line1\nline2\n";
    const crlf = "line1\r\nline2\r\n";
    strictEqual(sha256(normalizeContent(crlf)), sha256(normalizeContent(lf)));
  });

  it("normalizeContent_noTrailingNewline_oneAdded", () => {
    strictEqual(normalizeContent("abc"), "abc\n");
  });

  it("normalizeContent_multipleTrailingNewlines_collapsedToOne", () => {
    strictEqual(normalizeContent("abc\n\n\n"), "abc\n");
  });

  it("normalizeContent_loneCr_convertedToLf", () => {
    strictEqual(normalizeContent("a\rb\rc"), "a\nb\nc\n");
  });

  it("normalizeContent_emptyString_staysEmpty", () => {
    strictEqual(normalizeContent(""), "");
  });
});

// ==========================================================================
// sha256
// ==========================================================================

describe("sha256", () => {
  it("sha256_normalizedInput_matchesIndependentDigest", () => {
    const input = normalizeContent("hello world");
    const expected = createHash("sha256").update(input, "utf-8").digest("hex");
    strictEqual(sha256(input), expected);
  });

  it("sha256_differentContent_differentHash", () => {
    notStrictEqual(sha256("a\n"), sha256("b\n"));
  });

  it("sha256_output_is64CharHex", () => {
    ok(/^[0-9a-f]{64}$/.test(sha256("abc\n")), "expected 64-char lowercase hex digest");
  });
});

// ==========================================================================
// extractHookWiring
// ==========================================================================

describe("extractHookWiring", () => {
  it("extractHookWiring_twoEventsThreeHooksOneDuplicated_sortedUnique", () => {
    const settings = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "bash .claude/hooks/pre-tool-use.sh" }],
          },
        ],
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              { type: "command", command: "bash .claude/hooks/post-tool-use.sh" },
              { type: "command", command: "bash .claude/hooks/post-write-session.sh" },
            ],
          },
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "bash .claude/hooks/pre-tool-use.sh" }],
          },
        ],
      },
    });
    const result = extractHookWiring(settings);
    deepStrictEqual(result, [
      ".claude/hooks/post-tool-use.sh",
      ".claude/hooks/post-write-session.sh",
      ".claude/hooks/pre-tool-use.sh",
    ]);
  });

  it("extractHookWiring_noHooksKey_emptyArray", () => {
    const result = extractHookWiring(JSON.stringify({ permissions: {} }));
    deepStrictEqual(result, []);
  });
});

// ==========================================================================
// extractScriptRefs
// ==========================================================================

describe("extractScriptRefs", () => {
  it("extractScriptRefs_fencedAndInlineMatched_proseIgnored", () => {
    const md = [
      "This is prose that mentions scripts/foo.sh but has no backticks and must not match.",
      "",
      "```bash",
      "bash scripts/build.sh",
      "```",
      "",
      "Use `node scripts/deploy.ts` to run the deploy step.",
    ].join("\n");
    const result = extractScriptRefs(md, "docs/example.md");
    deepStrictEqual(result, [{ target: "scripts/build.sh" }, { target: "scripts/deploy.ts" }]);
  });

  it("extractScriptRefs_libAndHookRefs_bothExtracted", () => {
    const md = [
      "See `scripts/lib/json.sh` and `.claude/hooks/_common.sh` for shared helpers.",
    ].join("\n");
    const result = extractScriptRefs(md, "docs/example.md");
    deepStrictEqual(result, [
      { target: ".claude/hooks/_common.sh" },
      { target: "scripts/lib/json.sh" },
    ]);
  });

  it("extractScriptRefs_400kbSingleLine_completesUnder100ms", () => {
    const noise = "x".repeat(400_000);
    const md = `${noise} \`bash scripts/build.sh\` ${noise}`;
    const start = Date.now();
    const result = extractScriptRefs(md, "docs/big.md");
    const elapsed = Date.now() - start;
    deepStrictEqual(result, [{ target: "scripts/build.sh" }]);
    ok(elapsed < 100, `expected extractScriptRefs to run in <100ms, took ${elapsed}ms`);
  });
});

// ==========================================================================
// extractImports
// ==========================================================================

describe("extractImports", () => {
  it("extractImports_tsRelativeImports_resolvedRepoRelative", () => {
    const ts = [
      'import { esc } from "../dashboard-render.ts";',
      'import type { Task } from "../lib/types.ts";',
    ].join("\n");
    const result = extractImports(ts, "scripts/sub/foo.ts");
    deepStrictEqual(result, [
      { target: "scripts/dashboard-render.ts" },
      { target: "scripts/lib/types.ts" },
    ]);
  });

  it("extractImports_tsPackageImport_ignored", () => {
    const ts = [
      'import { readFileSync } from "node:fs";',
      'import { esc } from "../dashboard-render.ts";',
    ].join("\n");
    const result = extractImports(ts, "scripts/sub/foo.ts");
    strictEqual(result.length, 1);
    ok(!result.some((r) => r.target === "node:fs"), "package import must not be resolved as a target");
    deepStrictEqual(result, [{ target: "scripts/dashboard-render.ts" }]);
  });

  it("extractImports_bashSourceLines_resolvedToFixedTargets", () => {
    const sh = [
      "#!/usr/bin/env bash",
      'source "$(dirname "$0")/_common.sh"',
      '. "$(dirname "$0")/../lib/json.sh"',
      'echo "not a source line: lib/json.sh mentioned in prose only"',
    ].join("\n");
    const result = extractImports(sh, ".claude/hooks/post-tool-use.sh");
    deepStrictEqual(result, [
      { target: ".claude/hooks/_common.sh" },
      { target: "scripts/lib/json.sh" },
    ]);
  });

  it("extractImports_unknownExtension_emptyArray", () => {
    const result = extractImports("source lib/json.sh", "scripts/notes.txt");
    deepStrictEqual(result, []);
  });
});

// ==========================================================================
// buildGraph
// ==========================================================================

describe("buildGraph", () => {
  it("buildGraph_edges_indexedByBothEndpoints", () => {
    const nodes: MapNode[] = [
      { id: "a", kind: "script", path: "scripts/a.sh" },
      { id: "b", kind: "script", path: "scripts/b.sh" },
    ];
    const edges: MapEdge[] = [{ from: "b", to: "a", kind: "references" }];
    const graph = buildGraph(nodes, edges);
    strictEqual(graph.nodes.length, 2);
    strictEqual(graph.edges.length, 1);
    deepStrictEqual(graph.incoming.get("a"), [{ from: "b", to: "a", kind: "references" }]);
    deepStrictEqual(graph.outgoing.get("b"), [{ from: "b", to: "a", kind: "references" }]);
    deepStrictEqual(graph.incoming.get("b"), []);
    deepStrictEqual(graph.outgoing.get("a"), []);
  });
});

// ==========================================================================
// dependents
// ==========================================================================

describe("dependents", () => {
  it("dependents_diamondGraph_countsThree", () => {
    // a <- b, a <- c, b <- d, c <- d  (edge.from depends on edge.to)
    const nodes: MapNode[] = [
      { id: "a", kind: "script", path: "scripts/a.sh" },
      { id: "b", kind: "script", path: "scripts/b.sh" },
      { id: "c", kind: "script", path: "scripts/c.sh" },
      { id: "d", kind: "script", path: "scripts/d.sh" },
    ];
    const edges: MapEdge[] = [
      { from: "b", to: "a", kind: "references" },
      { from: "c", to: "a", kind: "references" },
      { from: "d", to: "b", kind: "references" },
      { from: "d", to: "c", kind: "references" },
    ];
    const graph = buildGraph(nodes, edges);
    strictEqual(dependents(graph, "a"), 3);
    strictEqual(dependents(graph, "b"), 1);
    strictEqual(dependents(graph, "d"), 0);
  });
});

// ==========================================================================
// findUnwiredHooks
// ==========================================================================

describe("findUnwiredHooks", () => {
  it("findUnwiredHooks_zeroIncomingHook_flaggedHigh_wiredAndLibIgnored", () => {
    const nodes: MapNode[] = [
      { id: "h_pre_tool_use", kind: "hook", path: ".claude/hooks/pre-tool-use.sh" },
      { id: "h_post_tool_use", kind: "hook", path: ".claude/hooks/post-tool-use.sh" },
      { id: "l_common", kind: "lib", path: ".claude/hooks/_common.sh" },
      { id: "c_settings", kind: "config", path: ".claude/settings.json" },
    ];
    const edges: MapEdge[] = [{ from: "c_settings", to: "h_post_tool_use", kind: "wires" }];
    const graph = buildGraph(nodes, edges);
    const findings = findUnwiredHooks(graph);
    deepStrictEqual(findings, [
      {
        severity: "HIGH",
        kind: "unwired-hook",
        subject: "h_pre_tool_use",
        detail:
          "Hook .claude/hooks/pre-tool-use.sh has no incoming edges — not wired in .claude/settings.json and not invoked by any command, skill, or script.",
      },
    ]);
  });

  it("findUnwiredHooks_commandInvokedHook_notFlagged", () => {
    // log-activity.sh-style hooks: invoked by workflow commands (`references`
    // edge), never event-wired in settings.json — must NOT be flagged.
    const nodes: MapNode[] = [
      { id: "h_log_activity", kind: "hook", path: ".claude/hooks/log-activity.sh" },
      { id: "cmd_build", kind: "command", path: ".claude/commands/workflows/build.md" },
    ];
    const edges: MapEdge[] = [{ from: "cmd_build", to: "h_log_activity", kind: "references" }];
    const graph = buildGraph(nodes, edges);
    deepStrictEqual(findUnwiredHooks(graph), []);
  });
});

// ==========================================================================
// findOrphanScripts
// ==========================================================================

describe("findOrphanScripts", () => {
  it("findOrphanScripts_unreferencedNotAllowlisted_flaggedMedium", () => {
    const nodes: MapNode[] = [
      { id: "s_build", kind: "script", path: "scripts/build.sh" },
      { id: "s_deploy", kind: "script", path: "scripts/deploy.sh" },
      { id: "s_legacy", kind: "script", path: "scripts/legacy.sh" },
    ];
    const edges: MapEdge[] = [{ from: "m_readme", to: "s_build", kind: "references" }];
    const graph = buildGraph(nodes, edges);
    const findings = findOrphanScripts(graph, ["s_legacy"]);
    deepStrictEqual(findings, [
      {
        severity: "MEDIUM",
        kind: "orphan-script",
        subject: "s_deploy",
        detail: "Script scripts/deploy.sh has no incoming references and is not in the orphan allowlist.",
      },
    ]);
  });
});

// ==========================================================================
// findDanglingRefs
// ==========================================================================

describe("findDanglingRefs", () => {
  it("findDanglingRefs_missingTarget_flaggedHigh_validEdgeIgnored", () => {
    const nodes: MapNode[] = [{ id: "a", kind: "script", path: "scripts/a.sh" }];
    const edges: MapEdge[] = [
      { from: "a", to: "a", kind: "references" },
      { from: "a", to: "missing_node", kind: "references" },
    ];
    const findings = findDanglingRefs(nodes, edges);
    deepStrictEqual(findings, [
      {
        severity: "HIGH",
        kind: "dangling-ref",
        subject: "a",
        detail: "Edge references from a points to missing node missing_node.",
      },
    ]);
  });
});

// ==========================================================================
// findManifestGaps
// ==========================================================================

describe("findManifestGaps", () => {
  it("findManifestGaps_missingTrackedPath_flaggedMedium_untrackedPathIgnored", () => {
    const manifest = JSON.stringify({
      files: {
        "scripts/build.sh": { hash: "abc" },
        ".claude/hooks/foo.sh": { hash: "def" },
      },
    });
    const nodes: MapNode[] = [
      { id: "s_build", kind: "script", path: "scripts/build.sh" },
      { id: "h_foo", kind: "hook", path: ".claude/hooks/foo.sh" },
      { id: "s_missing", kind: "script", path: "scripts/missing.sh" },
      { id: "cfg_readme", kind: "config", path: "README.md" },
    ];
    const findings = findManifestGaps(manifest, nodes);
    deepStrictEqual(findings, [
      {
        severity: "MEDIUM",
        kind: "manifest-gap",
        subject: "s_missing",
        detail: "scripts/missing.sh is missing from the manifest's files map.",
      },
    ]);
  });
});

// ==========================================================================
// findBloat
// ==========================================================================

describe("findBloat", () => {
  it("findBloat_overThreshold_flaggedLow_underThresholdIgnored", () => {
    const files = [
      { path: "a.md", content: "x".repeat(400) },
      { path: "b.md", content: "x".repeat(40) },
    ];
    const findings = findBloat(files, 50);
    deepStrictEqual(findings, [
      {
        severity: "LOW",
        kind: "bloat",
        subject: "a.md",
        detail: "a.md is approximately 100 tokens, exceeding the 50-token warn threshold.",
      },
    ]);
  });
});

// ==========================================================================
// pathToId (#T88)
// ==========================================================================

describe("pathToId", () => {
  it("pathToId_commandDoc_matchesLegacyIdScheme", () => {
    const relPath = ".claude/commands/tools/catchup.md";
    // Independently derived via the moved classify/idFor primitives — this
    // is the exact node id string the generator's own Nodes table emits for
    // this file (confirmed against docs/maps/system-map.md's Nodes section:
    // "- `c_tools_catchup` — `.claude/commands/tools/catchup.md`").
    const expected = idFor(classify(relPath)!, relPath);
    strictEqual(expected, "c_tools_catchup");
    strictEqual(pathToId(relPath), expected);
    strictEqual(pathToId(relPath), "c_tools_catchup");
  });

  it("pathToId_outOfScopePath_throws", () => {
    let threw = false;
    try {
      pathToId("docs/random-notes.md");
    } catch (e) {
      threw = true;
      ok(e instanceof Error, "expected an Error to be thrown");
      ok(
        (e as Error).message.includes("docs/random-notes.md"),
        "expected error message to name the offending path"
      );
    }
    ok(threw, "expected pathToId to throw for a path outside classify()'s discovery set");
  });
});

// ==========================================================================
// collectBloatFiles (#T88)
// ==========================================================================

/** Builds a minimal BloatContentSource backed by an in-memory path->content map, for fixture-driven tests. */
function fixtureSource(files: Record<string, string>): BloatContentSource {
  return {
    readInput(path: string): string | null {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
    },
    listDir(dirPath: string): string[] {
      const prefix = dirPath + "/";
      return Object.keys(files)
        .filter((p) => p.startsWith(prefix) && p.endsWith(".md") && !p.slice(prefix.length).includes("/"))
        .sort();
    },
  };
}

describe("collectBloatFiles", () => {
  it("collectBloatFiles_oversizedRulesFile_producesBloatFinding", () => {
    const warnTokens = 50;
    const bigContent = "x".repeat(400); // ~100 tokens, exceeds 50
    const source = fixtureSource({
      ".claude/rules/big.md": bigContent,
    });
    const files = collectBloatFiles(source);
    deepStrictEqual(files, [{ path: ".claude/rules/big.md", content: bigContent }]);
    const findings = findBloat(files, warnTokens);
    deepStrictEqual(findings, [
      {
        severity: "LOW",
        kind: "bloat",
        subject: ".claude/rules/big.md",
        detail: ".claude/rules/big.md is approximately 100 tokens, exceeding the 50-token warn threshold.",
      },
    ]);
  });

  it("collectBloatFiles_smallRulesFile_noFinding", () => {
    const warnTokens = 2500;
    const smallContent = "x".repeat(40); // ~10 tokens, well under 2500
    const source = fixtureSource({
      ".claude/rules/small.md": smallContent,
    });
    const files = collectBloatFiles(source);
    deepStrictEqual(files, [{ path: ".claude/rules/small.md", content: smallContent }]);
    const findings = findBloat(files, warnTokens);
    deepStrictEqual(findings, []);
  });
});
