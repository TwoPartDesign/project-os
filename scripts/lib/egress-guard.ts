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
//
// The I/O half below (staging, scrub subprocess, positive re-scan) invokes
// security-scanner.ts as a CHILD PROCESS instead, for the same reason: its
// module top level runs a CLI `main()` on import.

import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, sep } from "node:path";

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
 * Redacts the value half of key/value pairs whose key matches
 * {@link isSensitiveKey}. The key charset is `[A-Za-z0-9_.-]+`. Two passes:
 *
 * 1. JSON-style quoted keys — `"key": "value"` / `"key": value` — replaced
 *    with `"key": "[REDACTED:key]"` / `"key": [REDACTED:key]`.
 * 2. Bare keys with a `=` or `:` separator, with optional whitespace on
 *    either side, and a bare, single-quoted, or double-quoted value:
 *    `key=value`, `KEY="value"`, `key = 'value'`, `key: value`. The
 *    separator is preserved exactly as written and any quotes around the
 *    value are dropped, so these become `key=[REDACTED:key]`,
 *    `key = [REDACTED:key]`, `key: [REDACTED:key]`.
 *
 * A bare value runs up to whitespace, `,`, `;`, or a double quote; a quoted
 * value runs to its matching closing quote. The bare-key pass refuses a key
 * immediately preceded by `"` so a JSON pair already handled by pass 1 is
 * never counted or rewritten twice. Only matched key/value pairs are touched
 * — prose is never scanned for the denylist words, so "missing
 * authentication" is untouched, as are non-sensitive keys (`file: x.ts`,
 * `path=foo`, `https://host:8443/x`). Returns the redacted line and the
 * number of pairs redacted.
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

  // key=value / key = 'value' / key: value (bare key, not already consumed
  // as part of a JSON-style match above). The `(?<!")` pins the no-double-
  // redaction invariant: a quoted key belongs to pass 1 only, and the guard
  // holds even if the leading character class is ever widened.
  const barePairRe =
    /(^|[\s,;])(?<!")([A-Za-z0-9_.-]+)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;"]+)/g;
  result = result.replace(barePairRe, (match, lead, key, sep, value) => {
    if (!isSensitiveKey(key)) return match;
    count++;
    return `${lead}${key}${sep}[REDACTED:key]`;
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
 * Minimum length for the hex-charset branch of {@link redactHighEntropyTokens}.
 * A 32-hex run is the shortest shape a real key (MD5-width, or a 128-bit
 * API key rendered as hex) takes.
 */
export const HEX_MIN_LEN = 32;

/**
 * Entropy floor for the hex-charset branch of {@link redactHighEntropyTokens}.
 * The general 4.0 bits/char floor is unreachable for a hex token — a
 * 16-symbol alphabet caps at log2(16) = 4.0, hit only by a perfectly uniform
 * distribution — so random 32/40/64-hex keys scored ~3.6–3.9 and passed
 * straight through. 3.0 clears a random hex run while leaving a degenerate
 * one (e.g. 40 repeated characters, entropy 0) alone.
 */
export const HEX_MIN_ENTROPY = 3.0;

/**
 * Context-free entropy floor. Replaces any token matching
 * `[A-Za-z0-9_\-/+=]{minLen,}` with `[REDACTED:entropy]` when either its
 * {@link shannonEntropy} is at or above `minEntropy`, or it is entirely
 * hex (`[0-9a-fA-F]`) of at least {@link HEX_MIN_LEN} characters with
 * entropy at or above {@link HEX_MIN_ENTROPY}. The hex branch exists
 * because the general floor is mathematically unreachable for a hex
 * charset (see {@link HEX_MIN_ENTROPY}).
 *
 * The token charset excludes `:`, `[`, and `]`, so a prior `[REDACTED:...]`
 * marker's fragments (`REDACTED`, the reason word) can never themselves join
 * into one match spanning the marker — at the default `minLen` of 24 both
 * fragments fall well short, so an existing marker is left unchanged and
 * never double-wrapped. Over-redaction of a git SHA or hash is accepted by
 * design (and the hex branch widens it): a missed observation never leaks, a
 * missed secret does. Returns the redacted line and the number of tokens
 * redacted.
 */
export function redactHighEntropyTokens(
  line: string,
  minLen = 24,
  minEntropy = 4.0,
): { line: string; count: number } {
  let count = 0;
  const tokenRe = new RegExp(`[A-Za-z0-9_\\-/+=]{${minLen},}`, "g");

  const result = line.replace(tokenRe, (match) => {
    const entropy = shannonEntropy(match);
    const hexKeyShaped =
      match.length >= HEX_MIN_LEN &&
      /^[0-9a-fA-F]+$/.test(match) &&
      entropy >= HEX_MIN_ENTROPY;
    if (entropy < minEntropy && !hexKeyShaped) return match;
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

// ============================================================================
// I/O half: staging, scrub subprocess, positive re-scan
// ============================================================================

/**
 * Defuses the security scanner's inline allow marker inside outbound text by
 * rewriting every case-insensitive occurrence of `scan:allow` to
 * `scan-allow`.
 *
 * The scanner honours `scan:allow` on a staged line (its inline marker, see
 * `scripts/security-scanner.ts`), which would make it skip that line in BOTH
 * the scrub pass and the positive re-scan — so a field carrying the marker
 * would come back "verified clean" without ever having been examined.
 * Neutralizing it before staging closes that hole. The rewrite is a
 * defusal, not a redaction: it is never counted as one.
 */
export function neutralizeScanMarkers(field: string): string {
  return field.replace(/scan:allow/gi, "scan-allow");
}

/**
 * Dependency bag for {@link guardEgressFields}: the project root the guard
 * operates under, an optional override for the staging directory (default
 * `<projectRoot>/.claude/logs/jev`), and optional stand-ins for the scrub
 * and re-scan subprocess calls. Tests pass `scrubCmd`/`scanCmd` stubs to
 * simulate scanner behavior without invoking the real CLI; production code
 * omits them and gets the real `node scripts/security-scanner.ts ...`
 * subprocess calls.
 */
export type GuardDeps = {
  projectRoot: string;
  egressDir?: string;
  scrubCmd?: (file: string) => { status: number };
  scanCmd?: (file: string) => { status: number };
};

/**
 * Resolves and creates the private staging directory for outbound-egress
 * scrubbing, refusing it unless it is genuinely inside `projectRoot`. A
 * symlinked or relocated directory — or a sibling whose path merely shares
 * `projectRoot`'s string prefix (e.g. `<root>-evil/...`) — must decline,
 * not silently stage text outside the project.
 *
 * Creates `egressDir` (default `<projectRoot>/.claude/logs/jev`) with
 * `mkdirSync(..., { recursive: true, mode: 0o700 })`, then compares the
 * `realpathSync` of the directory against the `realpathSync` of
 * `projectRoot`: the resolved directory must equal the resolved root or
 * start with the resolved root plus a path separator. Returns the resolved
 * directory path on success, or `null` if containment fails or any step
 * throws (e.g. the path cannot be created or resolved).
 */
export function resolveEgressDir(
  projectRoot: string,
  egressDir: string = join(projectRoot, ".claude/logs/jev"),
): string | null {
  try {
    mkdirSync(egressDir, { recursive: true, mode: 0o700 });
    const real = realpathSync(egressDir);
    const root = realpathSync(projectRoot);
    if (real === root || real.startsWith(root + sep)) return real;
    return null;
  } catch {
    return null;
  }
}

/**
 * Runs `node scripts/security-scanner.ts <args>` from `projectRoot` and
 * reports its exit status without ever throwing: a nonzero exit surfaces as
 * that status, and any other failure (a thrown error with no numeric
 * `status`, e.g. a spawn failure) maps to status `1`. This is the default
 * `scrubCmd`/`scanCmd` implementation for {@link guardEgressFields}.
 */
function runScannerCommand(
  projectRoot: string,
  args: string[],
): { status: number } {
  try {
    execFileSync(
      process.execPath,
      [join(projectRoot, "scripts/security-scanner.ts"), ...args],
      { cwd: projectRoot, stdio: "pipe" },
    );
    return { status: 0 };
  } catch (err) {
    const status = (err as { status?: number | null } | undefined)?.status;
    return { status: typeof status === "number" ? status : 1 };
  }
}

/**
 * Runs every field through {@link neutralizeScanMarkers} so no field can
 * carry the scanner's inline `scan:allow` marker into staging and buy itself
 * a skipped scrub and a vacuously clean re-scan, then stages the neutralized
 * fields one per line in a private file under the project's egress-scrub
 * directory, runs the project's security scanner on that file in a
 * subprocess to scrub any secrets it recognizes, and trusts the result only
 * after re-reading the file and positively re-scanning it clean. Only then
 * are the pure redactions from {@link redactFields} applied on top of the
 * scrubbed text. The returned fields carry the neutralized marker text; the
 * neutralization itself is not counted as a redaction.
 *
 * Fails closed: an unsafe staging directory, a staging-file write failure,
 * a scrub/scan subprocess that throws, a line-count mismatch after
 * scrubbing (proof the file was not read back honestly), or a non-clean
 * re-scan all refuse the whole call — never a partially-scrubbed result.
 * The scrub subprocess's own exit status is never trusted by itself (step
 * 3 of the design); only the positive re-scan in step 4 is. The staging
 * file and any `.tmp`/`.tmp.bak` residue the scanner may leave behind are
 * always removed before returning, on every path including a thrown
 * `scrubCmd`/`scanCmd`.
 */
export function guardEgressFields(
  fields: string[],
  deps: GuardDeps,
):
  | { fields: string[]; redactions: number }
  | { refused: "egress-dir-unsafe" | "scrub-failed" } {
  const safeFields = fields.map(neutralizeScanMarkers);

  const dir = resolveEgressDir(deps.projectRoot, deps.egressDir);
  if (dir === null) return { refused: "egress-dir-unsafe" };

  const fileName = `egress-${process.pid}-${randomBytes(6).toString("hex")}.txt`;
  const path = join(dir, fileName);

  const scrub =
    deps.scrubCmd ??
    ((file: string) => runScannerCommand(deps.projectRoot, ["scrub", file]));
  const scan =
    deps.scanCmd ??
    ((file: string) =>
      runScannerCommand(deps.projectRoot, ["scan-files", "--quiet", file]));

  try {
    try {
      const text = safeFields.map(escapeField).join("\n") + "\n";
      writeFileSync(path, text, { flag: "wx", mode: 0o600 });
    } catch {
      return { refused: "scrub-failed" };
    }

    try {
      // The scrub subprocess's own exit status is not trusted — only the
      // positive re-scan below decides whether the file is clean.
      scrub(path);
    } catch {
      return { refused: "scrub-failed" };
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return { refused: "scrub-failed" };
    }

    const stripped = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const lines = stripped.split("\n");
    if (lines.length !== safeFields.length) {
      return { refused: "scrub-failed" };
    }

    let scanResult: { status: number };
    try {
      scanResult = scan(path);
    } catch {
      return { refused: "scrub-failed" };
    }
    if (scanResult.status !== 0) {
      return { refused: "scrub-failed" };
    }

    const { fields: redactedFields, redactions } = redactFields(
      lines.map(unescapeField),
    );
    return { fields: redactedFields, redactions };
  } finally {
    for (const p of [path, path + ".tmp", path + ".tmp.bak"]) {
      try {
        rmSync(p, { force: true });
      } catch {
        // Best-effort cleanup; a locked file must not mask the real result.
      }
    }
  }
}
