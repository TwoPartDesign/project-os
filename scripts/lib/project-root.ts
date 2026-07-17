// scripts/lib/project-root.ts — shared project-root resolution.
//
// Extracted so knowledge-index.ts, system-map.ts, and maintain-draft.ts
// share one definition instead of three identical copies. Dependency-free
// (node:fs + node:path only) so importing it never pulls in a heavier
// module's side effects (e.g. node:sqlite from knowledge-index.ts).

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Walks up from the current working directory to find the nearest ancestor
 * containing a `.claude` directory — the project root. Falls back to cwd if
 * no `.claude` directory is found within 10 levels.
 */
export function getProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}
