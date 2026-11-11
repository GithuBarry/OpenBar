import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";
import { readCompilerConfig } from "./compile";
import { isSafeCommittedPath, isSensitivePath, OverleafSetupError } from "./overleaf-git";
import { texPaths } from "./project";
import { locateTexRoot, traverseInputGraph } from "./source-graph";
import { sourceTransactionJournalPath } from "./source-transaction";

export const OVERLEAF_PROJECT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 2_000;
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".next", ".cache", "__pycache__"]);

export type PreparedOverleafProject = {
  snipUri: string;
  mainDocument: string;
  engine: string;
  filename: string;
};

/** Capture the saved manuscript and its OpenBar records under the ordinary project lock. */
export async function prepareOverleafProject(projectDir: string, slug: string): Promise<PreparedOverleafProject> {
  return withProjectWriteLockAsync(projectDir, () => {
    const paths = texPaths(projectDir);
    const root = fs.realpathSync(paths.manuscriptDir);
    const config = readCompilerConfig(projectDir);
    const mainDocument = path.relative(root, locateTexRoot(root, config.mainFile)).split(path.sep).join("/");
    if (fs.existsSync(sourceTransactionJournalPath(root))) {
      throw new OverleafSetupError("Recover the interrupted manuscript save before preparing this project for Overleaf.");
    }
    const files: Record<string, Uint8Array> = Object.create(null);
    let total = 0;
    let count = 0;
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        if (SKIP_DIRECTORIES.has(entry.name) || (!isSensitivePath(relative) && !isSafeCommittedPath(`${relative}/`))) continue;
        if (entry.name.includes("\\") || entry.isSymbolicLink()) {
          throw new OverleafSetupError(`Use regular project files before exporting: ${relative}`);
        }
        if (entry.isDirectory()) { walk(absolute); continue; }
        if (!entry.isFile()) throw new OverleafSetupError(`Use regular project files before exporting: ${relative}`);
        if (isSensitivePath(relative)) throw new OverleafSetupError(`Review the file blocked by OpenBar's publishing policy before exporting: ${relative}`);
        if (!isSafeCommittedPath(relative)) continue;
        if (++count > MAX_FILES) throw new OverleafSetupError("This project exceeds the 2,000-file Overleaf export limit.");
        const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(descriptor);
          if (!stat.isFile() || stat.size > OVERLEAF_PROJECT_MAX_BYTES - total) {
            throw new OverleafSetupError("The saved project exceeds the 50 MiB Overleaf export limit.");
          }
          const bytes = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < bytes.length) {
            const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
            if (!read) throw new OverleafSetupError("The project changed while preparing its ZIP. Retry after saving.");
            offset += read;
          }
          if (fs.fstatSync(descriptor).size !== stat.size) throw new OverleafSetupError("The project changed while preparing its ZIP. Retry after saving.");
          files[relative] = bytes;
          total += bytes.length;
        } finally { fs.closeSync(descriptor); }
      }
    };
    walk(root);
    if (!Object.hasOwn(files, mainDocument)) throw new OverleafSetupError("The selected main document must be a saved regular file inside this project.");
    const graph = traverseInputGraph(root, mainDocument);
    const omitted = graph.nodes.find(node => !Object.hasOwn(files, node.filePath));
    if (omitted) throw new OverleafSetupError(`Move this paper input out of an excluded runtime directory before exporting: ${omitted.filePath}`);
    if (graph.diagnostics.some(diagnostic => diagnostic.code === "include_outside_root")) {
      throw new OverleafSetupError("Keep every paper input inside the manuscript directory before exporting to Overleaf.");
    }
    return {
      snipUri: `data:application/zip;base64,${Buffer.from(zipSync(files, { level: 1 })).toString("base64")}`,
      mainDocument,
      engine: config.engine,
      filename: `${slug}.zip`,
    };
  });
}
