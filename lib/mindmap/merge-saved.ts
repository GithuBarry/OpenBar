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

/** Rebase independent edits onto a newer saved map, preserving real conflicts. */
export function rebaseSavedMindmap(base: Mindmap, saved: Mindmap, latest: Mindmap): Mindmap | null {
  if (base.projectId !== saved.projectId || base.projectId !== latest.projectId
    || (base.id || "draft") !== (saved.id || "draft") || (base.id || "draft") !== (latest.id || "draft")) return null;
  const nodeFields = MINDMAP_NODE_FIELDS.filter(field => field !== "createdAt" && field !== "updatedAt" && field !== "order");
  const mapFields = MINDMAP_FIELDS.filter(field => field !== "createdAt" && field !== "updatedAt");
  const conflicts = <T,>(original: T, remote: T, local: T, fields: ReadonlyArray<keyof T>) => fields.some(field =>
    !valuesEqual(local[field], original[field]) && !valuesEqual(remote[field], original[field])
    && !valuesEqual(local[field], remote[field]));
  const same = <T,>(left: T, right: T, fields: ReadonlyArray<keyof T>) => fields.every(field => valuesEqual(left[field], right[field]));
  if (conflicts(base, saved, latest, mapFields)) return null;
  const baseNodes = new Map(base.nodes.map(node => [node.id, node]));
  const savedNodes = new Map(saved.nodes.map(node => [node.id, node]));
  const latestNodes = new Map(latest.nodes.map(node => [node.id, node]));
  for (const id of new Set([...baseNodes.keys(), ...savedNodes.keys(), ...latestNodes.keys()])) {
    const original = baseNodes.get(id), remote = savedNodes.get(id), local = latestNodes.get(id);
    if (!original) {
      if (remote && local && !same(remote, local, nodeFields)) return null;
    } else if (!remote) {
      if (local && !same(original, local, nodeFields)) return null;
    } else if (!local) {
      if (!same(original, remote, nodeFields)) return null;
    } else {
      if (conflicts(original, remote, local, nodeFields)) return null;
      // A concurrent TODO binding can clear ordinary title/text. Preserve a
      // human edit for review instead of discarding it during canonicalization.
      if (remote.todoId !== original.todoId && remote.todoId
        && (!valuesEqual(local.title, original.title) || !valuesEqual(local.text, original.text))) return null;
      if (local.todoId !== original.todoId && local.todoId
        && (!valuesEqual(remote.title, original.title) || !valuesEqual(remote.text, original.text))) return null;
    }
  }
  const merged = mergeSavedMindmap(base, saved, latest);
  const mergedNodes = new Map(merged.nodes.map(node => [node.id, node]));
  if (mergedNodes.size !== merged.nodes.length || !mergedNodes.has(merged.rootId)) return null;
  // Independent moves or deletions can combine into a cycle or missing parent.
  for (const node of merged.nodes) {
    let current = node;
    const seen = new Set<string>();
    while (current.parentId !== null) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const parent = mergedNodes.get(current.parentId);
      if (!parent) return null;
      current = parent;
    }
    if (current.id !== merged.rootId) return null;
  }
  const matchesSaved = same(merged, saved, mapFields) && mergedNodes.size === savedNodes.size
    && merged.nodes.every(node => {
      const remote = savedNodes.get(node.id);
      return remote && same(node, remote, nodeFields);
    });
  return matchesSaved ? saved : merged;
}
