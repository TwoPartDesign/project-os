import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import {
  parseYamlFrontmatter,
  chunkContent,
  calculateFreshness,
  normalizeFilePath,
  getSourceType,
} from "../scripts/knowledge-index.ts";

// ==========================================================================
// parseYamlFrontmatter
// ==========================================================================

describe("parseYamlFrontmatter", () => {
  it("parseYamlFrontmatter_noFrontmatter_returnsEmptyAndFullBody", () => {
    const result = parseYamlFrontmatter("# Hello\nWorld");
    deepStrictEqual(result.frontmatter, {});
    strictEqual(result.body, "# Hello\nWorld");
  });

  it("parseYamlFrontmatter_validFrontmatter_parsesKeyValues", () => {
    const input = `---
title: My Doc
date: 2026-01-15
---
Body content here`;
    const result = parseYamlFrontmatter(input);
    strictEqual(result.frontmatter.title, "My Doc");
    strictEqual(result.frontmatter.date, "2026-01-15");
    strictEqual(result.body, "Body content here");
  });

  it("parseYamlFrontmatter_quotedValues_stripsQuotes", () => {
    const input = `---
name: "quoted value"
other: 'single quoted'
---
body`;
    const result = parseYamlFrontmatter(input);
    strictEqual(result.frontmatter.name, "quoted value");
    strictEqual(result.frontmatter.other, "single quoted");
  });

  it("parseYamlFrontmatter_unclosedFrontmatter_returnsEmptyAndFullBody", () => {
    const input = `---
title: Oops
no closing delimiter`;
    const result = parseYamlFrontmatter(input);
    deepStrictEqual(result.frontmatter, {});
    strictEqual(result.body, input);
  });

  it("parseYamlFrontmatter_emptyInput_returnsEmptyAndEmptyBody", () => {
    const result = parseYamlFrontmatter("");
    deepStrictEqual(result.frontmatter, {});
    strictEqual(result.body, "");
  });

  it("parseYamlFrontmatter_colonInValue_preservesFull", () => {
    const input = `---
url: https://example.com:8080/path
---
body`;
    const result = parseYamlFrontmatter(input);
    strictEqual(result.frontmatter.url, "https://example.com:8080/path");
  });
});

// ==========================================================================
// chunkContent
// ==========================================================================

describe("chunkContent", () => {
  it("chunkContent_plainProse_singleProseChunk", () => {
    const chunks = chunkContent("Hello world.\nSecond line.");
    strictEqual(chunks.length, 1);
    strictEqual(chunks[0].chunk_type, "prose");
    strictEqual(chunks[0].heading, "ROOT");
    strictEqual(chunks[0].content, "Hello world.\nSecond line.");
  });

  it("chunkContent_headingSplitsChunks_correctHeadingStack", () => {
    const input = `# Top
Intro text

## Sub
Sub text`;
    const chunks = chunkContent(input);
    strictEqual(chunks.length, 2);
    strictEqual(chunks[0].heading, "Top");
    strictEqual(chunks[0].content, "Intro text");
    strictEqual(chunks[1].heading, "Top > Sub");
    strictEqual(chunks[1].content, "Sub text");
  });

  it("chunkContent_codeFence_codeChunkType", () => {
    const input = "# Code\n```js\nconst x = 1;\n```";
    const chunks = chunkContent(input);
    strictEqual(chunks.length, 1);
    strictEqual(chunks[0].chunk_type, "code");
    strictEqual(chunks[0].heading, "Code");
  });

  it("chunkContent_listItems_listChunkType", () => {
    const input = "# Lists\n- item one\n- item two\n* item three";
    const chunks = chunkContent(input);
    strictEqual(chunks.length, 1);
    strictEqual(chunks[0].chunk_type, "list");
    strictEqual(chunks[0].content, "- item one\n- item two\n* item three");
  });

  it("chunkContent_mixedTypes_separateChunks", () => {
    const input = `# Mixed
Some prose here.

- list item

\`\`\`
code block
\`\`\``;
    const chunks = chunkContent(input);
    strictEqual(chunks.length, 3);
    strictEqual(chunks[0].chunk_type, "prose");
    strictEqual(chunks[1].chunk_type, "list");
    strictEqual(chunks[2].chunk_type, "code");
  });

  it("chunkContent_emptyInput_noChunks", () => {
    const chunks = chunkContent("");
    strictEqual(chunks.length, 0);
  });

  it("chunkContent_nestedHeadings_headingStackResets", () => {
    const input = `# A
## B
### C
Deep content
## D
Sibling content`;
    const chunks = chunkContent(input);
    const deepChunk = chunks.find((c) => c.content === "Deep content");
    const siblingChunk = chunks.find((c) => c.content === "Sibling content");
    strictEqual(deepChunk?.heading, "A > B > C");
    strictEqual(siblingChunk?.heading, "A > D");
  });
});

// ==========================================================================
// calculateFreshness
// ==========================================================================

describe("calculateFreshness", () => {
  it("calculateFreshness_recentDate_notStale", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const result = calculateFreshness(yesterday, 90, "high");
    strictEqual(result.age_days, 1);
    strictEqual(result.is_stale, false);
  });

  it("calculateFreshness_oldDate_isStale", () => {
    const longAgo = new Date(Date.now() - 100 * 86400000).toISOString();
    const result = calculateFreshness(longAgo, 90, "high");
    strictEqual(result.age_days, 100);
    strictEqual(result.is_stale, true);
  });

  it("calculateFreshness_exactThreshold_notStale", () => {
    const exactly90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const result = calculateFreshness(exactly90, 90, "high");
    strictEqual(result.age_days, 90);
    strictEqual(result.is_stale, false);
  });

  it("calculateFreshness_today_zeroAgeDays", () => {
    const today = new Date().toISOString();
    const result = calculateFreshness(today, 90, "high");
    strictEqual(result.age_days, 0);
    strictEqual(result.is_stale, false);
  });
});

// ==========================================================================
// normalizeFilePath
// ==========================================================================

describe("normalizeFilePath", () => {
  it("normalizeFilePath_backslashes_convertedToForward", () => {
    strictEqual(normalizeFilePath("docs\\knowledge\\arch.md"), "docs/knowledge/arch.md");
  });

  it("normalizeFilePath_forwardSlashes_unchanged", () => {
    strictEqual(normalizeFilePath("docs/knowledge/arch.md"), "docs/knowledge/arch.md");
  });

  it("normalizeFilePath_mixedSlashes_allForward", () => {
    strictEqual(normalizeFilePath("docs\\specs/feature\\design.md"), "docs/specs/feature/design.md");
  });

  it("normalizeFilePath_emptyString_returnsEmpty", () => {
    strictEqual(normalizeFilePath(""), "");
  });
});

// ==========================================================================
// getSourceType
// ==========================================================================

describe("getSourceType", () => {
  it("getSourceType_knowledgePath_returnsKnowledge", () => {
    strictEqual(getSourceType("docs/knowledge/architecture.md"), "knowledge");
  });

  it("getSourceType_specPath_returnsSpec", () => {
    strictEqual(getSourceType("docs/specs/context-filtering/design.md"), "spec");
  });

  it("getSourceType_otherPath_returnsOther", () => {
    strictEqual(getSourceType("scripts/knowledge-index.ts"), "other");
  });

  it("getSourceType_rootFile_returnsOther", () => {
    strictEqual(getSourceType("ROADMAP.md"), "other");
  });
});
