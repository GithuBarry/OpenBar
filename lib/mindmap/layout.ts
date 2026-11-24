/**
 * Deterministic connected-tree contour layout for variable-size cards.
 * Card size hugs wrapped text up to NODE_WIDTH / ROOT_WIDTH.
 */

import { markdownTableColumns } from "./markdown-table";
import { MIN_CARD_WIDTH, normalizeCardWidth } from "./card-width";
import { MAX_HTML_CARD_LENGTH } from "./html-card";
import { stripInlineInfoNotes } from "./inline-info-notes";
import { INLINE_MARKDOWN_BR_RE } from "./markdown-breaks";
import { flextree } from "d3-flextree";

import { indexMindmap } from "@/lib/mindmap-index";
import type { Mindmap, MindmapNode } from "@/lib/types";

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };

type Datum = { id: string; children: Datum[] };

/** Baseline width for a prose card. */
export const NODE_WIDTH = 264;
export const MAX_AUTO_TABLE_WIDTH = 900;
const MAX_AUTO_PROSE_WIDTH = 480;
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

/** Use room already occupied by a sibling when it saves at least two lines. */
export function fitProseToSiblingWidth(node: MindmapNode, text: string | undefined, preferred: Dimensions, siblingMaxWidth: number): number {
  const width = Math.min(siblingMaxWidth, MAX_AUTO_PROSE_WIDTH);
  if (width <= preferred.width || node.cardWidth !== undefined || node.contentFormat === "html" ||
      node.refs?.some(ref => ref.kind === "figure") || (node.contentFormat === "markdown" && markdownTableColumns(node.text))) {
    return preferred.width;
  }
  const expanded = nodeDimensions({ ...node, cardWidth: width }, text);
  return preferred.height - expanded.height >= 2 * DETAIL_LH ? width : preferred.width;
}

function markdownLayoutSource(text: string, hasTable: boolean): string {
  const stripped = stripInlineInfoNotes(text, " ⓘ");
  if (!/<br\s*\/?>/i.test(stripped)) return stripped;
  return stripped
    .split("\n")
    .flatMap((line) => {
      if (hasTable && line.includes("|")) {
        let maxLines = 1;
        const compact = line
          .split("|")
          .map((cell) => {
            const parts = cell.split(INLINE_MARKDOWN_BR_RE);
            if (parts.length > maxLines) maxLines = parts.length;
            return parts.reduce((longest, part) => (part.trim().length > longest.trim().length ? part : longest), "");
          })
          .join("|");
        return [compact, ...Array.from({ length: maxLines - 1 }, () => "")];
      }
      return line.split(INLINE_MARKDOWN_BR_RE);
    })
    .join("\n");
}

export function nodeDimensions(node: MindmapNode, displayText?: string): Dimensions {
  const isRoot = node.parentId === null;
  if (node.contentFormat === "html" && !node.todoId) {
    const width = normalizeCardWidth(node.cardWidth) ?? 360;
    const inner = width - PAD_X;
    const source = node.text.slice(0, MAX_HTML_CARD_LENGTH);
    const visible = source.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<[^>]*>/g, " ").replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "x").replace(/\s+/g, " ").trim();
    const title = node.title?.trim() ? wrappedSize(node.title, inner, isRoot ? ROOT_TITLE_PX : TITLE_PX, isRoot ? ROOT_TITLE_LH : TITLE_LH).height : 0;
    const textHeight = visible ? wrappedSize(visible, inner, DETAIL_PX, DETAIL_LH).height : 0;
    const svgMatch = source.match(/<svg\b[^>]*\bviewBox\s*=\s*["']\s*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)\s*["']/i);
    const svgWidth = svgMatch ? Number(svgMatch[1]) : 0;
    const svgHeight = svgMatch ? Number(svgMatch[2]) : 0;
    const estimatedSvg = svgWidth > 0 && svgHeight > 0 ? Math.ceil(inner * (svgHeight / svgWidth)) : 240;
    const body = source.trim()
      ? /<svg\b/i.test(source)
        ? Math.max(estimatedSvg, textHeight)
        : Math.max(DETAIL_LH, textHeight)
      : 0;
    const meta = node.tags?.length || node.progress !== undefined || node.priority ? META_H : 0;
    return { width, height: Math.max(isRoot ? ROOT_HEIGHT : NODE_HEIGHT, PAD_Y + title + (title && body ? 4 : 0) + body + meta) };
  }
  const tableColumns = node.contentFormat === "markdown" ? markdownTableColumns(node.text) : 0;
  const baseMaxW = isRoot ? ROOT_WIDTH : NODE_WIDTH;
  const wideTable = tableColumns > 0 && node.tableLayout !== "scroll";
  const imageCard = node.refs?.some((ref) => ref.kind === "figure") ?? false;
  const cardWidth = normalizeCardWidth(node.cardWidth);
  const maxW = cardWidth ?? (wideTable
    ? MAX_AUTO_TABLE_WIDTH
    : imageCard ? Math.max(baseMaxW, 320) : baseMaxW);
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
  const rawSource = (displayText ?? ordinarySource).trim()
    || (node.todoId
      ? "Paper TODO placeholder that wraps onto several compact card lines at max width."
      : "Untitled topic");
  const source = node.contentFormat === "markdown" && !node.todoId
    ? markdownLayoutSource(rawSource, tableColumns > 0)
    : rawSource;
  const [titleLine, ...detailLines] = source.split("\n");
  const title = wrappedSize(titleLine || "Untitled topic", maxInner, titlePx, titleLh);
  const detailText = detailLines.join("\n").trim();
  const naturalDetail = detailText
    ? wrappedSize(detailText, maxInner, node.todoId ? TODO_BODY_PX : DETAIL_PX, node.todoId ? TODO_BODY_LH : DETAIL_LH)
    : { width: 0, height: 0 };
  const naturalInnerW = Math.max(title.width, naturalDetail.width);
  let width = cardWidth ?? baseMaxW;
  if (cardWidth === undefined) {
    if (wideTable || imageCard) {
      width = Math.min(maxW, Math.max(baseMaxW, Math.ceil(naturalInnerW + padX)));
    } else if (tableColumns === 0) {
      const textHeight = title.height + naturalDetail.height;
      const compact = Math.max(MIN_CARD_WIDTH, Math.ceil(naturalInnerW + padX));
      // A tall paragraph can trade width for fewer lines. Hard line breaks alone
      // do not benefit from extra width, so also bound it by the longest line.
      const longestLine = Math.max(titleLine.length * titlePx * CHAR,
        detailLines.reduce((max, line) => Math.max(max, line.length), 0) * DETAIL_PX * CHAR);
      const balanced = Math.sqrt(baseMaxW * (textHeight + padY) * 1.35);
      width = Math.max(compact, Math.min(MAX_AUTO_PROSE_WIDTH, Math.ceil(longestLine + padX), Math.round(balanced)));
    }
  }
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

/** Width groups follow saved relationships, including currently collapsed cards. */
export function groupedCardWidths(
  mindmap: Mindmap,
  naturalWidths: ReadonlyMap<string, number>,
  mode: "individual" | "siblings" | "depth" = "individual",
): Map<string, number> {
  const widths = new Map(naturalWidths);
  if (mode === "individual") return widths;
  const { nodeById } = indexMindmap(mindmap);
  const depthById = new Map<string, number>();
  const depthOf = (id: string, path = new Set<string>()): number | undefined => {
    const known = depthById.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return;
    const node = nodeById.get(id);
    if (!node) return;
    if (id === mindmap.rootId) { depthById.set(id, 0); return 0; }
    if (!node.parentId) return;
    const nextPath = new Set(path).add(id);
    const parentDepth = depthOf(node.parentId, nextPath);
    if (parentDepth === undefined) return;
    depthById.set(id, parentDepth + 1);
    return parentDepth + 1;
  };
  const groups = new Map<string, string[]>();
  for (const node of mindmap.nodes) {
    const depth = mode === "depth" ? depthOf(node.id) : undefined;
    const group = mode === "siblings"
      ? node.id !== mindmap.rootId && node.parentId && nodeById.has(node.parentId) ? `parent:${node.parentId}` : `card:${node.id}`
      : depth !== undefined ? `depth:${depth}` : `card:${node.id}`;
    const members = groups.get(group) || [];
    members.push(node.id);
    groups.set(group, members);
  }
  for (const members of groups.values()) {
    const maximum = Math.max(0, ...members.map(id => naturalWidths.get(id) || 0));
    for (const id of members) if (maximum > 0) widths.set(id, maximum);
  }
  return widths;
}

export function layoutMindmapTree(
  mindmap: Mindmap,
  sizes: Map<string, Dimensions>,
  collapsedIds: ReadonlySet<string> = new Set(),
): { positions: Map<string, Point>; reachable: Set<string>; connected: Set<string> } {
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const positions = new Map<string, Point>();
  const reachable = new Set<string>();
  const connected = new Set<string>();
  const rootId = nodeById.has(mindmap.rootId)
    ? mindmap.rootId
    : ([...nodeById.values()].find((node) => node.parentId === null)?.id || mindmap.nodes[0]?.id);
  if (!rootId) return { positions, reachable, connected };

  const toDatum = (id: string): Datum | undefined => {
    if (!nodeById.has(id) || reachable.has(id)) return;
    reachable.add(id);
    const children = collapsedIds.has(id) ? [] : (childrenByParent.get(id) || [])
      .flatMap(child => {
        const datum = toDatum(child.id);
        return datum ? [datum] : [];
      });
    return { id, children };
  };
  const sizeOf = (id: string) => sizes.get(id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
  // Flextree packs real rectangular contours. Its depth dimension is the
  // horizontal card width plus the exact parent-to-child clearance.
  const layout = flextree<Datum>({
    children: datum => datum.children,
    nodeSize: node => {
      const size = sizeOf(node.data.id);
      return [size.height, size.width + HORIZONTAL_GAP];
    },
    spacing: VERTICAL_GAP,
  });
  const root = layout.hierarchy(toDatum(rootId)!);
  layout(root);
  let minimumY = 24;
  for (const node of root.nodes) {
    const point = { x: node.y + 80, y: node.x - sizeOf(node.data.id).height / 2 + 88 };
    positions.set(node.data.id, point);
    minimumY = Math.min(minimumY, point.y);
  }
  if (minimumY < 24) {
    for (const point of positions.values()) point.y += 24 - minimumY;
  }

  // Full-graph membership keeps collapsed descendants out of orphan recovery.
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (connected.has(id) || !nodeById.has(id)) continue;
    connected.add(id);
    for (const child of childrenByParent.get(id) || []) pending.push(child.id);
  }
  return { positions, reachable, connected };
}
