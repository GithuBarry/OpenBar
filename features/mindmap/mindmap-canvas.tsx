"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  Controls,
  Handle,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
  applyNodeChanges,
  Position,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { applyMindmapDrop, resolveMindmapDrop, type MindmapDrop } from "@/lib/mindmap/drop-targets";
import type { Mindmap } from "@/lib/types";
import { cn } from "@/lib/utils";

export type MindmapFlowNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  renderVersion?: string;
};

export type MindmapFocusRequest = { id: string; sequence: number; center?: boolean };

type CardData = { render: (id: string) => ReactNode; renderVersion?: string };

const nodeTypes = {
  card: memo(function CardNode({ id, data }: NodeProps<Node<CardData>>) {
    return (
      <div className="mindmap-rf-card">
        <Handle type="target" position={Position.Left} className="mindmap-rf-handle" aria-hidden="true" />
        {data.render(id)}
        <Handle type="source" position={Position.Right} className="mindmap-rf-handle" aria-hidden="true" />
      </div>
    );
  }),
};

function targetNodeId(clientX: number, clientY: number, draggedId: string): { id: string; el: HTMLElement } | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const node = (element as HTMLElement).closest<HTMLElement>("[data-mind-node]");
    const id = node?.getAttribute("data-mind-node");
    if (node && id && id !== draggedId) return { id, el: node };
  }
  // A small landing zone in the gap makes sibling insertion easier to aim.
  let closest: { id: string; el: HTMLElement; distance: number } | null = null;
  for (const node of document.querySelectorAll<HTMLElement>("[data-mind-node]")) {
    const id = node.dataset.mindNode;
    if (!id || id === draggedId) continue;
    const bounds = node.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right) continue;
    const distance = Math.min(Math.abs(clientY - bounds.top), Math.abs(clientY - bounds.bottom));
    if (distance <= 14 && (!closest || distance < closest.distance)) closest = { id, el: node, distance };
  }
  return closest;
}

function eventPoint(event: MouseEvent | TouchEvent | null): { x: number; y: number } | null {
  if (!event) return null;
  if ("touches" in event) {
    const touch = event.touches[0] || event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

function FlowCanvas({
  mindmap,
  nodes,
  renderCard,
  readOnly,
  selectMultiple = false,
  virtualize,
  onSelect,
  onDoubleClick,
  onReparent,
  onDropPreview,
  onPaneClick,
  focusRequest,
}: {
  mindmap: Mindmap;
  nodes: MindmapFlowNode[];
  renderCard: (id: string) => ReactNode;
  readOnly: boolean;
  selectMultiple?: boolean;
  virtualize?: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDoubleClick: (id: string) => void;
  onReparent: (id: string, parentId: string, beforeId?: string, afterId?: string) => void;
  onDropPreview: (drop: MindmapDrop | null) => void;
  onPaneClick?: () => void;
  focusRequest?: MindmapFocusRequest | null;
}) {
  const { setCenter, getZoom, setViewport, viewportInitialized } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastFocusRef = useRef<number | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const initialViewRef = useRef(false);
  const rasterFrame = useRef<number | null>(null);
  const beginViewportMove = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) initialViewRef.current = true;
    if (rasterFrame.current !== null) cancelAnimationFrame(rasterFrame.current);
    const viewport = canvasRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (viewport) viewport.style.willChange = "transform";
  }, []);
  const finishViewportMove = useCallback(() => {
    // Release the gesture's cached layer so the browser rasterizes text at
    // the final scale. Card layout remains in unchanged world coordinates.
    rasterFrame.current = requestAnimationFrame(() => {
      rasterFrame.current = null;
      const viewport = canvasRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
      if (viewport) viewport.style.willChange = "auto";
      if (canvasRef.current) canvasRef.current.dataset.sharpCards = String(getZoom() > 1.25);
    });
  }, [getZoom]);
  useEffect(() => () => { if (rasterFrame.current !== null) cancelAnimationFrame(rasterFrame.current); }, []);
  useEffect(() => {
    if (!viewportInitialized || !nodesInitialized || initialViewRef.current || focusRequest) return;
    const root = nodes.find((node) => node.id === mindmap.rootId);
    const pane = canvasRef.current;
    if (!root || !pane) return;
    const left = pane.clientWidth < 600 ? Math.max(24, (pane.clientWidth - root.width) / 2) : 48;
    void setViewport({ x: left - root.x, y: pane.clientHeight / 2 - root.y - root.height / 2, zoom: 1 });
  }, [viewportInitialized, nodesInitialized, nodes, mindmap.rootId, focusRequest, setViewport]);
  useEffect(() => {
    if (!viewportInitialized || !nodesInitialized || !focusRequest || lastFocusRef.current === focusRequest.sequence) return;
    const node = nodes.find((item) => item.id === focusRequest.id);
    if (!node) return;
    lastFocusRef.current = focusRequest.sequence;
    initialViewRef.current = true;
    if (focusRequest.center === false) return;
    void setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: Math.max(0.75, getZoom()), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 });
  }, [viewportInitialized, nodesInitialized, focusRequest, nodes, setCenter, getZoom]);

  const baseFlowNodes: Node<CardData>[] = useMemo(
    () => nodes.map((node) => ({
      id: node.id,
      type: "card",
      position: { x: node.x, y: node.y },
      selected: node.selected,
      draggable: !readOnly && !selectMultiple && node.id !== mindmap.rootId,
      initialWidth: node.width,
      initialHeight: node.height,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
        style: { width: node.width, height: node.height },
        data: { render: renderCard, renderVersion: node.renderVersion },
      })),
    [mindmap.rootId, nodes, readOnly, renderCard, selectMultiple],
  );
  const [controlledNodes, setControlledNodes] = useState<Node<CardData>[]>(baseFlowNodes);
  useEffect(() => {
    setControlledNodes((previous) => {
      const oldNodes = new Map(previous.map((node) => [node.id, node]));
      return baseFlowNodes.map((node) => {
        const old = oldNodes.get(node.id);
        return { ...node, measured: old?.measured, ...(draggingIdRef.current === node.id && old ? { position: old.position, dragging: true } : {}) };
      });
    });
  }, [baseFlowNodes]);
  const flowNodes = controlledNodes;
  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map(node => [node.id, node]));
    return mindmap.nodes.flatMap(node => {
      if (!node.parentId || !byId.has(node.id) || !byId.has(node.parentId)) return [];
      return [{ id: `${node.parentId}-${node.id}`, source: node.parentId, target: node.id, type: "default", focusable: false, interactionWidth: 0 }];
    });
  }, [mindmap.nodes, nodes]);

  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (event.detail === 0) onSelect(node.id, event.shiftKey);
  }, [onSelect]);

  const onNodeDoubleClickHandler: NodeMouseHandler = useCallback((_event, node) => {
    onDoubleClick(node.id);
  }, [onDoubleClick]);

  const previewFromEvent = useCallback((event: MouseEvent | TouchEvent | null, draggedId: string) => {
    const point = eventPoint(event);
    if (!point) {
      onDropPreview(null);
      return;
    }
    const hit = targetNodeId(point.x, point.y, draggedId);
    if (!hit) {
      onDropPreview(null);
      return;
    }
    const bounds = hit.el.getBoundingClientRect();
    onDropPreview(resolveMindmapDrop(
      mindmap,
      draggedId,
      hit.id,
      point.y - bounds.top,
      bounds.height,
      point.x - bounds.left,
      bounds.width,
    ));
  }, [mindmap, onDropPreview]);

  return (
    <ReactFlow
      key="fixed-card-geometry"
      ref={canvasRef}
      className="mindmap-viewport mindmap-rf"
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        initialViewRef.current = true;
        const target = event.target as Element;
        if (target.closest('button, a, input, textarea, select, .cm-editor')) return;
        const card = target.closest<HTMLElement>('[data-mind-node]');
        if (card?.dataset.mindNode) onSelect(card.dataset.mindNode, event.shiftKey);
      }}
      onWheelCapture={() => { initialViewRef.current = true; }}
      onKeyDownCapture={() => { initialViewRef.current = true; }}
      onlyRenderVisibleElements={virtualize}
      onMoveStart={beginViewportMove}
      onMoveEnd={finishViewportMove}
      nodes={flowNodes}
      edges={edges}
      onNodesChange={(changes: NodeChange[]) => {
        // Selection and deletion follow the manuscript-backed map reducer.
        setControlledNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "select" && change.type !== "remove"), current.length ? current : baseFlowNodes) as Node<CardData>[]);
      }}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClickHandler}
      onNodeDragStart={(_event, node) => { draggingIdRef.current = node.id; onSelect(node.id, false); }}
      onNodeDrag={(event, node) => previewFromEvent(event, node.id)}
      onNodeDragStop={(event, node) => {
        draggingIdRef.current = null;
        const point = eventPoint(event);
        const hit = point ? targetNodeId(point.x, point.y, node.id) : null;
        onDropPreview(null);
        if (!hit) {
          const home = nodes.find((entry) => entry.id === node.id);
          if (home) {
            setControlledNodes((current) => current.map((item) => (
              item.id === node.id ? { ...item, position: { x: home.x, y: home.y } } : item
            )));
          }
          return;
        }
        const bounds = hit.el.getBoundingClientRect();
        const drop = resolveMindmapDrop(
          mindmap,
          node.id,
          hit.id,
          point!.y - bounds.top,
          bounds.height,
          point!.x - bounds.left,
          bounds.width,
        );
        if (!drop) {
          const home = nodes.find((entry) => entry.id === node.id);
          if (home) setControlledNodes((current) => current.map((item) => item.id === node.id
            ? { ...item, position: { x: home.x, y: home.y } }
            : item));
          return;
        }
        const mapped = applyMindmapDrop(mindmap, drop);
        if (mapped) onReparent(drop.id, mapped.parentId, mapped.beforeId, mapped.afterId);
      }}
      onPaneClick={onPaneClick}
      nodesConnectable={false}
      elementsSelectable
      multiSelectionKeyCode="Shift"
      deleteKeyCode={null}
      selectNodesOnDrag={false}
      panOnScroll
      zoomOnPinch
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnDrag
      minZoom={0.25}
      maxZoom={2.5}
      nodeDragThreshold={4}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { stroke: "rgb(var(--line))", strokeWidth: 1.15 },
      }}
    >
      <Background gap={32} size={1} color="rgb(var(--accent) / 0.12)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function MindmapCanvas(props: {
  mindmap: Mindmap;
  nodes: MindmapFlowNode[];
  renderCard: (id: string) => ReactNode;
  readOnly: boolean;
  selectMultiple?: boolean;
  virtualize?: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDoubleClick: (id: string) => void;
  onReparent: (id: string, parentId: string, beforeId?: string, afterId?: string) => void;
  onDropPreview: (drop: MindmapDrop | null) => void;
  onPaneClick?: () => void;
  focusRequest?: MindmapFocusRequest | null;
  className?: string;
}) {
  return (
    <div className={cn("h-full min-h-0 w-full", props.className)}>
      <ReactFlowProvider>
        <FlowCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
