// scripts/lib/policy.ts — shared reader for .claude/maintenance-policy.yaml.
//
// Parsing semantics MUST stay in lockstep with two independent implementations
// that predate this shared lib and are not being refactored to call it:
//   - scripts/maintain.sh's `policy_raw_value` (anchored grep `^${key}:`, no
//     indentation match, first match wins, trailing `# comment` stripped,
//     value trimmed).
//   - scripts/system-map.ts's `loadBloatThreshold` (line-by-line trim/startsWith
//     scan, same comment-stripping rule).
// Flat `key: value` pairs only — deliberately no YAML library (linear-parse
// mandate; see docs/knowledge/patterns.md).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "./project-root.ts";

/**
 * Reads the raw string value for `key` from the maintenance policy file
 * (default `<projectRoot>/.claude/maintenance-policy.yaml`, override via
 * `policyPath`). Matches `^<key>:` at line start only — indented lines and
 * commented-out lines (`# key: value`) do not match, mirroring maintain.sh's
 * anchored-grep `policy_raw_value`. A trailing `# ...` comment on the matched
 * line is stripped before trimming. Returns the first match if `key` appears
 * more than once. Returns `null` if the file is missing, the key is absent,
 * or the resolved value is empty.
 */
export function readPolicyValue(key: string, policyPath?: string): string | null {
  const path = policyPath ?? resolve(getProjectRoot(), ".claude/maintenance-policy.yaml");
  if (!existsSync(path)) return null;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  const prefix = `${key}:`;
  for (const line of text.split("\n")) {
    // Anchored at line start, no leading whitespace allowed — matches the
    // bash `grep -E "^${key}:"` semantics (an indented or `#`-prefixed line
    // never starts with `${key}:`).
    if (!line.startsWith(prefix)) continue;
    let val = line.slice(prefix.length);
    const hashIdx = val.indexOf("#");
    if (hashIdx >= 0) val = val.slice(0, hashIdx);
    val = val.trim();
    return val === "" ? null : val;
  }
  return null;
}

/**
 * Reads a numeric policy value for `key`, falling back to `fallback` when the
 * file/key is missing, the value fails to coerce via `Number()`, is `NaN`, or
 * is negative.
 */
export function readPolicyNumber(key: string, fallback: number, policyPath?: string): number {
  const raw = readPolicyValue(key, policyPath);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) return fallback;
  return n;
}

/**
 * Reads a boolean policy flag for `key`. `"on"` and `"true"` resolve to
 * `true`; `"off"` and `"false"` resolve to `false`; any other value
 * (including missing file/key) falls back to `fallback`.
 */
export function readPolicyFlag(key: string, fallback: boolean, policyPath?: string): boolean {
  const raw = readPolicyValue(key, policyPath);
  if (raw === "on" || raw === "true") return true;
  if (raw === "off" || raw === "false") return false;
  return fallback;
}
