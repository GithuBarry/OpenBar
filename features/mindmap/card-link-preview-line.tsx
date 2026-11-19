"use client";

import { useContext } from "react";
import { getBezierPath, Position, useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { LinkPreviewContext } from "./linked-card";

function previewPath(state: ReactFlowState, sourceId: string, targetId: string) {
  const rect = (id: string) => {
    const node = state.nodeLookup.get(id);
    if (!node || node.hidden) return;
    const { width, height } = node.measured;
    if (!width || !height) return;
    const { x, y } = node.internals.positionAbsolute;
    return { x: x + width / 2, y: y + height / 2, width, height };
  };
  const source = rect(sourceId), target = rect(targetId);
  if (!source || !target) return;
  const dx = target.x - source.x, dy = target.y - source.y;
  const horizontal = Math.abs(dx) / (source.width + target.width) >= Math.abs(dy) / (source.height + target.height);
  const sign = Math.sign(horizontal ? dx : dy) || 1;
  const sourceX = source.x + (horizontal ? sign * source.width / 2 : 0);
  const targetX = target.x - (horizontal ? sign * target.width / 2 : 0);
  const sourceY = source.y + (horizontal ? 0 : sign * source.height / 2);
  const targetY = target.y - (horizontal ? 0 : sign * target.height / 2);
  const [panX, panY, zoom] = state.transform;
  const onScreen = (x: number, y: number) =>
    x * zoom + panX >= 0 && x * zoom + panX <= state.width && y * zoom + panY >= 0 && y * zoom + panY <= state.height;
  if (!onScreen(sourceX, sourceY) || !onScreen(targetX, targetY)) return;
  const forward = horizontal ? Position.Right : Position.Bottom;
  const backward = horizontal ? Position.Left : Position.Top;
  return getBezierPath({ sourceX, sourceY, targetX, targetY,
    sourcePosition: sign > 0 ? forward : backward, targetPosition: sign > 0 ? backward : forward })[0];
}

function VisibleReferenceLine({ sourceId, targetId }: { sourceId: string; targetId: string }) {
  const path = useStore(state => previewPath(state, sourceId, targetId));
  if (!path) return null;
  return <ViewportPortal><svg width="1" height="1" aria-hidden="true"
    style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}>
    <path data-card-reference-line="" d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.5}
      strokeDasharray="4 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg></ViewportPortal>;
}

export function CardLinkPreviewLine() {
  const link = useContext(LinkPreviewContext);
  return link ? <VisibleReferenceLine sourceId={link.sourceId} targetId={link.targetId} /> : null;
}
