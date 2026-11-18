/** Drop on the center to reparent, or on the top/bottom edge to reorder. */

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
  _localX = 0,
  _targetWidth = 0,
): MindmapDrop | null {
  if (draggedId === targetId) return null;
  if (draggedId === mindmap.rootId) return null;
  if (descendantsOf(mindmap, draggedId).has(targetId)) return null;
  const index = indexMindmap(mindmap);
  if (!index.nodeById.has(draggedId) || !index.nodeById.has(targetId)) return null;
  const ratioY = targetHeight <= 0 ? 0.5 : localY / targetHeight;
  let kind: DropKind = "child";
  if (targetId !== mindmap.rootId) {
    if (ratioY < 0.25) kind = "before";
    else if (ratioY > 0.75) kind = "after";
  }
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

/** Indent: become the last child of the previous sibling. */
export function indentMindmapNode(mindmap: Mindmap, id: string): { parentId: string } | null {
  const index = indexMindmap(mindmap);
  const node = index.nodeById.get(id);
  if (!node || node.id === mindmap.rootId || !node.parentId) return null;
  const siblings = index.childrenByParent.get(node.parentId) || [];
  const at = siblings.findIndex((item) => item.id === id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  if (!previous) return null;
  if (descendantsOf(mindmap, id, index).has(previous.id)) return null;
  return { parentId: previous.id };
}

/** Outdent: move to the grandparent immediately after the former parent. */
export function outdentMindmapNode(mindmap: Mindmap, id: string): { parentId: string; afterId: string } | null {
  const index = indexMindmap(mindmap);
  const node = index.nodeById.get(id);
  if (!node || node.id === mindmap.rootId || !node.parentId) return null;
  const parent = index.nodeById.get(node.parentId);
  if (!parent || parent.id === mindmap.rootId || !parent.parentId) return null;
  if (descendantsOf(mindmap, id, index).has(parent.parentId)) return null;
  return { parentId: parent.parentId, afterId: parent.id };
}

export function mindmapMoveTargets(mindmap: Mindmap, id: string): Array<{ id: string; label: string; depth: number }> {
  const index = indexMindmap(mindmap);
  const blocked = descendantsOf(mindmap, id, index);
  blocked.add(id);
  const out: Array<{ id: string; label: string; depth: number }> = [];
  const walk = (parentId: string, depth: number) => {
    for (const child of index.childrenByParent.get(parentId) || []) {
      if (blocked.has(child.id)) continue;
      out.push({
        id: child.id,
        label: (child.title || (child.contentFormat === "html" ? "HTML card" : child.text) || child.id).trim().split("\n")[0] || child.id,
        depth,
      });
      walk(child.id, depth + 1);
    }
  };
  const root = index.nodeById.get(mindmap.rootId);
  if (root && !blocked.has(root.id)) {
    out.push({ id: root.id, label: (root.title || "Map").trim() || "Map", depth: 0 });
  }
  walk(mindmap.rootId, 1);
  return out;
}
