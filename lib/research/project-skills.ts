import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import matter from "gray-matter";

import { SKILLS, getSkill } from "@/lib/skills";
import { assertAdministrativeWriteAllowed, isPublicDemoMode } from "@/lib/server/demo-mode";
import { resolveConfinedPath, resolveConfinedRoot } from "@/lib/server/path-policy";
import { safeFileSegment, withWriteLock, writeTextAtomic } from "@/lib/tex-project/codec";

export type ProjectSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "project" | "openbar" | "workspace";
  updatedAt?: string;
  hash?: string;
};

const SKILL_FILE = "SKILL.md";
const SKILL_ROOTS = ["skills", ".OpenBar/skills", "manuscript/skills"];

function requireConfinedRoot(root: string): string {
  const resolved = resolveConfinedRoot(root);
  if (!resolved) throw new Error("Project root is unavailable.");
  return resolved;
}

function requireConfinedPath(root: string, file: string, allowMissing = false): string {
  const resolved = resolveConfinedPath(root, file, { allowMissing });
  if (!resolved) throw new Error("Instruction or skill path must stay inside the project root.");
  return resolved;
}

function listSkillDirs(root: string): string[] {
  const resolvedRoot = resolveConfinedRoot(root);
  if (!resolvedRoot) return [];
  const dirs: string[] = [];
  for (const relative of SKILL_ROOTS) {
    const skillsDir = resolveConfinedPath(
      resolvedRoot,
      path.join(/* turbopackIgnore: true */ resolvedRoot, relative),
    );
    if (!skillsDir) continue;
    try {
      for (const entry of fs.readdirSync(/* turbopackIgnore: true */ skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const dir = resolveConfinedPath(
          resolvedRoot,
          path.join(/* turbopackIgnore: true */ skillsDir, entry.name),
        );
        if (!dir) continue;
        try {
          if (fs.statSync(/* turbopackIgnore: true */ dir).isDirectory()) dirs.push(dir);
        } catch { /* broken links and disappearing entries */ }
      }
    } catch { /* missing skill root */ }
  }
  return dirs;
}

function posixFrom(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function workspaceRoot(): string {
  return process.env.OPENBAR_CONTENT || path.join(process.cwd(), "content");
}

/** Shared user instructions belong to the private workspace. */
export function workspaceInstructionsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPublicDemoMode(env) && env.OPENBAR_VIEW_ONLY !== "1";
}

export function readWorkspaceInstructions(): { path: string; body: string; hash: string } | undefined {
  if (!workspaceInstructionsAvailable()) return undefined;
  const saved = findAgentsMd(workspaceRoot());
  const body = saved?.body || "";
  return { path: saved?.path || "AGENTS.md", body, hash: hashText(body) };
}

export function writeWorkspaceInstructions(body: string, expectedHash: string): { path: string; hash: string } {
  assertAdministrativeWriteAllowed("Workspace instructions");
  if (!workspaceInstructionsAvailable()) throw new Error("Permission denied: workspace instructions require private workspace access.");
  return writeAgentsMd(workspaceRoot(), body, expectedHash);
}

type ParsedSkillDocument = {
  data: Record<string, unknown>;
  content: string;
};

function parseSkillDocument(raw: string): ParsedSkillDocument | null {
  try {
    const parsed = matter(raw);
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) return null;
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  } catch {
    return null;
  }
}

function parseSkillFile(
  root: string,
  file: string,
  fallbackId: string,
  source: ProjectSkill["source"] = "project",
): ProjectSkill | null {
  try {
    const confinedFile = resolveConfinedPath(root, file);
    if (!confinedFile) return null;
    const raw = fs.readFileSync(/* turbopackIgnore: true */ confinedFile, "utf8");
    const parsed = parseSkillDocument(raw);
    if (!parsed) return null;
    const { data } = parsed;
    const id = String(data.id || fallbackId).trim() || fallbackId;
    const name = String(data.name || data.title || fallbackId).trim() || fallbackId;
    const description = String(data.description || data.when || "").trim()
      || parsed.content.trim().split(/\n\n/)[0]?.replace(/^#+\s*/, "").trim()
      || name;
    return {
      id,
      name,
      description,
      path: posixFrom(root, file),
      source,
      updatedAt: fs.statSync(/* turbopackIgnore: true */ confinedFile).mtime.toISOString(),
      hash: hashText(raw),
    };
  } catch {
    return null;
  }
}

/** Discover skills/<id>/SKILL.md files under a content root. */
export function discoverSkillsInDir(root: string, source: ProjectSkill["source"] = "project"): ProjectSkill[] {
  const resolvedRoot = resolveConfinedRoot(root);
  if (!resolvedRoot) return [];
  const seen = new Set<string>();
  const skills: ProjectSkill[] = [];
  for (const dir of listSkillDirs(resolvedRoot)) {
    const file = resolveConfinedPath(
      resolvedRoot,
      path.join(/* turbopackIgnore: true */ dir, SKILL_FILE),
    );
    if (!file) continue;
    const parsed = parseSkillFile(resolvedRoot, file, path.basename(dir), source);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    skills.push(parsed);
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function discoverWorkspaceSkills(): ProjectSkill[] {
  return discoverSkillsInDir(workspaceRoot(), "workspace");
}

export function mergeSkills(...lists: ProjectSkill[][]): ProjectSkill[] {
  const seen = new Set<string>();
  const skills: ProjectSkill[] = [];
  for (const list of lists) {
    for (const skill of list) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push(skill);
    }
  }
  return skills;
}

export function findAgentsMd(root: string): { path: string; body: string; updatedAt: string } | undefined {
  const resolvedRoot = resolveConfinedRoot(root);
  if (!resolvedRoot) return undefined;
  for (const relative of ["AGENTS.md", "manuscript/AGENTS.md"]) {
    const file = resolveConfinedPath(
      resolvedRoot,
      path.join(/* turbopackIgnore: true */ resolvedRoot, relative),
    );
    if (!file) continue;
    try {
      return {
        path: relative,
        body: fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"),
        updatedAt: fs.statSync(/* turbopackIgnore: true */ file).mtime.toISOString(),
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

export function writeAgentsMd(root: string, body: string, expectedHash?: string): { path: string; hash: string } {
  const resolvedRoot = requireConfinedRoot(root);
  const existing = findAgentsMd(resolvedRoot);
  const relative = existing?.path || "AGENTS.md";
  const file = requireConfinedPath(
    resolvedRoot,
    path.join(/* turbopackIgnore: true */ resolvedRoot, relative),
    true,
  );
  return withWriteLock(file, () => {
    const currentExisting = findAgentsMd(resolvedRoot);
    if (currentExisting && !expectedHash) throw new Error("AGENTS.md exists. Read it and pass expectedHash before saving.");
    const current = currentExisting ? hashText(currentExisting.body) : hashText("");
    if (expectedHash && current !== expectedHash) throw new Error("AGENTS.md changed on disk. Reload before saving.");
    const next = body.endsWith("\n") ? body : `${body}\n`;
    const target = requireConfinedPath(resolvedRoot, file, true);
    fs.mkdirSync(path.dirname(/* turbopackIgnore: true */ target), { recursive: true });
    writeTextAtomic(target, next);
    return { path: relative, hash: hashText(next) };
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function skillFileHash(root: string, id: string): string | undefined {
  const resolvedRoot = resolveConfinedRoot(root);
  if (!resolvedRoot) return undefined;
  const skill = discoverSkillsInDir(resolvedRoot).find((item) => item.id === id);
  if (!skill) return undefined;
  try {
    const file = resolveConfinedPath(resolvedRoot, path.join(/* turbopackIgnore: true */ resolvedRoot, skill.path));
    if (!file) return undefined;
    return hashText(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"));
  } catch {
    return undefined;
  }
}

type SkillWriteSpec = { id: string; name?: string; description?: string; body: string };

function buildSkillCandidate(id: string, spec: SkillWriteSpec): string {
  if (typeof spec.name !== "undefined" && typeof spec.name !== "string") {
    throw new Error("Skill name must be a string.");
  }
  if (typeof spec.description !== "undefined" && typeof spec.description !== "string") {
    throw new Error("Skill description must be a string.");
  }
  if (typeof spec.body !== "string") throw new Error("Skill body must be a string.");

  const name = spec.name?.trim() || id;
  const description = spec.description?.trim() || undefined;
  const body = spec.body.trimEnd();
  const lines = [
    "---",
    `id: ${JSON.stringify(id)}`,
    `name: ${JSON.stringify(name)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    "---",
    "",
    body,
    "",
  ];
  const candidate = lines.join("\n");
  const parsed = parseSkillDocument(candidate);
  const data = parsed?.data;
  const valid = Boolean(
    parsed
      && data
      && data.id === id
      && data.name === name
      && (description === undefined ? data.description === undefined : data.description === description)
      && parsed.content.trim() === body.trim(),
  );
  if (!valid) throw new Error("Skill candidate has invalid front matter.");
  return candidate;
}

export function writeProjectSkill(
  root: string,
  spec: SkillWriteSpec,
  expectedHash?: string,
  source: "project" | "workspace" = "project",
): ProjectSkill {
  const resolvedRoot = requireConfinedRoot(root);
  if (typeof spec.id !== "string") throw new Error("Skill id must be a string.");
  const id = spec.id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!id || id === "." || id === "..") throw new Error("Skill id is required and must be a safe file name.");
  safeFileSegment(id, "skill id");
  const candidate = buildSkillCandidate(id, spec);
  const existing = discoverSkillsInDir(resolvedRoot, source).find((item) => item.id === id);
  const relative = existing?.path || path.posix.join(source === "workspace" ? "skills" : ".OpenBar/skills", id, SKILL_FILE);
  const file = requireConfinedPath(
    resolvedRoot,
    path.join(/* turbopackIgnore: true */ resolvedRoot, relative),
    true,
  );
  return withWriteLock(file, () => {
    const currentExisting = discoverSkillsInDir(resolvedRoot, source).find((item) => item.id === id);
    if (currentExisting && !expectedHash) throw new Error("Skill exists. Read it and pass expectedHash before saving.");
    const currentFile = currentExisting
      ? requireConfinedPath(resolvedRoot, path.join(/* turbopackIgnore: true */ resolvedRoot, currentExisting.path))
      : file;
    const currentHash = currentExisting
      ? hashText(fs.readFileSync(/* turbopackIgnore: true */ currentFile, "utf8"))
      : hashText("");
    if (expectedHash && currentHash !== expectedHash) throw new Error("Skill file changed on disk. Reload before saving.");
    const target = requireConfinedPath(resolvedRoot, file, true);
    fs.mkdirSync(path.dirname(/* turbopackIgnore: true */ target), { recursive: true });
    writeTextAtomic(target, candidate);
    const parsed = parseSkillFile(resolvedRoot, target, id, source);
    if (!parsed) throw new Error("Skill could not be read after save.");
    return parsed;
  });
}

export function writeWorkspaceSkill(
  spec: { id: string; name?: string; description?: string; body: string },
  expectedHash?: string,
): ProjectSkill {
  return writeProjectSkill(workspaceRoot(), spec, expectedHash, "workspace");
}

export function deleteProjectSkill(root: string, id: string, source: "project" | "workspace" = "project", expectedHash?: string): void {
  const resolvedRoot = requireConfinedRoot(root);
  const skill = discoverSkillsInDir(resolvedRoot, source).find((item) => item.id === id);
  if (!skill) throw new Error(`Unknown skill "${id}".`);
  const file = requireConfinedPath(resolvedRoot, path.join(/* turbopackIgnore: true */ resolvedRoot, skill.path));
  withWriteLock(file, () => {
    const current = discoverSkillsInDir(resolvedRoot, source).find((item) => item.id === id);
    if (!current) throw new Error(`Unknown skill "${id}".`);
    if (!expectedHash) throw new Error("Read the skill and pass expectedHash before deleting it.");
    const currentFile = requireConfinedPath(resolvedRoot, path.join(/* turbopackIgnore: true */ resolvedRoot, current.path));
    const currentHash = hashText(fs.readFileSync(/* turbopackIgnore: true */ currentFile, "utf8"));
    if (currentHash !== expectedHash) throw new Error("Skill file changed on disk. Reload before deleting it.");
    fs.rmSync(/* turbopackIgnore: true */ currentFile);
    const dir = requireConfinedPath(resolvedRoot, path.dirname(currentFile));
    try {
      if (fs.readdirSync(/* turbopackIgnore: true */ dir).length === 0) fs.rmdirSync(/* turbopackIgnore: true */ dir);
    } catch { /* leave parent */ }
  });
}

export { hashText };

export function deleteWorkspaceSkill(id: string, expectedHash?: string): void {
  deleteProjectSkill(workspaceRoot(), id, "workspace", expectedHash);
}

export function readSkillFile(root: string, id: string, source: ProjectSkill["source"] = "project"): { skill: ProjectSkill; body: string } | null {
  const resolvedRoot = resolveConfinedRoot(root);
  if (!resolvedRoot) return null;
  const skill = discoverSkillsInDir(resolvedRoot, source === "openbar" ? "project" : source).find((item) => item.id === id);
  if (!skill) return null;
  const file = resolveConfinedPath(resolvedRoot, path.join(/* turbopackIgnore: true */ resolvedRoot, skill.path));
  if (!file) return null;
  try {
    const parsed = matter(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"));
    return { skill, body: parsed.content.trim() };
  } catch {
    return null;
  }
}

export function readAnySkill(projectRoot: string, id: string, source?: ProjectSkill["source"]): { skill: ProjectSkill; body: string } | null {
  if (source === "project") return readSkillFile(projectRoot, id, "project");
  if (source === "workspace") return readSkillFile(workspaceRoot(), id, "workspace");
  if (source === "openbar") return readBundledSkill(id);
  return readSkillFile(projectRoot, id, "project")
    || readSkillFile(workspaceRoot(), id, "workspace")
    || readBundledSkill(id);
}

export function bundledSkills(): ProjectSkill[] {
  return SKILLS.map((skill) => ({
    id: skill.id,
    name: skill.title,
    description: skill.when,
    path: `openbar:${skill.id}`,
    source: "openbar" as const,
  }));
}

export function readBundledSkill(id: string): { skill: ProjectSkill; body: string } | null {
  const skill = getSkill(id);
  if (!skill) return null;
  return {
    skill: {
      id: skill.id,
      name: skill.title,
      description: skill.when,
      path: `openbar:${skill.id}`,
      source: "openbar",
    },
    body: skill.body,
  };
}
