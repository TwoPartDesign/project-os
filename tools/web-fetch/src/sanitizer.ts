/**
 * Prompt injection sanitizer for web-fetched HTML/Markdown content.
 * Pure functions, no side effects, regex-based.
 */

export interface SanitizeResult {
  cleaned: string;
  removed: string[];
}

/**
 * sanitizeHtml — pre-extraction sanitizer (stages 1-6 + dangerous attributes).
 * Removes hidden elements, zero-width chars, base64 payloads, fake LLM delimiters,
 * invisible Unicode, HTML comments, and dangerous attributes.
 */
export function sanitizeHtml(html: string): SanitizeResult {
  const removed: string[] = [];
  let cleaned = html;

  // Stage 1 — Hidden elements
  // Remove elements with display:none, visibility:hidden, opacity:0, hidden attribute, height:0/width:0
  const hiddenPatterns = [
    // style="display:none" or style="display: none" — bounded to 10K chars to prevent ReDoS
    /<[^>]+style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]{0,10000}?<\/[^>]+>/gi,
    // style="visibility:hidden"
    /<[^>]+style\s*=\s*["'][^"']*visibility\s*:\s*hidden[^"']*["'][^>]*>[\s\S]{0,10000}?<\/[^>]+>/gi,
    // style="opacity:0"
    /<[^>]+style\s*=\s*["'][^"']*opacity\s*:\s*0[^"']*["'][^>]*>[\s\S]{0,10000}?<\/[^>]+>/gi,
    // hidden attribute
    /<[^>]+\shidden(?:\s|>|\/)[^>]*>[\s\S]{0,10000}?<\/[^>]+>/gi,
    // style="height:0" or style="width:0"
    /<[^>]+style\s*=\s*["'][^"']*(?:height|width)\s*:\s*0[^"']*["'][^>]*>[\s\S]{0,10000}?<\/[^>]+>/gi,
    // Self-closing variants with hidden attribute
    /<[^>]+\shidden(?:\s|>|\/)[^>]*/gi,
  ];

  let hadHidden = false;
  for (const pattern of hiddenPatterns) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, '');
    if (cleaned !== before) {
      hadHidden = true;
    }
  }
  if (hadHidden) {
    removed.push('hidden-element');
  }

  // Stage 2 — Zero-width chars
  const zeroWidthRegex = /[\u200B\u200C\u200D\uFEFF\u2060]/g;
  if (zeroWidthRegex.test(cleaned)) {
    cleaned = cleaned.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '');
    removed.push('zero-width');
  }

  // Stage 3 — Base64 payloads
  const base64Regex = /data:[^;]+;base64,[A-Za-z0-9+/=]{100,}/g;
  if (base64Regex.test(cleaned)) {
    cleaned = cleaned.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, '[base64-removed]');
    removed.push('base64');
  }

  // Stage 4 — Fake LLM delimiters
  const llmDelimiterRegex = /<\|(?:im_start|im_end|system|user|assistant)\|>|\[\/?\s*INST\s*\]|<<\/?SYS>>/gi;
  if (llmDelimiterRegex.test(cleaned)) {
    cleaned = cleaned.replace(/<\|(?:im_start|im_end|system|user|assistant)\|>|\[\/?\s*INST\s*\]|<<\/?SYS>>/gi, '');
    removed.push('llm-delimiter');
  }

  // Stage 5 — Invisible Unicode (Cf category only)
  const invisibleUnicodeRegex = /[\p{Cf}]/gu;
  if (invisibleUnicodeRegex.test(cleaned)) {
    cleaned = cleaned.replace(/[\p{Cf}]/gu, '');
    removed.push('invisible-unicode');
  }

  // Stage 6 — HTML comments
  const htmlCommentRegex = /<!--[\s\S]*?-->/g;
  if (htmlCommentRegex.test(cleaned)) {
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    removed.push('html-comment');
  }

  // Strip dangerous attributes: aria-label, title, alt, data-* from all tags
  const dangerousAttrRegex = /\s(?:aria-label|title|alt|data-[a-zA-Z0-9_-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g;
  if (dangerousAttrRegex.test(cleaned)) {
    cleaned = cleaned.replace(/\s(?:aria-label|title|alt|data-[a-zA-Z0-9_-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
    removed.push('dangerous-attr');
  }

  return { cleaned, removed };
}

/**
 * sanitizeMarkdown — post-extraction sanitizer (stages 7-8).
 * Escapes markdown injection headers and normalizes whitespace.
 */
export function sanitizeMarkdown(md: string): SanitizeResult {
  const removed: string[] = [];
  let cleaned = md;

  // Stage 7 — Markdown injection: escape lines matching heading pattern
  const mdInjectionRegex = /^(#{1,3}\s*(System|Instructions|Tool Use|Assistant|Human))/im;
  if (mdInjectionRegex.test(cleaned)) {
    cleaned = cleaned.replace(/^(#{1,3}\s*(?:System|Instructions|Tool Use|Assistant|Human))/gim, '\\$1');
    removed.push('markdown-injection');
  }

  // Stage 8 — Whitespace normalization
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+$/gm, '');
  // Note: whitespace normalization is not tracked in removed[] as it's not a security removal

  return { cleaned, removed };
}
