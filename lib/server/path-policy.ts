import fs from "node:fs";
import path from "node:path";

/**
 * Readable/writable filesystem roots for MCP and evidence source checks.
 * Default is the content tree only — never process.cwd(), which would expose
 * package.json, .env, and source. Extra roots come from OPENBARRY_ALLOWED_PATHS.
 */
export function getAllowedRoots(): string[] {
  const contentRoot = process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");
  const custom = (process.env.OPENBARRY_ALLOWED_PATHS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return [path.resolve(/*turbopackIgnore: true*/ contentRoot), ...custom.map((item) => path.resolve(/*turbopackIgnore: true*/ item))];
}

/**
 * Return a verified path only when the target and its resolved parents stay
 * inside one of the configured roots. Resolving the target itself matters:
 * a symlink located inside content must not grant access to a file outside
 * content.
 */
export function resolveAllowedPath(filePath: string): string | undefined {
  try {
    const target = fs.realpathSync.native(path.resolve(filePath));
    const roots = getAllowedRoots().flatMap((root) => {
      try {
        return [fs.realpathSync.native(root)];
      } catch {
        return [];
      }
    });
    return roots.some((root) => target === root || target.startsWith(root + path.sep)) ? target : undefined;
  } catch {
    return undefined;
  }
}

export function isPathAllowed(filePath: string): boolean {
  return resolveAllowedPath(filePath) !== undefined;
}

/** Resolve a new path whose nearest existing parent is inside an allowed root. */
export function resolveAllowedCreationPath(filePath: string): string | undefined {
  try {
    const candidate = path.resolve(filePath);
    let ancestor = candidate;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return undefined;
      ancestor = parent;
    }
    const safeAncestor = resolveAllowedPath(ancestor);
    if (!safeAncestor) return undefined;
    return path.join(/*turbopackIgnore: true*/ safeAncestor, path.relative(ancestor, candidate));
  } catch {
    return undefined;
  }
}
