import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
import { extractContent, htmlToMarkdown } from "../tools/web-fetch/src/extractor.ts";

// ---------------------------------------------------------------------------
// extractContent — semantic tag extraction
// ---------------------------------------------------------------------------

describe("extractContent", () => {
  it("extractor_articleTag_extractsContent", () => {
    const html = `<html><body>
      <nav>menu</nav>
      <article><h1>Title</h1><p>Body</p></article>
      <footer>foot</footer>
    </body></html>`;
    const result = extractContent(html);
    ok(result.content.includes("Title"), "should contain Title");
    ok(result.content.includes("Body"), "should contain Body");
    ok(!result.content.includes("menu"), "should not contain nav content");
    ok(!result.content.includes("foot"), "should not contain footer content");
  });

  it("extractor_mainTag_extractsContent", () => {
    const html = `<html><body>
      <aside>sidebar</aside>
      <main><p>Main content</p></main>
    </body></html>`;
    const result = extractContent(html);
    ok(result.content.includes("Main content"), "should contain Main content");
    ok(!result.content.includes("sidebar"), "should not contain aside content");
  });

  it("extractor_classScoring_prefersContentOverSidebar", () => {
    const html = `<html><body>
      <div class="sidebar">side</div>
      <div class="article-content">article text here with enough content to win scoring</div>
    </body></html>`;
    const result = extractContent(html);
    ok(result.content.includes("article"), "should contain article content");
    ok(!result.content.includes("side"), "should not select sidebar block");
  });

  it("extractor_textDensity_findsLargestBlock", () => {
    const longText = "a".repeat(500);
    const shortText = "b".repeat(50);
    const html = `<html><body>
      <div>${shortText}</div>
      <div>${longText}</div>
    </body></html>`;
    const result = extractContent(html);
    ok(result.content.includes(longText), "should select the larger block");
    ok(!result.content.includes(shortText), "should not select the smaller block");
  });
});

// ---------------------------------------------------------------------------
// htmlToMarkdown — conversion rules
// ---------------------------------------------------------------------------

describe("htmlToMarkdown", () => {
  it("extractor_headingsPreserved_markdownOutput", () => {
    const md = htmlToMarkdown("<h1>One</h1><h2>Two</h2><h3>Three</h3>");
    strictEqual(md, "# One\n\n## Two\n\n### Three");
  });

  it("extractor_codeBlocksPreserved", () => {
    const md = htmlToMarkdown('<pre><code class="language-js">const x = 1;</code></pre>');
    ok(md.includes("```js"), "should have fenced code block with js tag");
    ok(md.includes("const x = 1;"), "should preserve code content");
    ok(md.includes("```"), "should close fenced block");
  });

  it("extractor_tablesConverted", () => {
    const html = `<table>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>1</td><td>2</td></tr>
    </table>`;
    const md = htmlToMarkdown(html);
    ok(md.includes("| A |"), "should include header cell A");
    ok(md.includes("| B |"), "should include header cell B");
    ok(md.includes("---"), "should include separator row");
  });

  it("extractor_linksPreserved", () => {
    const md = htmlToMarkdown('<a href="https://example.com">here</a>');
    strictEqual(md, "[here](https://example.com)");
  });

  it("extractor_nestedListsConverted", () => {
    const html = `<ul>
      <li>A<ul><li>B</li></ul></li>
      <li>C</li>
    </ul>`;
    const md = htmlToMarkdown(html);
    ok(md.includes("- A"), "should have top-level item A");
    ok(md.includes("  - B"), "should have nested item B with 2-space indent");
    ok(md.includes("- C"), "should have top-level item C");
  });
});
