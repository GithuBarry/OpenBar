/**
 * Unified asset resolver for preview, conversion, compile, and MCP.
 */

import fs from "node:fs";
import path from "node:path";

import { fileTypeFromBuffer } from "file-type";

export const ASSET_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

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

/** Resolve manuscript-relative images, with the upload directory as a fallback for bare names. */
export function resolveProjectAssetPath(relativePath: string, manuscriptDir: string): string | null {
  const normalized = normalizeAssetRequest(relativePath);
  if (!normalized) return null;
  try {
    const root = fs.realpathSync.native(path.resolve(manuscriptDir));
    const candidates = [path.resolve(root, normalized)];
    if (!normalized.includes("/")) candidates.push(path.join(root, "figures", normalized));
    for (const candidate of candidates) {
      if (!candidate.startsWith(root + path.sep)) continue;
      if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) continue;
      const real = fs.realpathSync.native(candidate);
      if (!real.startsWith(root + path.sep)) continue;
      if (!ASSET_EXTENSIONS.has(path.extname(real).toLowerCase())) continue;
      if (fs.statSync(real).isFile()) return real;
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveProjectAsset(
  projectDir: string,
  relativePath: string,
  manuscriptDir: string,
): Promise<string | null> {
  const real = resolveProjectAssetPath(relativePath, manuscriptDir);
  if (!real) return null;
  try {
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
