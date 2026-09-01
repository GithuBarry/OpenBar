/**
 * Mindmap v2: parentId + siblingIndex define the saved structure. Coordinates are derived.
 */

import { createHash } from "node:crypto";

import type { ArtifactRef, Mindmap, MindmapNode } from "@/lib/types";
import { byOrder, indexMindmap } from "@/lib/mindmap-index";

export { isDerivedEvidenceNode } from "@/lib/mindmap-index";

export const MINDMAP_SCHEMA_V2 = "openbarry/mindmap@2";

export type MindmapContentFormat = "plain" | "markdown" | "tex" | "html";

export type MindmapNodeV2 = {
  id: string;
  parentId: string | null;
  siblingIndex: number;
  content: { format: MindmapContentFormat; value: string };
  refs: ArtifactRef[];
  collapsed: boolean;
  metadata: Record<string, unknown>;
  tags?: string[];
  progress?: number;
  createdAt?: string;
  updatedAt?: string;
  derivedKind?: string;
};

export type MindmapV2 = {
  schema: typeof MINDMAP_SCHEMA_V2;
  rootId: string;
  revision: number;
  nodes: MindmapNodeV2[];
};

export function normalizeMindmap(mindmap: Mindmap): Mindmap {
  const index = indexMindmap(mindmap);
  const nodes = mindmap.nodes.map((node) => {
    const siblings = node.parentId ? (index.childrenByParent.get(node.parentId) || []) : [];
    const siblingIndex = siblings.findIndex((item) => item.id === node.id);
    const { x: _x, y: _y, ...rest } = node;
    return {
      ...rest,
      order: siblingIndex >= 0 ? siblingIndex : node.order ?? 0,
    };
  });
  return { ...mindmap, nodes };
}

export function mindmapDiskHash(mindmap: Mindmap): string {
  const normalized = normalizeMindmap(mindmap);
  const { diskHash: _diskHash, nodes, ...mapState } = normalized;
  const payload = JSON.stringify(stableJsonValue({
    ...mapState,
    nodes: nodes.map(({ x: _x, y: _y, ...node }) => node).sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return createHash("sha256").update(payload).digest("hex");
}

/** Sort object keys so semantically equal metadata receives the same CAS token. */
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

export function toMindmapV2(mindmap: Mindmap): MindmapV2 {
  const normalized = normalizeMindmap(mindmap);
  return {
    schema: MINDMAP_SCHEMA_V2,
    rootId: normalized.rootId,
    revision: normalized.revision ?? 0,
    nodes: normalized.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      siblingIndex: node.order ?? 0,
      content: {
        format: (node.contentFormat as MindmapContentFormat) || "plain",
        value: node.text,
      },
      refs: node.refs || [],
      collapsed: Boolean(node.collapsed),
      metadata: node.metadata || {},
      tags: node.tags,
      progress: node.progress,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      derivedKind: node.derivedKind,
    })),
  };
}

export function fromMindmapV2(projectId: string, map: MindmapV2, extra: Partial<Mindmap> = {}): Mindmap {
  return {
    projectId,
    id: extra.id,
    title: extra.title,
    role: extra.role,
    rootId: map.rootId,
    revision: map.revision,
    updatedAt: extra.updatedAt || new Date().toISOString(),
    createdAt: extra.createdAt,
    nodes: map.nodes.map((node) => ({
      id: node.id,
      text: node.content.value,
      parentId: node.parentId,
      order: node.siblingIndex,
      collapsed: node.collapsed,
      refs: node.refs,
      derivedKind: node.derivedKind,
      metadata: node.metadata,
      contentFormat: node.content.format,
      tags: node.tags,
      progress: node.progress,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    })),
  };
}

export function migrateV1CoordinatesAsTieBreaker(mindmap: Mindmap): Mindmap {
  const byParent = new Map<string, MindmapNode[]>();
  for (const node of mindmap.nodes) {
    if (!node.parentId) continue;
    const siblings = byParent.get(node.parentId) || [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  const orderById = new Map<string, number>();
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => {
      const order = (a.order ?? 0) - (b.order ?? 0);
      if (order !== 0) return order;
      const ay = Number.isFinite(a.y) ? (a.y as number) : 0;
      const by = Number.isFinite(b.y) ? (b.y as number) : 0;
      if (ay !== by) return ay - by;
      return a.id.localeCompare(b.id);
    });
    siblings.forEach((node, index) => orderById.set(node.id, index));
  }
  return normalizeMindmap({
    ...mindmap,
    nodes: mindmap.nodes.map((node) => ({
      ...node,
      order: orderById.get(node.id) ?? node.order ?? 0,
    })),
  });
}

export { byOrder };
