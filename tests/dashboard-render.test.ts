// tests/dashboard-render.test.ts
// Unit tests for scripts/lib/dashboard-render.ts (parseRoadmap, esc, renderKanban).
// Pattern follows tests/knowledge-index.test.ts: node:test + node:assert, one describe
// block per exported function, each test self-contained (own fixture file, no shared state).

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseRoadmap, renderKanban } from "../scripts/lib/dashboard-render.ts";
import type { Task } from "../scripts/lib/dashboard-render.ts";

/** Writes ROADMAP-format content to a fresh temp file and returns its path. */
function writeTmpRoadmap(content: string): string {
  const path = join(tmpdir(), `dashboard-render-test-${randomUUID()}.md`);
  writeFileSync(path, content, "utf-8");
  return path;
}

/** Counts non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ==========================================================================
// parseRoadmap
// ==========================================================================

describe("parseRoadmap", () => {
  it("parseRoadmap_allSevenMarkers_bucketed", () => {
    const fixture = [
      "- [?] Draft task #T1",
      "- [ ] Todo task #T2",
      "- [-] WIP task #T3",
      "- [~] Review task #T4",
      "- [>] Racing task #T5",
      "- [x] Done task #T6",
      "- [!] Blocked task #T7",
    ].join("\n");
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks, totals } = parseRoadmap(path);
      strictEqual(tasks.size, 7);
      deepStrictEqual(totals, { "?": 1, " ": 1, "-": 1, "~": 1, ">": 1, x: 1, "!": 1 });
      strictEqual(tasks.get("T1")?.marker, "?");
      strictEqual(tasks.get("T5")?.marker, ">");
      strictEqual(tasks.get("T7")?.marker, "!");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("parseRoadmap_agentSuffix_notDropped", () => {
    const fixture = "- [ ] Some task #T1 (agent: codex)";
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks } = parseRoadmap(path);
      strictEqual(tasks.size, 1);
      const t = tasks.get("T1");
      strictEqual(t?.id, "T1");
      strictEqual(t?.title, "Some task");
      strictEqual(t?.marker, " ");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("parseRoadmap_modelSuffix_notDropped", () => {
    const fixture = "- [ ] Some task #T1 (model: opus)";
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks } = parseRoadmap(path);
      strictEqual(tasks.size, 1);
      const t = tasks.get("T1");
      strictEqual(t?.id, "T1");
      strictEqual(t?.title, "Some task");
      strictEqual(t?.marker, " ");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("parseRoadmap_bothSuffixes_notDropped", () => {
    const fixture = "- [ ] Some task #T1 (model: opus) (agent: codex)";
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks } = parseRoadmap(path);
      strictEqual(tasks.size, 1);
      const t = tasks.get("T1");
      strictEqual(t?.id, "T1");
      strictEqual(t?.title, "Some task");
      strictEqual(t?.marker, " ");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("parseRoadmap_plainLine_unchangedFields", () => {
    const fixture = "- [ ] Build the login page (depends: #T1, #T2) #T9";
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks } = parseRoadmap(path);
      const t = tasks.get("T9");
      strictEqual(t?.id, "T9");
      strictEqual(t?.title, "Build the login page");
      deepStrictEqual(t?.deps, ["T1", "T2"]);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("parseRoadmap_realRoadmap_parses", () => {
    const roadmapPath = fileURLToPath(new URL("../ROADMAP.md", import.meta.url));
    const { tasks } = parseRoadmap(roadmapPath);
    ok(tasks.size > 0, `expected at least one parsed task, got ${tasks.size}`);
  });
});

// ==========================================================================
// renderKanban
// ==========================================================================

describe("renderKanban", () => {
  it("renderKanban_columns_presentAndConditional", () => {
    // Racing column present when a `>` task exists.
    const withRacing = new Map<string, Task>([
      ["T1", { id: "T1", title: "Racing task", marker: ">", deps: [] }],
    ]);
    ok(renderKanban(withRacing).includes('aria-label="Racing"'));

    // Racing column absent when no `>` task exists.
    const withoutRacing = new Map<string, Task>([
      ["T2", { id: "T2", title: "Todo task", marker: " ", deps: [] }],
    ]);
    ok(!renderKanban(withoutRacing).includes('aria-label="Racing"'));

    // Unknown marker routes to the trailing "Other" column.
    const withUnknown = new Map<string, Task>([
      ["T3", { id: "T3", title: "Weird task", marker: "@", deps: [] }],
    ]);
    ok(renderKanban(withUnknown).includes('aria-label="Other"'));

    // No unknown marker -> no "Other" column.
    const knownOnly = new Map<string, Task>([
      ["T4", { id: "T4", title: "Known task", marker: "x", deps: [] }],
    ]);
    ok(!renderKanban(knownOnly).includes('aria-label="Other"'));
  });

  it("renderKanban_taskCard_idTitleDepsRendered", () => {
    const tasks = new Map<string, Task>([
      ["T5", { id: "T5", title: "Fix bug", marker: " ", deps: ["T1", "T2"] }],
    ]);
    const html = renderKanban(tasks);
    ok(html.includes('<span class="tid">#T5</span> Fix bug'));
    ok(html.includes('<div class="deps">depends: #T1 #T2</div>'));
  });

  it("renderKanban_blockedTask_flaggedDistinct", () => {
    const tasks = new Map<string, Task>([
      ["T1", { id: "T1", title: "Blocked task", marker: "!", deps: [] }],
      ["T2", { id: "T2", title: "Normal task", marker: " ", deps: [] }],
    ]);
    const html = renderKanban(tasks);
    ok(html.includes('<li class="kanban-card blocked"><span class="tid">#T1</span> Blocked task</li>'));
    ok(html.includes('<li class="kanban-card"><span class="tid">#T2</span> Normal task</li>'));
    ok(!html.includes('<li class="kanban-card blocked"><span class="tid">#T2</span>'));
  });

  it("renderKanban_escapedTitle_notDoubleEscaped", () => {
    const fixture = "- [ ] a<script>b #T1";
    const path = writeTmpRoadmap(fixture);
    try {
      const { tasks } = parseRoadmap(path);
      strictEqual(tasks.get("T1")?.title, "a&lt;script&gt;b");
      const html = renderKanban(tasks);
      strictEqual(countOccurrences(html, "a&lt;script&gt;b"), 1);
      ok(!html.includes("&amp;lt;"));
      ok(!html.includes("<script>"));
    } finally {
      rmSync(path, { force: true });
    }
  });
});
