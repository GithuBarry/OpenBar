import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { SKILLS, getSkill } from "@/lib/skills";

export type ProjectSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "project" | "openbar";
};

const SKILL_FILE = "SKILL.md";

function listSkillDirs(root: string): string[] {
  const skillsDir = path.join(root, "skills");
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skillsDir, entry.name));
  } catch {
    return [];
  }
}

function posixFrom(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function parseSkillFile(root: string, file: string, fallbackId: string): ProjectSkill | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
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
      source: "project",
    };
  } catch {
    return null;
  }
}

/** Discover project-local skills/<id>/SKILL.md files. */
export function discoverSkillsInDir(root: string): ProjectSkill[] {
  const seen = new Set<string>();
  const skills: ProjectSkill[] = [];
  for (const dir of listSkillDirs(root)) {
    const file = path.join(dir, SKILL_FILE);
    if (!fs.existsSync(file)) continue;
    const parsed = parseSkillFile(root, file, path.basename(dir));
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    skills.push(parsed);
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function findAgentsMd(root: string): { path: string } | undefined {
  for (const relative of ["AGENTS.md", "manuscript/AGENTS.md"]) {
    if (fs.existsSync(path.join(root, relative))) return { path: relative };
  }
  return undefined;
}

export function readSkillFile(root: string, id: string): { skill: ProjectSkill; body: string } | null {
  const skill = discoverSkillsInDir(root).find((item) => item.id === id);
  if (!skill) return null;
  const file = path.join(root, skill.path);
  try {
    const parsed = matter(fs.readFileSync(file, "utf8"));
    return { skill, body: parsed.content.trim() };
  } catch {
    return null;
  }
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
