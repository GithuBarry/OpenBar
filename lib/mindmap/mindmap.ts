/**
 * Mindmap persistence record: parentId + siblingIndex define the saved structure. Coordinates are derived.
 */

import type { Mindmap } from "@/lib/types";
import { coerceArtifactRef } from "@/lib/research/artifact-link";
import { indexMindmap, persistableMindmap } from "@/lib/mindmap-index";
import { sha256Hex } from "@/lib/mindmap/sha256";

export const DEFAULT_MINDMAP_FONT_SIZE = 13;

export function normalizeMindmap(mindmap: Mindmap): Mindmap {
  const cleaned = persistableMindmap(mindmap);
  const index = indexMindmap(cleaned);
  const nodes = cleaned.nodes.map((node) => {
    const siblings = node.parentId ? (index.childrenByParent.get(node.parentId) || []) : [];
    const siblingIndex = siblings.findIndex((item) => item.id === node.id);
    return {
      ...node,
      refs: (node.refs || []).map(coerceArtifactRef).filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
      order: siblingIndex >= 0 ? siblingIndex : node.order ?? 0,
    };
  });
  const activityWindowDays = Number.isInteger(cleaned.activityWindowDays)
    ? Math.max(1, Math.min(365, cleaned.activityWindowDays as number))
    : undefined;
  return {
    ...cleaned,
    nodes,
    ...(activityWindowDays === undefined ? { activityWindowDays: undefined } : { activityWindowDays }),
  };
}

export function mindmapDiskHash(mindmap: Mindmap): string {
  const normalized = normalizeMindmap(mindmap);
  const { diskHash: _diskHash, nodes, ...mapState } = normalized;
  const payload = JSON.stringify(stableJsonValue({
    ...mapState,
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return sha256Hex(payload);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableJsonValue(child)]),
  );
}
