import type { Mindmap, MindmapNode } from "@/lib/types";

const MINDMAP_NODE_FIELDS: ReadonlyArray<keyof MindmapNode> = [
  "id",
  "title",
  "text",
  "caption",
  "caution",
  "todoId",
  "parentId",
  "shape",
  "agentDraft",
  "metadata",
  "contentFormat",
  "color",
  "tags",
  "progress",
  "priority",
  "tableLayout",
  "cardWidth",
  "refs",
  "order",
  "createdAt",
  "updatedAt",
];

const MINDMAP_FIELDS: ReadonlyArray<keyof Mindmap> = [
  "projectId",
  "id",
  "title",
  "role",
  "rootId",
  "createdAt",
  "updatedAt",
  "activityWindowDays",
  "fontSize",
];

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function mergeConvertedNode(base: MindmapNode, saved: MindmapNode, latest: MindmapNode): MindmapNode {
  const merged = { ...saved };
  for (const field of MINDMAP_NODE_FIELDS) {
    if (valuesEqual(latest[field], base[field])) continue;
    const value = latest[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value as never;
  }
  // The server conversion binds the card to TeX. Keep that canonical shape
  // even when an ordinary-card edit arrived while the request was in flight.
  if (merged.todoId?.trim()) {
    delete merged.title;
    merged.text = "";
  }
  return merged;
}

/**
 * Apply the server's canonical snapshot onto edits made while it was in flight.
 * A three-way merge retains local card edits, additions, moves, and deletions
 * while adopting the fresh disk hash and server-owned canonical fields.
 */
export function mergeSavedMindmap(base: Mindmap, saved: Mindmap, latest: Mindmap): Mindmap {
  const baseById = new Map(base.nodes.map((node) => [node.id, node]));
  const savedById = new Map(saved.nodes.map((node) => [node.id, node]));
  const latestById = new Map(latest.nodes.map((node) => [node.id, node]));
  const baseIds = base.nodes.map((node) => node.id);
  const latestIds = latest.nodes.map((node) => node.id);
  const localStructureChanged = !valuesEqual(baseIds, latestIds);
  const orderedIds = localStructureChanged
    ? latestIds
    : saved.nodes.map((node) => node.id);
  const seen = new Set<string>();
  const nodes: MindmapNode[] = [];

  for (const id of [...orderedIds, ...saved.nodes.map((node) => node.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const baseNode = baseById.get(id);
    const savedNode = savedById.get(id);
    const latestNode = latestById.get(id);

    // A local deletion remains effective after the server adds the binding.
    if (!latestNode && baseNode) continue;
    if (latestNode && baseNode && savedNode) {
      nodes.push(mergeConvertedNode(baseNode, savedNode, latestNode));
    } else if (latestNode && !baseNode) {
      nodes.push({ ...latestNode });
    } else if (savedNode) {
      nodes.push({ ...savedNode });
    }
  }

  const merged: Mindmap = { ...saved, nodes };
  for (const field of MINDMAP_FIELDS) {
    if (valuesEqual(latest[field], base[field])) continue;
    const value = latest[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value as never;
  }
  // These fields identify the persisted server snapshot used by the next CAS
  // save. Local content remains dirty through the saved-signature comparison.
  merged.revision = saved.revision;
  merged.diskHash = saved.diskHash;
  return merged;
}
