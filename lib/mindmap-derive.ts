/**
 * Reconcile TeX TODOs with the primary mindmap.
 * Derived overlays are never written back to the map file.
 */

import { getMindmap, getProject } from "@/lib/store";
import { DEFAULT_PRIMARY_MINDMAP_TITLE, DRAFT_MINDMAP_ID } from "@/lib/tex-project/project";
import type { Mindmap } from "@/lib/types";

export function deriveMindmap(slug: string): Mindmap | null {
  return getMindmap(slug, DRAFT_MINDMAP_ID) || emptyPlanningMap(slug);
}

function emptyPlanningMap(slug: string): Mindmap | null {
  const project = getProject(slug);
  if (!project) return null;
  const now = new Date().toISOString();
  return {
    projectId: slug,
    id: DRAFT_MINDMAP_ID,
    title: DEFAULT_PRIMARY_MINDMAP_TITLE,
    role: "draft",
    rootId: "root",
    createdAt: now,
    updatedAt: now,
    nodes: [{ id: "root", text: project.title, parentId: null, shape: "root", order: 0, createdAt: now }],
  };
}
