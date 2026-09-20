// scripts/lib/egress-guard.ts — pure (no I/O, no subprocess) redaction
// primitives for the outbound-text egress guard. A later task appends the
// staging-file and scanner-subprocess half to this same file.
//
// SENSITIVE_KEY_RE is ported VERBATIM (character-for-character) from the
// `sensitivePatterns` regex inside `extractConfigKeys` in
// scripts/observation-parser.ts (not re-exported there, so this is a
// deliberate copy, not an import — see the parity test in
// tests/egress-guard.test.ts, which reads that file's source and asserts
// the regex literals are textually identical).
//
// shannonEntropy is reimplemented locally from the algorithm in
// scripts/security-scanner.ts (its own `shannonEntropy`, near line 265):
// bits-per-character Shannon entropy over the string's character frequency
// distribution. security-scanner.ts is NOT imported here — its module top
// level runs a CLI `main()` on import, which this pure module must not
// trigger.

/**
 * Denylist regex for sensitive key names, ported verbatim from the
 * `sensitivePatterns` local in `extractConfigKeys` (scripts/observation-parser.ts).
 * Tested against a key with `_`/`-` already stripped (see `isSensitiveKey`).
 */
export const SENSITIVE_KEY_RE =
  /SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY|PRIVATEKEY|AUTH/i;

/**
 * True when `key` matches the sensitive-key denylist. Mirrors
 * observation-parser.ts's `isSensitiveKey` exactly: the key is normalized by
 * stripping `_`/`-` (so `API_KEY`/`api-key`/`apiKey` all collapse to the same
 * shape) before testing against {@link SENSITIVE_KEY_RE}, which does not
 * strip separators itself.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key.replace(/[_-]/g, ""));
}

/**
 * Escapes a field for one-per-line staging: backslashes first, then
 * newlines and carriage returns, so a staged field never introduces an
 * extra line (line count stays equal to field count). Exact inverse of
 * {@link unescapeField}.
 */
export function escapeField(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/**
 * Exact inverse of {@link escapeField}. Unescapes in a single left-to-right
 * pass over `\\\\`, `\\n`, `\\r` (trying the two-backslash escape first at
 * each position) so a literal backslash-n sequence in the original — which
 * escapeField turns into `\\` + `n`, not `\n` — round-trips back to the two
 * literal characters instead of being mis-read as an escaped newline.
 * Three separate global replaces (unescape `\n`, then `\r`, then `\\`) get
 * this wrong: an escaped backslash immediately followed by a literal `n` or
 * `r` collides with the newline/CR escape sequence.
 */
export function unescapeField(s: string): string {
  return s.replace(/\\\\|\\n|\\r/g, (m) =>
    m === "\\\\" ? "\\" : m === "\\n" ? "\n" : "\r",
  );
}

/**
 * Redacts the value half of `key=value` and `"key": "value"` / `"key": value`
 * pairs whose key matches {@link isSensitiveKey}. The key charset is
 * `[A-Za-z0-9_.-]+`; the value is the run up to whitespace, `,`, `;`, or a
 * closing quote. Only matched key/value pairs are touched — prose is never
 * scanned for the denylist words, so "missing authentication" is untouched.
 * Returns the redacted line and the number of pairs redacted.
 */
export function redactSensitivePairs(line: string): {
  line: string;
  count: number;
} {
  let count = 0;

  // "key": "value"  or  "key": value
  const jsonPairRe =
    /"([A-Za-z0-9_.-]+)":\s*"([^"]*)"|"([A-Za-z0-9_.-]+)":\s*([^\s,;"]+)/g;
  let result = line.replace(jsonPairRe, (match, qKey, qVal, bKey, bVal) => {
    const key = qKey ?? bKey;
    if (!isSensitiveKey(key)) return match;
    count++;
    return qVal !== undefined
      ? `"${key}": "[REDACTED:key]"`
      : `"${key}": [REDACTED:key]`;
  });

  // key=value (bare, not already consumed as part of a JSON-style match)
  const barePairRe = /(^|[\s,;])([A-Za-z0-9_.-]+)=([^\s,;"]+)/g;
  result = result.replace(barePairRe, (match, lead, key, value) => {
    if (!isSensitiveKey(key)) return match;
    count++;
    return `${lead}${key}=[REDACTED:key]`;
  });

  return { line: result, count };
}

/**
 * Shannon entropy of `s` in bits per character (log base 2 over the
 * character frequency distribution), reimplemented from
 * scripts/security-scanner.ts's `shannonEntropy`. Returns 0 for an empty
 * string.
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  const len = s.length;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum + p * Math.log2(p);
  }, 0);
}

/**
 * Context-free entropy floor. Replaces any token matching
 * `[A-Za-z0-9_\-/+=]{minLen,}` whose {@link shannonEntropy} is at or above
 * `minEntropy` with `[REDACTED:entropy]`. The token charset excludes `:`,
 * `[`, and `]`, so a prior `[REDACTED:...]` marker's fragments (`REDACTED`,
 * the reason word) can never themselves join into one match spanning the
 * marker — at the default `minLen` of 24 both fragments fall well short,
 * so an existing marker is left unchanged and never double-wrapped.
 * Over-redaction of a git SHA or hash is accepted by design: a missed
 * observation never leaks, a missed secret does. Returns the redacted line
 * and the number of tokens redacted.
 */
export function redactHighEntropyTokens(
  line: string,
  minLen = 24,
  minEntropy = 4.0,
): { line: string; count: number } {
  let count = 0;
  const tokenRe = new RegExp(`[A-Za-z0-9_\\-/+=]{${minLen},}`, "g");

  const result = line.replace(tokenRe, (match) => {
    if (shannonEntropy(match) < minEntropy) return match;
    count++;
    return "[REDACTED:entropy]";
  });

  return { line: result, count };
}

/**
 * Applies {@link redactSensitivePairs} then {@link redactHighEntropyTokens}
 * to each field. Returns the redacted fields and the total redaction count
 * summed across both passes and all fields.
 */
export function redactFields(fields: string[]): {
  fields: string[];
  redactions: number;
} {
  let redactions = 0;
  const out = fields.map((field) => {
    const pairs = redactSensitivePairs(field);
    redactions += pairs.count;
    const entropy = redactHighEntropyTokens(pairs.line);
    redactions += entropy.count;
    return entropy.line;
  });
  return { fields: out, redactions };
}
