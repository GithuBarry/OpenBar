import fs from "node:fs";
import path from "node:path";

/**
 * Readable/writable filesystem roots for MCP and evidence source checks.
 * Default is the content tree only — never process.cwd(), which would expose
 * package.json, .env, and source. Extra roots come from OPENBAR_ALLOWED_PATHS.
 */
export function getAllowedRoots(): string[] {
  const contentRoot = process.env.OPENBAR_CONTENT || path.join(process.cwd(), "content");
  const custom = (process.env.OPENBAR_ALLOWED_PATHS || "")
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

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function existingComponentsStayInside(root: string, candidate: string): boolean {
  let current = root;
  const relative = path.relative(root, candidate);
  if (!relative) return true;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
    try {
      const resolved = fs.realpathSync.native(current);
      if (!isWithinRoot(root, resolved)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Resolve a project directory to the path used for confined operations. */
export function resolveConfinedRoot(rootPath: string): string | undefined {
  try {
    const root = fs.realpathSync.native(path.resolve(rootPath));
    return fs.statSync(root).isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a path under one project root while checking every existing link in
 * the path. Missing descendants are allowed when the nearest existing parent
 * resolves inside the root.
 */
export function resolveConfinedPath(
  rootPath: string,
  filePath: string,
  options: { allowMissing?: boolean } = {},
): string | undefined {
  try {
    const lexicalRoot = path.resolve(rootPath);
    const root = resolveConfinedRoot(lexicalRoot);
    if (!root) return undefined;

    const lexicalPath = path.resolve(filePath);
    if (!isWithinRoot(lexicalRoot, lexicalPath)) return undefined;
    const candidate = path.resolve(root, path.relative(lexicalRoot, lexicalPath));

    let candidateExists = true;
    try {
      fs.lstatSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      candidateExists = false;
    }
    if (!existingComponentsStayInside(root, candidate)) return undefined;
    if (!candidateExists && !options.allowMissing) return undefined;

    if (candidateExists) {
      const resolvedCandidate = fs.realpathSync.native(candidate);
      if (!isWithinRoot(root, resolvedCandidate)) return undefined;
    }

    return candidate;
  } catch {
    return undefined;
  }
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
