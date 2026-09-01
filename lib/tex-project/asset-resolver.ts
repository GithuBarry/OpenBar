/**
 * Unified asset resolver for preview, conversion, compile, and MCP.
 */

import fs from "node:fs";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";

export const ASSET_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
export const ASSET_ROOTS = ["figures", "figure_candidates"];

const MAGIC_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function posix(value: string): string {
  return value.replaceAll("\\", "/");
}

export function isProtocolRelative(url: string): boolean {
  return /^\/\//.test(url.trim());
}

export function normalizeAssetRequest(relativePath: string): string | null {
  const trimmed = relativePath.trim();
  if (!trimmed || isProtocolRelative(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[.]{0,2}\//.test(trimmed)) return null;
  const candidate = posix(trimmed);
  if (candidate.split("/").includes("..")) return null;
  const normalized = posix(path.posix.normalize(candidate));
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
  if (!ASSET_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) return null;
  return normalized;
}

export async function resolveProjectAsset(
  projectDir: string,
  relativePath: string,
  manuscriptDir: string,
): Promise<string | null> {
  const normalized = normalizeAssetRequest(relativePath);
  if (!normalized) return null;
  try {
    const root = fs.realpathSync.native(path.resolve(manuscriptDir));
    const texRelative = ASSET_ROOTS.some((dir) => normalized.startsWith(`${dir}/`));
    const base = texRelative ? root : path.join(root, "figures");
    const candidate = path.resolve(base, normalized);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) return null;
    const real = fs.realpathSync.native(candidate);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    const rel = posix(path.relative(root, real));
    if (!ASSET_ROOTS.some((dir) => rel.startsWith(`${dir}/`))) return null;
    if (!ASSET_EXTENSIONS.has(path.extname(real).toLowerCase())) return null;
    if (!fs.statSync(real).isFile()) return null;
    const bytes = fs.readFileSync(real);
    const ext = path.extname(real).toLowerCase();
    if (ext === ".svg") {
      const text = bytes.toString("utf8").slice(0, 200).toLowerCase();
      if (!text.includes("<svg")) return null;
      return real;
    }
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected || !MAGIC_TYPES.has(detected.mime)) return null;
    return real;
  } catch {
    return null;
  }
}
