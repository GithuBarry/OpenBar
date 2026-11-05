/**
 * Small SyncTeX CLI bridge. Coordinates are PDF points; callers convert CSS pixels.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { compiledPdfFile, currentArtifactId, getCompiledPdf } from "./compile";
import { texPaths } from "./project";

const execFileAsync = promisify(execFile);

export type SyncTexView = { page: number; x: number; y: number; width?: number; height?: number };
export type SyncTexEdit = { file: string; line: number; column: number };

async function runSynctex(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("synctex", args, { timeout: 4_000, maxBuffer: 256_000 });
    return stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return "";
  }
}

function parseView(output: string): SyncTexView | null {
  const page = /(?:^|\n)Page:(\d+)/.exec(output);
  const x = /(?:^|\n)x:([0-9.]+)/.exec(output);
  const y = /(?:^|\n)y:([0-9.]+)/.exec(output);
  if (!page || !x || !y) return null;
  const width = /(?:^|\n)W:([0-9.]+)/.exec(output);
  const height = /(?:^|\n)H:([0-9.]+)/.exec(output);
  return {
    page: Number(page[1]),
    x: Number(x[1]),
    y: Number(y[1]),
    ...(width ? { width: Number(width[1]) } : {}),
    ...(height ? { height: Number(height[1]) } : {}),
  };
}

function parseEdit(output: string, manuscriptDir: string): SyncTexEdit | null {
  const input = /(?:^|\n)Input:(.+)/.exec(output);
  const line = /(?:^|\n)Line:(\d+)/.exec(output);
  const column = /(?:^|\n)Column:(-?\d+)/.exec(output);
  if (!input || !line) return null;
  const abs = input[1]!.trim();
  const rel = path.relative(manuscriptDir, abs).split(path.sep).join("/");
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) return null;
  return {
    file: rel,
    line: Number(line[1]),
    column: Number(column?.[1] || 0),
  };
}

export async function synctexView(projectDir: string, file: string, line: number, column = 0, artifactId?: string): Promise<
  | { ok: true; view: SyncTexView }
  | { ok: false; code: "capability_unavailable" | "compile_failed"; message: string }
> {
  const requestedArtifactId = artifactId || currentArtifactId(projectDir);
  if (!getCompiledPdf(projectDir, requestedArtifactId)) return { ok: false, code: "compile_failed", message: "The requested PDF artifact is no longer available for SyncTeX." };
  const pdf = compiledPdfFile(projectDir, requestedArtifactId);
  const root = path.resolve(texPaths(projectDir).manuscriptDir);
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ok: false, code: "compile_failed", message: "Choose a source file inside the manuscript." };
  const output = await runSynctex(["view", "-i", `${line}:${column}:${absolute}`, "-o", pdf]);
  if (output === null) {
    return { ok: false, code: "capability_unavailable", message: "synctex is not installed. Install TeX Live to enable PDF source navigation." };
  }
  const view = parseView(output);
  if (!view) return { ok: false, code: "compile_failed", message: "SyncTeX did not find a PDF position for that source location." };
  return { ok: true, view };
}

export async function synctexEdit(projectDir: string, page: number, x: number, y: number, artifactId?: string): Promise<
  | { ok: true; edit: SyncTexEdit }
  | { ok: false; code: "capability_unavailable" | "compile_failed"; message: string }
> {
  const paths = texPaths(projectDir);
  const requestedArtifactId = artifactId || currentArtifactId(projectDir);
  const pdf = compiledPdfFile(projectDir, requestedArtifactId);
  if (!getCompiledPdf(projectDir, requestedArtifactId)) return { ok: false, code: "compile_failed", message: "The requested PDF artifact is no longer available for SyncTeX." };
  const output = await runSynctex(["edit", "-o", `${page}:${x}:${y}:${pdf}`]);
  if (output === null) {
    return { ok: false, code: "capability_unavailable", message: "synctex is not installed. Install TeX Live to enable PDF source navigation." };
  }
  const edit = parseEdit(output, paths.manuscriptDir);
  if (!edit) return { ok: false, code: "compile_failed", message: "SyncTeX did not find a source location for that PDF position." };
  return { ok: true, edit };
}
