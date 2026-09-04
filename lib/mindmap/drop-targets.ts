/**
 * Drop above/below reorders siblings. Drop near the lower edge reparents.
 * Moves into descendants are rejected.
 */

import { descendantsOf, indexMindmap } from "@/features/mindmap/mindmap-state";
import type { Mindmap } from "@/lib/types";

export type DropKind = "before" | "after" | "child";

export type MindmapDrop = {
  id: string;
  targetId: string;
  kind: DropKind;
};

export function resolveMindmapDrop(
  mindmap: Mindmap,
  draggedId: string,
  targetId: string,
  localY: number,
  targetHeight: number,
): MindmapDrop | null {
  if (draggedId === targetId) return null;
  if (draggedId === mindmap.rootId) return null;
  if (descendantsOf(mindmap, draggedId).has(targetId)) return null;
  const index = indexMindmap(mindmap);
  if (!index.nodeById.has(draggedId) || !index.nodeById.has(targetId)) return null;
  const ratio = targetHeight <= 0 ? 0.5 : localY / targetHeight;
  let kind: DropKind = "after";
  if (ratio < 0.28) kind = "before";
  else if (ratio > 0.72) kind = "child";
  return { id: draggedId, targetId, kind };
}

export function applyMindmapDrop(mindmap: Mindmap, drop: MindmapDrop): { parentId: string; beforeId?: string; afterId?: string } | null {
  const index = indexMindmap(mindmap);
  const target = index.nodeById.get(drop.targetId);
  const dragged = index.nodeById.get(drop.id);
  if (!target || !dragged) return null;
  if (dragged.id === mindmap.rootId || dragged.id === target.id) return null;
  if (descendantsOf(mindmap, dragged.id, index).has(target.id)) return null;
  if (drop.kind === "child") return { parentId: target.id };
  const parentId = target.parentId || mindmap.rootId;
  if (drop.kind === "before") return { parentId, beforeId: target.id };
  return { parentId, afterId: target.id };
}
