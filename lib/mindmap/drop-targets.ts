/**
 * Drop near the right or lower edge reparents. Drop near the upper edge
 * reorders before a sibling, with the remaining card area reordering after it.
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
  localX = 0,
  targetWidth = 0,
): MindmapDrop | null {
  if (draggedId === targetId) return null;
  if (draggedId === mindmap.rootId) return null;
  if (descendantsOf(mindmap, draggedId).has(targetId)) return null;
  const index = indexMindmap(mindmap);
  if (!index.nodeById.has(draggedId) || !index.nodeById.has(targetId)) return null;
  const ratioY = targetHeight <= 0 ? 0.5 : localY / targetHeight;
  const ratioX = targetWidth <= 0 ? 0.5 : localX / targetWidth;
  let kind: DropKind = "after";
  if (ratioX > 0.72 || ratioY > 0.72) kind = "child";
  else if (ratioY < 0.28) kind = "before";
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
