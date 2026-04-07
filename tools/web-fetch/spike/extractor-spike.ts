/**
 * Zero-dep HTML content extractor prototype
 * T18: Spike — Zero-dep HTML extractor prototype
 *
 * Usage:
 *   node --experimental-strip-types tools/web-fetch/spike/extractor-spike.ts
 *
 * Runs embedded tests and then the benchmark.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface ExtractionResult {
  markdown: string;
  rawHtmlSize: number;
  markdownSize: number;
  reductionRatio: number;
}

// ---------------------------------------------------------------------------
// STEP 1: Strip boilerplate tags entirely (scripts, styles, hidden elements)
// ---------------------------------------------------------------------------

function stripBoilerplate(html: string): string {
  // Remove <script ...>...</script> (including multiline)
  let out = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  // Remove <style ...>...</style>
  out = out.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Remove HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  // Remove <noscript>...</noscript>
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // Remove SVG
  out = out.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  return out;
}

// ---------------------------------------------------------------------------
// STEP 2: Find main content block
// ---------------------------------------------------------------------------

/**
 * Extract the inner HTML of the best candidate content block.
 * Priority: <article>, <main>, <div role="main">, then density scoring.
 */
function findMainContent(html: string): string {
  // Try <article> first
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  // Try <main>
  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  // Try <div role="main">
  const roleMainMatch = html.match(
    /<div[^>]*role\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (roleMainMatch) return roleMainMatch[1];

  // Fall back to text-density scoring over <div> blocks
  return densityScore(html);
}

/**
 * Score each top-level <div> block by text density and class/ID signals.
 * Returns the content of the highest-scoring block.
 */
function densityScore(html: string): string {
  // Extract all <div ...>...</div> blocks (non-greedy depth-1 approximation)
  const divRegex = /<div([^>]*)>([\s\S]*?)<\/div>/gi;
  let best = "";
  let bestScore = -Infinity;

  const POSITIVE = /article|content|post|entry|body|text|story/i;
  const NEGATIVE = /sidebar|comment|footer|nav|ad|menu|widget|related/i;

  let m: RegExpExecArray | null;
  while ((m = divRegex.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    // Count text chars (strip tags for measurement)
    const text = inner.replace(/<[^>]+>/g, "");
    const textChars = text.replace(/\s+/g, " ").trim().length;

    // Count tags
    const tagCount = (inner.match(/<[^>]+>/g) || []).length + 1;

    const density = textChars / tagCount;

    // Class/ID signal scoring
    let signal = 0;
    const classId = attrs.match(/(?:class|id)\s*=\s*["']([^"']*)["']/gi) || [];
    for (const ci of classId) {
      if (POSITIVE.test(ci)) signal += 10;
      if (NEGATIVE.test(ci)) signal -= 10;
    }

    const score = density + signal;

    if (score > bestScore && textChars > 200) {
      bestScore = score;
      best = inner;
    }
  }

  // If nothing scored well, return the whole body
  if (!best) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
  }

  return best;
}

// ---------------------------------------------------------------------------
// STEP 3: Strip structural noise within the selected block
// ---------------------------------------------------------------------------

function stripNoise(html: string): string {
  // Remove nav, footer, aside, header blocks within the content
  let out = html.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  out = out.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  out = out.replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  out = out.replace(/<header[\s\S]*?<\/header>/gi, " ");
  // Remove forms (login boxes, search, etc.)
  out = out.replace(/<form[\s\S]*?<\/form>/gi, " ");
  return out;
}

// ---------------------------------------------------------------------------
// STEP 4: Convert HTML to Markdown
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string): string {
  let md = html;

  // Headings — must come before generic tag stripping
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => `\n\n# ${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => `\n\n## ${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => `\n\n### ${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner) => `\n\n#### ${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, inner) => `\n\n##### ${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, inner) => `\n\n###### ${stripTags(inner).trim()}\n\n`);

  // Code blocks (pre/code) — before inline code
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, inner) => {
    const code = decodeHtmlEntities(stripTags(inner));
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = decodeHtmlEntities(stripTags(inner));
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${stripTags(inner)}\``);

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const lines = stripTags(inner).trim().split("\n");
    return "\n\n" + lines.map((l) => `> ${l.trim()}`).join("\n") + "\n\n";
  });

  // Tables — simple: extract cell text
  md = md.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]).trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return "";
    const header = `| ${rows[0].join(" | ")} |`;
    const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
    const body = rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
    return `\n\n${header}\n${sep}\n${body}\n\n`;
  });

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return "\n\n" + items.map((li: string) => `- ${stripTags(li).trim()}`).join("\n") + "\n\n";
  });

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    const items = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    return "\n\n" + items.map((li: string, i: number) => `${i + 1}. ${stripTags(li).trim()}`).join("\n") + "\n\n";
  });

  // Strong/Bold
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, inner) => `**${stripTags(inner).trim()}**`);
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, inner) => `**${stripTags(inner).trim()}**`);

  // Emphasis/Italic
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, inner) => `_${stripTags(inner).trim()}_`);
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, inner) => `_${stripTags(inner).trim()}_`);

  // Links
  md = md.replace(/<a[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = stripTags(inner).trim();
    return text ? `[${text}](${href})` : href;
  });

  // Images — convert to alt text if available
  md = md.replace(/<img[^>]*alt\s*=\s*["']([^"']*)["'][^>]*\/?>/gi, (_, alt) => alt ? `[Image: ${alt}]` : "");
  md = md.replace(/<img[^>]*\/?>/gi, "");

  // Line breaks and paragraphs
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `\n\n${stripTags(inner).trim()}\n\n`);
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, inner) => `\n${inner}\n`);

  // Strip remaining HTML tags
  md = stripTags(md);

  // Decode HTML entities
  md = decodeHtmlEntities(md);

  // Normalize whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/[ \t]+/g, " ");
  md = md.replace(/^ +/gm, "");
  md = md.trim();

  return md;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

export function extractContent(html: string): ExtractionResult {
  const rawHtmlSize = html.length;
  const stripped = stripBoilerplate(html);
  const mainContent = findMainContent(stripped);
  const clean = stripNoise(mainContent);
  const markdown = htmlToMarkdown(clean);
  const markdownSize = markdown.length;
  const reductionRatio = rawHtmlSize > 0 ? 1 - markdownSize / rawHtmlSize : 0;

  return { markdown, rawHtmlSize, markdownSize, reductionRatio };
}

// ---------------------------------------------------------------------------
// BENCHMARK
// ---------------------------------------------------------------------------

const BENCHMARK_URLS = [
  // Documentation
  { url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", label: "MDN Array.map" },
  { url: "https://docs.python.org/3/library/functions.html", label: "Python builtins" },
  // News / Blog
  { url: "https://blog.nodejs.org/en/blog/announcements/v23-release-announce/", label: "Node.js v23 announcement" },
  { url: "https://deno.com/blog/v2", label: "Deno v2 blog post" },
  // GitHub
  { url: "https://github.com/nodejs/node/blob/main/README.md", label: "Node.js README" },
  { url: "https://github.com/denoland/deno/issues/20704", label: "Deno GitHub issue" },
  // API reference
  { url: "https://nodejs.org/docs/latest/api/fs.html", label: "Node.js fs API" },
  { url: "https://bun.sh/docs/api/http", label: "Bun HTTP API" },
  // Wikipedia
  { url: "https://en.wikipedia.org/wiki/TypeScript", label: "Wikipedia: TypeScript" },
  // Stack Overflow
  { url: "https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep", label: "SO: JS sleep" },
];

interface BenchmarkRow {
  label: string;
  url: string;
  rawHtmlSize: number;
  markdownSize: number;
  reductionRatio: number;
  status: "ok" | "error";
  error?: string;
  fidelityNotes: string;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ProjectOS-WebFetch-Spike/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function assessFidelity(markdown: string): string {
  const notes: string[] = [];
  if (/^#{1,3} /m.test(markdown)) notes.push("headings:yes");
  else notes.push("headings:no");
  if (/```/.test(markdown)) notes.push("code:yes");
  else notes.push("code:no");
  if (/\|.*\|/.test(markdown)) notes.push("tables:yes");
  // Check for leaked noise
  if (/\bnavigation\b|\bcookies\b|\bprivacy policy\b|\badvertisement\b/i.test(markdown)) {
    notes.push("noise:possible");
  } else {
    notes.push("noise:clean");
  }
  return notes.join(", ");
}

async function runBenchmark(): Promise<BenchmarkRow[]> {
  const results: BenchmarkRow[] = [];

  for (const entry of BENCHMARK_URLS) {
    process.stdout.write(`  Fetching: ${entry.label} ... `);
    try {
      const html = await fetchHtml(entry.url);
      const result = extractContent(html);
      const fidelityNotes = assessFidelity(result.markdown);
      results.push({
        label: entry.label,
        url: entry.url,
        rawHtmlSize: result.rawHtmlSize,
        markdownSize: result.markdownSize,
        reductionRatio: result.reductionRatio,
        status: "ok",
        fidelityNotes,
      });
      process.stdout.write(`ok (${(result.reductionRatio * 100).toFixed(1)}% reduction)\n`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        label: entry.label,
        url: entry.url,
        rawHtmlSize: 0,
        markdownSize: 0,
        reductionRatio: 0,
        status: "error",
        error,
        fidelityNotes: "n/a",
      });
      process.stdout.write(`error: ${error}\n`);
    }
  }

  return results;
}

function buildMarkdownReport(rows: BenchmarkRow[]): string {
  const successful = rows.filter((r) => r.status === "ok");
  const avgReduction =
    successful.length > 0
      ? successful.reduce((sum, r) => sum + r.reductionRatio, 0) / successful.length
      : 0;

  const tableRows = rows
    .map((r) => {
      if (r.status === "error") {
        return `| ${r.label} | error | — | — | — | ${r.error ?? ""} |`;
      }
      const rawKb = (r.rawHtmlSize / 1024).toFixed(1);
      const mdKb = (r.markdownSize / 1024).toFixed(1);
      const pct = (r.reductionRatio * 100).toFixed(1);
      return `| ${r.label} | ok | ${rawKb} KB | ${mdKb} KB | ${pct}% | ${r.fidelityNotes} |`;
    })
    .join("\n");

  const decision =
    avgReduction >= 0.8
      ? "GO"
      : avgReduction >= 0.7
      ? "CONDITIONAL GO (below 80% target; consider tuning)"
      : "NO-GO (below 70% — recommend vendoring a full HTML parser)";

  const now = new Date().toISOString();

  return `# Benchmark Results — Zero-dep HTML Extractor Spike

**Date**: ${now}
**Approach**: Regex-based HTML→Markdown extraction, zero npm deps, Node 22+ only
**Target**: ≥80% average token reduction with acceptable fidelity

## Summary

| Metric | Value |
|---|---|
| URLs tested | ${rows.length} |
| Successful | ${successful.length} |
| Failed | ${rows.length - successful.length} |
| Average token reduction | ${(avgReduction * 100).toFixed(1)}% |
| **Decision** | **${decision}** |

## Per-URL Results

| URL | Status | Raw HTML | Markdown | Reduction | Notes |
|---|---|---|---|---|---|
${tableRows}

## Fidelity Legend

- **headings:yes/no** — h1-h3 headings present in output
- **code:yes/no** — fenced code blocks found
- **tables:yes** — markdown table found
- **noise:clean** — no obvious nav/cookie/ad text leaked
- **noise:possible** — leaked boilerplate detected

## Recommendation

${
  avgReduction >= 0.8
    ? `**GO** — The zero-dep regex extractor achieves ${(avgReduction * 100).toFixed(1)}% average token reduction, meeting the ≥80% target. Content fidelity is sufficient for LLM consumption. Proceed to full implementation.`
    : avgReduction >= 0.7
    ? `**CONDITIONAL GO** — The extractor achieves ${(avgReduction * 100).toFixed(1)}%, slightly below the 80% target. Tuning the density scorer or adding more noise-removal rules could push it over the threshold before full implementation.`
    : `**NO-GO** — The extractor achieves only ${(avgReduction * 100).toFixed(1)}%, well below the 70% floor. The regex approach is insufficient for reliable extraction. Recommend evaluating a vendored lightweight HTML parser (e.g., \`node-html-parser\` source inlined) or a WASM-based approach before committing to implementation.`
}

## Architecture Notes

- **Entry points**: \`<article>\` → \`<main>\` → \`<div role="main">\` → text-density scoring
- **Density scorer**: \`text_chars / tag_count\` + class/ID signal bias (±10 per keyword)
- **Noise removal**: strips \`<nav>\`, \`<footer>\`, \`<aside>\`, \`<header>\`, \`<form>\` within content block
- **Markdown conversion**: h1-h6, pre/code, blockquote, tables, ul/ol, strong/em, links, images
- **Zero deps**: only \`node:test\`, \`node:assert\`, and native \`fetch()\`
`;
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

function runTests(): void {
  describe("extractContent", () => {
    test("extractContent_withArticleTag_returnsOnlyArticleContent", () => {
      const html = `
        <html><body>
          <nav>Navigation stuff</nav>
          <article>
            <h1>Article Title</h1>
            <p>This is the article body.</p>
          </article>
          <footer>Footer noise</footer>
        </body></html>
      `;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("Article Title"), "Should include article heading");
      assert.ok(result.markdown.includes("article body"), "Should include article paragraph");
      assert.ok(!result.markdown.includes("Navigation stuff"), "Should not include nav content");
      assert.ok(!result.markdown.includes("Footer noise"), "Should not include footer content");
    });

    test("densityScore_picksLargerTextBlock_overSmallerBlock", () => {
      const html = `
        <html><body>
          <div class="sidebar">Short nav text. Very short.</div>
          <div class="content">
            This is a much longer block of article text that contains many words and
            should score higher in the density calculation because it has more text
            characters relative to its HTML tag count. This is the main content.
            We want to select this block over the sidebar. More words here.
          </div>
        </body></html>
      `;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("longer block"), "Should pick the higher-density block");
    });

    test("htmlToMarkdown_convertsH1ToMarkdownHeading", () => {
      const html = `<html><body><article><h1>Hello World</h1><p>Text</p></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("# Hello World"), "h1 should become # heading");
    });

    test("htmlToMarkdown_convertsH2ToMarkdownHeading", () => {
      const html = `<html><body><article><h2>Section Title</h2><p>Body text here.</p></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("## Section Title"), "h2 should become ## heading");
    });

    test("htmlToMarkdown_convertsH3ToMarkdownHeading", () => {
      const html = `<html><body><article><h3>Subsection</h3><p>Content.</p></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("### Subsection"), "h3 should become ### heading");
    });

    test("htmlToMarkdown_convertsPreCodeToFencedBlock", () => {
      const html = `<html><body><article><pre><code>const x = 1;</code></pre></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("```"), "Should produce fenced code block");
      assert.ok(result.markdown.includes("const x = 1;"), "Code content should be preserved");
    });

    test("htmlToMarkdown_convertsLinksToMarkdownLinks", () => {
      const html = `<html><body><article><p>See <a href="https://example.com">example</a>.</p></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.markdown.includes("[example](https://example.com)"), "Should convert links to markdown");
    });

    test("extractContent_reductionRatio_isPositive", () => {
      const html = `<html><head><style>body{color:red;background:blue;font-size:16px;}</style></head><body><article><h1>Title</h1><p>Content paragraph with some text.</p></article></body></html>`;
      const result = extractContent(html);
      assert.ok(result.reductionRatio > 0, "Reduction ratio should be positive");
      assert.ok(result.markdownSize < result.rawHtmlSize, "Markdown should be smaller than raw HTML");
    });
  });
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

const IS_MAIN = process.argv[1]?.endsWith("extractor-spike.ts") || process.argv[1]?.endsWith("extractor-spike.js");

if (IS_MAIN) {
  console.log("=== T18: Zero-dep HTML Extractor Spike ===\n");
  console.log("Running tests...");
  runTests();

  // Wait a tick for tests to register, then run benchmark
  setTimeout(async () => {
    console.log("\nRunning benchmark against 10 URLs...\n");
    const rows = await runBenchmark();

    const report = buildMarkdownReport(rows);

    // Write benchmark results
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    // Use script location rather than import.meta.url (avoids Windows URL-encoding issues)
    const scriptDir = dirname(resolve(process.argv[1]));
    const outPath = resolve(scriptDir, "benchmark-results.md");

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, report, "utf8");

    console.log(`\nBenchmark results written to: ${outPath}`);

    const successful = rows.filter((r) => r.status === "ok");
    const avgReduction =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.reductionRatio, 0) / successful.length
        : 0;

    console.log(`\nAverage token reduction: ${(avgReduction * 100).toFixed(1)}%`);
    console.log(
      avgReduction >= 0.8
        ? "DECISION: GO"
        : avgReduction >= 0.7
        ? "DECISION: CONDITIONAL GO"
        : "DECISION: NO-GO"
    );
  }, 100);
}
