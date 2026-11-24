"use client";

import { useContext } from "react";
import { getBezierPath, Position, useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { LinkPreviewContext } from "./linked-card";

type PreviewCurve = {
  path: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  targetRect: { x: number; y: number; width: number; height: number };
};

function previewCurve(state: ReactFlowState, sourceId: string, targetId: string): PreviewCurve | undefined {
  const rect = (id: string) => {
    const node = state.nodeLookup.get(id);
    if (!node || node.hidden) return;
    const { width, height } = node.measured;
    if (!width || !height) return;
    const { x, y } = node.internals.positionAbsolute;
    return { left: x, top: y, x: x + width / 2, y: y + height / 2, width, height };
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
  const forward = horizontal ? Position.Right : Position.Bottom;
  const backward = horizontal ? Position.Left : Position.Top;
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition: sign > 0 ? forward : backward,
    targetPosition: sign > 0 ? backward : forward,
  });
  return {
    path,
    sourceX,
    sourceY,
    targetX,
    targetY,
    targetRect: { x: target.left, y: target.top, width: target.width, height: target.height },
  };
}

function VisibleReferenceLine({ sourceId, targetId }: { sourceId: string; targetId: string }) {
  const curve = useStore(state => previewCurve(state, sourceId, targetId));
  if (!curve) return null;
  return <ViewportPortal><svg width="1" height="1" aria-hidden="true"
    style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none", zIndex: 20 }}>
    <rect
      x={curve.targetRect.x - 3}
      y={curve.targetRect.y - 3}
      width={curve.targetRect.width + 6}
      height={curve.targetRect.height + 6}
      rx={12}
      fill="none"
      stroke="rgb(var(--accent) / 0.55)"
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
    <path data-card-reference-line="" d={curve.path} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.75}
      strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    <circle cx={curve.sourceX} cy={curve.sourceY} r={3.5} fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth={1.75} />
    <circle cx={curve.targetX} cy={curve.targetY} r={4.2} fill="rgb(var(--accent))" />
  </svg></ViewportPortal>;
}

export function CardLinkPreviewLine() {
  const link = useContext(LinkPreviewContext);
  return link ? <VisibleReferenceLine sourceId={link.sourceId} targetId={link.targetId} /> : null;
}
