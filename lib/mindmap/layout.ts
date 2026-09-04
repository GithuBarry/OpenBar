/**
 * Deterministic connected-tree layout via d3-hierarchy.
 * Card size hugs wrapped text up to NODE_WIDTH / ROOT_WIDTH.
 */

import { hierarchy, tree } from "d3-hierarchy";

import { indexMindmap } from "@/lib/mindmap-index";
import type { Mindmap, MindmapNode } from "@/lib/types";

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };

type Datum = { id: string; children: Datum[] };

type SeparableTree = {
  nodeSize(size: [number, number]): SeparableTree;
  separation(fn: (a: { data: Datum }, b: { data: Datum }) => number): SeparableTree;
  (root: ReturnType<typeof hierarchy<Datum>>): void;
};

/** Max card width for readable dense topics and TODOs. */
export const NODE_WIDTH = 248;
/** Min one-line card height. */
export const NODE_HEIGHT = 36;
export const ROOT_WIDTH = 280;
export const ROOT_HEIGHT = 42;
export const HORIZONTAL_GAP = 72;
export const VERTICAL_GAP = 12;

const PAD_X = 20;
const PAD_Y = 14;
const MIN_WIDTH = 96;
const MIN_ROOT_WIDTH = 96;
const TITLE_PX = 13.5;
const TITLE_LH = 17;
const TODO_TITLE_PX = 13.5;
const TODO_TITLE_LH = 17;
const TODO_BODY_PX = 11.6;
const TODO_BODY_LH = 15;
const ROOT_TITLE_PX = 15.7;
const ROOT_TITLE_LH = 20;
const DETAIL_PX = 11.6;
const DETAIL_LH = 15;
const META_H = 16;
// ponytail: naive em-width wrap; canvas measureText if cards clip or look loose.
const CHAR = 0.62;

function wrappedSize(text: string, maxInner: number, fontPx: number, linePx: number): Dimensions {
  const charW = fontPx * CHAR;
  const inner = Math.max(charW, maxInner);
  let width = 0;
  let height = 0;
  for (const hard of text.split("\n")) {
    const raw = Math.max(charW, hard.length * charW);
    const lines = Math.max(1, Math.ceil(raw / inner));
    width = Math.max(width, Math.min(raw, inner));
    height += lines * linePx;
  }
  return { width, height };
}

export function nodeDimensions(node: MindmapNode, displayText?: string, forcedWidth?: number): Dimensions {
  const isRoot = node.parentId === null;
  const maxW = isRoot ? ROOT_WIDTH : NODE_WIDTH;
  const maxInner = maxW - PAD_X;
  const titlePx = isRoot ? ROOT_TITLE_PX : node.todoId ? TODO_TITLE_PX : TITLE_PX;
  const titleLh = isRoot ? ROOT_TITLE_LH : node.todoId ? TODO_TITLE_LH : TITLE_LH;
  // ponytail: TODO display text lives in TeX; empty map text would hug "Untitled"
  // and collide. Size empty TODOs as a wrapped sentence at max width.
  const ordinarySource = node.title !== undefined
    ? `${node.title}\n${node.text}`
    : node.text;
  const source = (displayText ?? ordinarySource).trim()
    || (node.todoId
      ? "Paper TODO placeholder that wraps onto several compact card lines at max width."
      : "Untitled topic");
  const [titleLine, ...detailLines] = source.split("\n");
  const title = wrappedSize(titleLine || "Untitled topic", maxInner, titlePx, titleLh);
  const detailText = detailLines.join("\n").trim();
  const naturalDetail = detailText
    ? wrappedSize(detailText, maxInner, node.todoId ? TODO_BODY_PX : DETAIL_PX, node.todoId ? TODO_BODY_LH : DETAIL_LH)
    : { width: 0, height: 0 };
  const naturalInnerW = Math.max(title.width, naturalDetail.width);
  const minimumWidth = isRoot ? MIN_ROOT_WIDTH : MIN_WIDTH;
  const width = forcedWidth === undefined
    ? Math.min(maxW, Math.max(minimumWidth, Math.ceil(naturalInnerW + PAD_X)))
    : Math.min(maxW, Math.max(minimumWidth, Math.ceil(forcedWidth)));
  const actualInner = Math.max(titlePx * CHAR, width - PAD_X);
  const actualTitle = wrappedSize(titleLine || "Untitled topic", actualInner, titlePx, titleLh);
  const detail = detailText
    ? wrappedSize(detailText, actualInner, node.todoId ? TODO_BODY_PX : DETAIL_PX, node.todoId ? TODO_BODY_LH : DETAIL_LH)
    : { width: 0, height: 0 };
  const meta = node.tags?.length || node.progress !== undefined ? META_H : 0;
  const height = Math.max(
    isRoot ? ROOT_HEIGHT : NODE_HEIGHT,
    Math.ceil(PAD_Y + actualTitle.height + (detail.height ? 4 + detail.height : 0) + meta),
  );
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
  const columnPitch = Math.max(
    NODE_WIDTH,
    ROOT_WIDTH,
    ...[...sizes.values()].map((size) => size.width),
  ) + HORIZONTAL_GAP;
  const layout = tree<Datum>().nodeSize([1, columnPitch]) as unknown as SeparableTree;
  layout.separation((a, b) => {
    const ha = sizes.get(a.data.id)?.height ?? NODE_HEIGHT;
    const hb = sizes.get(b.data.id)?.height ?? NODE_HEIGHT;
    return (ha + hb) / 2 + VERTICAL_GAP;
  });
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
  separateOverlappingColumns(positions, sizes);
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

function separateOverlappingColumns(positions: Map<string, Point>, sizes: Map<string, Dimensions>): void {
  const columns = new Map<number, string[]>();
  for (const [id, point] of positions) {
    const column = columns.get(point.x);
    if (column) column.push(id);
    else columns.set(point.x, [id]);
  }
  for (const ids of columns.values()) {
    ids.sort((a, b) => (positions.get(a)?.y ?? 0) - (positions.get(b)?.y ?? 0));
    for (let index = 1; index < ids.length; index += 1) {
      const previousId = ids[index - 1]!;
      const currentId = ids[index]!;
      const previous = positions.get(previousId);
      const current = positions.get(currentId);
      const previousSize = sizes.get(previousId) || { width: NODE_WIDTH, height: NODE_HEIGHT };
      if (!previous || !current) continue;
      const minimumY = previous.y + previousSize.height + VERTICAL_GAP;
      if (current.y < minimumY) positions.set(currentId, { ...current, y: minimumY });
    }
  }
}

function checkNodeDimensions(): void {
  const short = nodeDimensions({ id: "s", text: "Hi", parentId: "r" });
  const long = nodeDimensions({ id: "l", text: "Long topic ".repeat(12), parentId: "r" });
  const root = nodeDimensions({ id: "r", text: "Paper", parentId: null });
  const todo = nodeDimensions({ id: "t", text: "", parentId: "r", todoId: "x" });
  if (!(short.width < NODE_WIDTH && short.width >= MIN_WIDTH)) throw new Error("nodeDimensions should hug short text");
  if (long.width !== NODE_WIDTH) throw new Error("nodeDimensions should cap at NODE_WIDTH");
  if (!(long.height > short.height)) throw new Error("nodeDimensions should grow for wrapped text");
  if (!(root.width >= short.width && root.width <= ROOT_WIDTH)) throw new Error("root should stay slightly distinct");
  if (!(todo.width === NODE_WIDTH && todo.height > NODE_HEIGHT)) throw new Error("empty TODOs should use wrapped max-width");
}

checkNodeDimensions();
