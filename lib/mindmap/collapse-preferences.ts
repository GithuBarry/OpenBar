import type { MindmapNode } from "@/lib/types";

/**
 * Collapse state belongs to the mounted browser view. Keep the key scoped to
 * both identities so two maps, or two projects, never share a view preference.
 */
export const MINDMAP_COLLAPSE_STORAGE_PREFIX = "openbar:mindmap-collapse:v1";
export const MINDMAP_COLLAPSE_STORAGE_VERSION = 1 as const;

export type CollapsePreferenceNode = Pick<MindmapNode, "id" | "parentId">;
export type MindmapCollapsePreference = {
  version: typeof MINDMAP_COLLAPSE_STORAGE_VERSION;
  collapsedIds: string[];
};

export function mindmapCollapseStorageKey(project: string, mapId: string): string {
  return `${MINDMAP_COLLAPSE_STORAGE_PREFIX}:${encodeURIComponent(project)}:${encodeURIComponent(mapId)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Keep only existing branch ids and return a deterministic representation.
 * Leaf ids have no collapsible descendants and therefore never enter the
 * browser preference.
 */
export function normalizeMindmapCollapsedIds(
  value: unknown,
  nodes: readonly CollapsePreferenceNode[],
): string[] {
  const validIds = new Set(nodes.map((node) => node.id));
  const parentIds = new Set(nodes.flatMap((node) => node.parentId ? [node.parentId] : []));
  const ids = Array.isArray(value)
    ? value
    : record(value)?.collapsedIds;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => (
    typeof id === "string" && validIds.has(id) && parentIds.has(id)
  )))].sort();
}

/**
 * Parse the current browser format and the pre-versioned array/object forms.
 * `undefined` version is accepted for one-way migration to the canonical
 * versioned payload. Unknown versions are discarded by returning null.
 */
export function parseMindmapCollapsePreference(
  raw: string | null,
  nodes: readonly CollapsePreferenceNode[],
): MindmapCollapsePreference | null {
  if (raw === null) return { version: MINDMAP_COLLAPSE_STORAGE_VERSION, collapsedIds: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    const parsedRecord = record(parsed);
    if (parsedRecord) {
      const version = parsedRecord.version;
      if (version !== undefined && version !== MINDMAP_COLLAPSE_STORAGE_VERSION) return null;
      if (!Array.isArray(parsedRecord.collapsedIds)) return null;
    } else if (!Array.isArray(parsed)) {
      return null;
    }
    return {
      version: MINDMAP_COLLAPSE_STORAGE_VERSION,
      collapsedIds: normalizeMindmapCollapsedIds(parsed, nodes),
    };
  } catch {
    return null;
  }
}

export function serializeMindmapCollapsePreference(ids: Iterable<string>): string {
  return JSON.stringify({
    version: MINDMAP_COLLAPSE_STORAGE_VERSION,
    collapsedIds: [...new Set(ids)].sort(),
  } satisfies MindmapCollapsePreference);
}

/** Reveal one child level while collapsing each branch below it. */
export function expandMindmapImmediateChildren(
  ids: ReadonlySet<string>,
  nodes: readonly CollapsePreferenceNode[],
  id: string,
): Set<string> {
  const next = new Set(normalizeMindmapCollapsedIds([...ids], nodes));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) || [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  next.delete(id);
  const queue = [id], visited = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const child of children.get(queue[cursor]) || []) {
      if (visited.has(child)) continue;
      visited.add(child);
      if (children.has(child)) next.add(child);
      queue.push(child);
    }
  }
  return next;
}

/**
 * Remove the old durable field at every read/normalization boundary. The
 * generic shape allows this function to process legacy JSON while the current
 * MindmapNode type stays free of persisted view state.
 */
export function stripLegacyCollapsedField<T extends object>(value: T): Omit<T, "collapsed"> {
  const { collapsed: _legacyCollapsed, ...rest } = value as T & { collapsed?: unknown };
  return rest as Omit<T, "collapsed">;
}

/** Read legacy durable flags for an explicit browser migration boundary. */
export function legacyCollapsedIds(nodes: readonly unknown[]): string[] {
  const candidates = nodes.flatMap((value) => {
    const node = record(value);
    return node && node.collapsed === true && typeof node.id === "string" && typeof node.parentId === "string"
      ? [node.id]
      : [];
  });
  return [...new Set(candidates)].sort();
}
