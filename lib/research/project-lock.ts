import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

import { openBarPaths } from "@/lib/config/openbar-paths";
import { sha256, withWriteLock, withWriteLockAsync } from "@/lib/tex-project/codec";

const projectWriteGuards = new AsyncLocalStorage<(projectPath: string) => void>();

/** Carry browser ownership through queues to each actual project mutation. */
export function withProjectWriteGuard<T>(
  guard: (projectPath: string) => void,
  operation: () => T,
): T {
  const previous = projectWriteGuards.getStore();
  return projectWriteGuards.run((projectPath) => {
    previous?.(projectPath);
    guard(projectPath);
  }, operation);
}

/**
 * Resolve the metadata directory that belongs to a manuscript path.
 *
 * Canonical projects keep OpenBar state in `.OpenBar`. Legacy nested projects
 * keep it in `openbarry` beside the manuscript. Persisted project records
 * identify the authored layout while runtime ownership uses the project root.
 */
export function projectMetadataDir(inputPath: string): string {
  const absolute = path.resolve(inputPath);
  let current = absolute;
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  for (;;) {
    if (path.basename(current) === ".OpenBar") return current;
    if (path.basename(current) === "openbarry") return current;
    if (fs.existsSync(path.join(current, ".OpenBar", "project.tex"))) return path.join(current, ".OpenBar");
    if (fs.existsSync(path.join(current, "manuscript", "openbarry", "project.tex"))) return path.join(current, "manuscript", "openbarry");
    if (fs.existsSync(path.join(current, ".OpenBar"))) return path.join(current, ".OpenBar");
    if (fs.existsSync(path.join(current, "openbarry"))) return path.join(current, "openbarry");
    if (fs.existsSync(path.join(current, "manuscript", "openbarry"))) return path.join(current, "manuscript", "openbarry");
    if (path.basename(current) === "manuscript") return path.join(current, "openbarry");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.join(absolute, ".OpenBar");
}

/** One project root survives creation and migration of its metadata layout. */
export function projectWriteIdentityPath(inputPath: string): string {
  const metadata = projectMetadataDir(inputPath);
  let current = path.dirname(metadata);
  if (path.basename(metadata) === "openbarry" && path.basename(current) === "manuscript") {
    current = path.dirname(current);
  }
  const missing: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export function projectWriteLockPath(inputPath: string): string {
  return path.join(openBarPaths().runtimeRoot, "project-write-locks", sha256(projectWriteIdentityPath(inputPath)));
}

export function withProjectWriteLock<T>(projectPath: string, operation: () => T): T {
  return withWriteLock(projectWriteLockPath(projectPath), () => {
    projectWriteGuards.getStore()?.(projectPath);
    return operation();
  });
}

export function withProjectWriteLockAsync<T>(
  projectPath: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  return withWriteLockAsync(projectWriteLockPath(projectPath), () => {
    projectWriteGuards.getStore()?.(projectPath);
    return operation();
  });
}
