"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  AlertCircle,
  CalendarDays,
  Check,
  CircleHelp,
  Keyboard,
  LoaderCircle,
  Maximize,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  RefreshCw,
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";

import { getMindmapAction, saveMindmapAction } from "@/app/actions";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { PaperActivityRail } from "@/features/mindmap/paper-activity-rail";
import { HtmlDocumentFrame } from "@/features/document/html-frame";
import { htmlFrameCapabilities } from "@/lib/html-policy";
import {
  cloneMindmap,
  createMindmapSession,
  descendantsOf,
  indexMindmap,
  mapSignature,
  mindmapReducer,
  newNodeId,
  type MindmapSession,
  type MindmapTreeAction,
} from "@/features/mindmap/mindmap-state";
import { useMindmapWebMcp } from "@/features/mindmap/use-mindmap-webmcp";
import {
  HORIZONTAL_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  ROOT_HEIGHT,
  ROOT_WIDTH,
  VERTICAL_GAP,
  layoutMindmapTree,
  nodeDimensions,
} from "@/lib/mindmap/layout";
import { applyMindmapDrop, resolveMindmapDrop } from "@/lib/mindmap/drop-targets";
import { mindmapDiskHash } from "@/lib/mindmap/v2";
import { isDerivedEvidenceNode } from "@/lib/mindmap-index";
import { pruneEvidenceNodes } from "@/lib/mindmap-index";
import { ARTIFACT_KINDS, artifactHref } from "@/lib/research/artifact-link";
import { cn } from "@/lib/utils";
import type { ArtifactKind, ArtifactRef, Maturity, Mindmap, MindmapNode, MindmapNodeShape } from "@/lib/types";
import type { ProjectState } from "@/lib/research/project-state";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const AUTOSAVE_DELAY = 700;
const LAST_WEEK_DAYS = 7;

const MATURITY_ACCENT: Record<Maturity, string> = {
  empty: "rgb(var(--m-empty))",
  hypothesized: "rgb(var(--m-hypo))",
  draft: "rgb(var(--m-draft))",
  review: "rgb(var(--m-review))",
  final: "rgb(var(--m-final))",
};

const COLOR_SWATCHES = [
  { value: "", label: "Automatic" },
  { value: "#785ef0", label: "Violet" },
  { value: "#648fff", label: "Blue" },
  { value: "#dc267f", label: "Pink" },
  { value: "#fe6100", label: "Orange" },
  { value: "#ffb000", label: "Gold" },
] as const;

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };
type View = { x: number; y: number; scale: number };

type Interaction =
  | {
      kind: "pan";
      pointerId: number;
      startClient: Point;
      startView: View;
    }
  | {
      kind: "node";
      pointerId: number;
      id: string;
      startClient: Point;
      startPosition: Point;
      before: Mindmap;
      moved: boolean;
    };

interface CanvasLayout {
  nodes: MindmapNode[];
  nodeById: Map<string, MindmapNode>;
  children: Map<string, MindmapNode[]>;
  reachable: Set<string>;
  recoveryAnchorId?: string;
  positions: Map<string, Point>;
  dimensions: Map<string, Dimensions>;
  width: number;
  height: number;
}

export function MindmapEditor({
  project,
  initialMindmap,
  draftMindmap,
  paperState,
  artifactSuggestions = [],
}: {
  project: string;
  initialMindmap: Mindmap;
  /** A non-destructive fallback the user can explicitly restore from. */
  draftMindmap?: Mindmap | null;
  paperState?: ProjectState | null;
  artifactSuggestions?: ArtifactRef[];
}) {
  const router = useRouter();
  const [session, dispatch] = useReducer(mindmapReducer, initialMindmap, createMindmapSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { mindmap, selectedId, past: history, future, revision } = session;
  const persistedDiskHashRef = useRef(initialMindmap.diskHash ?? mindmapDiskHash(initialMindmap));
  const [activitySince, setActivitySince] = useState<string | null>(null);

  const webMcpSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistWebMcpMutation = useCallback(async (
    action: MindmapTreeAction | ((current: MindmapSession) => MindmapTreeAction | null),
    expectedRevision?: number,
  ): Promise<Mindmap> => {
    const job = webMcpSaveQueueRef.current.then(async () => {
      const current = sessionRef.current;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw Object.assign(
          new Error(`Live mindmap revision is ${current.revision}, not ${String(expectedRevision)}.`),
          { code: "stale_live_state" },
        );
      }
      const nextAction = typeof action === "function" ? action(current) : action;
      if (!nextAction) return current.mindmap;
      const nextSession = mindmapReducer(current, nextAction);
      if (nextSession.mindmap === current.mindmap) return current.mindmap;

      const snapshot = cloneMindmap(nextSession.mindmap);
      const saved = await saveMindmapAction(project, snapshot, persistedDiskHashRef.current);
      persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
      setSavedSignature(mapSignature(saved));

      const latest = sessionRef.current;
      if (mapSignature(latest.mindmap) === mapSignature(current.mindmap)) {
        const hydrated = mindmapReducer(latest, { type: "hydrate", mindmap: saved });
        sessionRef.current = hydrated;
        dispatch({ type: "hydrate", mindmap: saved });
      } else {
        const rebased = mindmapReducer(latest, { type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
        sessionRef.current = rebased;
        dispatch({ type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
      }
      return saved;
    });
    webMcpSaveQueueRef.current = job.then(() => undefined, () => undefined);
    try {
      return await job;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the mindmap.");
      throw error;
    }
  }, [project]);

  useMindmapWebMcp({
    sharedActions: sharedWebMcpActions,
    getSnapshot: () => ({
      project,
      mapId: mindmap.id || "draft",
      revision: sessionRef.current.revision,
      diskHash: persistedDiskHashRef.current,
      rootId: sessionRef.current.mindmap.rootId,
      nodes: sessionRef.current.mindmap.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        text: node.text,
        collapsed: node.collapsed,
        contentFormat: node.contentFormat,
        maturity: node.maturity,
        shape: node.shape,
        color: node.color,
        refs: node.refs,
        metadata: node.metadata,
        tags: node.tags,
        progress: node.progress,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      })),
      selectedId: sessionRef.current.selectedId,
      activitySince: activitySince || undefined,
    }),
    focusNode: (id) => dispatch({ type: "select", id }),
    addNode: async (parentId, text, expectedRevision) => {
      const id = newNodeId();
      await persistWebMcpMutation({ type: "add-node", parentId, id, text }, expectedRevision);
      return id;
    },
    renameNode: async (id, text, expectedRevision) => {
      await persistWebMcpMutation({ type: "edit-text", id, text }, expectedRevision);
    },
    moveNode: async (id, parentId, beforeId, afterId, expectedRevision) => {
      await persistWebMcpMutation({ type: "reparent", id, parentId, beforeId, afterId }, expectedRevision);
    },
    deleteNode: async (id, expectedRevision) => {
      await persistWebMcpMutation({ type: "delete-subtree", id }, expectedRevision);
    },
    setCollapsed: async (id, collapsed, expectedRevision) => {
      await persistWebMcpMutation((current) => {
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        return !node || Boolean(node.collapsed) === collapsed ? null : { type: "collapse", id };
      }, expectedRevision);
    },
    setPresentation: async (id, patch, expectedRevision) => {
      await persistWebMcpMutation((current) => {
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        if (!node || Object.entries(patch).every(([key, value]) => node[key as keyof typeof node] === value)) return null;
        return { type: "patch-node", id, patch };
      }, expectedRevision);
    },
    linkArtifact: async (id, kind, artifactId, label, url, expectedRevision) => {
      await persistWebMcpMutation((current) => {
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        if (!node) return null;
        return {
          type: "patch-node",
          id,
          patch: {
            refs: [
              ...(node.refs || []).filter((ref) => !(ref.kind === kind && ref.id === artifactId)),
              { kind, id: artifactId, ...(label?.trim() ? { label: label.trim() } : {}), ...(url ? { url } : {}) },
            ],
          },
        };
      }, expectedRevision);
    },
    setActivityHighlight: (since) => setActivitySince(since || null),
    navigate: (href) => {
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname) {
          const hash = decodeURIComponent(url.hash.replace(/^#/, ""));
          if (hash) dispatch({ type: "select", id: hash });
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          return;
        }
      } catch {
        // Fall through to a full navigation.
      }
      router.push(href);
    },
    current: () => ({
      kind: "mindmap" as const,
      href: `/p/${project}/mindmap`,
      mapId: sessionRef.current.mindmap.id || "draft",
      nodeId: sessionRef.current.selectedId,
    }),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 36, y: 36, scale: 1 });
  const viewRef = useRef(view);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isSpacePressedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState(() => mapSignature(initialMindmap));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>("wiki-page");
  const [artifactId, setArtifactId] = useState("");
  const [artifactLabel, setArtifactLabel] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const pendingMoveRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const editBaselineRef = useRef<Mindmap | null>(null);
  const didFitRef = useRef(false);
  const viewAnimRef = useRef<number | null>(null);

  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const next = createCanvasLayout(mindmap);
    if (dragPreview && next.positions.has(dragPreview.id)) {
      next.positions.set(dragPreview.id, { x: dragPreview.x, y: dragPreview.y });
    }
    return next;
  }, [mindmap, dragPreview]);
  const selected = layout.nodeById.get(selectedId) || layout.nodeById.get(mindmap.rootId);
  const dirty = mapSignature(mindmap) !== savedSignature;
  const activityNodeIds = useMemo(() => {
    if (!activitySince) return new Set<string>();
    return new Set(mindmap.nodes
      .filter((node) => isMindmapNodeActiveSince(node, activitySince))
      .map((node) => node.id));
  }, [activitySince, mindmap.nodes]);
  const quietBranchIds = useMemo(() => (
    activitySince ? findQuietBranchIds(mindmap, activityNodeIds) : []
  ), [activityNodeIds, activitySince, mindmap]);

  const updateView = useCallback((updater: View | ((prev: View) => View)) => {
    setView((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      viewRef.current = next;
      return next;
    });
  }, []);

  const cancelViewAnim = useCallback(() => {
    if (viewAnimRef.current != null) {
      cancelAnimationFrame(viewAnimRef.current);
      viewAnimRef.current = null;
    }
  }, []);

  const settleView = useCallback((next: View) => {
    cancelViewAnim();
    if (interactionRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      updateView(next);
      return;
    }
    const from = viewRef.current;
    if (from.scale === next.scale && from.x === next.x && from.y === next.y) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 180);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      updateView({
        scale: from.scale + (next.scale - from.scale) * e,
        x: from.x + (next.x - from.x) * e,
        y: from.y + (next.y - from.y) * e,
      });
      if (t < 1) viewAnimRef.current = requestAnimationFrame(tick);
      else viewAnimRef.current = null;
    };
    viewAnimRef.current = requestAnimationFrame(tick);
  }, [cancelViewAnim, updateView]);

  const zoomAt = useCallback((factor: number, clientPoint?: Point, settle = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const focus = clientPoint
      ? { x: clientPoint.x - bounds.left, y: clientPoint.y - bounds.top }
      : { x: bounds.width / 2, y: bounds.height / 2 };
    const apply = (current: View): View => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      if (nextScale === current.scale) return current;
      const world = {
        x: (focus.x - current.x) / current.scale,
        y: (focus.y - current.y) / current.scale,
      };
      return {
        scale: nextScale,
        x: focus.x - world.x * nextScale,
        y: focus.y - world.y * nextScale,
      };
    };
    if (settle) {
      settleView(apply(viewRef.current));
      return;
    }
    cancelViewAnim();
    updateView(apply);
  }, [cancelViewAnim, settleView, updateView]);

  const fitToCanvas = useCallback((settle = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const scale = clamp(
      Math.min((bounds.width - 80) / layout.width, (bounds.height - 80) / layout.height, 1.1),
      MIN_SCALE,
      MAX_SCALE,
    );
    const next = {
      scale,
      x: Math.max(24, (bounds.width - layout.width * scale) / 2),
      y: Math.max(24, (bounds.height - layout.height * scale) / 2),
    };
    if (settle) {
      settleView(next);
      return;
    }
    cancelViewAnim();
    updateView(next);
  }, [cancelViewAnim, layout.height, layout.width, settleView, updateView]);

  useEffect(() => {
    if (didFitRef.current) return;
    const frame = requestAnimationFrame(() => {
      didFitRef.current = true;
      fitToCanvas();
    });
    return () => cancelAnimationFrame(frame);
  }, [fitToCanvas]);

  useEffect(() => () => {
    if (viewAnimRef.current != null) cancelAnimationFrame(viewAnimRef.current);
  }, []);

  // Attach non-passive wheel and touch event listeners to ensure smooth trackpad pinch-zoom,
  // 2-finger touch gestures on touchscreens/iPad, and standard trackpad 2-finger pan
  // without browser default page zoom or gesture interference.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      cancelViewAnim();

      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      if (event.deltaMode === 1) {
        // DOM_DELTA_LINE (discrete mouse wheel)
        deltaX *= 16;
        deltaY *= 16;
      } else if (event.deltaMode === 2) {
        // DOM_DELTA_PAGE
        deltaX *= 800;
        deltaY *= 800;
      }

      // Trackpad pinch gesture (macOS sends ctrlKey === true with continuous deltaY)
      // or Ctrl/Cmd/Alt + Wheel zoom
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const factor = Math.exp(-deltaY * 0.008);
        zoomAt(factor, { x: event.clientX, y: event.clientY });
        return;
      }

      // Shift + scroll horizontally
      if (event.shiftKey) {
        const dx = deltaY !== 0 ? deltaY : deltaX;
        updateView((current) => ({
          ...current,
          x: current.x - dx,
          y: current.y,
        }));
        return;
      }

      // Standard 2-finger trackpad swipe or mouse wheel pan
      updateView((current) => ({
        ...current,
        x: current.x - deltaX,
        y: current.y - deltaY,
      }));
    };

    let prevTouchDist = 0;
    let prevTouchCenter: Point | null = null;

    const handleTouchStart = (event: globalThis.TouchEvent) => {
      cancelViewAnim();
      if (event.touches.length === 2) {
        event.preventDefault();
        interactionRef.current = null;
        setIsPanning(false);
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        prevTouchDist = dist;
        prevTouchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const handleTouchMove = (event: globalThis.TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const newCenter: Point = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };

        if (prevTouchDist > 0 && prevTouchCenter) {
          const factor = newDist / prevTouchDist;
          const bounds = viewport.getBoundingClientRect();
          const prevFocus = {
            x: prevTouchCenter.x - bounds.left,
            y: prevTouchCenter.y - bounds.top,
          };
          const newFocus = {
            x: newCenter.x - bounds.left,
            y: newCenter.y - bounds.top,
          };

          updateView((current) => {
            const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
            const worldX = (prevFocus.x - current.x) / current.scale;
            const worldY = (prevFocus.y - current.y) / current.scale;
            return {
              scale: nextScale,
              x: newFocus.x - worldX * nextScale,
              y: newFocus.y - worldY * nextScale,
            };
          });
        }

        prevTouchDist = newDist;
        prevTouchCenter = newCenter;
      }
    };

    const handleTouchEnd = (event: globalThis.TouchEvent) => {
      if (event.touches.length < 2) {
        prevTouchDist = 0;
        prevTouchCenter = null;
      }
    };

    let gestureScale = 1;
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };

    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gEvent = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (typeof gEvent.scale === "number" && Number.isFinite(gEvent.scale)) {
        const delta = gEvent.scale / gestureScale;
        gestureScale = gEvent.scale;
        const clientPoint =
          typeof gEvent.clientX === "number" && typeof gEvent.clientY === "number"
            ? { x: gEvent.clientX, y: gEvent.clientY }
            : undefined;
        zoomAt(delta, clientPoint);
      }
    };

    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("touchstart", handleTouchStart, { passive: false });
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewport.addEventListener("touchend", handleTouchEnd, { passive: false });
    viewport.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    viewport.addEventListener("gesturestart", handleGestureStart as EventListener, { passive: false });
    viewport.addEventListener("gesturechange", handleGestureChange as EventListener, { passive: false });
    viewport.addEventListener("gestureend", handleGestureEnd as EventListener, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
      viewport.removeEventListener("touchend", handleTouchEnd);
      viewport.removeEventListener("touchcancel", handleTouchEnd);
      viewport.removeEventListener("gesturestart", handleGestureStart as EventListener);
      viewport.removeEventListener("gesturechange", handleGestureChange as EventListener);
      viewport.removeEventListener("gestureend", handleGestureEnd as EventListener);
    };
  }, [cancelViewAnim, updateView, zoomAt]);

  function beginTextTransaction() {
    if (!editBaselineRef.current) editBaselineRef.current = cloneMindmap(sessionRef.current.mindmap);
  }

  function finishTextTransaction(commitChanges = true) {
    const before = editBaselineRef.current;
    editBaselineRef.current = null;
    setEditingId(null);
    if (!before) return;
    if (!commitChanges) {
      dispatch({ type: "revert", mindmap: before });
      return;
    }
    dispatch({ type: "record-history", before });
  }

  function startEditing(id: string) {
    dispatch({ type: "select", id });
    beginTextTransaction();
    setEditingId(id);
  }

  function updateNodeText(id: string, text: string) {
    setSaveError(null);
    dispatch({ type: "edit-text", id, text });
  }

  function addChild(parentId = selected?.id || mindmap.rootId) {
    if (!indexMindmap(sessionRef.current.mindmap).nodeById.has(parentId)) return;
    const id = newNodeId();
    setSaveError(null);
    dispatch({ type: "add-node", parentId, id });
    requestAnimationFrame(() => startEditing(id));
  }

  function addSibling() {
    const current = sessionRef.current.mindmap;
    const node = indexMindmap(current).nodeById.get(selected?.id || "");
    if (!node || node.parentId === null) {
      addChild(current.rootId);
      return;
    }
    addChild(node.parentId);
  }

  function deleteSelected() {
    const current = sessionRef.current.mindmap;
    const node = indexMindmap(current).nodeById.get(selected?.id || "");
    if (!node || node.id === current.rootId) return;
    setSaveError(null);
    dispatch({ type: "delete-subtree", id: node.id });
  }

  const toggleCollapse = useCallback((id = selected?.id) => {
    if (!id) return;
    setSaveError(null);
    dispatch({ type: "collapse", id });
  }, [selected?.id]);

  function collapseQuietBranches() {
    if (!quietBranchIds.length) return;
    const current = sessionRef.current.mindmap;
    const quiet = new Set(quietBranchIds);
    const next = {
      ...current,
      nodes: current.nodes.map((node) => quiet.has(node.id) ? { ...node, collapsed: true } : node),
    };
    setSaveError(null);
    dispatch({ type: "replace", mindmap: next, selectedId: selected?.id });
  }

  function moveSibling(direction: -1 | 1) {
    if (!selected || selected.parentId === null) return;
    setSaveError(null);
    dispatch({ type: "move-sibling", id: selected.id, direction });
  }

  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const save = useCallback(() => {
    if (isPending) return;
    const snapshot = cloneMindmap(sessionRef.current.mindmap);
    const signature = mapSignature(snapshot);
    setSaveError(null);
    startTransition(async () => {
      try {
        const saved = await saveMindmapAction(project, snapshot, persistedDiskHashRef.current);
        persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
        setSavedSignature(mapSignature(saved));
        const current = sessionRef.current;
        if (mapSignature(current.mindmap) === signature) {
          const hydrated = mindmapReducer(current, { type: "hydrate", mindmap: saved });
          sessionRef.current = hydrated;
          dispatch({ type: "hydrate", mindmap: saved });
        } else {
          // Keep edits made while the request was in flight and carry forward
          // the server's fresh CAS hash for the next save.
          const rebased = mindmapReducer(current, { type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
          sessionRef.current = rebased;
          dispatch({ type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not save the mindmap.");
      }
    });
  }, [isPending, project]);

  // Persist edits shortly after the user pauses.
  useEffect(() => {
    if (!dirty || isPending || saveError) return;
    const timer = window.setTimeout(() => save(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [dirty, isPending, mindmap, save, saveError]);

  const reloadSavedMap = useCallback(() => {
    if (isPending) return;
    if (!window.confirm("Load the newer saved map? Local unsaved edits will be replaced.")) return;
    startTransition(async () => {
      try {
        const mapId = sessionRef.current.mindmap.id || initialMindmap.id || "draft";
        const saved = await getMindmapAction(project, mapId);
        if (!saved) throw new Error("The saved mindmap is unavailable.");
        persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
        const hydrated = mindmapReducer(sessionRef.current, { type: "hydrate", mindmap: saved });
        sessionRef.current = hydrated;
        dispatch({ type: "hydrate", mindmap: saved });
        setSavedSignature(mapSignature(saved));
        setSaveError(null);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not reload the saved mindmap.");
      }
    });
  }, [initialMindmap.id, isPending, project]);

  // Global key navigation and canvas shortcuts
  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === " " && !event.repeat) {
        event.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        if (event.key === "c" || event.key === "C") {
          event.preventDefault();
          toggleCollapse();
          return;
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (dirty && !isPending) save();
      } else if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomAt(1.2, undefined, true);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomAt(0.8, undefined, true);
      } else if (event.key === "0") {
        event.preventDefault();
        fitToCanvas(true);
      }
    };

    const onGlobalKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === " ") {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    const onBlur = () => {
      isSpacePressedRef.current = false;
      setIsSpacePressed(false);
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    window.addEventListener("keyup", onGlobalKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown);
      window.removeEventListener("keyup", onGlobalKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [dirty, fitToCanvas, isPending, redo, save, toggleCollapse, undo, zoomAt]);

  function resetFromDraft() {
    if (!draftMindmap) return;
    if (!window.confirm("Replace this editable map with the current draft-derived outline? You can undo before saving.")) return;
    setSaveError(null);
    setEditingId(null);
    dispatch({ type: "replace", mindmap: cloneMindmap(draftMindmap), selectedId: draftMindmap.rootId });
  }

  function pruneReceipts() {
    const current = sessionRef.current.mindmap;
    const next = pruneEvidenceNodes(current);
    if (next === current) return;
    if (!window.confirm("Remove evidence/receipt cards from this map? Claims and open todos stay.")) return;
    setSaveError(null);
    dispatch({ type: "replace", mindmap: next, selectedId: indexMindmap(next).nodeById.has(selectedId) ? selectedId : next.rootId });
  }

  function selectDirection(direction: "parent" | "child" | "previous" | "next") {
    const node = layout.nodeById.get(selected?.id || "");
    if (!node) return;
    if (direction === "parent" && node.parentId) {
      dispatch({ type: "select", id: node.parentId });
      return;
    }
    if (direction === "child") {
      const child = (layout.children.get(node.id) || [])[0];
      if (child) dispatch({ type: "select", id: child.id });
      return;
    }
    if (!node.parentId) return;
    const siblings = layout.children.get(node.parentId) || [];
    const index = siblings.findIndex((item) => item.id === node.id);
    const peer = siblings[index + (direction === "previous" ? -1 : 1)];
    if (peer) dispatch({ type: "select", id: peer.id });
  }

  function onViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    const isNode = Boolean(target.closest("[data-mind-node]"));

    // If left click on a node and not holding space, let node handler handle it
    if (event.button === 0 && isNode && !isSpacePressedRef.current) return;

    event.preventDefault();
    cancelViewAnim();
    viewportRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startView: viewRef.current,
    };
    setIsPanning(true);
  }

  function onNodePointerDown(event: PointerEvent<HTMLElement>, id: string, position: Point) {
    if (editingId === id) return;

    // Middle click or Space+click pans the canvas instead of selecting/dragging node
    if (event.button === 1 || isSpacePressedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelViewAnim();
      viewportRef.current?.focus({ preventScroll: true });
      if (viewportRef.current) {
        viewportRef.current.setPointerCapture(event.pointerId);
      }
      interactionRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startView: viewRef.current,
      };
      setIsPanning(true);
      return;
    }

    if (event.button !== 0) return;
    event.stopPropagation();
    dispatch({ type: "select", id });
    viewportRef.current?.focus({ preventScroll: true });
    if (viewportRef.current) {
      viewportRef.current.setPointerCapture(event.pointerId);
    }
    interactionRef.current = {
      kind: "node",
      pointerId: event.pointerId,
      id,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: position,
      before: cloneMindmap(sessionRef.current.mindmap),
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === "pan") {
      updateView({
        ...interaction.startView,
        x: interaction.startView.x + event.clientX - interaction.startClient.x,
        y: interaction.startView.y + event.clientY - interaction.startClient.y,
      });
      return;
    }
    const currentView = viewRef.current;
    const dx = (event.clientX - interaction.startClient.x) / currentView.scale;
    const dy = (event.clientY - interaction.startClient.y) / currentView.scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) interaction.moved = true;
    setSaveError(null);
    pendingMoveRef.current = {
      id: interaction.id,
      x: Math.max(24, Math.round(interaction.startPosition.x + dx)),
      y: Math.max(24, Math.round(interaction.startPosition.y + dy)),
    };
    setDragPreview(pendingMoveRef.current);
  }

  function endPointerInteraction(event: PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    setDragPreview(null);
    if (interaction.kind === "node" && interaction.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-mind-node]");
      const targetId = target?.getAttribute("data-mind-node");
      if (pending && target && targetId && targetId !== interaction.id) {
        const bounds = target.getBoundingClientRect();
        const drop = resolveMindmapDrop(
          sessionRef.current.mindmap,
          interaction.id,
          targetId,
          event.clientY - bounds.top,
          bounds.height,
        );
        if (drop) {
          const mapped = applyMindmapDrop(sessionRef.current.mindmap, drop);
          if (mapped) dispatch({ type: "reparent", id: drop.id, parentId: mapped.parentId, beforeId: mapped.beforeId, afterId: mapped.afterId });
        }
      }
      dispatch({ type: "record-history", before: interaction.before });
    }
    interactionRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onAuxClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const inField = Boolean(target.closest("input, textarea, select"));
    const key = event.key.toLowerCase();
    if (inField) return;

    if (event.key === "Tab") {
      event.preventDefault();
      addChild();
    } else if (event.key === "Enter") {
      event.preventDefault();
      addSibling();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      deleteSelected();
    } else if (key === "e") {
      event.preventDefault();
      if (selected) startEditing(selected.id);
    } else if (event.key === "c" || event.key === "C") {
      event.preventDefault();
      toggleCollapse();
    } else if (event.key === " ") {
      event.preventDefault();
      // Space is reserved for panning (handled via global key listener & pointerdown)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectDirection("parent");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectDirection("child");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (event.altKey) moveSibling(1);
      else selectDirection("next");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (event.altKey) moveSibling(-1);
      else selectDirection("previous");
    }
  }

  const receiptCount = mindmap.nodes.filter(isDerivedEvidenceNode).length;
  const saveConflict = Boolean(saveError && /conflict|changed.*reload|stale/i.test(saveError));
  const selectedChildren = selected ? layout.children.get(selected.id) || [] : [];
  const bannedParents = selected ? descendantsOf(mindmap, selected.id) : null;
  const availableParents = selected && bannedParents
    ? mindmap.nodes.filter((node) => node.id !== selected.id && !bannedParents.has(node.id))
    : [];
  const paperSections = paperState?.paper?.outline || [];
  const paperRef = (selected?.refs || []).find((ref) => ref.kind === "draft-section" || ref.kind === "draft-todo");

  useEffect(() => {
    const apply = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash && sessionRef.current.mindmap.nodes.some((node) => node.id === hash)) {
        dispatch({ type: "select", id: hash });
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  return (
    <section className={cn(
      "mindmap-editor",
      !showInspector && "mindmap-editor-no-inspector",
      paperState && "mindmap-editor-with-activity",
    )}>
      {paperState && (
        <PaperActivityRail
          state={paperState}
          onPinTodo={(todo) => {
            const id = newNodeId();
            dispatch({ type: "add-node", parentId: mindmap.rootId, id, text: todo.text });
            dispatch({
              type: "patch-node",
              id,
              patch: { refs: [{ kind: "draft-todo", id: todo.id, label: todo.text }] },
            });
          }}
        />
      )}
      <div className="mindmap-workspace">
        <div className="mindmap-toolbar" aria-label="Mindmap controls">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <ToolbarButton title="Add child topic (Tab)" onClick={() => addChild()}><Plus size={15} /> Topic</ToolbarButton>
            <ToolbarButton title="Add sibling topic (Enter)" onClick={addSibling}><Plus size={15} /> Sibling</ToolbarButton>
            <ToolbarButton title="Delete selected topic (Delete)" onClick={deleteSelected} disabled={!selected || selected.id === mindmap.rootId} danger><Trash2 size={14} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <ToolbarButton title="Undo (⌘Z)" onClick={undo} disabled={!history.length}><Undo2 size={14} /><span className="hidden lg:inline">Undo</span></ToolbarButton>
            <ToolbarButton title="Redo (⌘⇧Z / Ctrl+Y)" onClick={redo} disabled={!future.length}><Redo2 size={14} /><span className="hidden lg:inline">Redo</span></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <ToolbarButton title="Zoom out (⌘-)" onClick={() => zoomAt(0.85, undefined, true)}><Minus size={14} /></ToolbarButton>
            <button type="button" className="mindmap-zoom-readout" title="Fit map to screen (⌘0)" onClick={() => fitToCanvas(true)}>{Math.round(view.scale * 100)}%</button>
            <ToolbarButton title="Zoom in (⌘+)" onClick={() => zoomAt(1.18, undefined, true)}><ZoomIn size={14} /></ToolbarButton>
            <ToolbarButton title="Fit map to screen (⌘0)" onClick={() => fitToCanvas(true)}><Maximize size={14} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <div className="mindmap-activity-controls" aria-label="Activity highlight controls">
              <button
                type="button"
                className={cn("mindmap-toolbar-button mindmap-activity-button", activitySince === daysAgoDate(LAST_WEEK_DAYS) && "mindmap-activity-button-active")}
                title="Highlight cards updated in the past seven days"
                onClick={() => setActivitySince((current) => current === daysAgoDate(LAST_WEEK_DAYS) ? null : daysAgoDate(LAST_WEEK_DAYS))}
              >
                <CalendarDays size={13} /> Last 7d
              </button>
              <label className="mindmap-activity-date" title="Highlight cards updated on or after this date">
                <span className="sr-only">Highlight activity since</span>
                <input
                  type="date"
                  value={activitySince || ""}
                  onChange={(event) => setActivitySince(event.target.value || null)}
                  aria-label="Highlight activity since a date"
                />
              </label>
              {activitySince && (
                <button type="button" className="mindmap-toolbar-button" title="Show every card without an activity highlight" onClick={() => setActivitySince(null)}>
                  Clear
                </button>
              )}
            </div>
            {activitySince && (
              <ToolbarButton
                title="Collapse branches with no card updated in the selected period"
                onClick={collapseQuietBranches}
                disabled={quietBranchIds.length === 0}
              >
                <ChevronsDown size={13} /><span className="hidden xl:inline">Collapse quiet</span>
              </ToolbarButton>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {draftMindmap && (
              <ToolbarButton title="Replace this map with a fresh outline from the draft" onClick={resetFromDraft}>
                <RefreshCw size={13} /> Reset from draft
              </ToolbarButton>
            )}
            {receiptCount > 0 && (
              <ToolbarButton title="Remove evidence/receipt cards from this map" onClick={pruneReceipts}>
                <Trash2 size={13} /> Prune receipts ({receiptCount})
              </ToolbarButton>
            )}
            <div className="relative">
              <ToolbarButton title="Keyboard shortcuts" onClick={() => setShowShortcuts((open) => !open)}>
                <Keyboard size={14} />
              </ToolbarButton>
              {showShortcuts && (
                <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-xs shadow-lg">
                  <p className="mb-2 font-semibold text-ink">Shortcuts</p>
                  <ul className="space-y-1 text-muted">
                    <li><kbd>Tab</kbd> child topic</li>
                    <li><kbd>Enter</kbd> sibling topic</li>
                    <li><kbd>E</kbd> edit selected</li>
                    <li><kbd>C</kbd> collapse / expand</li>
                    <li><kbd>Delete</kbd> remove topic</li>
                    <li>Alt+↑ / Alt+↓ reorder siblings</li>
                    <li>Arrows move selection</li>
                    <li>Space-drag pan · ⌘S save</li>
                  </ul>
                </div>
              )}
            </div>
            <ToolbarButton title={showInspector ? "Hide topic editor" : "Show topic editor"} onClick={() => setShowInspector((shown) => !shown)}>
              {showInspector ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </ToolbarButton>
            {saveError ? (
              <button
                type="button"
                className="mindmap-save-status mindmap-save-status-error"
                title={saveError}
                onClick={saveConflict ? reloadSavedMap : save}
              >
                <AlertCircle size={13} /> {saveConflict ? "Reload saved map" : "Retry save"}
              </button>
            ) : (
              <span className={cn("mindmap-save-status", dirty && !isPending && "mindmap-save-status-pending")}>
                {isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
                {isPending ? "Saving…" : dirty ? "Autosaving…" : "Autosaved"}
              </span>
            )}
          </div>
        </div>

        <div
          ref={viewportRef}
          className={cn(
            "mindmap-viewport",
            (isPanning || interactionRef.current?.kind === "pan") && "mindmap-panning",
            isSpacePressed && !isPanning && "mindmap-space-ready",
          )}
          tabIndex={0}
          role="application"
          aria-label="Editable mindmap canvas. Use Tab to add a child, Enter for a sibling, arrow keys to move, E to edit, C to collapse, and Command-S to save."
          onPointerDown={onViewportPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointerInteraction}
          onPointerCancel={endPointerInteraction}
          onAuxClick={onAuxClick}
          onKeyDown={onKeyDown}
        >
          <div
            className="mindmap-stage"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            <svg className="mindmap-edges" width={layout.width} height={layout.height} aria-hidden="true">
              {layout.nodes.map((node) => {
                const parent = node.parentId ? layout.nodeById.get(node.parentId) : undefined;
                const parentIsConnected = Boolean(parent
                  && layout.positions.has(parent.id)
                  && (layout.reachable.has(parent.id) || !layout.reachable.has(node.id)));
                const anchor = layout.recoveryAnchorId ? layout.nodeById.get(layout.recoveryAnchorId) : undefined;
                const recovery = !layout.reachable.has(node.id)
                  && !parentIsConnected
                  && anchor
                  && anchor.id !== node.id;
                if (!parentIsConnected && !recovery) return null;
                const fromId = parentIsConnected && parent ? parent.id : anchor?.id;
                if (!fromId) return null;
                const from = layout.positions.get(fromId);
                const to = layout.positions.get(node.id);
                const fromSize = layout.dimensions.get(fromId);
                const toSize = layout.dimensions.get(node.id);
                if (!from || !to || !fromSize || !toSize) return null;
                return <path key={`${fromId}-${node.id}`} d={connectorPath(from, fromSize, to, toSize)} className={cn("mindmap-edge", recovery && "mindmap-edge-recovery")} />;
              })}
            </svg>

            <div role="tree" aria-label="Mindmap topics">
            {layout.nodes.map((node) => {
              const position = layout.positions.get(node.id);
              const dimensions = layout.dimensions.get(node.id);
              if (!position || !dimensions) return null;
              return (
                <CanvasNode
                  key={node.id}
                  node={node}
                  position={position}
                  dimensions={dimensions}
                  orphan={!layout.reachable.has(node.id)}
                  selected={node.id === selected?.id}
                  active={activityNodeIds.has(node.id)}
                  editing={node.id === editingId}
                  onPointerDown={(event) => onNodePointerDown(event, node.id, position)}
                  onDoubleClick={() => startEditing(node.id)}
                  onSelect={() => dispatch({ type: "select", id: node.id })}
                  onTextChange={(text) => updateNodeText(node.id, text)}
                  onTextFocus={beginTextTransaction}
                  onTextBlur={() => finishTextTransaction(true)}
                  onTextKeyDown={(event) => {
                    const mod = event.metaKey || event.ctrlKey;
                    const key = event.key.toLowerCase();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      finishTextTransaction(false);
                    }
                    if (mod && event.key === "Enter") {
                      event.preventDefault();
                      finishTextTransaction(true);
                    }
                    // When an inline editor has no text change to undo (for
                    // example immediately after adding a topic), fall through
                    // to the canvas history instead of swallowing ⌘Z there.
                    if (mod && key === "z") {
                      const baselineText = editBaselineRef.current
                        ? indexMindmap(editBaselineRef.current).nodeById.get(node.id)?.text
                        : undefined;
                      if (baselineText === node.text) {
                        const redoAction = event.shiftKey;
                        event.preventDefault();
                        finishTextTransaction(true);
                        requestAnimationFrame(() => redoAction ? redo() : undo());
                      }
                    }
                  }}
                />
              );
            })}
            </div>
          </div>

          <div className="mindmap-canvas-hint" aria-hidden="true">
            <CircleHelp size={13} /> Drag or Space+drag to pan · Middle-click to pan · Pinch or ⌘/Ctrl+scroll to zoom · 2-finger scroll to pan · ⌘Z undo · ⌘⇧Z redo
          </div>
        </div>

        {saveError && <p className="mindmap-save-error" role="alert">{saveError}</p>}
        <footer className="mindmap-footer">
          <span>{mindmap.nodes.length} topic{mindmap.nodes.length === 1 ? "" : "s"}</span>
          {activitySince && <span>{activityNodeIds.size} active since {formatMindmapDate(activitySince)}</span>}
        </footer>
      </div>

      {showInspector && selected && (
        <aside className="mindmap-inspector" aria-label="Selected topic editor">
          <div className="mindmap-inspector-heading">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Topic editor</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold">{firstLine(selected.text) || "Untitled topic"}</h2>
            </div>
            <button type="button" className="btn-ghost h-7 w-7 p-0" title="Close editor" onClick={() => setShowInspector(false)}><X size={14} /></button>
          </div>

          <label className="mindmap-field">
            <span>Text</span>
            <textarea
              value={selected.text}
              onFocus={beginTextTransaction}
              onChange={(event) => updateNodeText(selected.id, event.target.value)}
              onBlur={() => finishTextTransaction(true)}
              rows={5}
              placeholder="Topic title\nOptional detail"
            />
            <small>First line is the topic title. Use a second line for context.</small>
          </label>

          <label className="mindmap-field">
            <span>Paper</span>
            <select
              value={paperRef?.kind === "draft-section" ? paperRef.id : ""}
              onChange={(event) => {
                const section = paperSections.find((item) => item.id === event.target.value);
                setSaveError(null);
                const refs = (selected.refs || []).filter((ref) => ref.kind !== "draft-section");
                if (section) refs.unshift({ kind: "draft-section", id: section.id, label: section.title });
                dispatch({ type: "patch-node", id: selected.id, patch: { refs } });
              }}
            >
              <option value="">No paper section</option>
              {paperSections.map((section) => (
                <option key={section.id} value={section.id}>{section.title}</option>
              ))}
            </select>
            <div className="mt-1 flex flex-wrap gap-1">
              {paperRef && (
                <a className="btn-outline px-2 py-0.5 text-[11px]" href={artifactHref(project, paperRef)}>Open in paper</a>
              )}
              {paperSections.length > 0 && (
                <button
                  type="button"
                  className="btn-outline px-2 py-0.5 text-[11px]"
                  onClick={async () => {
                    const target = paperRef?.kind === "draft-section" ? paperRef.id : paperSections[0]?.id;
                    if (!target) return;
                    try { await navigator.clipboard.writeText(selected.text); } catch { /* clipboard is optional */ }
                    router.push(`/p/${project}/paper#${encodeURIComponent(target)}`);
                  }}
                >
                  Put in paper…
                </button>
              )}
            </div>
          </label>

          {selected.createdAt && (
            <p className="mindmap-date-row">
              Created {formatMindmapDate(selected.createdAt)}
              {selected.updatedAt && <> · Updated {formatMindmapDate(selected.updatedAt)}</>}
            </p>
          )}

          <label className="mindmap-field">
            <span>Tags</span>
            <input
              value={(selected.tags || []).join(", ")}
              onChange={(event) => {
                setSaveError(null);
                dispatch({ type: "patch-node", id: selected.id, patch: { tags: splitMindmapTags(event.target.value) } });
              }}
              placeholder="experiment, priority, blocker"
            />
          </label>

          <details className="mindmap-details">
            <summary>Details</summary>
            <div className="mindmap-field">
            <span>Progress <strong>{formatProgress(selected.progress)}%</strong></span>
            <div className="mindmap-progress-inputs">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={selected.progress ?? 0}
                aria-label="Topic progress"
                onChange={(event) => {
                  setSaveError(null);
                  dispatch({ type: "patch-node", id: selected.id, patch: { progress: Number(event.target.value) } });
                }}
              />
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={selected.progress ?? 0}
                aria-label="Topic progress percentage"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setSaveError(null);
                  dispatch({ type: "patch-node", id: selected.id, patch: { progress: Math.min(100, Math.max(0, next)) } });
                }}
              />
            </div>
            <small>Use percentage progress for the level of detail that matters to this plan.</small>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="mindmap-field">
              <span>Maturity</span>
              <select
                value={selected.maturity || ""}
                onChange={(event) => {
                  setSaveError(null);
                  dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: { maturity: (event.target.value || undefined) as Maturity | undefined },
                  });
                }}
              >
                <option value="">None</option>
                <option value="empty">Empty</option>
                <option value="hypothesized">Hypothesized</option>
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="final">Final</option>
              </select>
            </label>
            <label className="mindmap-field">
              <span>Style</span>
              <select
                value={selected.id === mindmap.rootId ? "root" : selected.shape || "leaf"}
                disabled={selected.id === mindmap.rootId}
                onChange={(event) => {
                  setSaveError(null);
                  dispatch({ type: "patch-node", id: selected.id, patch: { shape: event.target.value as MindmapNodeShape } });
                }}
              >
                {selected.id === mindmap.rootId && <option value="root">Root</option>}
                <option value="branch">Branch</option>
                <option value="leaf">Leaf</option>
                <option value="note">Note</option>
                <option value="callout">Callout</option>
              </select>
            </label>
          </div>

          <label className="mindmap-field">
            <span>Content format</span>
            <select
              value={selected.contentFormat || "plain"}
              title="HTML is rendered inside an isolated card. Other formats keep the source text visible."
              onChange={(event) => {
                setSaveError(null);
                dispatch({
                  type: "patch-node",
                  id: selected.id,
                  patch: { contentFormat: event.target.value as MindmapNode["contentFormat"] },
                });
              }}
            >
              <option value="plain">Plain text</option>
              <option value="markdown">Markdown source</option>
              <option value="tex">TeX source</option>
              <option value="html">HTML card</option>
            </select>
            <small>Use HTML for a compact custom card. The browser renders it in a restricted frame.</small>
          </label>

          <div className="mindmap-field">
            <span>Accent</span>
            <div className="mindmap-swatches">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch.value || "automatic"}
                  type="button"
                  className={cn("mindmap-swatch", (selected.color || "") === swatch.value && "mindmap-swatch-selected")}
                  title={swatch.label}
                  aria-label={`Set accent to ${swatch.label}`}
                  onClick={() => {
                    setSaveError(null);
                    dispatch({ type: "patch-node", id: selected.id, patch: { color: swatch.value || undefined } });
                  }}
                >
                  <span style={{ background: swatch.value || nodeAccent(selected) }} />
                </button>
              ))}
            </div>
          </div>
          </details>

          {selected.id !== mindmap.rootId && (
            <>
              <label className="mindmap-field">
                <span>Parent</span>
                <select
                  value={selected.parentId || ""}
                  onChange={(event) => {
                    setSaveError(null);
                    dispatch({ type: "reparent", id: selected.id, parentId: event.target.value });
                  }}
                >
                  {availableParents.map((node) => <option key={node.id} value={node.id}>{firstLine(node.text) || "Untitled topic"}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-outline text-xs" onClick={() => moveSibling(-1)} title="Move before previous sibling"><ChevronsUp size={13} /> Move up</button>
                <button type="button" className="btn-outline text-xs" onClick={() => moveSibling(1)} title="Move after next sibling"><ChevronsDown size={13} /> Move down</button>
              </div>
            </>
          )}

          <div className="mindmap-field">
            <span>Linked artifacts</span>
            {artifactSuggestions.length > 0 && (
              <select
                value=""
                aria-label="Add a suggested artifact"
                title="Add a project artifact already known to OpenBarry"
                onChange={(event) => {
                  const item = artifactSuggestions[Number(event.target.value)];
                  if (!item) return;
                  const refs = [
                    ...(selected.refs || []).filter((ref) => !(ref.kind === item.kind && ref.id === item.id)),
                    item,
                  ];
                  dispatch({ type: "patch-node", id: selected.id, patch: { refs } });
                }}
              >
                <option value="">Add a suggested artifact…</option>
                {artifactSuggestions.map((item, index) => (
                  <option key={`${item.kind}:${item.id}`} value={index}>
                    {item.kind.replaceAll("-", " ")} · {item.label || item.id}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-1">
              <select
                value={artifactKind}
                aria-label="Artifact type"
                title="Choose the kind of research artifact to link"
                onChange={(event) => setArtifactKind(event.target.value as ArtifactKind)}
              >
                {ARTIFACT_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("-", " ")}</option>)}
              </select>
              <input
                value={artifactId}
                aria-label="Artifact identifier"
                placeholder={artifactKind === "web" || artifactKind === "external" ? "https://…" : "Artifact id"}
                title="Use an id for local artifacts or an http(s) URL for a web artifact"
                onChange={(event) => setArtifactId(event.target.value)}
              />
            </div>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-1">
              <input
                value={artifactLabel}
                aria-label="Artifact label"
                placeholder="Optional label"
                title="A short label that explains the linked artifact"
                onChange={(event) => setArtifactLabel(event.target.value)}
              />
              <button
                type="button"
                className="btn-outline px-2 py-1 text-[11px]"
                title="Add this artifact link"
                disabled={!artifactId.trim()}
                onClick={() => {
                  const id = artifactId.trim();
                  const external = artifactKind === "web" || artifactKind === "external";
                  if (external && !/^https?:\/\//i.test(id)) {
                    setSaveError("Web artifacts need an http(s) URL.");
                    return;
                  }
                  setSaveError(null);
                  const item: ArtifactRef = {
                    kind: artifactKind,
                    id,
                    ...(artifactLabel.trim() ? { label: artifactLabel.trim() } : {}),
                    ...(external ? { url: id } : {}),
                  };
                  dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: {
                      refs: [
                        ...(selected.refs || []).filter((ref) => !(ref.kind === item.kind && ref.id === item.id)),
                        item,
                      ],
                    },
                  });
                  setArtifactId("");
                  setArtifactLabel("");
                }}
              >
                Add
              </button>
            </div>
            <small>Links can point to paper work, project records, wiki pages, sources, or the web.</small>
            {(selected.refs || []).length > 0 && (
              <ul className="mt-1 space-y-1 text-xs">
                {(selected.refs || []).map((ref) => {
                  const href = artifactHref(project, ref);
                  const external = /^https?:\/\//i.test(href);
                  return (
                    <li key={`${ref.kind}:${ref.id}`} className="flex min-w-0 items-center justify-between gap-2">
                      <a
                        href={href}
                        className="min-w-0 truncate text-accent hover:underline"
                        title={ref.label || ref.id}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noreferrer" : undefined}
                      >
                        {ref.label || ref.id}
                      </a>
                      <button
                        type="button"
                        className="text-[11px] text-muted hover:text-danger"
                        title={`Remove ${ref.label || ref.id}`}
                        onClick={() => dispatch({
                          type: "patch-node",
                          id: selected.id,
                          patch: { refs: (selected.refs || []).filter((item) => !(item.kind === ref.kind && item.id === ref.id)) },
                        })}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mindmap-inspector-actions">
            <button type="button" className="btn-outline text-xs" disabled={selectedChildren.length === 0} onClick={() => toggleCollapse(selected.id)}>
              {selected.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {selected.collapsed ? "Expand" : "Collapse"}
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => startEditing(selected.id)}>Edit text</button>
          </div>
        </aside>
      )}
    </section>
  );
}

function CanvasNode({
  node,
  position,
  dimensions,
  orphan,
  selected,
  active,
  editing,
  onPointerDown,
  onDoubleClick,
  onSelect,
  onTextChange,
  onTextFocus,
  onTextBlur,
  onTextKeyDown,
}: {
  node: MindmapNode;
  position: Point;
  dimensions: Dimensions;
  orphan: boolean;
  selected: boolean;
  active: boolean;
  editing: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onSelect: () => void;
  onTextChange: (text: string) => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
  onTextKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [title, ...details] = node.text.split("\n");
  const tags = node.tags || [];
  return (
    <article
      data-mind-node={node.id}
      role="treeitem"
      aria-selected={selected}
      aria-label={mindmapNodeLabel(node)}
      title={mindmapNodeLabel(node)}
      className={cn(
        "mindmap-node-card",
        node.parentId === null && "mindmap-node-root",
        node.shape === "note" && "mindmap-node-note",
        node.shape === "callout" && "mindmap-node-callout",
        orphan && "mindmap-node-orphan",
        selected && "mindmap-node-selected",
        active && "mindmap-node-active",
        editing && "mindmap-node-editing",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: dimensions.width,
        minHeight: dimensions.height,
        "--mind-node-accent": nodeAccent(node),
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={onSelect}
    >
      {editing ? (
        <textarea
          autoFocus
          className="mindmap-node-textarea"
          value={node.text}
          aria-label="Topic text"
          rows={4}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onFocus={onTextFocus}
          onChange={(event) => onTextChange(event.target.value)}
          onBlur={onTextBlur}
          onKeyDown={onTextKeyDown}
        />
      ) : node.contentFormat === "html" ? (
        <div
          className="mindmap-node-html"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <HtmlDocumentFrame html={node.text} mode="static" capabilities={htmlFrameCapabilities("static")} compact />
        </div>
      ) : (
        <>
          <div className="mindmap-node-title"><NodeRichText text={title || "Untitled topic"} /></div>
          {details.join("\n").trim() && <p className="mindmap-node-detail"><NodeRichText text={details.join("\n")} /></p>}
          <div className="mindmap-node-meta">
            {node.progress !== undefined && <span className="mindmap-node-progress">{formatProgress(node.progress)}%</span>}
            {node.maturity && <span>{node.maturity}</span>}
            {tags.slice(0, 2).map((tag) => <span className="mindmap-node-tag" key={tag}>{tag}</span>)}
            {tags.length > 2 && <span className="mindmap-node-tag">+{tags.length - 2}</span>}
            {node.collapsed && <span>+ collapsed</span>}
          </div>
        </>
      )}
    </article>
  );
}

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return calendarDate(date);
}

function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isMindmapNodeActiveSince(node: MindmapNode, since: string): boolean {
  const date = node.updatedAt || node.createdAt;
  return Boolean(date && Date.parse(date) >= Date.parse(`${since}T00:00:00`));
}

function findQuietBranchIds(mindmap: Mindmap, activeNodeIds: Set<string>): string[] {
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const quiet: string[] = [];
  const visit = (id: string, path = new Set<string>()): boolean => {
    if (path.has(id)) return false;
    const node = nodeById.get(id);
    if (!node) return false;
    const nextPath = new Set(path);
    nextPath.add(id);
    const children = childrenByParent.get(id) || [];
    const hasActivity = activeNodeIds.has(id) || children.some((child) => visit(child.id, nextPath));
    if (id !== mindmap.rootId && children.length > 0 && !hasActivity && !node.collapsed) quiet.push(id);
    return hasActivity;
  };
  visit(mindmap.rootId);
  return quiet;
}

function splitMindmapTags(value: string): string[] {
  return Array.from(new Set(value.split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 40)))
    .slice(0, 12);
}

function formatProgress(progress: number | undefined): string {
  const value = Math.min(100, Math.max(0, progress ?? 0));
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMindmapDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function mindmapNodeLabel(node: MindmapNode): string {
  const bits = [firstLine(node.text) || "Untitled topic"];
  if (node.progress !== undefined) bits.push(`${formatProgress(node.progress)}% progress`);
  if (node.tags?.length) bits.push(`Tags: ${node.tags.join(", ")}`);
  if (node.createdAt) bits.push(`Created ${formatMindmapDate(node.createdAt)}`);
  if (node.updatedAt) bits.push(`Updated ${formatMindmapDate(node.updatedAt)}`);
  return bits.join(". ");
}

function ToolbarButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn("mindmap-toolbar-button", danger && "mindmap-toolbar-button-danger")}
    >
      {children}
    </button>
  );
}

function createCanvasLayout(mindmap: Mindmap): CanvasLayout {
  const { nodeById, childrenByParent: children } = indexMindmap(mindmap);
  const safeNodes = Array.isArray(mindmap?.nodes) ? mindmap.nodes : [];
  const dimensions = new Map<string, Dimensions>();
  for (const node of safeNodes) dimensions.set(node.id, nodeDimensions(node));
  const { positions, reachable, connected } = layoutMindmapTree(mindmap, dimensions);
  const recoveryAnchorId = positions.has(mindmap.rootId)
    ? mindmap.rootId
    : [...reachable].find((id) => positions.has(id));
  const orphanNodes = safeNodes.filter((node) => !connected.has(node.id));
  const connectedBottom = Math.max(0, ...[...reachable].map((id) => {
    const point = positions.get(id);
    const size = dimensions.get(id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    return point ? point.y + size.height : 0;
  }));
  const orphanRowTops: number[] = [];
  const orphanRowHeights: number[] = [];
  for (const [index, node] of orphanNodes.entries()) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const rowTop = orphanRowTops[row] ?? (
      row === 0
        ? connectedBottom + 72
        : orphanRowTops[row - 1]! + orphanRowHeights[row - 1]! + VERTICAL_GAP
    );
    const size = dimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    orphanRowTops[row] = rowTop;
    orphanRowHeights[row] = Math.max(orphanRowHeights[row] || 0, size.height);
    positions.set(node.id, {
      x: 24 + column * (NODE_WIDTH + HORIZONTAL_GAP),
      y: rowTop,
    });
  }
  // Collapsed descendants remain connected to their parent and stay hidden.
  // Disconnected nodes remain visible in the recovery row so malformed maps
  // stay recoverable from the editor.
  const nodes = safeNodes.filter((node) => reachable.has(node.id) || !connected.has(node.id));
  const width = Math.max(960, ...(nodes.length ? nodes.map((node) => {
    const point = positions.get(node.id) || { x: 80, y: 88 };
    const size = dimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    return point.x + size.width + 160;
  }) : [960]));
  const height = Math.max(640, ...(nodes.length ? nodes.map((node) => {
    const point = positions.get(node.id) || { x: 80, y: 88 };
    const size = dimensions.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
    return point.y + size.height + 120;
  }) : [640]));
  return { nodes, nodeById, children, reachable, recoveryAnchorId, positions, dimensions, width, height };
}

function NodeRichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\$([^$\n]+)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    try {
      parts.push(
        <span
          key={key++}
          dangerouslySetInnerHTML={{ __html: katex.renderToString(match[1]!, { throwOnError: false }) }}
        />,
      );
    } catch {
      parts.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.length ? parts : text}</>;
}

function connectorPath(from: Point, fromSize: Dimensions, to: Point, toSize: Dimensions) {
  const startX = from.x + fromSize.width;
  const startY = from.y + fromSize.height / 2;
  const endX = to.x;
  const endY = to.y + toSize.height / 2;
  const bend = Math.max(48, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function nodeAccent(node: MindmapNode) {
  return node.color || (node.maturity ? MATURITY_ACCENT[node.maturity] : "rgb(var(--accent))");
}

function firstLine(text: string) {
  return text.split("\n")[0].trim();
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
