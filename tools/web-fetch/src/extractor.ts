/**
 * HTML content extractor and Markdown converter.
 * Pure functions, zero external dependencies — regex-based extraction.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractResult {
  title: string;
  content: string;
  excerpt: string;
}

export interface ConvertResult {
  title: string;
  markdown: string;
  excerpt: string;
  wordCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip all HTML tags from a string, returning plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Decode basic HTML entities. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Count words in a plain-text string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Build a short excerpt (first ~160 chars of plain text). */
function buildExcerpt(plainText: string): string {
  const trimmed = plainText.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? trimmed.slice(0, 157) + "..." : trimmed;
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

const POSITIVE_RE = /article|content|post|entry|body|text|story/i;
const NEGATIVE_RE = /sidebar|comment|footer|nav|ad|menu|widget|related|social|share/i;

/**
 * Score a tag's opening attributes string.
 * Positive class/ID patterns add +10; negative patterns subtract 10.
 */
function scoreAttrs(attrs: string): number {
  let score = 0;
  const positiveMatches = attrs.match(new RegExp(POSITIVE_RE.source, "gi"));
  if (positiveMatches) score += positiveMatches.length * 10;
  const negativeMatches = attrs.match(new RegExp(NEGATIVE_RE.source, "gi"));
  if (negativeMatches) score -= negativeMatches.length * 10;
  return score;
}

/**
 * Remove noise tags (nav, footer, aside, header) from within a block.
 */
function removeNoiseTags(html: string): string {
  return html.replace(/<(nav|footer|aside|header)[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/**
 * Extract all div blocks from HTML along with their attributes and inner text.
 * Returns an array of { attrs, inner, textLen } sorted by match order.
 *
 * Note: this is a simple heuristic — it does not handle deeply nested divs
 * perfectly, but it covers the common content-extraction use-case.
 */
function extractDivBlocks(html: string): Array<{ attrs: string; inner: string; textLen: number }> {
  const blocks: Array<{ attrs: string; inner: string; textLen: number }> = [];
  // Match outermost-ish divs by scanning for <div ...>...</div>
  // We use a depth-tracking approach via iteration to find matching close tags.
  const openRe = /<div([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const startIdx = match.index + match[0].length;
    // Walk forward to find the matching </div>
    let depth = 1;
    let pos = startIdx;
    while (pos < html.length && depth > 0) {
      const nextOpen = html.indexOf("<div", pos);
      const nextClose = html.indexOf("</div", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          const inner = html.slice(startIdx, nextClose);
          blocks.push({ attrs, inner, textLen: stripTags(inner).length });
        }
        pos = nextClose + 6;
      }
    }
  }
  return blocks;
}

/**
 * extractContent — find the main content block in an HTML document.
 *
 * Priority:
 * 1. Semantic container: <article>, <main>, role="main"
 * 2. Best-scoring <div> by class/ID + text density
 * 3. Largest <div> by text character count
 */
export function extractContent(html: string): ExtractResult {
  // 1. Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : "";

  // 2. Semantic containers
  const semanticRe = /<(article|main)[^>]*>|<[^>]+role=["']main["'][^>]*>/i;
  const semanticMatch = semanticRe.exec(html);

  let contentBlock = "";

  if (semanticMatch) {
    // Extract everything from the matched tag to its closing tag
    const tagName = semanticMatch[0].match(/^<(\w+)/)?.[1] ?? "div";
    const startIdx = semanticMatch.index + semanticMatch[0].length;
    let depth = 1;
    let pos = startIdx;
    const openStr = `<${tagName}`;
    const closeStr = `</${tagName}`;
    while (pos < html.length && depth > 0) {
      const nextOpen = html.toLowerCase().indexOf(openStr.toLowerCase(), pos);
      const nextClose = html.toLowerCase().indexOf(closeStr.toLowerCase(), pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openStr.length;
      } else {
        depth--;
        if (depth === 0) {
          contentBlock = html.slice(startIdx, nextClose);
        }
        pos = nextClose + closeStr.length;
      }
    }
  }

  // 3. Div scoring if no semantic block found
  if (!contentBlock) {
    const divBlocks = extractDivBlocks(html);
    if (divBlocks.length > 0) {
      // Score each block
      let bestScore = -Infinity;
      let bestBlock = divBlocks[0];
      for (const block of divBlocks) {
        const attrScore = scoreAttrs(block.attrs);
        const scoreMult = attrScore >= 0 ? 1 + attrScore / 10 : 1 / (1 + Math.abs(attrScore) / 10);
        const finalScore = block.textLen * scoreMult;
        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestBlock = block;
        }
      }
      contentBlock = bestBlock.inner;
    }
  }

  // 4. Strip noise tags within selected block
  contentBlock = removeNoiseTags(contentBlock);

  const plainText = decodeEntities(stripTags(contentBlock)).replace(/\s+/g, " ").trim();
  const excerpt = buildExcerpt(plainText);

  return { title, content: contentBlock, excerpt };
}

// ---------------------------------------------------------------------------
// HTML → Markdown converter
// ---------------------------------------------------------------------------

/**
 * Convert an HTML fragment to Markdown.
 * Processes tags iteratively via regex substitution.
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Pre-processing: normalise line endings
  md = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // ---- Code blocks (must come before inline code) ----
  md = md.replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, attrs, code) => {
    const langMatch = attrs.match(/class=["'][^"']*language-([a-z0-9\-+]+)/i);
    const lang = langMatch ? langMatch[1] : "";
    const decoded = decodeEntities(stripTags(code));
    return `\n\`\`\`${lang}\n${decoded}\n\`\`\`\n`;
  });

  // ---- Tables ----
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
    return convertTable(inner);
  });

  // ---- Blockquotes ----
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const innerMd = htmlToMarkdown(inner).trim();
    return "\n" + innerMd.split("\n").map(l => `> ${l}`).join("\n") + "\n";
  });

  // ---- Lists: depth-aware replacement of outermost <ul>/<ol> blocks ----
  md = replaceOutermostLists(md);

  // ---- Headings ----
  for (let i = 6; i >= 1; i--) {
    const hashes = "#".repeat(i);
    md = md.replace(new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi"), (_m, inner) => {
      return `\n${hashes} ${decodeEntities(stripTags(inner)).trim()}\n`;
    });
  }

  // ---- Paragraphs ----
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => {
    return htmlToMarkdown(inner).trim() + "\n\n";
  });

  // ---- Links ----
  md = md.replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    if (!href) return decodeEntities(stripTags(inner));
    const text = decodeEntities(stripTags(inner)).trim();
    return `[${text}](${href})`;
  });

  // ---- Images — stripped ----
  md = md.replace(/<img[^>]*>/gi, "");

  // ---- Inline code ----
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => {
    return "`" + decodeEntities(stripTags(inner)) + "`";
  });

  // ---- Bold/strong ----
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
    return `**${htmlToMarkdown(inner).trim()}**`;
  });

  // ---- Italic/em ----
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => {
    return `*${htmlToMarkdown(inner).trim()}*`;
  });

  // ---- HR ----
  md = md.replace(/<hr[^>]*>/gi, "\n---\n");

  // ---- BR ----
  md = md.replace(/<br[^>]*>/gi, "\n");

  // ---- Strip remaining tags, keep content ----
  md = md.replace(/<[^>]+>/g, "");

  // ---- Decode entities ----
  md = decodeEntities(md);

  // ---- Normalise blank lines (max 2 consecutive) ----
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
}

// ---------------------------------------------------------------------------
// Table conversion helper
// ---------------------------------------------------------------------------

function convertTable(tableInner: string): string {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableInner)) !== null) {
    const rowInner = rowMatch[1];
    const cells: string[] = [];
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowInner)) !== null) {
      cells.push(decodeEntities(stripTags(cellMatch[1])).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map(r => r.length));
  const pad = (row: string[]) => row.concat(Array(colCount - row.length).fill("")).map(c => ` ${c} `).join("|");

  const header = `|${pad(rows[0])}|`;
  const separator = `|${Array(colCount).fill(" --- ").join("|")}|`;
  const body = rows.slice(1).map(r => `|${pad(r)}|`).join("\n");

  return "\n" + [header, separator, ...(body ? [body] : [])].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// List conversion helpers
// ---------------------------------------------------------------------------

/**
 * Find the inner content and tag type of the first outermost <ul> or <ol>
 * in `html`, using depth tracking to skip nested lists.
 * Returns { tagName, inner, start, end } where start/end span the full tag.
 */
function findFirstList(html: string): { tagName: string; inner: string; start: number; end: number } | null {
  const openRe = /<(ul|ol)([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const openTag = match[0];
    const start = match.index;
    const innerStart = start + openTag.length;
    let depth = 1;
    let pos = innerStart;
    const openStr = `<${tagName}`;
    const closeStr = `</${tagName}>`;
    while (pos < html.length && depth > 0) {
      const nextOpen = html.toLowerCase().indexOf(openStr, pos);
      const nextClose = html.toLowerCase().indexOf(closeStr, pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openStr.length;
      } else {
        depth--;
        if (depth === 0) {
          const inner = html.slice(innerStart, nextClose);
          const end = nextClose + closeStr.length;
          return { tagName, inner, start, end };
        }
        pos = nextClose + closeStr.length;
      }
    }
  }
  return null;
}

/**
 * Replace all outermost <ul>/<ol> blocks in html, converting them to Markdown.
 * Recurses into each list item for nested lists via convertListBlock.
 */
function replaceOutermostLists(html: string): string {
  let result = html;
  let offset = 0;
  // Work on original html, tracking offset shifts
  let working = html;
  let listInfo = findFirstList(working);
  while (listInfo !== null) {
    const { tagName, inner, start, end } = listInfo;
    const ordered = tagName === "ol";
    const md = "\n" + convertListBlock(inner, ordered, 0) + "\n";
    working = working.slice(0, start) + md + working.slice(end);
    listInfo = findFirstList(working.slice(start + md.length));
    if (listInfo) {
      listInfo = {
        ...listInfo,
        start: listInfo.start + start + md.length,
        end: listInfo.end + start + md.length,
      };
    }
  }
  void offset; // suppress unused warning
  return working;
}

/**
 * Extract top-level <li> items from list inner HTML using depth tracking.
 */
function extractLiItems(listInner: string): string[] {
  const items: string[] = [];
  let searchFrom = 0;
  while (searchFrom < listInner.length) {
    const openMatch = /<li[^>]*>/gi.exec(listInner.slice(searchFrom));
    if (!openMatch) break;
    const absOpenStart = searchFrom + openMatch.index;
    const absInnerStart = absOpenStart + openMatch[0].length;
    let depth = 1;
    let pos = absInnerStart;
    while (pos < listInner.length && depth > 0) {
      const nextOpen = listInner.toLowerCase().indexOf("<li", pos);
      const nextClose = listInner.toLowerCase().indexOf("</li", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 3;
      } else {
        depth--;
        if (depth === 0) {
          items.push(listInner.slice(absInnerStart, nextClose));
          searchFrom = nextClose + 5; // advance past </li (5 chars), > handled by next search
          // skip the ">" of "</li>"
          while (searchFrom < listInner.length && listInner[searchFrom] !== "<") {
            searchFrom++;
          }
        }
        pos = nextClose + 5;
      }
    }
    if (depth !== 0) break; // malformed
  }
  return items;
}

/**
 * Convert one list block (inner HTML of a <ul> or <ol>) to Markdown.
 * depth controls the indent level for nested lists.
 */
function convertListBlock(listInner: string, ordered: boolean, depth: number): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let counter = 1;

  const liItems = extractLiItems(listInner);
  for (const liContent of liItems) {
    // Recursively convert nested lists inside this li item
    const nestedConverted = replaceOutermostListsAtDepth(liContent, depth + 1);
    // Separate the text part from any nested list lines
    const parts = nestedConverted.split("\n");
    // The first non-empty part is the item text; remaining are nested lines
    const firstLineIdx = parts.findIndex(p => p.trim().length > 0);
    let itemText = "";
    let nestedLines: string[] = [];
    if (firstLineIdx !== -1) {
      itemText = decodeEntities(stripTags(parts[firstLineIdx])).trim();
      nestedLines = parts.slice(firstLineIdx + 1);
    } else {
      itemText = decodeEntities(stripTags(liContent)).trim();
    }
    const bullet = ordered ? `${counter++}. ` : "- ";
    lines.push(`${indent}${bullet}${itemText}`);
    for (const nl of nestedLines) {
      if (nl.trim()) lines.push(nl);
    }
  }
  return lines.join("\n");
}

/**
 * Like replaceOutermostLists but passes a specific depth to convertListBlock.
 * Used when recursing into nested list items.
 */
function replaceOutermostListsAtDepth(html: string, depth: number): string {
  let working = html;
  let listInfo = findFirstList(working);
  while (listInfo !== null) {
    const { tagName, inner, start, end } = listInfo;
    const ordered = tagName === "ol";
    const md = "\n" + convertListBlock(inner, ordered, depth) + "\n";
    working = working.slice(0, start) + md + working.slice(end);
    const nextSearch = working.slice(start + md.length);
    const next = findFirstList(nextSearch);
    if (next) {
      listInfo = {
        ...next,
        start: next.start + start + md.length,
        end: next.end + start + md.length,
      };
    } else {
      listInfo = null;
    }
  }
  return working;
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Extract content from HTML and convert to Markdown in one step.
 */
export function extractAndConvert(html: string): ConvertResult {
  const { title, content, excerpt } = extractContent(html);
  const markdown = htmlToMarkdown(content);
  const wordCount = countWords(markdown);
  return { title, markdown, excerpt, wordCount };
}
