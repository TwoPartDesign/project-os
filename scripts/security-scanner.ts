#!/usr/bin/env node
// security-scanner.ts — Secrets, PII, and privacy-leak detector for Project OS
// Usage: node scripts/security-scanner.ts <subcommand> [options]
// Subcommands: scan-files, scan-staged, scan-diff, scrub, list-rules, test-rules, test-pattern, install-hooks
// Requires Node 18+ (no npm dependencies)

import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================================
// Types
// ============================================================================

interface Rule {
  id: string;
  description: string;
  category: string;
  regex: RegExp | null;
  keywords: string[];
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entropy?: boolean;
  pathScope?: "non-code" | "all";
  pathScopeSkip?: string[];
  allowlist: {
    regexes: (string | RegExp)[];
    paths: string[];
    stopwords: string[];
  };
  testCases: Array<{ input: string; shouldMatch: boolean }>;
}

interface Finding {
  ruleId: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  file: string;
  line: number;
  match: string;
}

interface Allowlist {
  paths: { ignore: string[] };
  rules: { disable: string[] };
  inline: { marker: string };
  stopwords: string[];
}

interface ScanOptions {
  format: "text" | "json";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string | null;
  noEntropy: boolean;
  quiet: boolean;
  allowlistPath: string | null;
}

// ============================================================================
// Load rules (scan-rules.js is ESM with named exports; we use dynamic import
// via a synchronous-compatible workaround: createRequire for CJS or top-level
// await is unavailable here, so we use a lazy async bootstrap at the bottom)
// ============================================================================

// We defer rule loading to an async init because ESM dynamic import is needed.
let _rules: Rule[] = [];
let _categories: string[] = [];
let _entropyThreshold = 4.5;

async function loadRules(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rulesPath = resolve(__dirname, "lib/scan-rules.js");
  // On Windows, dynamic import() requires file:// URLs for absolute paths
  const rulesUrl = pathToFileURL(rulesPath).href;
  const mod = await import(rulesUrl) as {
    rules: Rule[];
    categories: string[];
    ENTROPY_THRESHOLD: number;
  };
  _rules = mod.rules;
  _categories = mod.categories;
  _entropyThreshold = mod.ENTROPY_THRESHOLD ?? 4.5;
}

// ============================================================================
// Project root detection
// ============================================================================

function getProjectRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"])
      .toString()
      .trim()
      .replace(/\\/g, "/");
  } catch {
    // Fall back to CWD if not in a git repo
    return process.cwd().replace(/\\/g, "/");
  }
}

// ============================================================================
// Allowlist loading
// ============================================================================

function loadAllowlist(projectRoot: string, extraPath: string | null): Allowlist {
  const defaultAllowlist: Allowlist = {
    paths: { ignore: [] },
    rules: { disable: [] },
    inline: { marker: "scan:allow" },
    stopwords: [],
  };

  const mainPath = join(projectRoot, ".claude/security/allowlist.json");
  let merged = { ...defaultAllowlist };

  if (existsSync(mainPath)) {
    try {
      const raw = JSON.parse(readFileSync(mainPath, "utf-8")) as Partial<Allowlist>;
      merged = mergeAllowlists(merged, raw);
    } catch {
      // Malformed JSON — warn but continue
      process.stderr.write(`Warning: could not parse ${mainPath}\n`);
    }
  }

  if (extraPath) {
    const absExtra = resolve(extraPath);
    if (existsSync(absExtra)) {
      try {
        const raw = JSON.parse(readFileSync(absExtra, "utf-8")) as Partial<Allowlist>;
        merged = mergeAllowlists(merged, raw);
      } catch {
        process.stderr.write(`Warning: could not parse ${absExtra}\n`);
      }
    } else {
      process.stderr.write(`Warning: allowlist file not found: ${absExtra}\n`);
    }
  }

  return merged;
}

function mergeAllowlists(base: Allowlist, extra: Partial<Allowlist>): Allowlist {
  return {
    paths: {
      ignore: [
        ...base.paths.ignore,
        ...(extra.paths?.ignore ?? []),
      ],
    },
    rules: {
      disable: [
        ...base.rules.disable,
        ...(extra.rules?.disable ?? []),
      ],
    },
    inline: {
      marker: extra.inline?.marker ?? base.inline.marker,
    },
    stopwords: [
      ...base.stopwords,
      ...(extra.stopwords ?? []),
    ],
  };
}

// ============================================================================
// Minimal glob matcher
// ============================================================================

function globToRegex(pattern: string): RegExp {
  // Escape all regex special chars except * and ?
  let regStr = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      regStr += ".*";
      i += 2;
      // Skip a trailing slash after ** if present
      if (pattern[i] === "/") i++;
    } else if (pattern[i] === "*") {
      regStr += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      regStr += ".";
      i++;
    } else {
      // Escape regex special characters
      regStr += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp("(^|/)" + regStr + "($|/)");
}

function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, "/");
  const rx = globToRegex(pattern);
  return rx.test(normalized) || rx.test("/" + normalized);
}

// ============================================================================
// Shannon entropy
// ============================================================================

function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  const len = str.length;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum + p * Math.log2(p);
  }, 0);
}

// ============================================================================
// Core scanner
// ============================================================================

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function scanContent(
  content: string,
  filePath: string,
  rules: Rule[],
  allowlist: Allowlist,
  options: ScanOptions,
): Finding[] {
  const findings: Finding[] = [];

  // 1. Check if entire file is ignored by path
  for (const pattern of allowlist.paths.ignore) {
    if (matchGlob(pattern, filePath)) {
      return [];
    }
  }

  const disabledRules = new Set(allowlist.rules.disable);
  const inlineMarker = allowlist.inline.marker;
  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // 3a. Inline suppression
    if (line.includes(inlineMarker)) continue;

    for (const rule of rules) {
      // Skip null regex rules (compile errors in scan-rules.js)
      if (!rule.regex) continue;

      // 2. Check if rule is disabled
      if (disabledRules.has(rule.id)) continue;

      // Severity filter
      if (SEVERITY_ORDER[rule.severity] > SEVERITY_ORDER[options.severity]) continue;

      // Category filter
      if (options.category && rule.category !== options.category) continue;

      // 3b. Keyword pre-filter (optimization)
      if (rule.keywords.length > 0) {
        const lineLower = line.toLowerCase();
        const hasKeyword = rule.keywords.some((kw) => lineLower.includes(kw.toLowerCase()));
        if (!hasKeyword) continue;
      }

      // Path scope filter
      if (rule.pathScope === "non-code" && rule.pathScopeSkip) {
        const skip = rule.pathScopeSkip.some((pattern) => matchGlob(pattern, filePath));
        if (skip) continue;
      }

      // Reset lastIndex for global regexes
      if (rule.regex.global) rule.regex.lastIndex = 0;

      let m: RegExpExecArray | null;
      // Use exec in a loop to handle global flag, but collect only first match per line
      // to avoid duplicate findings from overlapping patterns
      m = rule.regex.exec(line);
      if (!m) continue;

      const matchedText = m[0];
      const capturedGroup = m[1] ?? matchedText;

      // Rule-level allowlist regex check
      const blockedByRuleRegex = rule.allowlist.regexes.some((r) => {
        if (typeof r === "string") return new RegExp(r).test(matchedText);
        return r.test(matchedText);
      });
      if (blockedByRuleRegex) continue;

      // Rule-level stopwords
      if (rule.allowlist.stopwords.includes(matchedText)) continue;
      if (rule.allowlist.stopwords.includes(capturedGroup)) continue;

      // Global stopwords
      if (allowlist.stopwords.includes(matchedText)) continue;
      if (allowlist.stopwords.includes(capturedGroup)) continue;

      // Entropy check
      if (rule.entropy && !options.noEntropy) {
        const entropy = shannonEntropy(capturedGroup);
        if (entropy < _entropyThreshold) continue;
      }

      findings.push({
        ruleId: rule.id,
        description: rule.description,
        severity: rule.severity,
        category: rule.category,
        file: filePath,
        line: lineNum,
        match: matchedText,
      });

      // Reset for next iteration if global
      if (rule.regex.global) rule.regex.lastIndex = 0;
    }
  }

  // Sort by severity
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}

// ============================================================================
// Path validation
// ============================================================================

function validatePath(filePath: string, projectRoot: string): string {
  const abs = resolve(filePath);
  const absNorm = abs.replace(/\\/g, "/");
  const rootNorm = projectRoot.replace(/\\/g, "/");
  if (!absNorm.startsWith(rootNorm)) {
    process.stderr.write(`Error: path outside project root: ${filePath}\n`);
    process.exit(2);
  }
  return abs;
}

// ============================================================================
// Output formatting
// ============================================================================

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
};

function severityColor(severity: string): string {
  if (!process.stdout.isTTY) return "";
  switch (severity) {
    case "CRITICAL": return ANSI.bold + ANSI.red;
    case "HIGH": return ANSI.red;
    case "MEDIUM": return ANSI.yellow;
    case "LOW": return ANSI.cyan;
    default: return "";
  }
}

function colorReset(): string {
  return process.stdout.isTTY ? ANSI.reset : "";
}

function dim(s: string): string {
  return process.stdout.isTTY ? ANSI.gray + s + ANSI.reset : s;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

interface Summary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function buildSummary(findings: Finding[]): Summary {
  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "CRITICAL").length,
    high: findings.filter((f) => f.severity === "HIGH").length,
    medium: findings.filter((f) => f.severity === "MEDIUM").length,
    low: findings.filter((f) => f.severity === "LOW").length,
  };
}

function outputFindings(findings: Finding[], options: ScanOptions): void {
  const summary = buildSummary(findings);

  if (options.format === "json") {
    process.stdout.write(JSON.stringify({ findings, summary }, null, 2) + "\n");
    return;
  }

  if (options.quiet) {
    process.stdout.write(`${summary.total} findings\n`);
    return;
  }

  // Text mode
  for (const f of findings) {
    const col = severityColor(f.severity);
    const rst = colorReset();
    const sevPad = f.severity.padEnd(8);
    const loc = `${f.file}:${f.line}`;
    const matchStr = truncate(f.match.replace(/\n/g, "\\n"), 40);
    process.stdout.write(
      `${col}${sevPad}${rst}  ${dim(loc)}  ${f.ruleId}  ${matchStr}\n`,
    );
  }

  if (findings.length > 0) {
    process.stdout.write(
      `\nFound ${summary.total} findings (${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low)\n`,
    );
  } else {
    process.stdout.write("No findings.\n");
  }
}

// ============================================================================
// Subcommand: scan-files
// ============================================================================

function cmdScanFiles(
  filePaths: string[],
  projectRoot: string,
  allowlist: Allowlist,
  options: ScanOptions,
): void {
  if (filePaths.length === 0) {
    process.stderr.write("Error: scan-files requires at least one path argument\n");
    process.exit(2);
  }

  const allFindings: Finding[] = [];

  for (const rawPath of filePaths) {
    const absPath = validatePath(rawPath, projectRoot);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch (err) {
      process.stderr.write(`Warning: could not read ${absPath}: ${(err as Error).message}\n`);
      continue;
    }
    const relPath = relative(projectRoot, absPath).replace(/\\/g, "/");
    const found = scanContent(content, relPath, _rules, allowlist, options);
    allFindings.push(...found);
  }

  outputFindings(allFindings, options);
  process.exit(allFindings.length > 0 ? 1 : 0);
}

// ============================================================================
// Subcommand: scan-staged
// ============================================================================

function cmdScanStaged(
  projectRoot: string,
  allowlist: Allowlist,
  options: ScanOptions,
): void {
  let rawOutput: string;
  try {
    rawOutput = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
      cwd: projectRoot,
    }).toString();
  } catch (err) {
    process.stderr.write(`Error: git diff failed: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const files = rawOutput.split("\0").filter(Boolean);
  if (files.length === 0) {
    process.stdout.write("No staged files to scan.\n");
    process.exit(0);
  }

  const allFindings: Finding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = execFileSync("git", ["show", `:0:${file}`], {
        cwd: projectRoot,
      }).toString();
    } catch {
      // File might be deleted or binary — skip
      continue;
    }
    const found = scanContent(content, file, _rules, allowlist, options);
    allFindings.push(...found);
  }

  outputFindings(allFindings, options);
  process.exit(allFindings.length > 0 ? 1 : 0);
}

// ============================================================================
// Subcommand: scan-diff
// ============================================================================

function cmdScanDiff(
  baseBranch: string,
  projectRoot: string,
  allowlist: Allowlist,
  options: ScanOptions,
): void {
  let rawOutput: string;
  try {
    rawOutput = execFileSync(
      "git",
      ["diff", "--name-only", "-z", `${baseBranch}...HEAD`],
      { cwd: projectRoot },
    ).toString();
  } catch (err) {
    process.stderr.write(`Error: git diff failed: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const files = rawOutput.split("\0").filter(Boolean);
  if (files.length === 0) {
    process.stdout.write("No changed files to scan.\n");
    process.exit(0);
  }

  const allFindings: Finding[] = [];

  for (const file of files) {
    const absPath = resolve(projectRoot, file);
    if (!existsSync(absPath)) continue; // Deleted files

    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    const found = scanContent(content, file, _rules, allowlist, options);
    allFindings.push(...found);
  }

  outputFindings(allFindings, options);
  process.exit(allFindings.length > 0 ? 1 : 0);
}

// ============================================================================
// Subcommand: scrub
// ============================================================================

function cmdScrub(
  filePaths: string[],
  projectRoot: string,
  allowlist: Allowlist,
  options: ScanOptions,
): void {
  if (filePaths.length === 0) {
    process.stderr.write("Error: scrub requires at least one path argument\n");
    process.exit(2);
  }

  let totalRedacted = 0;
  // Use a low-severity options clone to catch everything
  const scrubOptions: ScanOptions = { ...options, severity: "LOW" };

  for (const rawPath of filePaths) {
    const absPath = validatePath(rawPath, projectRoot);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch (err) {
      process.stderr.write(`Warning: could not read ${absPath}: ${(err as Error).message}\n`);
      continue;
    }

    const relPath = relative(projectRoot, absPath).replace(/\\/g, "/");
    const findings = scanContent(content, relPath, _rules, allowlist, scrubOptions);

    if (findings.length === 0) continue;

    // Replace findings line-by-line to avoid corruption from overlapping matches
    const lines = content.split("\n");
    for (const f of findings) {
      const replacement = `[REDACTED:${f.ruleId}]`;
      const lineIdx = f.line - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        lines[lineIdx] = lines[lineIdx].replaceAll(f.match, replacement);
      }
      totalRedacted++;
    }
    const scrubbed = lines.join("\n");

    const tmpPath = absPath + ".tmp";
    try {
      writeFileSync(tmpPath, scrubbed, "utf-8");
      renameSync(tmpPath, absPath);
    } catch (err) {
      process.stderr.write(`Error: could not write ${absPath}: ${(err as Error).message}\n`);
      // Clean up tmp if possible
      try { renameSync(tmpPath, tmpPath + ".bak"); } catch { /* ignore */ }
    }
  }

  process.stderr.write(`Scrubbed ${totalRedacted} finding(s).\n`);
  process.exit(0);
}

// ============================================================================
// Subcommand: list-rules
// ============================================================================

function cmdListRules(): void {
  // Column widths
  const idW = Math.max(10, ..._rules.map((r) => r.id.length));
  const catW = Math.max(8, ..._rules.map((r) => r.category.length));
  const sevW = 8;

  const header = [
    "ID".padEnd(idW),
    "CATEGORY".padEnd(catW),
    "SEVERITY".padEnd(sevW),
    "DESCRIPTION",
  ].join("  ");

  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");

  for (const rule of _rules) {
    const line = [
      rule.id.padEnd(idW),
      rule.category.padEnd(catW),
      rule.severity.padEnd(sevW),
      rule.description,
    ].join("  ");
    process.stdout.write(line + "\n");
  }

  process.stdout.write(`\n${_rules.length} rules loaded across ${_categories.length} categories.\n`);
}

// ============================================================================
// Subcommand: test-rules
// ============================================================================

function cmdTestRules(allowlist: Allowlist, options: ScanOptions): void {
  let passed = 0;
  let failed = 0;
  let warned = 0;

  const noFilterOptions: ScanOptions = {
    ...options,
    severity: "LOW",
    category: null,
    noEntropy: true, // Entropy is deterministic; disable for testCase matching
  };

  for (const rule of _rules) {
    if (!rule.regex) {
      process.stdout.write(`SKIP  ${rule.id}  (null regex — compile error in scan-rules.js)\n`);
      warned++;
      continue;
    }

    if (rule.testCases.length === 0) {
      process.stdout.write(`WARN  ${rule.id}  (no test cases)\n`);
      warned++;
      continue;
    }

    let rulePassed = true;

    for (const tc of rule.testCases) {
      // Run the rule against a synthetic single-line "file"
      const findings = scanContent(
        tc.input,
        "test-input.txt",
        [rule],
        allowlist,
        noFilterOptions,
      );

      const didMatch = findings.length > 0;
      const ok = didMatch === tc.shouldMatch;

      if (!ok) {
        process.stdout.write(
          `FAIL  ${rule.id}  expected shouldMatch=${tc.shouldMatch} but got ${didMatch}\n` +
          `      input: ${truncate(tc.input, 80)}\n`,
        );
        rulePassed = false;
      }
    }

    if (rulePassed) {
      process.stdout.write(`PASS  ${rule.id}  (${rule.testCases.length} case(s))\n`);
      passed++;
    } else {
      failed++;
    }
  }

  process.stdout.write(
    `\n${passed} passed, ${failed} failed, ${warned} warned\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// Subcommand: test-pattern
// ============================================================================

async function cmdTestPattern(ruleId: string): Promise<void> {
  const rule = _rules.find((r) => r.id === ruleId);
  if (!rule) {
    process.stderr.write(`Error: rule not found: ${ruleId}\n`);
    process.stderr.write(`Available rules: ${_rules.map((r) => r.id).join(", ")}\n`);
    process.exit(2);
  }
  if (!rule.regex) {
    process.stderr.write(`Error: rule ${ruleId} has a null regex (compile error)\n`);
    process.exit(2);
  }

  process.stderr.write(`Testing rule: ${ruleId}\n`);
  process.stderr.write(`Regex: ${rule.regex}\n`);
  process.stderr.write(`Reading from stdin...\n\n`);

  const rl = createInterface({ input: process.stdin });
  let lineNum = 0;
  let matchCount = 0;

  for await (const line of rl) {
    lineNum++;
    if (rule.regex.global) rule.regex.lastIndex = 0;
    const m = rule.regex.exec(line);
    if (m) {
      matchCount++;
      process.stdout.write(`Line ${lineNum}: MATCH  "${truncate(m[0], 60)}"\n`);
    }
  }

  process.stdout.write(`\n${matchCount} match(es) across ${lineNum} line(s)\n`);
  process.exit(matchCount > 0 ? 0 : 1);
}

// ============================================================================
// Subcommand: install-hooks
// ============================================================================

function cmdInstallHooks(projectRoot: string): void {
  let gitDir: string;
  try {
    gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: projectRoot })
      .toString()
      .trim();
  } catch (err) {
    process.stderr.write(`Error: could not find .git directory: ${(err as Error).message}\n`);
    process.exit(2);
  }

  // Resolve relative git dir to absolute
  const absGitDir = resolve(projectRoot, gitDir);
  const hooksDir = join(absGitDir, "hooks");

  const preCommitContent = `#!/usr/bin/env bash
# Auto-installed by Project OS security scanner
node scripts/security-scanner.ts scan-staged
RESULT=$?
if [ $RESULT -ne 0 ]; then
  echo "Security scan failed. Commit blocked."
  echo "Use --no-verify to bypass (NOT recommended)."
  exit 1
fi
if [ -f "\${0}.local" ]; then
  bash "\${0}.local" "$@"
fi
`;

  const prePushContent = `#!/usr/bin/env bash
# Auto-installed by Project OS security scanner
BRANCH=$(git rev-parse --abbrev-ref HEAD)
node scripts/security-scanner.ts scan-diff "origin/$BRANCH"
RESULT=$?
if [ $RESULT -ne 0 ]; then
  echo "Security scan failed. Push blocked."
  echo "Use --no-verify to bypass (NOT recommended)."
  exit 1
fi
if [ -f "\${0}.local" ]; then
  bash "\${0}.local" "$@"
fi
`;

  const hooks: Array<{ name: string; content: string }> = [
    { name: "pre-commit", content: preCommitContent },
    { name: "pre-push", content: prePushContent },
  ];

  for (const hook of hooks) {
    const hookPath = join(hooksDir, hook.name);
    const ourMarker = "Auto-installed by Project OS security scanner";

    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf-8");
      if (!existing.includes(ourMarker)) {
        // Rename existing to .local to preserve it
        const localPath = hookPath + ".local";
        try {
          renameSync(hookPath, localPath);
          process.stderr.write(`Renamed existing ${hook.name} to ${hook.name}.local\n`);
        } catch (err) {
          process.stderr.write(
            `Warning: could not rename ${hookPath}: ${(err as Error).message}\n`,
          );
        }
      }
    }

    try {
      writeFileSync(hookPath, hook.content, "utf-8");
      chmodSync(hookPath, 0o755);
      process.stdout.write(`Installed ${hookPath}\n`);
    } catch (err) {
      process.stderr.write(`Error: could not write ${hookPath}: ${(err as Error).message}\n`);
      process.exit(2);
    }
  }

  process.stdout.write("Git hooks installed successfully.\n");
}

// ============================================================================
// CLI argument parsing
// ============================================================================

interface ParsedArgs {
  subcommand: string | null;
  positional: string[];
  options: ScanOptions;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // strip node + script path
  const positional: string[] = [];
  const options: ScanOptions = {
    format: "text",
    severity: "LOW",
    category: null,
    noEntropy: false,
    quiet: false,
    allowlistPath: null,
  };

  let subcommand: string | null = null;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--format":
        i++;
        if (args[i] === "json" || args[i] === "text") {
          options.format = args[i] as "text" | "json";
        } else {
          process.stderr.write(`Error: --format must be text or json\n`);
          process.exit(2);
        }
        break;
      case "--severity":
        i++;
        if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(args[i])) {
          options.severity = args[i] as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
        } else {
          process.stderr.write(`Error: --severity must be CRITICAL, HIGH, MEDIUM, or LOW\n`);
          process.exit(2);
        }
        break;
      case "--category":
        i++;
        options.category = args[i] ?? null;
        break;
      case "--allowlist":
        i++;
        options.allowlistPath = args[i] ?? null;
        break;
      case "--no-entropy":
        options.noEntropy = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        if (arg.startsWith("--")) {
          process.stderr.write(`Error: unknown option: ${arg}\n`);
          process.exit(2);
        }
        if (subcommand === null) {
          subcommand = arg;
        } else {
          positional.push(arg);
        }
    }
    i++;
  }

  return { subcommand, positional, options };
}

function printUsage(): void {
  process.stdout.write(`
Usage: node scripts/security-scanner.ts <subcommand> [options]

Subcommands:
  scan-files <path...>       Scan specific files
  scan-staged                Scan git staged files (pre-commit hook)
  scan-diff <base-branch>    Scan diff vs branch (ship workflow)
  scrub <path...>            Redact findings in-place
  list-rules                 List all loaded rules with categories
  test-rules                 Run built-in regression tests against all rules
  test-pattern <rule-id>     Test a specific rule against stdin
  install-hooks              Write pre-commit and pre-push hooks to .git/hooks/

Options:
  --format text|json         Output format (default: text)
  --severity LEVEL           Min severity: CRITICAL|HIGH|MEDIUM|LOW (default: LOW)
  --category CAT             Filter to category
  --allowlist PATH           Additional allowlist JSON file
  --no-entropy               Disable entropy checks
  --quiet                    Only output findings count + exit code
`.trimStart());
}

// ============================================================================
// Main entry point
// ============================================================================

async function main(): Promise<void> {
  await loadRules();

  const { subcommand, positional, options } = parseArgs(process.argv);
  const projectRoot = getProjectRoot();
  const allowlist = loadAllowlist(projectRoot, options.allowlistPath);

  switch (subcommand) {
    case "scan-files":
      cmdScanFiles(positional, projectRoot, allowlist, options);
      break;

    case "scan-staged":
      cmdScanStaged(projectRoot, allowlist, options);
      break;

    case "scan-diff": {
      const baseBranch = positional[0];
      if (!baseBranch) {
        process.stderr.write("Error: scan-diff requires a base-branch argument\n");
        process.exit(2);
      }
      cmdScanDiff(baseBranch, projectRoot, allowlist, options);
      break;
    }

    case "scrub":
      cmdScrub(positional, projectRoot, allowlist, options);
      break;

    case "list-rules":
      cmdListRules();
      break;

    case "test-rules":
      cmdTestRules(allowlist, options);
      break;

    case "test-pattern": {
      const ruleId = positional[0];
      if (!ruleId) {
        process.stderr.write("Error: test-pattern requires a rule-id argument\n");
        process.exit(2);
      }
      await cmdTestPattern(ruleId);
      break;
    }

    case "install-hooks":
      cmdInstallHooks(projectRoot);
      break;

    case null:
    case "--help":
    case "-h":
      printUsage();
      process.exit(0);
      break;

    default:
      process.stderr.write(`Error: unknown subcommand: ${subcommand}\n`);
      printUsage();
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  process.exit(2);
});
