import fs from "node:fs";
import path from "node:path";

import { readActivity } from "./activity-log";

const GENERATED_DIRS = new Set([".git", ".next", "node_modules", ".cache", ".venv", "__pycache__", "build", "dist"]);
const RUNTIME_FILES = new Set([".git", "activity.jsonl", "request-replay.json", "request-replay-journal.json", ".DS_Store"]);
const GENERATED_FILE = /(?:\.(?:aux|log|out|toc|lof|lot|bbl|blg|fls|fdb_latexmk|synctex(?:\.gz)?|idx|ind|ilg|nav|snm|vrb|lock|tmp)|\.run\.xml|~)$/i;

/** Latest saved authored state, including edits made outside OpenBar. */
export function projectLastEditedAt(projectDir: string, paperFile: string, fallback: string): string {
  let latest = Date.parse(fallback);
  if (!Number.isFinite(latest)) latest = 0;
  const root = path.resolve(projectDir);
  const compiledPdf = path.resolve(path.dirname(paperFile), `${path.parse(paperFile).name}.pdf`);
  const visit = (directory: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const metadataRecovery = entry.name === "recovery" && [".OpenBar", ".openbarry", "openbarry"].includes(path.basename(directory));
        if (!GENERATED_DIRS.has(entry.name) && !GENERATED_FILE.test(entry.name) && !metadataRecovery) visit(file);
      } else if (entry.isFile() && !RUNTIME_FILES.has(entry.name) && !GENERATED_FILE.test(entry.name) && file !== compiledPdf) {
        try { latest = Math.max(latest, fs.statSync(file).mtimeMs); }
        catch { /* A concurrently removed file is covered by authored activity. */ }
      }
    }
  };
  visit(root);
  // A deleted document has no remaining file timestamp to inspect.
  for (const event of readActivity(root, 2_000)) {
    if (!event.deleted) continue;
    const at = Date.parse(event.at);
    if (Number.isFinite(at)) latest = Math.max(latest, at);
  }
  return latest > 0 ? new Date(latest).toISOString() : fallback;
}
