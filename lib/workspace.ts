/**
 * Repository-backed identity for the research workspace.
 *
 * The product name belongs to the user, so it lives beside the saved
 * content rather than in a build-time constant or browser storage.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { readDataFile, sha256, stableJson, withWriteLock, withWriteLockAsync, writeDataFile, writeTextAtomic } from "@/lib/tex-project/codec";
import { getProject, listVisibleProjects, projectContentDir } from "@/lib/store";
import { readProjectRecord, texPaths, writeProjectRecord } from "@/lib/tex-project/project";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";
import { WORKSPACE_INPUTS } from "@/lib/research/command-inputs";
import type { Project } from "@/lib/types";

const WORKSPACE_SCHEMA = "openbarry/workspace@1";
const WORKSPACE_ID = "workspace";

const workspaceSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(96),
    tagline: z.string().trim().max(240),
    projectOrder: z.array(z.string()).default([]),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export type WorkspaceSettingsInput = Pick<WorkspaceSettings, "name" | "tagline">;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  name: "OpenBar",
  tagline: "Pouring the perfect draft.",
  projectOrder: [],
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function contentRoot() {
  return process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");
}

export function workspaceSettingsFile() {
  return path.join(contentRoot(), "workspace.tex");
}

export function getWorkspaceSettings(): WorkspaceSettings {
  const raw = readDataFile<unknown>(workspaceSettingsFile(), WORKSPACE_SCHEMA, WORKSPACE_ID);
  if (!raw) return DEFAULT_WORKSPACE_SETTINGS;
  return workspaceSettingsSchema.parse(raw);
}

export function saveWorkspaceSettings(input: WorkspaceSettingsInput): WorkspaceSettings {
  const file = workspaceSettingsFile();
  return withWriteLock(file, () => {
    const next = workspaceSettingsSchema.parse({
      ...getWorkspaceSettings(),
      name: input.name.trim(),
      tagline: input.tagline.trim(),
      updatedAt: new Date().toISOString(),
    });
    writeDataFile(
      file,
      WORKSPACE_SCHEMA,
      WORKSPACE_ID,
      next,
      "Editable workspace identity. This file controls the product name shown in the app.",
    );
    return next;
  });
}

export type WorkspaceLayout = { projects: Project[]; projectOrder: string[]; hash: string };
export type MoveWorkspaceProjectInput = z.infer<typeof WORKSPACE_INPUTS.move_project>;

export class WorkspaceLayoutError extends Error {
  constructor(message: string, readonly code: "invalid_arguments" | "stale_disk_state", readonly currentHash?: string) {
    super(message);
  }
}

export function getWorkspaceLayout(): WorkspaceLayout {
  const order = new Map(getWorkspaceSettings().projectOrder.map((slug, index) => [slug, index]));
  const projects = listVisibleProjects().sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt))
    || (order.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.slug) ?? Number.MAX_SAFE_INTEGER));
  return {
    projects,
    projectOrder: projects.map(project => project.slug),
    hash: sha256(stableJson(projects.map(project => [project.slug, project.archivedAt || null]))),
  };
}

/** Serialize moves with identity edits and preserve the current project record. */
export async function moveWorkspaceProject(input: MoveWorkspaceProjectInput): Promise<WorkspaceLayout> {
  const move = WORKSPACE_INPUTS.move_project.parse(input);
  const file = workspaceSettingsFile();
  return withWriteLockAsync(file, () => {
    if (!getProject(move.slug)) throw new WorkspaceLayoutError(`Unknown project "${move.slug}".`, "invalid_arguments");
    return withProjectWriteLockAsync(projectContentDir(move.slug), () => {
      const layout = getWorkspaceLayout();
      if (move.expectedHash !== layout.hash) throw new WorkspaceLayoutError("Project layout changed. Refresh before moving a project.", "stale_disk_state", layout.hash);
      const project = layout.projects.find(item => item.slug === move.slug);
      if (!project) throw new WorkspaceLayoutError(`Unknown project "${move.slug}".`, "invalid_arguments");
      const destination = layout.projects.filter(item => item.slug !== move.slug && Boolean(item.archivedAt) === move.archived);
      const before = move.beforeSlug === undefined ? -1 : destination.findIndex(item => item.slug === move.beforeSlug);
      const after = move.afterSlug === undefined ? -1 : destination.findIndex(item => item.slug === move.afterSlug);
      if ((move.beforeSlug !== undefined && before < 0) || (move.afterSlug !== undefined && after < 0)
        || (before >= 0 && after >= 0 && before !== after + 1)) {
        throw new WorkspaceLayoutError("Choose adjacent neighbors in the destination group.", "invalid_arguments");
      }
      const insertion = before >= 0 ? before : after >= 0 ? after + 1 : destination.length;
      destination.splice(insertion, 0, project);
      const other = layout.projects.filter(item => item.slug !== move.slug && Boolean(item.archivedAt) !== move.archived);
      const projectOrder = (move.archived ? [...other, ...destination] : [...destination, ...other]).map(item => item.slug);
      const settings = { ...getWorkspaceSettings(), projectOrder, updatedAt: new Date().toISOString() };
      let projectFile: string | undefined;
      let previousProject: string | null = null;
      if (Boolean(project.archivedAt) !== move.archived) {
        const dir = projectContentDir(move.slug);
        const { diskHash: _diskHash, lastEditedAt: _lastEditedAt, ...fallback } = project;
        const record = readProjectRecord<Record<string, unknown>>(dir) || fallback;
        const next = { ...record };
        if (move.archived) next.archivedAt = new Date().toISOString();
        else delete next.archivedAt;
        projectFile = texPaths(dir).projectFile;
        previousProject = fs.existsSync(projectFile) ? fs.readFileSync(projectFile, "utf8") : null;
        writeProjectRecord(dir, next);
      }
      try {
        writeDataFile(file, WORKSPACE_SCHEMA, WORKSPACE_ID, settings, "Editable workspace identity and project order.");
      } catch (error) {
        if (projectFile) {
          if (previousProject === null) fs.rmSync(projectFile, { force: true });
          else writeTextAtomic(projectFile, previousProject);
        }
        throw error;
      }
      return getWorkspaceLayout();
    });
  });
}
