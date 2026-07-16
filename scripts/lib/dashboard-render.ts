// dashboard-render.ts — Shared ROADMAP parsing + rendering helpers for dashboard-server.ts
// ES module, native TS (Node >=22.18 type-stripping): type-only syntax, no enums/namespaces.

import { existsSync, readFileSync } from "fs";

/** A single ROADMAP.md task line, parsed. */
export interface Task { id: string; title: string; marker: string; deps: string[] }

/** Escapes HTML-sensitive characters for safe interpolation into markup. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Parses a ROADMAP.md file into a Task map and per-marker totals.
 * Tolerates repeatable trailing `(model: ...)` / `(agent: ...)` annotations after `#TN`.
 *
 * Uses a two-phase linear parse rather than a single combined regex. A prior
 * single-regex version (`.+?` line body + repeatable `(?:\s+\(...\))*` annotation
 * group) was O(n^2) on adversarial input — catastrophic backtracking when a long
 * run of near-matching `(model: ...)`-shaped text failed to close cleanly — and
 * could freeze the dashboard's per-request/per-SSE-refresh render loop (see #T40).
 * Phase A strips trailing `(model: ...)` / `(agent: ...)` annotations with plain
 * string ops (endsWith/lastIndexOf), which is linear in line length. Phase B then
 * runs the original greedy line regex against the annotation-free remainder.
 * Do NOT collapse this back into one combined regex — that reintroduces the
 * quadratic backtracking this two-phase split exists to avoid.
 */
export function parseRoadmap(path: string) {
  const tasks = new Map<string, Task>();
  const totals: Record<string, number> = { "?": 0, " ": 0, "-": 0, "~": 0, ">": 0, x: 0, "!": 0 };
  if (!existsSync(path)) return { tasks, totals };
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      // Phase A: strip trailing annotation groups via linear string ops (no scanning regex on the full line).
      let s = line.trimEnd();
      while (s.endsWith(")")) {
        const i = s.lastIndexOf("(");
        if (i < 0) break;
        if (!/^\((?:model|agent):[^()]*\)$/.test(s.slice(i))) break;
        s = s.slice(0, i).trimEnd();
      }
      // Phase B: match the original linear greedy regex against the annotation-free remainder.
      const m = s.match(/^\s*-\s*\[(.)\]\s+(.+)\s+#(T\d+)$/);
      if (!m) continue;
      const [, marker, raw, id] = m;
      const depMatch = raw.match(/\(depends:\s*(#T\d+(?:,\s*#T\d+)*)\)/);
      const deps = depMatch ? (depMatch[1].match(/#T\d+/g) || []).map((d) => d.slice(1)) : [];
      const title = raw.replace(/\s*\(depends:.*?\)/, "").trim();
      tasks.set(id, { id, title: esc(title), marker, deps });
      if (marker in totals) totals[marker]++;
    }
  } catch { /* ignore */ }
  return { tasks, totals };
}

/** Marker -> [display label, CSS class] used by the status panel. */
export const statusLabels: Record<string, [string, string]> = {
  "?": ["Draft", "draft"], " ": ["Todo", "todo"], "-": ["WIP", "wip"],
  "~": ["Review", "review"], x: ["Done", "done"], "!": ["Blocked", "blocked"], ">": ["Racing", "racing"],
};

/** Marker -> hex fill color used by renderDag node styling. */
export const dagColors: Record<string, string> = {
  x: "#22c55e", "-": "#3b82f6", "~": "#a855f7", " ": "#94a3b8", "!": "#ef4444", "?": "#eab308", ">": "#f97316",
};

// Kanban column order. ">" (Racing) is conditional — see renderKanban.
const kanbanOrder = ["?", " ", "-", ">", "~", "x", "!"];

function renderKanbanCard(t: Task): string {
  const cls = t.marker === "!" ? "kanban-card blocked" : "kanban-card";
  const deps = t.deps.length ? `<div class="deps">depends: ${t.deps.map((d) => `#${d}`).join(" ")}</div>` : "";
  // t.title is already HTML-escaped by parseRoadmap — do NOT esc() it again here.
  return `<li class="${cls}"><span class="tid">#${t.id}</span> ${t.title}${deps}</li>`;
}

function renderKanbanCol(title: string, list: Task[]): string {
  const items = list.map(renderKanbanCard).join("");
  return `<section class="kanban-col" aria-label="${title}"><h3>${title} <span class="count">(${list.length})</span></h3><ul>${items}</ul></section>`;
}

/**
 * Renders the kanban board fragment: one column per ROADMAP marker.
 * Order: Draft, Todo, WIP, Racing, Review, Done, Blocked, then a trailing "Other"
 * column for unrecognized markers. Racing and Other only render when non-empty;
 * the other six columns always render (even with a zero count).
 */
export function renderKanban(tasks: Map<string, Task>): string {
  const byMarker = new Map<string, Task[]>();
  for (const [, t] of tasks) {
    const arr = byMarker.get(t.marker) || [];
    arr.push(t);
    byMarker.set(t.marker, arr);
  }
  let html = '<div class="kanban">';
  for (const marker of kanbanOrder) {
    const list = byMarker.get(marker) || [];
    byMarker.delete(marker);
    if (marker === ">" && list.length === 0) continue;
    const [label] = statusLabels[marker] || ["Other", "other"];
    html += renderKanbanCol(label, list);
  }
  const other: Task[] = [];
  for (const [, list] of byMarker) other.push(...list);
  if (other.length > 0) html += renderKanbanCol("Other", other);
  return html + "</div>";
}
