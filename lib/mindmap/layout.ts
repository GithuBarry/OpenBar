/**
 * Deterministic connected-tree layout via d3-hierarchy.
 */

import { hierarchy, tree } from "d3-hierarchy";

import { indexMindmap } from "@/lib/mindmap-index";
import type { Mindmap, MindmapNode } from "@/lib/types";

export type Point = { x: number; y: number };
export type Dimensions = { width: number; height: number };

type Datum = { id: string; children: Datum[] };

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 102;
export const ROOT_WIDTH = 286;
export const ROOT_HEIGHT = 118;
export const HORIZONTAL_GAP = 156;
export const VERTICAL_GAP = 24;

export function nodeDimensions(node: MindmapNode): Dimensions {
  const lines = Math.max(1, node.text.split("\n").length);
  const width = node.parentId === null ? ROOT_WIDTH : NODE_WIDTH;
  const trackingHeight = node.tags?.length || node.progress !== undefined ? 20 : 0;
  const height = (node.parentId === null ? ROOT_HEIGHT : NODE_HEIGHT) + Math.max(0, lines - 2) * 16 + trackingHeight;
  return { width, height };
}

export function layoutMindmapTree(
  mindmap: Mindmap,
  sizes: Map<string, Dimensions>,
): { positions: Map<string, Point>; reachable: Set<string>; connected: Set<string> } {
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const toDatum = (id: string, path = new Set<string>()): Datum => {
    const node = nodeById.get(id);
    if (path.has(id)) return { id, children: [] };
    const nextPath = new Set(path);
    nextPath.add(id);
    const kids = node && !node.collapsed ? (childrenByParent.get(id) || []) : [];
    return { id, children: kids.map((child) => toDatum(child.id, nextPath)) };
  };
  const rootId = nodeById.has(mindmap.rootId)
    ? mindmap.rootId
    : ([...nodeById.values()].find((node) => node.parentId === null)?.id || mindmap.nodes[0]?.id || "root");
  const root = hierarchy(toDatum(rootId), (d) => d.children);
  const verticalStep = Math.max(
    NODE_HEIGHT,
    ...[...sizes.values()].map((size) => size.height),
  ) + VERTICAL_GAP;
  const layout = tree<Datum>().nodeSize([verticalStep, NODE_WIDTH + HORIZONTAL_GAP]);
  layout(root);
  const positions = new Map<string, Point>();
  const reachable = new Set<string>();
  root.each((node) => {
    const size = sizes.get(node.data.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    positions.set(node.data.id, {
      x: Math.max(24, Math.round(node.y + 80)),
      y: Math.round(node.x - size.height / 2 + 88),
    });
    reachable.add(node.data.id);
  });
  const minimumY = Math.min(...[...positions.values()].map((point) => point.y), 24);
  if (minimumY < 24) {
    for (const [id, point] of positions) positions.set(id, { ...point, y: point.y + 24 - minimumY });
  }
  const connected = new Set<string>();
  const visitConnected = (id: string, path = new Set<string>()) => {
    if (path.has(id) || !nodeById.has(id)) return;
    connected.add(id);
    const nextPath = new Set(path);
    nextPath.add(id);
    for (const child of childrenByParent.get(id) || []) visitConnected(child.id, nextPath);
  };
  visitConnected(rootId);
  return { positions, reachable, connected };
}

export function connectedParentPath(mindmap: Mindmap, id: string): string[] | null {
  const { nodeById } = indexMindmap(mindmap);
  const path: string[] = [];
  const seen = new Set<string>();
  let current = nodeById.get(id);
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    path.push(current.id);
    if (current.id === mindmap.rootId) return path.reverse();
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  return null;
}
