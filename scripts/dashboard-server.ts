#!/usr/bin/env node
// dashboard-server.ts — Live-updating Project OS dashboard with SSE and Mermaid DAG
// Usage: node scripts/dashboard-server.ts [--port 3400] [--projects-root ~/projects]
// Requires Node 22.16+ (native TypeScript, node:sqlite FTS5) or bun

import { existsSync, readFileSync, watch } from "fs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { resolve } from "path";
import { homedir } from "os";
import { parseRoadmap, esc, statusLabels, dagColors, renderKanban, type Task } from "./lib/dashboard-render.ts";

let port = 3400;
let projectsRoot = "";
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--port") { if (++i >= process.argv.length) { console.error("Missing value for --port"); process.exit(1); } port = parseInt(process.argv[i], 10); if (isNaN(port) || port < 1 || port > 65535) { console.error("Invalid port"); process.exit(1); } }
  if (process.argv[i] === "--projects-root") { if (++i >= process.argv.length) { console.error("Missing value for --projects-root"); process.exit(1); } projectsRoot = process.argv[i]; }
}

if (!projectsRoot) {
  const sp = resolve(".claude/settings.json");
  try { projectsRoot = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf-8")).project_os?.dashboard?.projects_root || "~/projects" : "~/projects"; }
  catch { projectsRoot = "~/projects"; }
}
projectsRoot = projectsRoot.replace(/^~/, homedir());
// projectsRoot is parsed for future cross-project scanning (matching dashboard.sh behavior)

function parseActivity(path: string) {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").split("\n").filter((l) => l.trim()).slice(-20)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function renderStatus(totals: Record<string, number>): string {
  let h = '<table><tr><th>Status</th><th>Count</th></tr>';
  for (const [k, [label, cls]] of Object.entries(statusLabels))
    h += `<tr><td><span class="m ${cls}">${label}</span></td><td>${totals[k] || 0}</td></tr>`;
  return h + "</table>";
}

function renderDag(tasks: Map<string, Task>): string {
  if (tasks.size === 0) return '<p style="color:#999">No tasks found</p>';
  let dag = "graph TD\n";
  for (const [, t] of tasks) {
    dag += `  ${t.id}["${t.title.substring(0, 40)}"]\n`;
    dag += `  style ${t.id} fill:${dagColors[t.marker] || "#94a3b8"},stroke:#333,color:#000\n`;
  }
  for (const [, t] of tasks) for (const dep of t.deps) dag += `  ${dep} --> ${t.id}\n`;
  return `<pre class="mermaid">${dag}</pre>`;
}

function renderActivity(events: any[]): string {
  if (events.length === 0) return '<p style="color:#999">No activity yet</p>';
  return events.reverse().map((e: any) =>
    `<div class="item"><strong>${esc(String(e.timestamp || ""))}</strong> ${esc(String(e.event || ""))} ${esc(String(e.detail || ""))}</div>`
  ).join("");
}

// SSE clients
const sseClients = new Set<ServerResponse>();
let watchTimer: ReturnType<typeof setTimeout> | undefined;
const broadcast = () => { for (const c of sseClients) try { c.write("data: refresh\n\n"); } catch { sseClients.delete(c); } };
for (const p of [resolve("ROADMAP.md"), resolve(".claude/logs/activity.jsonl")]) {
  try {
    if (!existsSync(p)) continue;
    watch(p, () => { clearTimeout(watchTimer); watchTimer = setTimeout(broadcast, 500); });
  } catch { /* ignore */ }
}

const send = (res: ServerResponse, body: string, type = "text/html; charset=utf-8", status = 200) => {
  res.writeHead(status, { "Content-Type": type }); res.end(body);
};

createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`).pathname;

  if (url === "/") return send(res, getPage());
  if (url === "/api/status") { const { totals } = parseRoadmap(resolve("ROADMAP.md")); return send(res, renderStatus(totals)); }
  if (url === "/api/dag") { const { tasks } = parseRoadmap(resolve("ROADMAP.md")); return send(res, renderDag(tasks)); }
  if (url === "/api/kanban") { const { tasks } = parseRoadmap(resolve("ROADMAP.md")); return send(res, renderKanban(tasks)); }
  if (url === "/api/activity") return send(res, renderActivity(parseActivity(resolve(".claude/logs/activity.jsonl"))));
  if (url === "/api/status.json") {
    const { totals } = parseRoadmap(resolve("ROADMAP.md"));
    return send(res, JSON.stringify({ timestamp: new Date().toISOString(), totals }), "application/json");
  }
  if (url === "/events") {
    if (sseClients.size >= 5) return send(res, "Too many clients", "text/plain", 429);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("data: connected\n\n");
    sseClients.add(res);
    const timeout = setTimeout(() => { sseClients.delete(res); res.end(); }, 5 * 60 * 1000);
    res.on("close", () => { clearTimeout(timeout); sseClients.delete(res); });
    return;
  }
  send(res, "Not found", "text/plain", 404);
}).listen(port, "127.0.0.1").on("error", (e: Error) => { console.error(`Failed to start: ${e.message}`); process.exit(1); });

function getPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project OS Dashboard</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" integrity="sha384-L1dWfspMTHU/ApYnFiMz2QID/PlP1xCW9visvBdbEkOLkSSWsP6ZJWhPw6apiXxU" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" integrity="sha384-jFhLSLFn4m565eRAS0CDMWubMqOtfZWWbE8kqgGdU+VHbJ3B2G/4X8u+0BM8MtdU" crossorigin="anonymous"></script>
<script src="https://unpkg.com/htmx.org@2.0.4" integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+" crossorigin="anonymous"></script>
<script src="https://unpkg.com/htmx-ext-sse@2.2.4/sse.js" integrity="sha384-QA9wXqexhwzXTuTvuF5QP82pddm3R2hy81UzXi7ioNTqNF2b75hlkkSGjafohhL3" crossorigin="anonymous"></script>
<style>
body{padding:20px}h1{margin-bottom:8px}h2{font-size:18px;margin:20px 0 12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
table{width:100%}
.m{padding:2px 8px;border-radius:4px;font-weight:600;font-size:11px}
.draft{background:#fef08a}.todo{background:#e5e7eb}.wip{background:#bfdbfe}.review{background:#d8b4fe}
.done{background:#86efac}.blocked{background:#fca5a5}.racing{background:#fed7aa}
.card{background:var(--pico-card-background-color);padding:20px;border-radius:8px}
.item{padding:8px 0;border-bottom:1px solid var(--pico-muted-border-color);font-size:13px}
.item:last-child{border-bottom:0}.load{text-align:center;padding:20px;color:var(--pico-muted-color)}
.tabs{display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--pico-muted-border-color)}
.tabs button{background:none;border:none;border-bottom:2px solid transparent;padding:8px 4px;cursor:pointer;color:var(--pico-muted-color);font-size:15px}
.tabs button.active{color:var(--pico-color);border-bottom-color:var(--pico-primary)}
.view[hidden]{display:none}
.kanban{display:flex;gap:16px;overflow-x:auto;padding-bottom:8px}
.kanban-col{min-width:220px;flex:0 0 220px;background:var(--pico-card-background-color);border:1px solid var(--pico-muted-border-color);border-radius:8px;padding:12px}
.kanban-col h3{font-size:14px;margin:0 0 8px}
.kanban-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.kanban-card{background:var(--pico-background-color);border:1px solid var(--pico-muted-border-color);border-radius:6px;padding:8px;font-size:13px}
.kanban-card.blocked{border-color:#fca5a5;border-width:2px}
.tid{font-family:monospace;font-weight:600}
.deps{font-size:11px;color:var(--pico-muted-color);margin-top:4px}
</style></head>
<body><main class="container" hx-ext="sse" sse-connect="/events">
<h1>Project OS Dashboard</h1><p>Live task tracking with dependency visualization</p>
<nav class="tabs" role="tablist">
<button role="tab" id="tab-overview" aria-selected="true" class="active" onclick="showView('overview')">Overview</button>
<button role="tab" id="tab-board" aria-selected="false" onclick="showView('board')">Board</button>
</nav>
<div id="view-overview" class="view">
<div class="grid">
<div><h2>Task Status</h2><div id="status" hx-get="/api/status" hx-trigger="sse:refresh, load" hx-swap="innerHTML"><div class="load">Loading...</div></div></div>
<div><h2>Dependencies</h2><div class="card" id="dag" hx-get="/api/dag" hx-trigger="sse:refresh, load" hx-swap="innerHTML"><div class="load">Loading...</div></div></div>
</div>
<div class="card"><h2>Activity Feed</h2><div id="activity" hx-get="/api/activity" hx-trigger="sse:refresh, load" hx-swap="innerHTML"><div class="load">Loading...</div></div></div>
</div>
<div id="view-board" class="view" hidden><div hx-get="/api/kanban" hx-trigger="sse:refresh, load" hx-swap="innerHTML"><div class="load">Loading...</div></div></div>
</main>
<script>mermaid.initialize({startOnLoad:false,theme:'default',securityLevel:'strict'});
document.body.addEventListener('htmx:afterSwap',function(e){
  if(e.detail.target.id==='dag'){mermaid.run({nodes:e.detail.target.querySelectorAll('.mermaid')})}
});
function showView(v){
  document.getElementById('view-overview').hidden=v!=='overview';
  document.getElementById('view-board').hidden=v!=='board';
  document.getElementById('tab-overview').setAttribute('aria-selected',v==='overview');
  document.getElementById('tab-board').setAttribute('aria-selected',v==='board');
  document.getElementById('tab-overview').classList.toggle('active',v==='overview');
  document.getElementById('tab-board').classList.toggle('active',v==='board');
}</script></body></html>`;
}

console.log(`Dashboard running at http://127.0.0.1:${port}`);
