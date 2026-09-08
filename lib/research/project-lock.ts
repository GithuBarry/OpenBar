import fs from "node:fs";
import path from "node:path";

import { withWriteLock, withWriteLockAsync } from "@/lib/tex-project/codec";

/**
 * Resolve the metadata directory that belongs to a manuscript path.
 *
 * Canonical projects keep OpenBar state in `.OpenBar`. Legacy nested projects
 * keep it in `openbarry` beside the manuscript. The lock path lives in that
 * metadata directory so every authored resource in one project shares the
 * same write boundary.
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

export function projectWriteLockPath(inputPath: string): string {
  return path.join(projectMetadataDir(inputPath), "project-write");
}

export function withProjectWriteLock<T>(projectPath: string, operation: () => T): T {
  return withWriteLock(projectWriteLockPath(projectPath), operation);
}

export function withProjectWriteLockAsync<T>(
  projectPath: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  return withWriteLockAsync(projectWriteLockPath(projectPath), operation);
}
