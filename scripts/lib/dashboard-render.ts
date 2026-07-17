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
 * Both phases are linear in line length — neither uses an unbounded-backtracking
 * regex against the full line. Two attack shapes forced this shape and must not
 * regress:
 *   - Annotation repeat (#T40 attempt 1): a single combined regex with `.+?` body
 *     + repeatable `(?:\s+\(...\))*` annotation group was O(n^2) — catastrophic
 *     backtracking when a long run of near-matching `(model: ...)`-shaped text
 *     failed to close cleanly.
 *   - Whitespace flood (#T40 attempt 2): even after splitting off Phase A, the
 *     remaining `/^\s*-\s*\[(.)\]\s+(.+)\s+#(T\d+)$/` still had a `(.+)\s+` pair
 *     that backtracks O(n^2) across a long run of INTERNAL whitespace when the
 *     line fails to end in `#T\d+` (e.g. `"- [ ] t" + " ".repeat(112640) + "y"`
 *     took ~8.65s to fail).
 *   - Nested-depends flood (#T40 attempt 3): the dep-extraction regex
 *     `/\(depends:\s*(#T\d+(?:,\s*#T\d+)*)\)/` scanning the title was O(n^2) on
 *     repeated "(depends: " prefixes (80KB -> ~470ms) — replaced with an
 *     index-based, 2KB-bounded window scan.
 * Both freeze the dashboard's per-request/per-SSE-refresh render loop, so no
 * `(.+)`-style (or otherwise backtracking) matching may be reintroduced here.
 *
 * Phase A strips trailing `(model: ...)` / `(agent: ...)` annotations with plain
 * string ops (endsWith/lastIndexOf) — linear in line length.
 * Phase B locates the trailing `#T<digits>` token by index (`lastIndexOf("#T")`,
 * mirroring the old regex's greedy-then-anchored-at-`$` behavior, which always
 * resolves to the LAST `#T` token) and validates the small head/tail slices with
 * bounded, non-backtracking regexes/checks instead of a single scanning regex
 * over the whole (possibly huge) line.
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
      // Phase B: index-based split instead of `/^\s*-\s*\[(.)\]\s+(.+)\s+#(T\d+)$/`.
      // Find the last "#T" token (the old regex, anchored at `$`, could only ever
      // resolve to this one — see docstring above), validate its tail is exactly
      // `#T<digits>` to end of string, then validate/extract the marker from a
      // bounded PREFIX match on the head. Every step below is O(head/tail length)
      // with no backtracking, so a huge internal whitespace run costs one linear
      // pass (slice/trimEnd), not O(n^2).
      const h = s.lastIndexOf("#T");
      if (h < 0) continue; // no task id present at all
      if (!/^#T\d+$/.test(s.slice(h))) continue; // tail must be exactly #T<digits> to end of string
      const head = s.slice(0, h);
      if (!/\s$/.test(head)) continue; // old regex required \s+ immediately before #TN
      const pm = /^\s*-\s*\[(.)\]\s+/.exec(head); // bounded prefix match — no trailing wildcard
      if (!pm) continue;
      const marker = pm[1];
      const id = s.slice(h + 1);
      const raw = head.slice(pm[0].length).trimEnd();
      if (raw.length === 0) continue; // old regex's (.+) required a non-empty title
      // Dep extraction: index-based + bounded window instead of the old scanning
      // regex /\(depends:\s*(#T\d+(?:,\s*#T\d+)*)\)/, which was O(n^2) on nested
      // "(depends: " floods (#T40 attempt 3 — third quadratic shape in this
      // function's history; see docstring). First "(depends:" occurrence wins;
      // legit dep lists are tiny, so anything without a ")" within 2048 chars is
      // treated as plain title text. The validation regex runs only on the small
      // bounded slice and is deterministic (no backtracking ambiguity).
      let deps: string[] = [];
      let title = raw;
      const d = raw.indexOf("(depends:");
      if (d >= 0) {
        const close = raw.indexOf(")", d);
        if (close >= 0 && close - d <= 2048) {
          const inner = raw.slice(d + 9, close);
          if (/^\s*#T\d+(?:,\s*#T\d+)*\s*$/.test(inner)) {
            deps = (inner.match(/#T\d+/g) || []).map((x) => x.slice(1));
          }
          // Mirror the old title strip (`\s*\(depends:.*?\)` removed, rest kept).
          title = (raw.slice(0, d).trimEnd() + raw.slice(close + 1)).trim();
        }
      }
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
