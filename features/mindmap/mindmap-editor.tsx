"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
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
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";

import { ensurePaperCommentAction, getMindmapAction, insertPaperTodoAtSectionAction, persistPaperTodoAction, removePaperTodoAction, saveMindmapAction } from "@/app/actions";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { PaperActivityRail } from "@/features/mindmap/paper-activity-rail";
import {
  cloneMindmap,
  createMindmapSession,
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
import { applyMindmapDrop, resolveMindmapDrop, type MindmapDrop } from "@/lib/mindmap/drop-targets";
import { mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { cn } from "@/lib/utils";
import { artifactHref, isArtifactKind } from "@/lib/research/artifact-link";
import { availableTodoCandidates } from "@/lib/research/map-todo-candidates";
import { safeUrl } from "@/lib/safe-url";
import {
  clampMindmapLabels,
  isPrimaryMindmap,
  MAX_MINDMAP_LABEL_CHARS,
  MAX_MINDMAP_LABELS,
} from "@/lib/research/webmcp-mindmap-contract";
import type { ArtifactKind, ArtifactRef, Mindmap, MindmapNode } from "@/lib/types";
import type { ProjectState, ProjectStateComment } from "@/lib/research/project-state";
import {
  joinMindmapCardContent,
  nodeActivityAt,
  ordinaryMindmapCardContent,
  paperSectionRefs,
  reconcileTodos,
  todoCounts,
  todosFromPaperState,
} from "@/lib/research/todo-map";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const AUTOSAVE_DELAY = 700;
const LAST_WEEK_DAYS = 7;
const GRID_SIZE = 32;
const STATUS_META_HEIGHT = 18;
const COLLAPSE_STORAGE_PREFIX = "openbar:mindmap-collapse:v1";

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
      doubleClick: boolean;
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
}: {
  project: string;
  initialMindmap: Mindmap;
  /** A non-destructive fallback the user can explicitly restore from. */
  draftMindmap?: Mindmap | null;
  paperState?: ProjectState | null;
}) {
  const router = useRouter();
  const [session, dispatch] = useReducer(mindmapReducer, initialMindmap, createMindmapSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { mindmap, selectedId, past: history, future, revision } = session;
  const persistedDiskHashRef = useRef(mindmapDiskHash(initialMindmap));
  const [activitySince, setActivitySince] = useState<string | null>(null);
  const collapseMapId = mindmap.id || initialMindmap.id || "draft";
  const collapseStorageKey = `${COLLAPSE_STORAGE_PREFIX}:${encodeURIComponent(project)}:${encodeURIComponent(collapseMapId)}`;
  const collapseRevision = Math.max(0, mindmap.revision ?? initialMindmap.revision ?? 0);
  const collapseContext = `${collapseStorageKey}:${collapseRevision}`;
  const collapseNodeSignature = useMemo(
    () => mindmap.nodes.map((node) => `${node.id}:${node.parentId || ""}`).sort().join("|"),
    [mindmap.nodes],
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const collapsedIdsRef = useRef<Set<string>>(new Set());
  collapsedIdsRef.current = collapsedIds;

  const setLocalCollapsed = useCallback((id: string, collapsed: boolean) => {
    const next = new Set(collapsedIdsRef.current);
    if (collapsed) next.add(id);
    else next.delete(id);
    collapsedIdsRef.current = next;
    setCollapsedIds(next);
    try {
      window.localStorage.setItem(
        collapseStorageKey,
        JSON.stringify({ revision: collapseRevision, collapsedIds: [...next].sort() }),
      );
    } catch {
      // Browser storage can be unavailable in private or restricted sessions.
    }
  }, [collapseRevision, collapseStorageKey]);

  useEffect(() => {
    const validIds = new Set(mindmap.nodes.map((node) => node.id));
    const parentIds = new Set(mindmap.nodes.flatMap((node) => node.parentId ? [node.parentId] : []));
    let next = new Set<string>();
    try {
      const raw = window.localStorage.getItem(collapseStorageKey);
      if (raw) {
        const stored = JSON.parse(raw) as { revision?: unknown; collapsedIds?: unknown };
        if (stored.revision === collapseRevision && Array.isArray(stored.collapsedIds)) {
          next = new Set(
            stored.collapsedIds.filter(
              (id): id is string => typeof id === "string" && validIds.has(id) && parentIds.has(id),
            ),
          );
        } else {
          window.localStorage.removeItem(collapseStorageKey);
        }
      }
    } catch {
      next = new Set();
    }
    collapsedIdsRef.current = next;
    setCollapsedIds(next);
  }, [collapseContext, collapseNodeSignature, collapseRevision, collapseStorageKey]);

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
    getSnapshot: () => {
      const current = sessionRef.current.mindmap;
      return {
        project,
        mapId: current.id || "draft",
        title: current.title,
        role: current.role,
        isPrimary: isPrimaryMindmap(current),
        revision: sessionRef.current.revision,
        diskHash: persistedDiskHashRef.current,
        rootId: current.rootId,
        nodes: current.nodes.map((node) => {
          const content = cardContentForNodeWithPaperState(node, paperState);
          return {
            id: node.id,
            parentId: node.parentId,
            title: content.title,
            text: content.body,
            collapsed: collapsedIdsRef.current.has(node.id),
            contentFormat: node.contentFormat,
            todoId: node.todoId,
            shape: node.shape,
            color: node.color,
            refs: node.refs,
            metadata: node.metadata,
            tags: node.tags,
            progress: node.progress,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            completed: Boolean(node.todoId && paperTodoFor(node, paperState)?.completed),
          };
        }),
        selectedId: sessionRef.current.selectedId,
        activitySince: activitySince || undefined,
      };
    },
    focusNode: (id) => dispatch({ type: "select", id }),
    hasTodo: (todoId) => Boolean(paperState?.paper?.todos.some((todo) => todo.id === todoId)),
    addNode: async (parentId, text, expectedRevision, title) => {
      const id = newNodeId();
      await persistWebMcpMutation({ type: "add-node", parentId, id, text, title }, expectedRevision);
      return id;
    },
    moveNode: async (id, parentId, beforeId, afterId, expectedRevision) => {
      await persistWebMcpMutation({ type: "reparent", id, parentId, beforeId, afterId }, expectedRevision);
    },
    deleteNode: async (id, expectedRevision) => {
      await persistWebMcpMutation({ type: "delete-subtree", id }, expectedRevision);
    },
    setCollapsed: async (id, collapsed, expectedRevision) => {
      const current = sessionRef.current;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw Object.assign(
          new Error(`Live mindmap revision is ${current.revision}, not ${String(expectedRevision)}.`),
          { code: "stale_live_state" },
        );
      }
      if (!indexMindmap(current.mindmap).nodeById.has(id)) return;
      setLocalCollapsed(id, collapsed);
    },
    patchNode: async (id, patch, expectedRevision) => {
      const nodePatch: {
        title?: string;
        text?: string;
        tags?: string[];
        refs?: ArtifactRef[];
        metadata?: Record<string, unknown>;
        contentFormat?: MindmapNode["contentFormat"];
        shape?: MindmapNode["shape"];
        color?: string;
        progress?: number;
      } = {};
      if (patch.title !== undefined) nodePatch.title = patch.title;
      if (patch.text !== undefined) nodePatch.text = patch.text;
      if (patch.labels) nodePatch.tags = patch.labels;
      if (patch.refs) nodePatch.refs = patch.refs;
      if (patch.metadata !== undefined) nodePatch.metadata = patch.metadata || undefined;
      if (patch.presentation) {
        if (patch.presentation.contentFormat !== undefined) nodePatch.contentFormat = patch.presentation.contentFormat;
        if (patch.presentation.shape !== undefined) nodePatch.shape = patch.presentation.shape;
        if (patch.presentation.color !== undefined) nodePatch.color = patch.presentation.color;
        if (patch.presentation.progress === null) nodePatch.progress = undefined;
        else if (patch.presentation.progress !== undefined) nodePatch.progress = patch.presentation.progress;
      }
      if (Object.keys(nodePatch).length === 0) return;
      await persistWebMcpMutation((current) => {
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        return node ? { type: "patch-node", id, patch: nodePatch } : null;
      }, expectedRevision);
    },
    setActivityHighlight: (since) => setActivitySince(since || null),
    placeTodoCard: async (todoId, parentId, expectedRevision) => {
      const existing = sessionRef.current.mindmap.nodes.find((node) => node.todoId === todoId);
      if (existing) {
        dispatch({ type: "select", id: existing.id });
        return existing.id;
      }
      const id = newNodeId();
      await persistWebMcpMutation({ type: "add-node", parentId, id, todoId }, expectedRevision);
      return id;
    },
    convertCardToTodo: async (id, sectionTitle, expectedRevision) => {
      const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
      if (!node) throw new Error("Unknown card.");
      if (expectedRevision !== undefined && sessionRef.current.revision !== expectedRevision) {
        throw Object.assign(
          new Error(`Live mindmap revision is ${sessionRef.current.revision}, not ${String(expectedRevision)}.`),
          { code: "stale_live_state" },
        );
      }
      const result = await insertPaperTodoAtSectionAction(
        project,
        sectionTitle,
        mindmapTodoPayload(node).text,
        paperState?.paper?.sourceHash,
        mindmapTodoPayload(node).title,
      );
      if (!result.ok) throw new Error(result.message);
      try {
        await persistWebMcpMutation({ type: "bind-todo", id, todoId: result.id }, expectedRevision);
      } catch (error) {
        const rollbackHash = result.diskHash ?? result.value.bundleHash;
        const rollback = await removePaperTodoAction(project, result.id, rollbackHash);
        if (!rollback.ok) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Mindmap save failed: ${message} Paper TODO rollback failed: ${rollback.message}`);
        }
        throw error;
      }
      router.refresh();
      return result.id;
    },
    completeTodo: async (todoId) => {
      const result = await persistPaperTodoAction(project, { type: "complete_todo", id: todoId }, paperState?.paper?.sourceHash);
      if (!result.ok) throw new Error(result.message);
      router.refresh();
    },
    reopenTodo: async (todoId) => {
      const result = await persistPaperTodoAction(project, { type: "reopen_todo", id: todoId }, paperState?.paper?.sourceHash);
      if (!result.ok) throw new Error(result.message);
      router.refresh();
    },
    focusTodoInPaper: (todoId) => router.push(`/p/${project}/paper#${encodeURIComponent(todoId)}`),
    renameMap: async (title, expectedRevision) => {
      await persistWebMcpMutation({ type: "rename-map", title }, expectedRevision);
    },
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
  const [convertSection, setConvertSection] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [externalDraft, setExternalDraft] = useState({ url: "", label: "" });
  const [mapTitleDraft, setMapTitleDraft] = useState(initialMindmap.title || "");
  const [metadataDraft, setMetadataDraft] = useState("");
  const [metadataError, setMetadataError] = useState<string | null>(null);

  useEffect(() => {
    setMapTitleDraft(mindmap.title || "");
  }, [mindmap.title]);

  useEffect(() => {
    setLabelDraft("");
    setExternalDraft({ url: "", label: "" });
    setConvertSection("");
    const node = mindmap.nodes.find((item) => item.id === selectedId);
    setMetadataDraft(node?.metadata ? JSON.stringify(node.metadata, null, 2) : "");
    setMetadataError(null);
  }, [mindmap.nodes, selectedId]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const lastNodeClickRef = useRef<{ id: string; at: number; x: number; y: number } | null>(null);
  const pendingMoveRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const editBaselineRef = useRef<Mindmap | null>(null);
  const didFitRef = useRef(false);
  const viewAnimRef = useRef<number | null>(null);

  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropPreview, setDropPreview] = useState<MindmapDrop | null>(null);
  const dropPreviewRef = useRef<MindmapDrop | null>(null);

  const updateDropPreview = useCallback((next: MindmapDrop | null) => {
    const current = dropPreviewRef.current;
    if (current?.targetId === next?.targetId && current?.kind === next?.kind) return;
    dropPreviewRef.current = next;
    setDropPreview(next);
  }, []);

  const reconciliation = useMemo(
    () => reconcileTodos(mindmap, todosFromPaperState(paperState?.paper?.todos || [])),
    [mindmap, paperState?.paper?.todos],
  );
  const coverageById = useMemo(() => {
    const map = new Map<string, { complete: number; total: number }>();
    const { childrenByParent } = indexMindmap(mindmap);
    for (const node of mindmap.nodes) {
      if (node.todoId) continue;
      const linked = paperSectionRefs(node).length > 0;
      const directTodo = (childrenByParent.get(node.id) || []).some((child) => Boolean(child.todoId));
      if (!linked && !directTodo) continue;
      map.set(node.id, todoCounts(reconciliation, node.id, mindmap));
    }
    return map;
  }, [mindmap, reconciliation]);

  const layout = useMemo(() => {
    const extraHeight = new Map<string, number>();
    for (const node of mindmap.nodes) {
      let extra = 0;
      if (paperSectionRefs(node).length) extra += 16;
      const coverage = coverageById.get(node.id);
      if (coverage && coverage.total > 0) extra += 22;
      const todo = paperTodoFor(node, paperState);
      const baseSizeIncludesMeta = Boolean(node.tags?.length || node.progress !== undefined);
      if (node.todoId && !baseSizeIncludesMeta && (!todo || todo.completed)) extra += STATUS_META_HEIGHT;
      if (extra) extraHeight.set(node.id, extra);
    }
    const next = createCanvasLayout(mindmap, extraHeight, collapsedIds, paperState);
    if (dragPreview && next.positions.has(dragPreview.id)) {
      next.positions.set(dragPreview.id, { x: dragPreview.x, y: dragPreview.y });
    }
    return next;
  }, [mindmap, dragPreview, coverageById, collapsedIds, paperState?.paper?.todos]);
  const selected = layout.nodeById.get(selectedId) || layout.nodeById.get(mindmap.rootId);
  const dirty = mapSignature(mindmap) !== savedSignature;
  const descendantCounts = useMemo(() => countDescendantsByNode(mindmap), [mindmap]);
  const activityNodeIds = useMemo(() => {
    if (!activitySince) return new Set<string>();
    const sinceMs = Date.parse(`${activitySince}T00:00:00`);
    const extra = new Map(
      (paperState?.recent || [])
        .filter((item) => {
          if (!item.nodeId) return false;
          const mapId = "mapId" in item ? (item as { mapId?: string }).mapId : undefined;
          return !mapId || mapId === (mindmap.id || "draft");
        })
        .map((item) => [item.nodeId!, item.at]),
    );
    const recentSectionIds = new Set(
      (paperState?.paper?.outline || [])
        .filter((section) => section.updatedAt && Date.parse(section.updatedAt) >= sinceMs)
        .map((section) => section.id),
    );
    const active = new Set<string>();
    for (const node of mindmap.nodes) {
      const at = extra.get(node.id) || nodeActivityAt(node, reconciliation);
      const own = Boolean(at && Date.parse(at) >= sinceMs);
      const viaSection = paperSectionRefs(node).some((ref) => recentSectionIds.has(ref.id));
      if (own || viaSection) active.add(node.id);
    }
    const { nodeById } = indexMindmap(mindmap);
    for (const id of [...active]) {
      const node = nodeById.get(id);
      if (node?.todoId && node.parentId) active.add(node.parentId);
    }
    return active;
  }, [activitySince, mindmap, paperState?.recent, paperState?.paper?.outline, reconciliation]);

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
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (node?.todoId) {
      dispatch({ type: "select", id });
      return;
    }
    dispatch({ type: "select", id });
    beginTextTransaction();
    setEditingId(id);
  }

  function updateNodeText(id: string, text: string) {
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node || node.todoId) return;
    const parts = splitCardText(text);
    setSaveError(null);
    dispatch({ type: "edit-card", id, title: parts.title, text: parts.body });
  }

  function updateNodeCard(id: string, title: string, text: string) {
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node || node.todoId) return;
    setSaveError(null);
    dispatch({ type: "edit-card", id, title, text });
  }

  function addChild(parentId?: string) {
    const current = sessionRef.current.mindmap;
    const currentIndex = indexMindmap(current);
    const currentSelected = currentIndex.nodeById.get(sessionRef.current.selectedId);
    const nextParentId = parentId || currentSelected?.id || current.rootId;
    const parent = currentIndex.nodeById.get(nextParentId);
    if (!parent) return;
    if (collapsedIdsRef.current.has(parent.id)) setLocalCollapsed(parent.id, false);
    const id = newNodeId();
    setSaveError(null);
    dispatch({ type: "add-node", parentId: nextParentId, id, title: "New topic" });
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

  function placeUnplacedTodo(todoId: string, parentId = selected?.id || mindmap.rootId) {
    const existing = sessionRef.current.mindmap.nodes.find((node) => node.todoId === todoId);
    if (existing) {
      dispatch({ type: "select", id: existing.id });
      return;
    }
    if (!indexMindmap(sessionRef.current.mindmap).nodeById.has(parentId)) return;
    const id = newNodeId();
    setSaveError(null);
    dispatch({ type: "add-node", parentId, id, todoId });
  }

  const toggleCollapse = useCallback((id = selected?.id) => {
    if (!id) return;
    if (!(descendantCounts.get(id) || 0)) return;
    setSaveError(null);
    setLocalCollapsed(id, !collapsedIdsRef.current.has(id));
  }, [descendantCounts, selected?.id, setLocalCollapsed]);

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
      if (!mod) return;

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
  }, [dirty, fitToCanvas, isPending, redo, save, undo, zoomAt]);

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
    const now = performance.now();
    const previousClick = lastNodeClickRef.current;
    const doubleClick = Boolean(
      previousClick
      && previousClick.id === id
      && now - previousClick.at <= 500
      && Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) <= 12,
    );
    lastNodeClickRef.current = doubleClick
      ? null
      : { id, at: now, x: event.clientX, y: event.clientY };
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
      doubleClick,
    };
    updateDropPreview(null);
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
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      interaction.moved = true;
      lastNodeClickRef.current = null;
    }
    setSaveError(null);
    pendingMoveRef.current = {
      id: interaction.id,
      x: Math.max(24, Math.round(interaction.startPosition.x + dx)),
      y: Math.max(24, Math.round(interaction.startPosition.y + dy)),
    };
    setDragPreview(pendingMoveRef.current);

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-mind-node]");
    const targetId = target?.getAttribute("data-mind-node");
    if (!target || !targetId) {
      updateDropPreview(null);
      return;
    }
    const bounds = target.getBoundingClientRect();
    updateDropPreview(resolveMindmapDrop(
      sessionRef.current.mindmap,
      interaction.id,
      targetId,
      event.clientY - bounds.top,
      bounds.height,
    ));
  }

  function endPointerInteraction(event: PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    setDragPreview(null);
    updateDropPreview(null);
    if (interaction.kind === "node" && interaction.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-mind-node]");
      const targetId = target?.getAttribute("data-mind-node");
      if (pending && target && targetId) {
        const bounds = target.getBoundingClientRect();
        const drop = resolveMindmapDrop(
          sessionRef.current.mindmap,
          interaction.id,
          targetId,
          event.clientY - bounds.top,
          bounds.height,
        );
        if (drop && drop.id === interaction.id) {
          const mapped = applyMindmapDrop(sessionRef.current.mindmap, drop);
          if (mapped) dispatch({ type: "reparent", id: drop.id, parentId: mapped.parentId, beforeId: mapped.beforeId, afterId: mapped.afterId });
        }
      }
      dispatch({ type: "record-history", before: interaction.before });
    }
    if (interaction.kind === "node" && interaction.doubleClick && !interaction.moved) {
      onNodeDoubleClick(interaction.id);
    }
    interactionRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onNodeDoubleClick(id: string) {
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node) return;
    if (node.todoId) {
      if (paperTodoFor(node, paperState)) router.push(`/p/${project}/paper#${encodeURIComponent(node.todoId)}`);
      return;
    }
    startEditing(id);
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

  const saveConflict = Boolean(saveError && /conflict|changed.*reload|stale/i.test(saveError));
  const paperSections = paperState?.paper?.outline || [];
  const selectedTodo = selected ? paperTodoFor(selected, paperState) : undefined;
  const selectedMissing = Boolean(selected?.todoId && !selectedTodo);
  const selectedRefs = selected?.refs || [];
  const paperSourceHash = paperState?.paper?.sourceHash;
  const selectedParts = selected && !selected.todoId
    ? ordinaryMindmapCardContent(selected)
    : { title: "", body: "" };
  const selectedCardContent = selected ? cardContentForNodeWithPaperState(selected, paperState) : undefined;
  const projectLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const node of mindmap.nodes) {
      for (const tag of node.tags || []) {
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(tag);
      }
    }
    return labels;
  }, [mindmap.nodes]);
  const paperComments = paperState?.paper?.comments || [];
  const paperCommentKind = isArtifactKind("paper-comment") ? ("paper-comment" as ArtifactKind) : undefined;

  async function linkPaperComment(comment: ProjectStateComment) {
    if (!selected || !paperCommentKind) return;
    let id = commentRefId(comment);
    if (!id) {
      if (comment.sourceStart === undefined || !paperState?.paper?.sourceHash) {
        setSaveError("Reload the paper before linking this comment.");
        return;
      }
      try {
        const ensured = await ensurePaperCommentAction(project, comment.sourceStart, paperState.paper.sourceHash);
        id = ensured.id;
        router.refresh();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not assign an id to the paper comment.");
        return;
      }
    }
    dispatch({
      type: "patch-node",
      id: selected.id,
      patch: {
        refs: [
          ...(selected.refs || []).filter((item) => !(item.kind === paperCommentKind && item.id === id)),
          { kind: paperCommentKind, id, label: comment.text.slice(0, 80) },
        ],
      },
    });
  }

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
    <section className="mindmap-editor">
      <div className="mindmap-workspace">
        {paperState && (
        <PaperActivityRail
          state={paperState}
          nodes={mindmap.nodes}
          onPlaceTodo={(todoId) => placeUnplacedTodo(todoId)}
        />
        )}
        <div className="mindmap-toolbar" aria-label="Mindmap controls">
          <div className="flex min-w-0 flex-nowrap items-center gap-0.5">
            <ToolbarButton title="Add child topic (Tab)" onClick={() => addChild()}><Plus size={15} /></ToolbarButton>
            <ToolbarButton title="Delete selected topic (Delete)" onClick={deleteSelected} disabled={!selected || selected.id === mindmap.rootId} danger><Trash2 size={14} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <ToolbarButton title="Undo (⌘Z)" onClick={undo} disabled={!history.length}><Undo2 size={14} /></ToolbarButton>
            <ToolbarButton title="Redo (⌘⇧Z / Ctrl+Y)" onClick={redo} disabled={!future.length}><Redo2 size={14} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <ToolbarButton title="Zoom out (⌘-)" onClick={() => zoomAt(0.85, undefined, true)}><Minus size={14} /></ToolbarButton>
            <button type="button" className="mindmap-zoom-readout" title="Fit map to screen (⌘0)" onClick={() => fitToCanvas(true)}>{Math.round(view.scale * 100)}%</button>
            <ToolbarButton title="Zoom in (⌘+)" onClick={() => zoomAt(1.18, undefined, true)}><ZoomIn size={14} /></ToolbarButton>
            <ToolbarButton title="Fit map to screen (⌘0)" onClick={() => fitToCanvas(true)}><Maximize size={14} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              className={cn("mindmap-toolbar-button", activitySince && "mindmap-activity-button-active")}
              title="Highlight cards updated in the past seven days"
              onClick={() => setActivitySince((current) => current ? null : daysAgoDate(LAST_WEEK_DAYS))}
            >
              <CalendarDays size={13} /> Last 7d
            </button>
            {activitySince && (
              <label className="mindmap-activity-date" title="Highlight cards updated on or after this date">
                <span className="sr-only">Highlight activity since</span>
                <input
                  type="date"
                  value={activitySince}
                  onChange={(event) => setActivitySince(event.target.value || daysAgoDate(LAST_WEEK_DAYS))}
                  aria-label="Highlight activity since a date"
                />
              </label>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
                    <li><kbd>Delete</kbd> remove topic</li>
                    <li>Alt+↑ / Alt+↓ reorder siblings</li>
                    <li>Arrows move selection</li>
                    <li>Click the card edge to collapse child cards · Space-drag pan · ⌘S save</li>
                  </ul>
                </div>
              )}
            </div>
            <ToolbarButton title={showInspector ? "Hide inspector" : "Show inspector"} onClick={() => setShowInspector((shown) => !shown)}>
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
          style={{
            backgroundPosition: `${view.x}px ${view.y}px`,
            backgroundSize: `${GRID_SIZE * view.scale}px ${GRID_SIZE * view.scale}px`,
          }}
          tabIndex={0}
          role="application"
          aria-label="Editable mindmap canvas showing all topics. Use Tab to add a child, Enter for a sibling, arrow keys to move, E to edit, and Command-S to save."
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
                  cardContent={cardContentForNodeWithPaperState(node, paperState)}
                  completed={Boolean(paperTodoFor(node, paperState)?.completed)}
                  missing={Boolean(node.todoId && !paperTodoFor(node, paperState))}
                  collapsed={collapsedIds.has(node.id)}
                  collapsedDescendantCount={descendantCounts.get(node.id) || 0}
                  sectionLabel={paperSectionRefs(node).map((ref) => sectionRefLabel(ref, paperSections)).join(" · ")}
                  coverage={coverageById.get(node.id)}
                  activityLabel={activityNodeIds.has(node.id) ? relativeActivityLabel(nodeActivityAt(node, reconciliation)) : null}
                  position={position}
                  dimensions={dimensions}
                  orphan={!layout.reachable.has(node.id)}
                  selected={node.id === selected?.id}
                  active={activityNodeIds.has(node.id)}
                  editing={node.id === editingId}
                  dropPreviewKind={dropPreview?.targetId === node.id ? dropPreview.kind : null}
                  onPointerDown={(event) => onNodePointerDown(event, node.id, position)}
                  onToggleCollapse={() => toggleCollapse(node.id)}
                  onSelect={() => dispatch({ type: "select", id: node.id })}
                  onDropTodo={(todoId) => placeUnplacedTodo(todoId, node.id)}
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
                      const baselineNode = editBaselineRef.current
                        ? indexMindmap(editBaselineRef.current).nodeById.get(node.id)
                        : undefined;
                      if (baselineNode && editableCardText(baselineNode) === editableCardText(node)) {
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

          <div className="mindmap-canvas-hint" title="Canvas navigation help">
            <CircleHelp size={14} aria-hidden="true" />
            <span className="mindmap-canvas-hint-details">
              Drag or Space+drag to pan · Middle-click to pan · Pinch or ⌘/Ctrl+scroll to zoom · 2-finger scroll to pan · ⌘Z undo · ⌘⇧Z redo
            </span>
          </div>
        </div>

        {saveError && <p className="mindmap-save-error" role="alert">{saveError}</p>}
        <footer className="mindmap-footer">
          <span>{layout.nodes.length === mindmap.nodes.length ? mindmap.nodes.length : `${layout.nodes.length} of ${mindmap.nodes.length}`} topic{mindmap.nodes.length === 1 ? "" : "s"}</span>
          {activitySince && <span>{activityNodeIds.size} active since {formatMindmapDate(activitySince)}</span>}
        </footer>
      </div>

      {showInspector && selected && (
        <aside className="mindmap-inspector" aria-label="Selected card">
          <div className="mindmap-inspector-heading">
            <div className="min-w-0">
              <p className="mindmap-inspector-kicker">{selected.todoId ? "Paper TODO" : "Card"}</p>
              {selectedCardContent?.title && <h2 className="mindmap-inspector-title truncate">{selectedCardContent.title}</h2>}
            </div>
            <button type="button" className="btn-ghost h-7 w-7 p-0" title="Close inspector" onClick={() => setShowInspector(false)}><X size={24} strokeWidth={2.5} /></button>
          </div>

          {selected.todoId ? (
            <div className="mindmap-inspector-group mindmap-inspector-group-flush">
              <div className="mindmap-field">
                <span>Paper TODO</span>
                {selectedMissing ? (
                  <p className="text-xs text-warn">Missing paper TODO: {selected.todoId}</p>
                ) : (
                  <div className={cn("mindmap-inspector-todo-text", selectedTodo?.completed && "is-done")}>
                    {selectedCardContent?.title && <div className="mindmap-node-title">{selectedCardContent.title}</div>}
                    {selectedCardContent?.body.trim() && (
                      <p className="mindmap-node-detail"><NodeRichText text={selectedCardContent.body} /></p>
                    )}
                  </div>
                )}
              </div>
              <div className="mindmap-inspector-actions">
                {selectedTodo && <a className="btn-outline" href={`/p/${project}/paper#${encodeURIComponent(selected.todoId)}`}>Jump to paper</a>}
                {!selectedMissing && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      void persistPaperTodoAction(
                        project,
                        { type: selectedTodo?.completed ? "reopen_todo" : "complete_todo", id: selected.todoId! },
                        paperState?.paper?.sourceHash,
                      ).then((result) => {
                        if (!result.ok) setSaveError(result.message);
                        else router.refresh();
                      });
                    }}
                  >
                    {selectedTodo?.completed ? "Reopen" : "Complete"}
                  </button>
                )}
                {!selectedMissing && selected.todoId && paperSourceHash && (
                  <button
                    type="button"
                    className="btn-outline text-warn"
                onClick={() => {
                      if (!window.confirm("Delete this TODO from the paper? Its mindmap card and child topics will stay in place so you can repair or convert the card.")) return;
                      void removePaperTodoAction(project, selected.todoId!, paperSourceHash)
                        .then((result) => {
                          if (!result.ok) {
                            setSaveError(result.message);
                            return;
                          }
                          router.refresh();
                        })
                        .catch((error) => setSaveError(error instanceof Error ? error.message : "Could not delete the paper TODO."));
                    }}
                  >
                    Delete paper TODO
                  </button>
                )}
                {selectedMissing && (
                  <>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => {
                        const content = selectedCardContent || { title: `Missing paper TODO: ${selected.todoId}`, body: "" };
                        dispatch({ type: "unbind-todo", id: selected.id, title: content.title, text: content.body });
                      }}
                    >
                      Convert to ordinary card
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => dispatch({ type: "delete-subtree", id: selected.id })}
                    >
                      Delete card
                    </button>
                  </>
                )}
              </div>
              {selectedMissing && availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).length > 0 && (
                <label className="mindmap-field">
                  <span>Relink to paper TODO</span>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const todoId = event.target.value;
                      if (!todoId) return;
                      dispatch({ type: "bind-todo", id: selected.id, todoId });
                    }}
                  >
                    <option value="">Choose an available TODO…</option>
                    {availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).map((todo) => (
                      <option key={todo.id} value={todo.id}>{todo.text}</option>
                    ))}
                  </select>
                </label>
              )}
              <small>TeX owns the title, main text, and completion.</small>
            </div>
          ) : (
            <div className="mindmap-inspector-group mindmap-inspector-group-flush">
              <label className="mindmap-field">
                <span>Title</span>
                <input
                  value={selectedParts.title}
                  onFocus={beginTextTransaction}
                  onChange={(event) => updateNodeCard(selected.id, event.target.value, selectedParts.body)}
                  onBlur={() => finishTextTransaction(true)}
                  placeholder="Title"
                  aria-label="Card title"
                />
              </label>
              <label className="mindmap-field">
                <span>Main text</span>
                <textarea
                  value={selectedParts.body}
                  onFocus={beginTextTransaction}
                  onChange={(event) => updateNodeCard(selected.id, selectedParts.title, event.target.value)}
                  onBlur={() => finishTextTransaction(true)}
                  rows={4}
                  placeholder="Optional note"
                  aria-label="Card main text"
                />
              </label>
            </div>
          )}

          {!selected.todoId && paperSections.length > 0 && (
            <div className="mindmap-inspector-group">
              <label className="mindmap-field">
                <span>Convert to TODO</span>
                <select value={convertSection} onChange={(event) => setConvertSection(event.target.value)}>
                  <option value="">Place TODO in paper…</option>
                  {paperSections.map((section) => (
                    <option key={section.id} value={section.title}>{section.title}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-outline mindmap-convert-btn"
                disabled={!convertSection}
                onClick={() => {
                  void (async () => {
                    const result = await insertPaperTodoAtSectionAction(
                      project,
                      convertSection,
                      mindmapTodoPayload(selected).text,
                      paperState?.paper?.sourceHash,
                      mindmapTodoPayload(selected).title,
                    );
                    if (!result.ok) {
                      setSaveError(result.message);
                      return;
                    }
                    dispatch({ type: "bind-todo", id: selected.id, todoId: result.id });
                    setConvertSection("");
                    router.refresh();
                  })();
                }}
              >
                Make TODO
              </button>
              <small>Inserts a pending paper TODO in that section. This card becomes that TODO.</small>
            </div>
          )}

          <div className="mindmap-inspector-group">
            <div className="mindmap-field">
              <span>Labels</span>
              {(selected.tags || []).length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {(selected.tags || []).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[11px]"
                      title={`Remove ${tag}`}
                      onClick={() => dispatch({
                        type: "patch-node",
                        id: selected.id,
                        patch: { tags: (selected.tags || []).filter((item) => item !== tag) },
                      })}
                    >
                      {tag} <X size={10} />
                    </button>
                  ))}
                </div>
              )}
              <input
                value={labelDraft}
                list="mindmap-label-suggestions"
                maxLength={MAX_MINDMAP_LABEL_CHARS}
                placeholder="Add label and press Enter"
                aria-label="Add label"
                disabled={(selected.tags || []).length >= MAX_MINDMAP_LABELS}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const next = labelDraft.trim();
                  if (!next || next.length > MAX_MINDMAP_LABEL_CHARS) return;
                  const tags = clampMindmapLabels([...(selected.tags || []), next]);
                  setSaveError(null);
                  dispatch({ type: "patch-node", id: selected.id, patch: { tags } });
                  setLabelDraft("");
                }}
              />
              <datalist id="mindmap-label-suggestions">
                {projectLabels.map((tag) => <option key={tag} value={tag} />)}
              </datalist>
            </div>
          </div>

          <div className="mindmap-inspector-group">
            <div className="mindmap-field">
              <span>References</span>
              {selectedRefs.length === 0 && <p className="text-xs text-faint">No linked sections, comments, or URLs.</p>}
            <ul className="mindmap-ref-list">
              {selectedRefs.map((ref) => {
                const href = artifactHref(project, ref);
                const external = ref.kind === "web" || ref.kind === "external";
                return (
                  <li key={`${ref.kind}:${ref.id}`}>
                    <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
                      ↗ {refDisplayLabel(ref, paperSections, paperState?.paper?.comments || [])}
                    </a>
                    <button
                      type="button"
                      className="mindmap-ref-remove"
                      title="Remove reference"
                      onClick={() => dispatch({
                        type: "patch-node",
                        id: selected.id,
                        patch: { refs: (selected.refs || []).filter((item) => !(item.kind === ref.kind && item.id === ref.id)) },
                      })}
                    >
                      <X size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {paperSections.length > 0 && (
              <select
                className="mt-1"
                value=""
                aria-label="Link paper section"
                onChange={(event) => {
                  const section = paperSections.find((item) => item.id === event.target.value);
                  if (!section) return;
                  dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: {
                      refs: [
                        ...(selected.refs || []).filter((item) => !(item.kind === "paper-section" && item.id === section.id)),
                        { kind: "paper-section", id: section.id, label: section.title },
                      ],
                    },
                  });
                }}
              >
                <option value="">+ Paper section</option>
                {paperSections.map((section) => (
                  <option key={section.id} value={section.id}>{section.title}</option>
                ))}
              </select>
            )}
            {paperCommentKind && paperComments.length > 0 && (
              <select
                className="mt-1"
                value=""
                aria-label="Link paper comment"
                onChange={(event) => {
                  const comment = paperComments.find((item, index) => commentOptionValue(item, index) === event.target.value);
                  if (!comment) return;
                  void linkPaperComment(comment);
                }}
              >
                <option value="">+ Paper comment</option>
                {paperComments.map((comment, index) => {
                  const value = commentOptionValue(comment, index);
                  return (
                    <option key={value} value={value}>
                      {comment.kind ? `${comment.kind}: ` : ""}{comment.text.slice(0, 72)}
                    </option>
                  );
                })}
              </select>
            )}
            <div className="mt-1 flex flex-col gap-1">
              <input
                value={externalDraft.url}
                onChange={(event) => setExternalDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://…"
                aria-label="External URL"
              />
              <input
                value={externalDraft.label}
                onChange={(event) => setExternalDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Optional label"
                aria-label="External link label"
              />
              <button
                type="button"
                className="btn-outline px-2 py-0.5 text-[11px]"
                onClick={() => {
                  const url = safeUrl(externalDraft.url);
                  if (!url) return;
                  dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: {
                      refs: [
                        ...(selected.refs || []).filter((item) => !(item.kind === "external" && (item.id === url || item.url === url))),
                        { kind: "external", id: url, url, ...(externalDraft.label.trim() ? { label: externalDraft.label.trim() } : {}) },
                      ],
                    },
                  });
                  setExternalDraft({ url: "", label: "" });
                }}
              >
                + External link
              </button>
            </div>
            </div>
          </div>

          <div className="mindmap-inspector-group">
            <label className="mindmap-field">
              <span>Metadata</span>
              <textarea
                value={metadataDraft}
                onChange={(event) => {
                  setMetadataDraft(event.target.value);
                  setMetadataError(null);
                }}
                onBlur={() => {
                  const value = metadataDraft.trim();
                  if (!value) {
                    setMetadataError(null);
                    dispatch({ type: "patch-node", id: selected.id, patch: { metadata: undefined } });
                    return;
                  }
                  try {
                    const parsed = JSON.parse(value);
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Metadata must be a JSON object.");
                    setMetadataError(null);
                    dispatch({ type: "patch-node", id: selected.id, patch: { metadata: parsed as Record<string, unknown> } });
                  } catch (error) {
                    setMetadataError(error instanceof Error ? error.message : "Metadata must be valid JSON.");
                  }
                }}
                rows={4}
                placeholder='{"key": "value"}'
                aria-label="Card metadata JSON"
              />
              {metadataError && <small className="text-danger">{metadataError}</small>}
            </label>
          </div>

          <details className="mindmap-inspector-group mindmap-inspector-more">
            <summary>More</summary>
            <label className="mindmap-field">
              <span>Map title</span>
              <input
                value={mapTitleDraft}
                onChange={(event) => setMapTitleDraft(event.target.value)}
                onBlur={() => {
                  const title = mapTitleDraft.trim();
                  if (title && title !== (mindmap.title || "")) {
                    setSaveError(null);
                    dispatch({ type: "rename-map", title });
                  } else {
                    setMapTitleDraft(mindmap.title || "");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                }}
                placeholder="Map title"
                aria-label="Mindmap title"
              />
            </label>
            <div className="mindmap-field">
              <span>Progress</span>
              {selected.progress == null ? (
                <button
                  type="button"
                  className="btn-outline mindmap-convert-btn"
                  onClick={() => dispatch({ type: "patch-node", id: selected.id, patch: { progress: 0 } })}
                >
                  Set progress
                </button>
              ) : (
                <>
                  <div className="mindmap-progress-inputs">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={selected.progress}
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
                      value={selected.progress}
                      aria-label="Topic progress percentage"
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setSaveError(null);
                        dispatch({ type: "patch-node", id: selected.id, patch: { progress: Math.min(100, Math.max(0, next)) } });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-accent hover:underline"
                    onClick={() => dispatch({ type: "patch-node", id: selected.id, patch: { progress: undefined } })}
                  >
                    Hide progress
                  </button>
                </>
              )}
              <small>Optional local planning bar. Not TODO completion.</small>
            </div>
            <div className="mindmap-field">
              <span>Appearance</span>
              {selected.parentId !== null && (
                <select
                  value={selected.shape || "leaf"}
                  aria-label="Card shape"
                  onChange={(event) => dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: { shape: event.target.value as MindmapNode["shape"] },
                  })}
                >
                  <option value="branch">Branch</option>
                  <option value="leaf">Leaf</option>
                  <option value="note">Note</option>
                  <option value="callout">Callout</option>
                </select>
              )}
              <input
                className={selected.parentId !== null ? "mt-1.5" : undefined}
                value={selected.color || ""}
                onChange={(event) => dispatch({
                  type: "patch-node",
                  id: selected.id,
                  patch: { color: event.target.value.trim() || undefined },
                })}
                placeholder="CSS color"
                aria-label="Card color"
              />
            </div>
          </details>
        </aside>
      )}
    </section>
  );
}

function CanvasNode({
  node,
  cardContent,
  completed,
  missing,
  collapsed,
  collapsedDescendantCount,
  sectionLabel,
  coverage,
  activityLabel,
  position,
  dimensions,
  orphan,
  selected,
  active,
  editing,
  dropPreviewKind,
  onPointerDown,
  onToggleCollapse,
  onSelect,
  onDropTodo,
  onTextChange,
  onTextFocus,
  onTextBlur,
  onTextKeyDown,
}: {
  node: MindmapNode;
  cardContent: { title: string; body: string };
  completed: boolean;
  missing: boolean;
  collapsed: boolean;
  collapsedDescendantCount: number;
  sectionLabel?: string;
  coverage?: { complete: number; total: number };
  activityLabel?: string | null;
  position: Point;
  dimensions: Dimensions;
  orphan: boolean;
  selected: boolean;
  active: boolean;
  editing: boolean;
  dropPreviewKind: MindmapDrop["kind"] | null;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onDropTodo: (todoId: string) => void;
  onTextChange: (text: string) => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
  onTextKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const { title, body } = cardContent;
  const tags = node.tags || [];
  return (
    <article
      data-mind-node={node.id}
      role="treeitem"
      aria-selected={selected}
      aria-label={title || mindmapNodeLabel(node)}
      title={title || mindmapNodeLabel(node)}
      className={cn(
        "mindmap-node-card",
        node.todoId && "mindmap-node-todo",
        node.parentId === null && "mindmap-node-root",
        node.shape === "note" && "mindmap-node-note",
        node.shape === "callout" && "mindmap-node-callout",
        orphan && "mindmap-node-orphan",
        selected && "mindmap-node-selected",
        active && "mindmap-node-active",
        editing && "mindmap-node-editing",
        dropPreviewKind && "mindmap-node-drop-target",
        dropPreviewKind === "child" && "mindmap-node-drop-parent",
        completed && "mindmap-node-complete",
        missing && "mindmap-node-missing",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: dimensions.width,
        minHeight: dimensions.height,
        "--mind-node-accent": nodeAccent(node),
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        onSelect();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-openbar-todo")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const todoId = event.dataTransfer.getData("application/x-openbar-todo");
        if (!todoId) return;
        event.preventDefault();
        onDropTodo(todoId);
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          className="mindmap-node-textarea"
          value={editableCardText(node)}
          aria-label="Topic title and main text"
          rows={4}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => {
            onTextFocus();
            if (editableCardText(node) === "New topic") event.currentTarget.select();
          }}
          onChange={(event) => onTextChange(event.target.value)}
          onBlur={onTextBlur}
          onKeyDown={onTextKeyDown}
        />
      ) : (
        <>
          {node.todoId ? (
            <div className="mindmap-node-todo-text">
              <span className="mr-1">{completed ? "☑" : missing ? "⚠" : "☐"}</span>
              {title.trim() && <span className="font-semibold"><NodeRichText text={title} /></span>}
              {body.trim() && <p className="mindmap-node-detail"><NodeRichText text={body} /></p>}
            </div>
          ) : (
            <>
              {title.trim() && <div className="mindmap-node-title"><NodeRichText text={title} /></div>}
              {body.trim() && <p className="mindmap-node-detail"><NodeRichText text={body} /></p>}
            </>
          )}
          {sectionLabel && <p className="mindmap-node-section">§ {sectionLabel}</p>}
          {coverage && coverage.total > 0 && (
            <div className="mindmap-coverage">
              <span className="tabular-nums">{coverage.complete} / {coverage.total} TODOs</span>
              <div className="mindmap-coverage-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((coverage.complete / coverage.total) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="mindmap-node-meta">
            {!(coverage && coverage.total > 0) && node.progress !== undefined && !completed && <span className="mindmap-node-progress">{formatProgress(node.progress)}%</span>}
            {completed && <span>complete</span>}
            {missing && <span>missing paper TODO</span>}
            {activityLabel && <span>{activityLabel}</span>}
            {tags.slice(0, 2).map((tag) => <span className="mindmap-node-tag" key={tag}>{tag}</span>)}
            {tags.length > 2 && <span className="mindmap-node-tag">+{tags.length - 2}</span>}
          </div>
        </>
      )}
      {collapsedDescendantCount > 0 && (
        <button
          type="button"
          className="mindmap-collapse-toggle"
          aria-label={collapsed ? `Expand ${collapsedDescendantCount} child cards` : `Collapse ${collapsedDescendantCount} child cards`}
          aria-pressed={collapsed}
          title={collapsed ? "Expand child cards" : "Collapse all child cards"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleCollapse();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {collapsed ? `(${collapsedDescendantCount})` : "(-)"}
        </button>
      )}
      {dropPreviewKind && (
        <span className="mindmap-drop-preview" aria-hidden="true">
          {dropPreviewKind === "child" ? "↳ child" : dropPreviewKind === "before" ? "↑ before" : "↓ after"}
        </span>
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
  const title = node.title !== undefined ? node.title.trim() : firstLine(node.text);
  const bits = [title || "Untitled topic"];
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

function createCanvasLayout(
  mindmap: Mindmap,
  extraHeight?: Map<string, number>,
  collapsedIds = new Set<string>(),
  paperState?: ProjectState | null,
): CanvasLayout {
  const safeNodes = Array.isArray(mindmap?.nodes) ? mindmap.nodes : [];
  const visibleNodes = safeNodes;
  const visibleMindmap = {
    ...mindmap,
    nodes: visibleNodes.map((node) => ({ ...node, collapsed: collapsedIds.has(node.id) })),
  };
  const { nodeById, childrenByParent: children } = indexMindmap(visibleMindmap);
  const dimensions = new Map<string, Dimensions>();
  for (const node of visibleNodes) {
    const size = nodeDimensions(node, paperTodoText(node, paperState));
    const extra = extraHeight?.get(node.id) || 0;
    dimensions.set(node.id, extra ? { ...size, height: size.height + extra } : size);
  }
  const { positions, reachable, connected } = layoutMindmapTree(visibleMindmap, dimensions);
  const recoveryAnchorId = positions.has(visibleMindmap.rootId)
    ? visibleMindmap.rootId
    : [...reachable].find((id) => positions.has(id));
  const orphanNodes = visibleNodes.filter((node) => !connected.has(node.id));
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
  const nodes = visibleNodes.filter((node) => reachable.has(node.id) || !connected.has(node.id));
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

function countDescendantsByNode(mindmap: Mindmap): Map<string, number> {
  const { childrenByParent } = indexMindmap(mindmap);
  const counts = new Map<string, number>();
  const count = (id: string, path = new Set<string>()): number => {
    if (path.has(id)) return 0;
    const nextPath = new Set(path);
    nextPath.add(id);
    let total = 0;
    for (const child of childrenByParent.get(id) || []) {
      total += 1 + count(child.id, nextPath);
    }
    return total;
  };
  for (const node of mindmap.nodes) counts.set(node.id, count(node.id));
  return counts;
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
  return node.color || "rgb(var(--accent))";
}

function paperTodoFor(node: MindmapNode, paperState?: ProjectState | null) {
  if (!node.todoId) return undefined;
  return paperState?.paper?.todos.find((todo) => todo.id === node.todoId);
}

function paperTodoText(node: MindmapNode, paperState?: ProjectState | null): string {
  return joinMindmapCardContent(cardContentForNodeWithPaperState(node, paperState));
}

function firstLine(text: string) {
  return splitCardText(text).title.trim();
}

function splitCardText(text: string): { title: string; body: string } {
  const nl = text.indexOf("\n");
  if (nl < 0) return { title: text, body: "" };
  return { title: text.slice(0, nl), body: text.slice(nl + 1) };
}

function editableCardContent(node: MindmapNode): { title: string; body: string } {
  if (node.title !== undefined) return { title: node.title, body: node.text };
  return splitCardText(node.text);
}

function editableCardText(node: MindmapNode): string {
  return joinMindmapCardContent(editableCardContent(node));
}

function mindmapTodoPayload(node: MindmapNode): { title?: string; text: string } {
  const content = ordinaryMindmapCardContent(node);
  const title = content.title.trim();
  return {
    ...(title ? { title } : {}),
    text: content.body.trim(),
  };
}

function cardContentForNodeWithPaperState(node: MindmapNode, paperState?: ProjectState | null) {
  if (!node.todoId) return ordinaryMindmapCardContent(node);
  const todo = paperTodoFor(node, paperState);
  if (todo) {
    return {
      title: todo.title?.trim() || "",
      body: todo.text,
    };
  }
  const fallback = ordinaryMindmapCardContent(node);
  return {
    title: fallback.title || `Missing paper TODO: ${node.todoId}`,
    body: fallback.body,
  };
}

function commentRefId(comment: ProjectStateComment): string | undefined {
  const id = comment.id?.trim();
  return id || undefined;
}

function commentOptionValue(comment: ProjectStateComment, index: number): string {
  return commentRefId(comment) || (comment.sourceStart === undefined ? `comment:${index}` : `offset:${comment.sourceStart}`);
}

function sectionRefLabel(ref: ArtifactRef, outline: Array<{ id: string; title: string }>): string {
  return ref.label || outline.find((section) => section.id === ref.id)?.title || ref.id;
}

function refDisplayLabel(ref: ArtifactRef, outline: Array<{ id: string; title: string }>, comments: ProjectStateComment[]): string {
  if (ref.label?.trim()) return ref.label.trim();
  if (ref.kind === "paper-section") return sectionRefLabel(ref, outline);
  if (ref.kind === "paper-comment") {
    const comment = comments.find((item) => commentRefId(item) === ref.id);
    if (comment) return comment.text.slice(0, 80) || ref.id;
  }
  if (ref.kind === "web" || ref.kind === "external") return ref.url || ref.id;
  return ref.id;
}

function relativeActivityLabel(at: string): string | null {
  if (!at) return null;
  const date = new Date(at.includes("T") ? at : `${at}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "updated today";
  return `updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
