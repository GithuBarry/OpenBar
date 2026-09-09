/**
 * Deterministic connected-tree layout via d3-hierarchy.
 * Card size hugs wrapped text up to NODE_WIDTH / ROOT_WIDTH.
 */

import { markdownTableColumns, markdownTableWidth } from "./markdown-table";
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
export const NODE_WIDTH = 264;
/** Min one-line card height. */
export const NODE_HEIGHT = 36;
export const ROOT_WIDTH = 300;
export const ROOT_HEIGHT = 42;
export const HORIZONTAL_GAP = 72;
export const VERTICAL_GAP = 20;

const PAD_X = 31;
const PAD_Y = 26;
const TITLE_PX = 14;
const TITLE_LH = 19;
const TODO_TITLE_PX = 14;
const TODO_TITLE_LH = 19;
const TODO_BODY_PX = 12;
const TODO_BODY_LH = 17;
const ROOT_TITLE_PX = 16;
const ROOT_TITLE_LH = 21;
const DETAIL_PX = 12;
const DETAIL_LH = 17;
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

export function nodeDimensions(node: MindmapNode, displayText?: string): Dimensions {
  const isRoot = node.parentId === null;
  const tableColumns = node.contentFormat === "markdown" ? markdownTableColumns(node.text) : 0;
  const baseMaxW = isRoot ? ROOT_WIDTH : NODE_WIDTH;
  const wideTable = tableColumns > 0 && node.tableLayout !== "scroll";
  const imageCard = node.refs?.some((ref) => ref.kind === "figure") ?? false;
  const maxW = wideTable
    ? Math.max(baseMaxW, Math.min(900, markdownTableWidth(node.text)))
    : imageCard ? Math.max(baseMaxW, 320) : baseMaxW;
  const padX = node.todoId ? 28 : PAD_X;
  const padY = node.todoId ? 24 : PAD_Y;
  const headingHeight = node.todoId ? 24 : 0;
  const maxInner = maxW - padX;
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
  const width = wideTable || imageCard
    ? Math.min(maxW, Math.max(baseMaxW, Math.ceil(naturalInnerW + padX)))
    : baseMaxW;
  const actualInner = Math.max(titlePx * CHAR, width - padX);
  const actualTitle = wrappedSize(titleLine || "Untitled topic", actualInner, titlePx, titleLh);
  const detail = detailText
    ? wrappedSize(detailText, actualInner, node.todoId ? TODO_BODY_PX : DETAIL_PX, node.todoId ? TODO_BODY_LH : DETAIL_LH)
    : { width: 0, height: 0 };
  const meta = node.tags?.length || node.progress !== undefined || node.priority
    ? node.todoId ? 32 : META_H
    : 0;
  const height = Math.max(
    isRoot ? ROOT_HEIGHT : NODE_HEIGHT,
    Math.ceil(padY + headingHeight + actualTitle.height + (detail.height ? (node.todoId ? 6 : 4) + detail.height : 0) + meta),
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
  const layout = tree<Datum>().nodeSize([1, 1]) as unknown as SeparableTree;
  layout.separation((a, b) => {
    const ha = sizes.get(a.data.id)?.height ?? NODE_HEIGHT;
    const hb = sizes.get(b.data.id)?.height ?? NODE_HEIGHT;
    return (ha + hb) / 2 + VERTICAL_GAP;
  });
  layout(root);
  const positions = new Map<string, Point>();
  const reachable = new Set<string>();
  const alignedX = new Map<number, number>([[0, 80]]);
  for (let depth = 1; depth <= root.height; depth += 1) {
    const previousWidth = depth === 1 ? ROOT_WIDTH : NODE_WIDTH;
    alignedX.set(depth, (alignedX.get(depth - 1) || 80) + previousWidth + HORIZONTAL_GAP);
  }
  root.eachBefore((node) => {
    const size = sizes.get(node.data.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    const parentPosition = node.parent ? positions.get(node.parent.data.id) : undefined;
    const parentWidth = node.parent ? sizes.get(node.parent.data.id)?.width ?? NODE_WIDTH : 0;
    positions.set(node.data.id, {
      x: Math.max(24, Math.round(parentPosition
        ? Math.max(alignedX.get(node.depth) || 80, parentPosition.x + parentWidth + HORIZONTAL_GAP)
        : 80)),
      y: Math.round(node.x - size.height / 2 + 88),
    });
    reachable.add(node.data.id);
  });
  groupSiblingBranchesVertically(root, positions, sizes);
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

type VerticalExtent = { top: number; bottom: number };

/**
 * Give every sibling subtree its own vertical band in saved sibling order.
 * This keeps every parent's cards visually grouped even when neighboring
 * branches contain cards with very different measured heights.
 */
function groupSiblingBranchesVertically(
  root: ReturnType<typeof hierarchy<Datum>>,
  positions: Map<string, Point>,
  sizes: Map<string, Dimensions>,
): void {
  const shiftBranch = (node: typeof root, amount: number) => {
    for (const descendant of node.descendants()) {
      const point = positions.get(descendant.data.id);
      if (point) point.y += amount;
    }
  };

  const placeBranch = (node: typeof root): VerticalExtent => {
    const point = positions.get(node.data.id)!;
    const size = sizes.get(node.data.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    const children = node.children || [];
    let previousBottom: number | undefined;
    let childrenTop = Number.POSITIVE_INFINITY;
    let childrenBottom = Number.NEGATIVE_INFINITY;

    for (const child of children) {
      let extent = placeBranch(child);
      const shift = previousBottom === undefined
        ? 0
        : Math.max(0, previousBottom + VERTICAL_GAP - extent.top);
      if (shift > 0) {
        shiftBranch(child, shift);
        extent = { top: extent.top + shift, bottom: extent.bottom + shift };
      }
      previousBottom = extent.bottom;
      childrenTop = Math.min(childrenTop, extent.top);
      childrenBottom = Math.max(childrenBottom, extent.bottom);
    }

    if (children.length > 0) {
      point.y = Math.round((childrenTop + childrenBottom - size.height) / 2);
    }
    return {
      top: Math.min(point.y, childrenTop),
      bottom: Math.max(point.y + size.height, childrenBottom),
    };
  };

  placeBranch(root);
}

function checkNodeDimensions(): void {
  const short = nodeDimensions({ id: "s", text: "Hi", parentId: "r" });
  const long = nodeDimensions({ id: "l", text: "Long topic ".repeat(12), parentId: "r" });
  const root = nodeDimensions({ id: "r", text: "Paper", parentId: null });
  const todo = nodeDimensions({ id: "t", text: "", parentId: "r", todoId: "x" });
  if (short.width !== NODE_WIDTH) throw new Error("standard cards should use the default width");
  if (long.width !== NODE_WIDTH) throw new Error("nodeDimensions should cap at NODE_WIDTH");
  if (!(long.height > short.height)) throw new Error("nodeDimensions should grow for wrapped text");
  if (root.width !== ROOT_WIDTH) throw new Error("root should use the root width");
  if (!(todo.width === NODE_WIDTH && todo.height > NODE_HEIGHT)) throw new Error("empty TODOs should use wrapped max-width");
}

checkNodeDimensions();
