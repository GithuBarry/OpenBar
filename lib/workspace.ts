/**
 * Repository-backed identity for the research workspace.
 *
 * The product name belongs to the user, so it lives beside the saved
 * content rather than in a build-time constant or browser storage.
 */

import path from "node:path";
import { z } from "zod";

import { readDataFile, withWriteLock, writeDataFile } from "@/lib/tex-project/codec";

const WORKSPACE_SCHEMA = "openbarry/workspace@1";
const WORKSPACE_ID = "workspace";

const workspaceSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(96),
    tagline: z.string().trim().max(240),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export type WorkspaceSettingsInput = Pick<WorkspaceSettings, "name" | "tagline">;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  name: "OpenBar",
  tagline: "Pouring the perfect draft.",
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
  const next = workspaceSettingsSchema.parse({
    name: input.name.trim(),
    tagline: input.tagline.trim(),
    updatedAt: new Date().toISOString(),
  });
  const file = workspaceSettingsFile();
  return withWriteLock(file, () => {
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
