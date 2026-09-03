import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import matter from "gray-matter";

import { SKILLS, getSkill } from "@/lib/skills";
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
const SKILL_ROOTS = ["skills", ".openbar/skills", "manuscript/skills"];

function listSkillDirs(root: string): string[] {
  const dirs: string[] = [];
  for (const relative of SKILL_ROOTS) {
    const skillsDir = path.join(/* turbopackIgnore: true */ root, relative);
    try {
      for (const entry of fs.readdirSync(/* turbopackIgnore: true */ skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.join(/* turbopackIgnore: true */ skillsDir, entry.name));
      }
    } catch { /* missing skill root */ }
  }
  return dirs;
}

function posixFrom(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function workspaceRoot(): string {
  return process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");
}

function parseSkillFile(
  root: string,
  file: string,
  fallbackId: string,
  source: ProjectSkill["source"] = "project",
): ProjectSkill | null {
  try {
    const raw = fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
    const parsed = matter(raw);
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
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
      updatedAt: fs.statSync(/* turbopackIgnore: true */ file).mtime.toISOString(),
      hash: hashText(raw),
    };
  } catch {
    return null;
  }
}

/** Discover skills/<id>/SKILL.md files under a content root. */
export function discoverSkillsInDir(root: string, source: ProjectSkill["source"] = "project"): ProjectSkill[] {
  const seen = new Set<string>();
  const skills: ProjectSkill[] = [];
  for (const dir of listSkillDirs(root)) {
    const file = path.join(/* turbopackIgnore: true */ dir, SKILL_FILE);
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) continue;
    const parsed = parseSkillFile(root, file, path.basename(dir), source);
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
  for (const relative of ["AGENTS.md", "manuscript/AGENTS.md"]) {
    const file = path.join(/* turbopackIgnore: true */ root, relative);
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) continue;
    return {
      path: relative,
      body: fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"),
      updatedAt: fs.statSync(/* turbopackIgnore: true */ file).mtime.toISOString(),
    };
  }
  return undefined;
}

export function writeAgentsMd(root: string, body: string, expectedHash?: string): { path: string; hash: string } {
  const existing = findAgentsMd(root);
  const relative = existing?.path || "AGENTS.md";
  const file = path.join(/* turbopackIgnore: true */ root, relative);
  return withWriteLock(file, () => {
    const currentExisting = findAgentsMd(root);
    if (currentExisting && !expectedHash) throw new Error("AGENTS.md exists. Read it and pass expectedHash before saving.");
    const current = currentExisting ? hashText(currentExisting.body) : hashText("");
    if (expectedHash && current !== expectedHash) throw new Error("AGENTS.md changed on disk. Reload before saving.");
    const next = body.endsWith("\n") ? body : `${body}\n`;
    fs.mkdirSync(path.dirname(/* turbopackIgnore: true */ file), { recursive: true });
    writeTextAtomic(file, next);
    return { path: relative, hash: hashText(next) };
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function skillFileHash(root: string, id: string): string | undefined {
  const skill = discoverSkillsInDir(root).find((item) => item.id === id);
  if (!skill) return undefined;
  try {
    return hashText(fs.readFileSync(path.join(/* turbopackIgnore: true */ root, skill.path), "utf8"));
  } catch {
    return undefined;
  }
}

export function writeProjectSkill(
  root: string,
  spec: { id: string; name?: string; description?: string; body: string },
  expectedHash?: string,
  source: "project" | "workspace" = "project",
): ProjectSkill {
  const id = spec.id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!id || id === "." || id === "..") throw new Error("Skill id is required and must be a safe file name.");
  safeFileSegment(id, "skill id");
  const existing = discoverSkillsInDir(root, source).find((item) => item.id === id);
  const relative = existing?.path || path.posix.join(source === "workspace" ? "skills" : ".openbar/skills", id, SKILL_FILE);
  const file = path.join(/* turbopackIgnore: true */ root, relative);
  const front = [
    "---",
    `id: ${id}`,
    `name: ${JSON.stringify(spec.name || id)}`,
    spec.description ? `description: ${JSON.stringify(spec.description)}` : "",
    "---",
    "",
  ].filter(Boolean).join("\n");
  return withWriteLock(file, () => {
    const currentExisting = discoverSkillsInDir(root, source).find((item) => item.id === id);
    if (currentExisting && !expectedHash) throw new Error("Skill exists. Read it and pass expectedHash before saving.");
    const currentFile = currentExisting ? path.join(/* turbopackIgnore: true */ root, currentExisting.path) : file;
    const currentHash = currentExisting
      ? hashText(fs.readFileSync(/* turbopackIgnore: true */ currentFile, "utf8"))
      : hashText("");
    if (expectedHash && currentHash !== expectedHash) throw new Error("Skill file changed on disk. Reload before saving.");
    fs.mkdirSync(path.dirname(/* turbopackIgnore: true */ file), { recursive: true });
    writeTextAtomic(file, `${front}${spec.body.trim()}\n`);
    const parsed = parseSkillFile(root, file, id, source);
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
  const skill = discoverSkillsInDir(root, source).find((item) => item.id === id);
  if (!skill) throw new Error(`Unknown skill "${id}".`);
  const file = path.join(/* turbopackIgnore: true */ root, skill.path);
  withWriteLock(file, () => {
    const current = discoverSkillsInDir(root, source).find((item) => item.id === id);
    if (!current) throw new Error(`Unknown skill "${id}".`);
    if (!expectedHash) throw new Error("Read the skill and pass expectedHash before deleting it.");
    const currentFile = path.join(/* turbopackIgnore: true */ root, current.path);
    const currentHash = hashText(fs.readFileSync(/* turbopackIgnore: true */ currentFile, "utf8"));
    if (currentHash !== expectedHash) throw new Error("Skill file changed on disk. Reload before deleting it.");
    fs.rmSync(/* turbopackIgnore: true */ currentFile);
    const dir = path.dirname(currentFile);
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
  const skill = discoverSkillsInDir(root, source === "openbar" ? "project" : source).find((item) => item.id === id);
  if (!skill) return null;
  const file = path.join(/* turbopackIgnore: true */ root, skill.path);
  try {
    const parsed = matter(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"));
    return { skill, body: parsed.content.trim() };
  } catch {
    return null;
  }
}

export function readAnySkill(projectRoot: string, id: string): { skill: ProjectSkill; body: string } | null {
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
