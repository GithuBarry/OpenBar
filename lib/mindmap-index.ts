import type { Mindmap, MindmapNode } from "@/lib/types";

export type MindmapIndex = {
  nodeById: Map<string, MindmapNode>;
  childrenByParent: Map<string, MindmapNode[]>;
};

export function byOrder(a: MindmapNode, b: MindmapNode): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

/** Evidence overlays are derived from project records and stay out of saved planning maps. */
export function isDerivedEvidenceNode(node: MindmapNode): boolean {
  return node.derivedKind === "evidence" || node.derivedKind === "receipt";
}

/** Map id → node, plus children grouped by parentId (sibling order preserved). */
export function indexMindmap(mindmap: Mindmap | null | undefined): MindmapIndex {
  const nodes = Array.isArray(mindmap?.nodes) ? mindmap.nodes : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (!node.parentId || !nodeById.has(node.parentId)) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(byOrder);
  return { nodeById, childrenByParent };
}

/** Drop derived evidence/receipt cards from a saved planning map. */
export function pruneEvidenceNodes(mindmap: Mindmap): Mindmap {
  const drop = new Set(
    mindmap.nodes
      .filter(isDerivedEvidenceNode)
      .map((node) => node.id),
  );
  if (drop.size === 0) return mindmap;
  return {
    ...mindmap,
    nodes: mindmap.nodes.filter((node) => !drop.has(node.id) && (!node.parentId || !drop.has(node.parentId))),
  };
}

export function emptyMindmap(
  projectId: string,
  spec: { id: string; title: string; role: "draft" | "planning"; rootText?: string },
): Mindmap {
  const now = new Date().toISOString();
  return {
    projectId,
    id: spec.id,
    title: spec.title,
    role: spec.role,
    rootId: "root",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "root",
        text: spec.rootText || spec.title,
        parentId: null,
        shape: "root",
        order: 0,
        createdAt: now,
      },
    ],
  };
}

export function slugifyMindmapId(title: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "map";
}
