// tests/agent-roster.test.ts
// Repo invariants for the agent roster and the model-routing guidance.
//
// Two classes of silent rot this guards:
//   1. An edit to `.claude/agents/*.md` that makes Claude Code skip the file
//      (bad frontmatter, wrong `name`, a model/effort value off the ladder),
//      so the agent silently stops being registered and every dispatch that
//      names it falls back or halts.
//   2. A retired tier (`haiku`) or a dated model id (`claude-sonnet-4-5`,
//      `claude-3-5-sonnet-20241022`) creeping back into live guidance, where
//      it becomes routing advice the Lead follows.
//
// node:test + node:assert, stdlib only, each test self-contained, real files
// read from disk. All globs are anchored at the literal directories named in
// docs/specs/fable-orchestrator-alignment/design.md; `.claude/worktrees/**`
// holds stale command copies and is never read.

import { describe, it } from "node:test";
import { ok, deepStrictEqual, throws } from "node:assert";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The six registered agents. Filename stem === frontmatter `name`. */
const ROSTER_NAMES: readonly string[] = [
  "documenter",
  "implementer",
  "researcher",
  "reviewer-architecture",
  "reviewer-security",
  "reviewer-tests",
];

/**
 * Agent types the Claude Code CLI provides itself. This list is coupled to the
 * installed CLI version — when the CLI adds or renames a built-in, this list
 * must be updated by hand; nothing in the repo can derive it.
 *
 * `general-purpose` is deliberately absent: it is the fallback the roster
 * exists to replace, so it is accepted only in the files named by
 * GENERAL_PURPOSE_ALLOWED_FILES below.
 */
const BUILTIN_SUBAGENT_TYPES: readonly string[] = [
  "Explore",
  "Plan",
  "claude-code-guide",
  "claude",
  "statusline-setup",
];

/**
 * The only files allowed to dispatch `general-purpose`. A command that reverts
 * to it anywhere else — with a pasted role paragraph in place of a roster file
 * — is the exact regression this suite exists to catch, so it must fail.
 */
const GENERAL_PURPOSE_ALLOWED_FILES: readonly string[] = [
  ".claude/commands/tools/dream.md",
];

/**
 * Top-level `.claude/agents/*.md` files that are reference docs, not agents,
 * and so carry no frontmatter. `adapters/` is excluded structurally — the
 * agent-file sweep reads only the top level.
 */
const NON_AGENT_FILES: readonly string[] = ["roles.md", "handoffs.md"];

/** The agent that each spawn file must dispatch by literal name. */
const SPAWN_FILE_EXPECTED_AGENTS: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  [".claude/commands/workflows/build.md", ["implementer", "documenter"]],
  [
    ".claude/commands/workflows/review.md",
    ["reviewer-architecture", "reviewer-security", "reviewer-tests"],
  ],
  [".claude/commands/workflows/design.md", ["reviewer-architecture"]],
  [".claude/commands/workflows/compete.md", ["implementer"]],
  [".claude/commands/workflows/compete-review.md", ["reviewer-architecture"]],
  [".claude/commands/tools/research.md", ["researcher"]],
];

const VALID_MODELS = new Set(["sonnet", "opus", "fable", "inherit"]);
const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** The literal string every `reviewer-*` body must teach. */
const FINDING_FORMAT = "SEVERITY / FILE:LINES / ISSUE / FIX";

/** Opt-out marker for a guidance line that legitimately names a retired tier. */
const ALLOW_MARKER = "<!-- roster-test: allow -->";

type FrontmatterValue = string | string[];

interface Frontmatter {
  /** Top-level keys to values. A container key (`key:` with no value) is `""`. */
  fields: Record<string, FrontmatterValue>;
  /** Keys whose scalar value was written as a double-quoted string. */
  quotedKeys: Set<string>;
}

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

/**
 * Parse the YAML frontmatter block Claude Code reads from an agent file.
 *
 * Returns `null` when the file has no frontmatter (line 1 is not `---`), which
 * is legal for a plain reference doc but disqualifies the file from being a
 * registered agent. Throws when a frontmatter line has a shape the reader
 * cannot classify, naming the line — Claude Code would skip such a file
 * silently, so a test failure is the only signal.
 *
 * Recognised line shapes between the delimiters: blank lines and `#` comments
 * (skipped); lines indented at column > 0 (nested children, skipped); `key:`
 * with an empty value (a container, recorded with value `""`); `key: [a, b]`
 * (flow list, parsed to an array); `key: "text with: colons"` (quoted scalar);
 * `key: bare-scalar`.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new Error(
      "frontmatter opened with `---` on line 1 but never closed with a `---` line",
    );
  }

  const fields: Record<string, FrontmatterValue> = {};
  const quotedKeys = new Set<string>();

  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === "") continue;
    if (line.trimStart().startsWith("#")) continue;
    // First non-space column > 0 => a child of the previous container key.
    if (/^\s/.test(line)) continue;

    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (!m) {
      throw new Error(
        `unparseable frontmatter on line ${lineNo}: ${JSON.stringify(line)} — ` +
          'expected `key:`, `key: value`, `key: [a, b]`, or `key: "quoted value"`',
      );
    }

    const key = m[1];
    const raw = (m[2] ?? "").trim();

    if (raw === "") {
      fields[key] = "";
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      fields[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      continue;
    }
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      fields[key] = raw.slice(1, -1);
      quotedKeys.add(key);
      continue;
    }
    fields[key] = raw;
  }

  return { fields, quotedKeys };
}

/** Top-level `.claude/agents/*.md` paths, relative to the repo root. */
function topLevelAgentFiles(): string[] {
  const dir = resolve(ROOT, ".claude", "agents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => `.claude/agents/${f}`)
    .sort();
}

/**
 * `*.md` files under one literal directory, recursively. Anchored at the
 * directory given — never a walk from `.claude/` — and any path segment named
 * `worktrees` is skipped, since worktrees hold stale copies of command files.
 */
function markdownFilesUnder(relDir: string): string[] {
  const dir = resolve(ROOT, relDir);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, {
    recursive: true,
    encoding: "utf-8",
  })) {
    const rel = entry.split(/[\\/]/);
    if (rel.includes("worktrees")) continue;
    if (!entry.endsWith(".md")) continue;
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    out.push(`${relDir}/${rel.join("/")}`);
  }
  return out.sort();
}

/** Files swept for retired tiers and dated model ids. Explicit, never a walk. */
function guidanceFiles(): string[] {
  const dirs = [
    ".claude/commands",
    ".claude/rules",
    ".claude/agents",
    ".claude/skills",
  ];
  const singles = [
    "CLAUDE.md",
    "CLAUDE.template.md",
    "README.md",
    "project-os-guide.md",
    "docs/knowledge/architecture.md",
    "docs/knowledge/design-principles.md",
    "docs/knowledge/patterns.md",
    "docs/knowledge/roadmap-format.md",
    "docs/knowledge/multi-agent-judging.md",
  ];
  const out: string[] = [];
  for (const d of dirs) out.push(...markdownFilesUnder(d));
  for (const f of singles) if (existsSync(resolve(ROOT, f))) out.push(f);
  return out;
}

// ==========================================================================
// Roster registration
// ==========================================================================

/**
 * Every registration rule Claude Code applies to an agent file, checked against
 * one already-parsed frontmatter block. Returns human-readable problems; an
 * empty list means the file registers. Pure — no shared state between callers.
 */
function registrationProblems(rel: string, fm: Frontmatter): string[] {
  const problems: string[] = [];
  const stem = basename(rel, ".md");
  const f = fm.fields;

  if (f.name !== stem) {
    problems.push(
      `${rel}: name is ${JSON.stringify(f.name)}, must equal the filename stem "${stem}"`,
    );
  }
  if (typeof f.description !== "string" || f.description.length === 0) {
    problems.push(`${rel}: description is missing or empty`);
  } else if (!fm.quotedKeys.has("description")) {
    problems.push(
      `${rel}: description must be a double-quoted string (it contains commas and colons)`,
    );
  }
  if (typeof f.model !== "string" || !VALID_MODELS.has(f.model)) {
    problems.push(
      `${rel}: model is ${JSON.stringify(f.model)}, must be one of ${[...VALID_MODELS].join(", ")}`,
    );
  }
  if (typeof f.effort !== "string" || !VALID_EFFORTS.has(f.effort)) {
    problems.push(
      `${rel}: effort is ${JSON.stringify(f.effort)}, must be one of ${[...VALID_EFFORTS].join(", ")}`,
    );
  }
  if (
    !Array.isArray(f.disallowedTools) ||
    !f.disallowedTools.includes("Agent")
  ) {
    problems.push(
      `${rel}: disallowedTools is ${JSON.stringify(f.disallowedTools)}, must include "Agent" — fan-out is the Lead's job`,
    );
  }
  return problems;
}

describe("agent roster registration", () => {
  it("roster_everyRosterName_hasValidRegistration", () => {
    // Driven by ROSTER_NAMES, not by what the files happen to contain: a file
    // that drops `name:`, `model:` or its whole frontmatter must fail here.
    const problems: string[] = [];
    for (const name of ROSTER_NAMES) {
      const rel = `.claude/agents/${name}.md`;
      if (!existsSync(resolve(ROOT, rel))) {
        problems.push(
          `${rel}: file does not exist, so "${name}" is not a registered agent`,
        );
        continue;
      }
      const fm = parseFrontmatter(read(rel));
      if (fm === null) {
        problems.push(
          `${rel}: no YAML frontmatter, so Claude Code never registers "${name}"`,
        );
        continue;
      }
      problems.push(...registrationProblems(rel, fm));
    }
    ok(
      problems.length === 0,
      `invalid roster registrations:\n${problems.join("\n")}`,
    );
  });

  it("roster_everyNonReferenceAgentFile_hasNameAndDescription", () => {
    // Sweep over extra agent files beyond the six. `roles.md` and
    // `handoffs.md` are reference docs; `adapters/` is excluded structurally
    // because topLevelAgentFiles() reads only the top level.
    const problems: string[] = [];
    for (const rel of topLevelAgentFiles()) {
      if (NON_AGENT_FILES.includes(basename(rel))) continue;
      const stem = basename(rel, ".md");
      const fm = parseFrontmatter(read(rel));
      if (fm === null) {
        problems.push(
          `${rel}: no YAML frontmatter — every .claude/agents/*.md file except ${NON_AGENT_FILES.join(", ")} must register`,
        );
        continue;
      }
      if (fm.fields.name !== stem) {
        problems.push(
          `${rel}: name is ${JSON.stringify(fm.fields.name)}, must equal the filename stem "${stem}"`,
        );
      }
      const description = fm.fields.description;
      if (typeof description !== "string" || description.length === 0) {
        problems.push(`${rel}: description is missing or empty`);
      }
    }
    ok(
      problems.length === 0,
      `these .claude/agents/*.md files do not carry a valid name+description registration:\n${problems.join("\n")}`,
    );
  });

  it("roster_fileWithoutFrontmatter_isNotARosterName", () => {
    // roles.md and handoffs.md are reference docs, not agents. If one ever
    // takes a roster name it would look registered and never load.
    const unregistered: string[] = [];
    for (const rel of topLevelAgentFiles()) {
      if (parseFrontmatter(read(rel)) !== null) continue;
      unregistered.push(basename(rel, ".md"));
    }
    const collisions = unregistered.filter((n) => ROSTER_NAMES.includes(n));
    deepStrictEqual(
      collisions,
      [],
      `these .claude/agents/*.md files have no frontmatter yet carry a roster name, so the agent is unregistered: ${collisions.join(", ")}`,
    );
  });

  it("roster_frontmatterParseFailure_failsWithLine", () => {
    // Malformed: `name implementer` has no colon, so the reader cannot
    // classify it and must say which line.
    throws(
      () => parseFrontmatter("---\nname implementer\n---\n"),
      (err: unknown) => {
        const msg = (err as Error).message;
        ok(
          msg.includes("line 2"),
          `parse error must name the offending line number, got: ${msg}`,
        );
        ok(
          msg.includes("name implementer"),
          `parse error must quote the offending line text, got: ${msg}`,
        );
        return true;
      },
    );

    // Well-formed: a nested block, a flow list, and a quoted value that
    // contains a colon.
    const wellFormed = [
      "---",
      "name: implementer",
      "# a comment line",
      'description: "Implements one task: exactly as specified, with tests."',
      "model: opus",
      "disallowedTools: [Agent, Task]",
      "permissions:",
      "  read: [specs, knowledge]",
      "  write: [code, tests]",
      "---",
      "",
      "# Implementer Agent",
      "",
    ].join("\n");
    const parsed = parseFrontmatter(wellFormed);
    ok(parsed !== null, "a file starting with `---` must parse to frontmatter");
    deepStrictEqual(parsed!.fields, {
      name: "implementer",
      description: "Implements one task: exactly as specified, with tests.",
      model: "opus",
      disallowedTools: ["Agent", "Task"],
      permissions: "",
    });
    deepStrictEqual([...parsed!.quotedKeys], ["description"]);

    // No frontmatter at all.
    deepStrictEqual(parseFrontmatter("# Roles\n\nAdvisory only.\n"), null);
  });
});

// ==========================================================================
// Agent bodies
// ==========================================================================

describe("agent bodies", () => {
  it("roster_reviewerBodies_containFindingFormat", () => {
    const missing: string[] = [];
    for (const rel of topLevelAgentFiles()) {
      if (!basename(rel).startsWith("reviewer-")) continue;
      if (!read(rel).includes(FINDING_FORMAT)) missing.push(rel);
    }
    ok(
      missing.length === 0,
      `these reviewer bodies do not teach the literal finding format "${FINDING_FORMAT}": ${missing.join(", ")}`,
    );
  });

  it("roster_everyBody_containsReportHeading", () => {
    const missing: string[] = [];
    for (const name of ROSTER_NAMES) {
      const rel = `.claude/agents/${name}.md`;
      if (!existsSync(resolve(ROOT, rel))) {
        missing.push(`${rel} (file does not exist)`);
        continue;
      }
      if (!read(rel).includes("## Report")) missing.push(rel);
    }
    ok(
      missing.length === 0,
      `these roster bodies are missing the "## Report" contract heading: ${missing.join(", ")}`,
    );
  });
});

// ==========================================================================
// Command dispatch sites
// ==========================================================================

describe("command dispatch sites", () => {
  it("commands_everySubagentType_namesRosterOrBuiltin", () => {
    const known = new Set<string>([...ROSTER_NAMES, ...BUILTIN_SUBAGENT_TYPES]);
    const offenders: string[] = [];
    for (const rel of markdownFilesUnder(".claude/commands")) {
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const m of line.matchAll(
          /subagent_type:\s*["']?([A-Za-z0-9_-]+)["']?/g,
        )) {
          const named = m[1];
          if (named === "general-purpose") {
            if (!GENERAL_PURPOSE_ALLOWED_FILES.includes(rel)) {
              offenders.push(
                `${rel}:${i + 1} -> general-purpose (allowed only in ${GENERAL_PURPOSE_ALLOWED_FILES.join(", ")})`,
              );
            }
            continue;
          }
          if (!known.has(named)) offenders.push(`${rel}:${i + 1} -> ${named}`);
        }
      });
    }
    ok(
      offenders.length === 0,
      "these dispatch sites name an agent type that is neither a roster file nor a permitted CLI built-in.\n" +
        `The built-in list (${BUILTIN_SUBAGENT_TYPES.join(", ")}) is CLI-version-coupled: ` +
        "if the CLI added or renamed a built-in, update BUILTIN_SUBAGENT_TYPES in this test.\n" +
        "`general-purpose` is not on that list: it is the fallback the roster replaces, " +
        `and is accepted only in ${GENERAL_PURPOSE_ALLOWED_FILES.join(", ")}.\n` +
        offenders.join("\n"),
    );
  });

  it("commands_sixSpawnFiles_nameTheirExpectedRosterAgents", () => {
    // Not a substring check: each file must name every agent the design maps
    // to it, by a literal roster name. review.md dropping a reviewer, or
    // build.md naming reviewer-tests, has to fail here.
    const offenders: string[] = [];
    for (const [rel, expected] of SPAWN_FILE_EXPECTED_AGENTS) {
      if (!existsSync(resolve(ROOT, rel))) {
        offenders.push(`${rel}: file does not exist`);
        continue;
      }
      const named = new Set<string>();
      for (const m of read(rel).matchAll(
        /subagent_type:\s*["']?([A-Za-z0-9_-]+)["']?/g,
      )) {
        named.add(m[1]);
      }
      if (named.size === 0) {
        offenders.push(
          `${rel}: no literal \`subagent_type:\` line, so dispatch is left to prose`,
        );
        continue;
      }
      const missing = expected.filter((n) => !named.has(n));
      if (missing.length > 0) {
        offenders.push(
          `${rel}: expected ${expected.join(", ")}; missing ${missing.join(", ")} (found ${[...named].sort().join(", ")})`,
        );
      }
      const nonRoster = [...named].filter((n) => !ROSTER_NAMES.includes(n));
      if (nonRoster.length > 0) {
        offenders.push(
          `${rel}: dispatches ${nonRoster.join(", ")}, which is not a roster name`,
        );
      }
    }
    ok(
      offenders.length === 0,
      `these commands do not dispatch the roster agents the design maps to them:\n${offenders.join("\n")}`,
    );
  });
});

// ==========================================================================
// Live model-routing guidance
// ==========================================================================

describe("model-routing guidance", () => {
  it("guidance_allowlist_hasNoRetiredTierOrDatedId", () => {
    const patterns: ReadonlyArray<{ re: RegExp; why: string }> = [
      { re: /\bhaiku\b/i, why: "retired tier" },
      { re: /claude-(opus|sonnet|haiku|fable)-[0-9]/, why: "dated model id" },
      { re: /claude-[a-z0-9.-]*\d{6,}/, why: "dated model id" },
    ];
    const offenders: string[] = [];
    for (const rel of guidanceFiles()) {
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(ALLOW_MARKER)) return;
        for (const { re, why } of patterns) {
          if (re.test(line)) {
            offenders.push(`${rel}:${i + 1} (${why}) -> ${line.trim()}`);
            return;
          }
        }
      });
    }
    ok(
      offenders.length === 0,
      "live guidance still names a retired tier or a dated model id. " +
        `The ladder is sonnet -> opus -> fable on bare aliases. Add "${ALLOW_MARKER}" ` +
        "to a line that legitimately names one (e.g. prose about the retirement itself).\n" +
        offenders.join("\n"),
    );
  });
});
