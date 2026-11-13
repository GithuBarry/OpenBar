import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openBarPaths, type OpenBarPaths } from "../config/openbar-paths";
import { sha256, withWriteLock } from "../tex-project/codec";
import { writePrivateFileAtomic } from "../fs/atomic-write";
import {
  registeredProjectSchema,
  workspaceIdSchema,
  workspaceRegistrySchema,
  type RegisteredProject,
  type WorkspaceRegistryV1,
} from "./registry-types";

const EMPTY_REGISTRY: WorkspaceRegistryV1 = {
  schemaVersion: 1,
  projects: [],
  skillPacks: [],
};

export class WorkspaceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRegistryError";
  }
}

export type WorkspaceRegistrySnapshot = {
  registry: WorkspaceRegistryV1;
  hash?: string;
  exists: boolean;
};

export type WorkspaceRegistryDuplicates = {
  projectIds: string[];
  skillPackIds: string[];
  checkoutPaths: string[];
};

function registryError(message: string, cause?: unknown): WorkspaceRegistryError {
  if (cause instanceof WorkspaceRegistryError) return cause;
  return new WorkspaceRegistryError(message);
}

function readRegistryBytes(file: string): { raw: string; exists: true } | { raw: ""; exists: false } {
  try {
    return { raw: fs.readFileSync(file, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "", exists: false };
    throw error;
  }
}

function parseRegistry(raw: string, file: string): WorkspaceRegistryV1 {
  try {
    return workspaceRegistrySchema.parse(JSON.parse(raw));
  } catch (error) {
    throw registryError(`Workspace registry is invalid: ${file}`, error);
  }
}

function orderedProject(project: RegisteredProject): RegisteredProject {
  return {
    id: project.id,
    checkoutPath: project.checkoutPath,
    ...(project.credentialProfileId ? { credentialProfileId: project.credentialProfileId } : {}),
    addedAt: project.addedAt,
    ...(project.lastOpenedAt ? { lastOpenedAt: project.lastOpenedAt } : {}),
  };
}

function serializeRegistry(registry: WorkspaceRegistryV1): string {
  const normalized: WorkspaceRegistryV1 = {
    schemaVersion: 1,
    projects: registry.projects.map(orderedProject),
    skillPacks: registry.skillPacks.map((skillPack) => ({
      id: skillPack.id,
      checkoutPath: skillPack.checkoutPath,
      ...(skillPack.credentialProfileId ? { credentialProfileId: skillPack.credentialProfileId } : {}),
      ...(skillPack.remote ? { remote: skillPack.remote } : {}),
      ...(skillPack.revision ? { revision: skillPack.revision } : {}),
      addedAt: skillPack.addedAt,
    })),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

function comparablePath(value: string): string {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return path.normalize(absolute);
  }
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

export function findWorkspaceRegistryDuplicates(registry: WorkspaceRegistryV1): WorkspaceRegistryDuplicates {
  return {
    projectIds: duplicateValues(registry.projects.map((project) => project.id)),
    skillPackIds: duplicateValues(registry.skillPacks.map((skillPack) => skillPack.id)),
    checkoutPaths: duplicateValues([
      ...registry.projects.map((project) => comparablePath(project.checkoutPath)),
      ...registry.skillPacks.map((skillPack) => comparablePath(skillPack.checkoutPath)),
    ]),
  };
}

function assertNoDuplicates(registry: WorkspaceRegistryV1): void {
  const duplicates = findWorkspaceRegistryDuplicates(registry);
  const details = [
    duplicates.projectIds.length ? `project ids: ${duplicates.projectIds.join(", ")}` : "",
    duplicates.skillPackIds.length ? `skill-pack ids: ${duplicates.skillPackIds.join(", ")}` : "",
    duplicates.checkoutPaths.length ? `checkout paths: ${duplicates.checkoutPaths.join(", ")}` : "",
  ].filter(Boolean);
  if (details.length) throw new WorkspaceRegistryError(`Workspace registry has duplicate registrations (${details.join("; ")}).`);
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function writePrivateAtomic(file: string, text: string): void {
  ensurePrivateDirectory(path.dirname(file));
  writePrivateFileAtomic(file, text);
}

function currentSnapshot(paths: OpenBarPaths): WorkspaceRegistrySnapshot {
  const bytes = readRegistryBytes(paths.workspaceFile);
  if (!bytes.exists) return { registry: { ...EMPTY_REGISTRY, projects: [], skillPacks: [] }, exists: false };
  return {
    registry: parseRegistry(bytes.raw, paths.workspaceFile),
    hash: sha256(bytes.raw),
    exists: true,
  };
}

export function readWorkspaceRegistrySnapshot(paths: OpenBarPaths = openBarPaths()): WorkspaceRegistrySnapshot {
  return currentSnapshot(paths);
}

export function readWorkspaceRegistry(paths: OpenBarPaths = openBarPaths()): WorkspaceRegistryV1 {
  return currentSnapshot(paths).registry;
}

function assertCompareAndSwap(snapshot: WorkspaceRegistrySnapshot, expectedHash: string | undefined): void {
  if (!snapshot.exists) {
    if (expectedHash !== undefined) {
      throw new WorkspaceRegistryError("Workspace registry was removed before this write.");
    }
    return;
  }
  if (expectedHash === undefined) {
    throw new WorkspaceRegistryError("Workspace registry already exists. Reload it and provide its hash before saving.");
  }
  if (snapshot.hash !== expectedHash) {
    throw new WorkspaceRegistryError("Workspace registry changed on disk. Reload it before saving.");
  }
}

export function writeWorkspaceRegistry(
  registry: WorkspaceRegistryV1,
  expectedHash?: string,
  paths: OpenBarPaths = openBarPaths(),
): { hash: string } {
  const parsed = workspaceRegistrySchema.safeParse(registry);
  if (!parsed.success) throw new WorkspaceRegistryError("Workspace registry has invalid syntax.");
  assertNoDuplicates(parsed.data);
  const serialized = serializeRegistry(parsed.data);
  const hash = sha256(serialized);

  ensurePrivateDirectory(paths.configRoot);
  withWriteLock(paths.workspaceFile, () => {
    assertCompareAndSwap(currentSnapshot(paths), expectedHash);
    writePrivateAtomic(paths.workspaceFile, serialized);
  });
  return { hash };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: process.env.HOME || os.homedir(),
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  } as unknown as NodeJS.ProcessEnv;
}

function readGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new WorkspaceRegistryError(`Checkout is not a usable Git repository: ${cwd}`);
  }
}

function canonicalGitRoot(checkoutPath: string): string {
  const requested = path.resolve(checkoutPath);
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(requested);
    if (!fs.statSync(canonical).isDirectory()) throw new Error("checkout is not a directory");
  } catch {
    throw new WorkspaceRegistryError(`Checkout path does not exist: ${requested}`);
  }

  const insideWorkTree = readGit(canonical, ["rev-parse", "--is-inside-work-tree"]).trim();
  if (insideWorkTree !== "true") throw new WorkspaceRegistryError(`Checkout is not a Git worktree: ${canonical}`);
  let reportedRoot: string;
  try {
    reportedRoot = fs.realpathSync.native(readGit(canonical, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    throw new WorkspaceRegistryError(`Git did not report a valid checkout root: ${canonical}`);
  }
  if (reportedRoot !== canonical) {
    throw new WorkspaceRegistryError(`Checkout path must be the Git root: ${canonical}`);
  }
  return canonical;
}

function normalizedProject(project: RegisteredProject): RegisteredProject {
  const checkoutPath = canonicalGitRoot(project.checkoutPath);
  const parsed = registeredProjectSchema.safeParse({ ...project, checkoutPath });
  if (!parsed.success) throw new WorkspaceRegistryError("Project registration has invalid syntax.");
  return parsed.data;
}

export function registerProject(
  project: RegisteredProject,
  expectedHash?: string,
  paths: OpenBarPaths = openBarPaths(),
): { registry: WorkspaceRegistryV1; hash: string } {
  const normalized = normalizedProject(project);
  ensurePrivateDirectory(paths.configRoot);
  let result: { registry: WorkspaceRegistryV1; hash: string } | undefined;
  withWriteLock(paths.workspaceFile, () => {
    const snapshot = currentSnapshot(paths);
    assertCompareAndSwap(snapshot, expectedHash);
    const next: WorkspaceRegistryV1 = {
      schemaVersion: 1,
      projects: [...snapshot.registry.projects, normalized],
      skillPacks: [...snapshot.registry.skillPacks],
    };
    const duplicateIds = next.projects.filter((candidate) => candidate.id === normalized.id && candidate !== normalized).length;
    if (duplicateIds) throw new WorkspaceRegistryError(`Project id is already registered: ${normalized.id}`);
    assertNoDuplicates(next);
    const serialized = serializeRegistry(next);
    writePrivateAtomic(paths.workspaceFile, serialized);
    result = { registry: next, hash: sha256(serialized) };
  });
  if (!result) throw new WorkspaceRegistryError("Workspace registry write did not complete.");
  return result;
}

export function unregisterProject(
  id: string,
  expectedHash?: string,
  paths: OpenBarPaths = openBarPaths(),
): { registry: WorkspaceRegistryV1; hash: string } {
  let safeId: string;
  try {
    safeId = workspaceIdSchema.parse(id);
  } catch {
    throw new WorkspaceRegistryError(`Invalid project id: ${id}`);
  }

  ensurePrivateDirectory(paths.configRoot);
  let result: { registry: WorkspaceRegistryV1; hash: string } | undefined;
  withWriteLock(paths.workspaceFile, () => {
    const snapshot = currentSnapshot(paths);
    assertCompareAndSwap(snapshot, expectedHash);
    const projects = snapshot.registry.projects.filter((project) => project.id !== safeId);
    if (projects.length === snapshot.registry.projects.length) {
      throw new WorkspaceRegistryError(`Project is not registered: ${safeId}`);
    }
    const next: WorkspaceRegistryV1 = {
      schemaVersion: 1,
      projects,
      skillPacks: [...snapshot.registry.skillPacks],
    };
    assertNoDuplicates(next);
    const serialized = serializeRegistry(next);
    writePrivateAtomic(paths.workspaceFile, serialized);
    result = { registry: next, hash: sha256(serialized) };
  });
  if (!result) throw new WorkspaceRegistryError("Workspace registry write did not complete.");
  return result;
}
