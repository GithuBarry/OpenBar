"use client";

import "katex/dist/katex.min.css";
import styles from "./mindmap-editor.module.css";
import { RichText as NodeRichText } from "@/components/rich-text";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { NodeToolbar, Position } from "@xyflow/react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  ChevronRight,
  FilePlus2,
  FileText,
  Bold,
  Italic,
  Keyboard,
  LoaderCircle,
  Link2,
  LockKeyhole,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Search,
  PanelRight,
  GitBranch,
  Undo2,
  X,
} from "lucide-react";

import { markdownTableColumns, startsWithMarkdownTable } from "@/lib/mindmap/markdown-table";
import { ChoiceButtons } from "@/components/choice-buttons";
import { countMindmapDescendants } from "@/lib/mindmap-index";
import { useGitAutoSync } from "@/components/use-git-auto-sync";
import { OverleafSyncNotice } from "@/components/overleaf-sync-notice";
import { EditorNotice } from "@/components/editor-notice";
import { commitAndPushProjectAction, convertMindmapCardToTodoAction, getMindmapAction, getProjectGitStatusAction, persistPaperTodoAction, removePaperTodoAction, saveMindmapAction, uploadMindmapImageAction } from "@/app/actions";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import {
  cloneMindmap,
  createMindmapSession,
  indexMindmap,
  mapSignature,
  mindmapReducer,
  newNodeId,
  type MindmapSession,
  type MindmapNodePatch,
  type MindmapTreeAction,
} from "@/features/mindmap/mindmap-state";
import { useMindmapWebMcp } from "@/features/mindmap/use-mindmap-webmcp";
import {
  HORIZONTAL_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  VERTICAL_GAP,
  layoutMindmapTree,
  nodeDimensions,
} from "@/lib/mindmap/layout";
import { indentMindmapNode, mindmapMoveTargets, outdentMindmapNode, type MindmapDrop } from "@/lib/mindmap/drop-targets";
import { mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { cn } from "@/lib/utils";
import { MAX_MINDMAP_CAPTION_WORDS, captionWordCount } from "@/lib/mindmap/card-content";
import { artifactHref } from "@/lib/research/artifact-link";
import { captionMindmapImage, detachMindmapImage } from "@/lib/mindmap/image-refs";
import { availableTodoCandidates } from "@/lib/research/map-todo-candidates";
import {
  clampMindmapLabels,
  isPrimaryMindmap,
  MAX_MINDMAP_LABEL_CHARS,
  MAX_MINDMAP_LABELS,
} from "@/lib/research/webmcp-mindmap-contract";
import { remoteSyncResult } from "@/lib/research/project-sync";
import type { RemoteSyncOutcome } from "@/lib/research/operation-result";
import type { ArtifactRef, Mindmap, MindmapNode } from "@/lib/types";
import type { ProjectState } from "@/lib/research/project-state";
import type { MindmapTodoConversionResult } from "@/lib/research/webmcp-mindmap-contract";
import {
  joinMindmapCardContent,
  nodeActivityAt,
  ordinaryMindmapCardContent,
  paperSectionRefs,
  reconcileTodos,
  todoCounts,
  todosFromPaperState,
} from "@/lib/research/todo-map";
import { CardImages, hasImageTransfer, imageFilesFromTransfer } from "./card-images";
import { MindmapCanvas } from "./mindmap-canvas";
import { MindmapChangesView } from "./mindmap-changes";
import { TexCodeMirror, type TexCodeMirrorHandle } from "@/features/paper/tex-codemirror";

const AUTOSAVE_DELAY = 700;
const LAST_WEEK_DAYS = 7;
const COLLAPSE_STORAGE_PREFIX = "openbar:mindmap-collapse:v1";
const CARD_PALETTE = [
  { value: "#ffb000", label: "Amber" },
  { value: "#fe6100", label: "Orange" },
  { value: "#dc267f", label: "Pink" },
  { value: "#785ef0", label: "Violet" },
  { value: "#648fff", label: "Blue" },
] as const;

type RemoteSaveState = "checking" | "local" | "saving" | "saved" | "changed" | "unavailable" | "error";

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };
type MindmapViewMode = "map" | "changes";
type InspectorSectionId = "organization" | "appearance" | "more";
type InlineCardSession = { nodeId: string; commit: () => Promise<boolean> };

const INSPECTOR_SECTION_LABELS: Record<InspectorSectionId, string> = {
  organization: "Organization",
  appearance: "Appearance",
  more: "More actions",
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

const MINDMAP_NODE_FIELDS: ReadonlyArray<keyof MindmapNode> = [
  "id",
  "title",
  "text",
  "caption",
  "todoId",
  "parentId",
  "shape",
  "agentDraft",
  "collapsed",
  "metadata",
  "contentFormat",
  "color",
  "tags",
  "progress",
  "priority",
  "tableLayout",
  "refs",
  "order",
  "createdAt",
  "updatedAt",
];

const MINDMAP_FIELDS: ReadonlyArray<keyof Mindmap> = [
  "projectId",
  "id",
  "title",
  "role",
  "rootId",
  "createdAt",
  "updatedAt",
  "activityWindowDays",
  "fontSize",
];

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function mergeConvertedNode(base: MindmapNode, saved: MindmapNode, latest: MindmapNode): MindmapNode {
  const merged = { ...saved };
  for (const field of MINDMAP_NODE_FIELDS) {
    if (valuesEqual(latest[field], base[field])) continue;
    const value = latest[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value as never;
  }
  // The server conversion binds the card to TeX. Keep that canonical shape
  // even when an ordinary-card edit arrived while the request was in flight.
  if (merged.todoId?.trim()) {
    delete merged.title;
    merged.text = "";
  }
  return merged;
}

/**
 * Apply the server's conversion delta onto edits made while it was in flight.
 * Conversion changes one node's TODO binding. A three-way merge keeps local
 * card edits, additions, moves, and deletions attached to the fresh disk hash.
 */
function mergeMindmapAfterConversion(base: Mindmap, saved: Mindmap, latest: Mindmap): Mindmap {
  const baseById = new Map(base.nodes.map((node) => [node.id, node]));
  const savedById = new Map(saved.nodes.map((node) => [node.id, node]));
  const latestById = new Map(latest.nodes.map((node) => [node.id, node]));
  const baseIds = base.nodes.map((node) => node.id);
  const latestIds = latest.nodes.map((node) => node.id);
  const localStructureChanged = !valuesEqual(baseIds, latestIds);
  const orderedIds = localStructureChanged
    ? latestIds
    : saved.nodes.map((node) => node.id);
  const seen = new Set<string>();
  const nodes: MindmapNode[] = [];

  for (const id of [...orderedIds, ...saved.nodes.map((node) => node.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const baseNode = baseById.get(id);
    const savedNode = savedById.get(id);
    const latestNode = latestById.get(id);

    // A local deletion remains effective after the server adds the binding.
    if (!latestNode && baseNode) continue;
    if (latestNode && baseNode && savedNode) {
      nodes.push(mergeConvertedNode(baseNode, savedNode, latestNode));
    } else if (latestNode && !baseNode) {
      nodes.push({ ...latestNode });
    } else if (savedNode) {
      nodes.push({ ...savedNode });
    }
  }

  const merged: Mindmap = { ...saved, nodes };
  for (const field of MINDMAP_FIELDS) {
    if (valuesEqual(latest[field], base[field])) continue;
    const value = latest[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value as never;
  }
  // These fields identify the persisted server snapshot used by the next CAS
  // save. Local content remains dirty through the saved-signature comparison.
  merged.revision = saved.revision;
  merged.diskHash = saved.diskHash;
  return merged;
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
  const [remoteOutOfSync, setRemoteOutOfSync] = useState(false);
  const [applyingRemote, setApplyingRemote] = useState(false);
  const applyingRemoteRef = useRef(false);
  const remoteOutOfSyncRef = useRef(false);
  remoteOutOfSyncRef.current = remoteOutOfSync || applyingRemoteRef.current;
  const [session, rawDispatch] = useReducer(mindmapReducer, initialMindmap, createMindmapSession);
  const dispatch = useCallback((action: Parameters<typeof mindmapReducer>[1]) => {
    // Preserve navigation, hydration, and text typed before a conflict arrived.
    const allowed = ["select", "clear-selection", "replace", "hydrate", "ack-save", "rebase-disk-hash", "record-history", "edit-card", "edit-text"];
    if (remoteOutOfSyncRef.current && !allowed.includes(action.type)) return;
    rawDispatch(action);
  }, []);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { mindmap, selectedId, selectedIds, past: history, future, revision } = session;
  const persistedDiskHashRef = useRef(mindmapDiskHash(initialMindmap));
  const paperSourceHashRef = useRef<string | undefined>(paperState?.paper?.sourceHash);
  const convertingCardIdRef = useRef<string | null>(null);
  const pendingConversionRefreshRef = useRef<{ cardId: string; todoId: string } | null>(null);
  useEffect(() => {
    paperSourceHashRef.current = paperState?.paper?.sourceHash;
  }, [paperState?.paper?.sourceHash]);
  const [activitySince, setActivitySince] = useState<string | null>(null);
  const collapseMapId = mindmap.id || initialMindmap.id || "draft";
  const collapseStorageKey = `${COLLAPSE_STORAGE_PREFIX}:${encodeURIComponent(project)}:${encodeURIComponent(collapseMapId)}`;
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
        JSON.stringify({ version: 1, collapsedIds: [...next].sort() }),
      );
    } catch {
      // Browser storage can be unavailable in private or restricted sessions.
    }
  }, [collapseStorageKey]);

  useEffect(() => {
    const validIds = new Set(mindmap.nodes.map((node) => node.id));
    const parentIds = new Set(mindmap.nodes.flatMap((node) => node.parentId ? [node.parentId] : []));
    let next = new Set<string>();
    try {
      const raw = window.localStorage.getItem(collapseStorageKey);
      if (raw) {
        const stored = JSON.parse(raw) as { version?: unknown; collapsedIds?: unknown };
        if ((stored.version === undefined || stored.version === 1) && Array.isArray(stored.collapsedIds)) {
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
  }, [collapseNodeSignature, collapseStorageKey]);

  const [remoteSaveState, setRemoteSaveState] = useState<RemoteSaveState>("local");
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [imageUploads, setImageUploads] = useState<Record<string, number>>({});
  const imageUploadQueue = useRef(Promise.resolve());
  const pendingImageUploads = useRef(0);
  const remoteStatusRequestRef = useRef(0);
  const remoteSyncRef = useRef<RemoteSyncOutcome | undefined>(undefined);

  const pushRemote = useCallback(async (message: string) => {
    ++remoteStatusRequestRef.current;
    setCheckingRemote(false);
    setRemoteSaveState("saving");
    remoteSyncRef.current = {
      status: "pending",
      code: "push_in_progress",
      message: "Local save complete. Pushing to Git…",
      retryable: true,
    };
    try {
      const result = await commitAndPushProjectAction(project, message);
      remoteSyncRef.current = remoteSyncResult(result);
      if (!result.ok) {
        if (result.code === "remote_ahead" || result.code === "remote_conflict") setRemoteOutOfSync(true);
        setRemoteSaveState(result.code === "remote_ahead" || result.code === "remote_conflict" ? "changed" : "error");
        setRemoteSaveError(result.message);
      } else {
        setRemoteSaveState("saved");
        setRemoteOutOfSync(false);
        setRemoteSaveError(null);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save to the remote.";
      remoteSyncRef.current = remoteSyncResult({ ok: false, code: "remote_save_failed", message });
      setRemoteSaveState("error");
      setRemoteSaveError(message);
      return { ok: false as const, code: "remote_save_failed", message };
    }
  }, [project]);

  const refreshRemoteStatus = useCallback(async (refreshRemote = true, announce = true) => {
    const requestId = ++remoteStatusRequestRef.current;
    setCheckingRemote(true);
    if (announce) setRemoteSaveState(current => current === "changed" || current === "error" || current === "unavailable" ? current : "checking");
    let timeoutId: number | undefined;
    try {
      const timeout = announce ? new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Remote status check timed out. Retry to refresh synchronization status.")), 5_000);
      }) : null;
      const request = getProjectGitStatusAction(project, refreshRemote);
      const status = timeout ? await Promise.race([request, timeout]) : await request;
      if (requestId !== remoteStatusRequestRef.current) return;
      if (!status.isGitRepo) {
        setRemoteSaveState("unavailable");
        setRemoteSaveError("Git status unavailable: this project has no Git repository.");
        return status;
      }
      if (!status.isOverleafRemote) {
        setRemoteSaveState("unavailable");
        setRemoteSaveError("Git remote unavailable: origin is not git.overleaf.com.");
        return status;
      }
      if (status.error) {
        setRemoteSaveState("unavailable");
        setRemoteSaveError(`Git status unavailable: ${status.error}`);
        return status;
      }
      if ((status.behind || 0) > 0) {
        remoteOutOfSyncRef.current = true;
        setRemoteOutOfSync(true);
        setRemoteSaveState("changed");
        setRemoteSaveError("Git has newer commits. Pull before saving to Git.");
        return status;
      }
      remoteOutOfSyncRef.current = applyingRemoteRef.current;
      setRemoteOutOfSync(false);
      setRemoteSaveError(null);
      setRemoteSaveState((status.ahead || 0) > 0 || !status.isClean ? "local" : "saved");
      return status;
    } catch (error) {
      if (requestId !== remoteStatusRequestRef.current) return;
      setRemoteSaveState("unavailable");
      setRemoteSaveError(`Git status unavailable: ${error instanceof Error ? error.message : "Could not check Git."}`);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (requestId === remoteStatusRequestRef.current) setCheckingRemote(false);
    }
  }, [project]);

  useEffect(() => {
    // Start with cached Git state. Background checks fetch after first paint.
    void refreshRemoteStatus(false, false);
  }, [refreshRemoteStatus]);

  const webMcpSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const webMcpSaveCountRef = useRef(0);
  const persistWebMcpMutation = useCallback(async (
    action: MindmapTreeAction | ((current: MindmapSession) => MindmapTreeAction | null),
    expectedRevision?: number,
  ): Promise<Mindmap> => {
    webMcpSaveCountRef.current += 1;
    const job = webMcpSaveQueueRef.current.then(async () => {
      if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Editing is paused. Review and synchronize Git updates to resume."), { code: "remote_conflict" });
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
      sessionRef.current = nextSession;
      dispatch(nextAction);
      const saved = await saveMindmapAction(project, snapshot, persistedDiskHashRef.current);
      persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
      const savedMapSignature = mapSignature(saved);
      savedSignatureRef.current = savedMapSignature;
      setSavedSignature(savedMapSignature);

      const latest = sessionRef.current;
      if (mapSignature(latest.mindmap) === mapSignature(snapshot)) {
        const acknowledged = mindmapReducer(latest, {
          type: "ack-save",
          diskHash: saved.diskHash,
          persistedRevision: saved.revision,
          updatedAt: saved.updatedAt,
        });
        sessionRef.current = acknowledged;
        dispatch({
          type: "ack-save",
          diskHash: saved.diskHash,
          persistedRevision: saved.revision,
          updatedAt: saved.updatedAt,
        });
      } else {
        const rebased = mindmapReducer(latest, { type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
        sessionRef.current = rebased;
        dispatch({ type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
      }
      await pushRemote("OpenBar: save mindmap");
      return saved;
    });
    webMcpSaveQueueRef.current = job.then(() => undefined, () => undefined).finally(() => {
      webMcpSaveCountRef.current = Math.max(0, webMcpSaveCountRef.current - 1);
    });
    try {
      return await job;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the mindmap.";
      saveErrorRef.current = message;
      setSaveError(message);
      throw error;
    }
  }, [project, pushRemote]);

  useMindmapWebMcp({
    sharedActions: sharedWebMcpActions,
    getSnapshot: () => {
      const current = sessionRef.current.mindmap;
      return {
        project,
        mapId: current.id || "draft",
        title: current.title,
        fontSize: current.fontSize || 12,
        role: current.role,
        isPrimary: isPrimaryMindmap(current),
        revision: sessionRef.current.revision,
        diskHash: persistedDiskHashRef.current,
        remoteSync: remoteSyncRef.current,
        editingBlocked: remoteOutOfSyncRef.current,
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
            agentDraft: node.agentDraft,
            color: node.color,
            refs: node.refs,
            metadata: node.metadata,
            tags: node.tags,
            progress: node.progress,
            priority: node.priority,
            caption: node.caption,
            tableLayout: node.tableLayout,
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
      await persistWebMcpMutation({ type: "add-node", parentId, id, text, title, agentDraft: true }, expectedRevision);
      return id;
    },
    moveNode: async (id, parentId, beforeId, afterId, expectedRevision) => {
      await persistWebMcpMutation({ type: "reparent", id, parentId, beforeId, afterId }, expectedRevision);
    },
    deleteNode: async (id, expectedRevision) => {
      await persistWebMcpMutation({ type: "delete-node-keep-children", id }, expectedRevision);
    },
    deleteBranch: async (id, expectedRevision) => {
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
      if (convertingCardIdRef.current === id) {
        throw Object.assign(
          new Error(`Mindmap card "${id}" is being converted to a paper TODO. Retry after the conversion finishes.`),
          { code: "stale_live_state" },
        );
      }
      const nodePatch: {
        title?: string;
        text?: string;
        tags?: string[];
        refs?: ArtifactRef[];
        metadata?: Record<string, unknown>;
        contentFormat?: MindmapNode["contentFormat"];
        shape?: MindmapNode["shape"];
        color?: string;
        progress?: MindmapNode["progress"];
        priority?: MindmapNode["priority"];
        tableLayout?: MindmapNode["tableLayout"];
      } = {};
      if (patch.title !== undefined) nodePatch.title = patch.title;
      if (patch.text !== undefined) nodePatch.text = patch.text;
      if (patch.labels) nodePatch.tags = patch.labels;
      if (patch.refs) nodePatch.refs = patch.refs;
      if (patch.metadata !== undefined) nodePatch.metadata = patch.metadata || undefined;
      if (Object.prototype.hasOwnProperty.call(patch, "priority")) nodePatch.priority = patch.priority;
      if (patch.presentation?.tableLayout !== undefined) nodePatch.tableLayout = patch.presentation.tableLayout;
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
      await persistWebMcpMutation({ type: "add-node", parentId, id, todoId, agentDraft: true }, expectedRevision);
      return id;
    },
    convertCardToTodo: (id, sectionId, expectedRevision, requestId) => {
      if (convertingCardIdRef.current) {
        const message = "A mindmap card conversion is already in progress. Retry after it finishes.";
        return Promise.resolve({
          ok: false as const,
          code: "stale_live_state",
          message,
          retryable: true,
          local: { paper: "failed" as const, map: "not_attempted" as const, message },
          remote: {
            status: "failed" as const,
            code: "not_attempted",
            message: "Remote sync was not attempted because the local conversion did not complete.",
            retryable: false,
          },
        });
      }
      convertingCardIdRef.current = id;
      setConvertingCardId(id);
      return Promise.resolve(convertCardToTodo(id, sectionId, expectedRevision, requestId)).finally(() => {
        const pending = pendingConversionRefreshRef.current;
        if (convertingCardIdRef.current === id && pending?.cardId !== id) convertingCardIdRef.current = null;
        setConvertingCardId((current) => current === id && pending?.cardId !== id ? null : current);
      });
    },
    completeTodo: async (todoId) => {
      const result = await persistPaperTodoAction(
        project,
        { type: "complete_todo", id: todoId },
        paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
      );
      if (!result.ok) throw new Error(result.message);
      if (result.diskHash) paperSourceHashRef.current = result.diskHash;
      router.refresh();
      await pushRemote("OpenBar: complete paper TODO");
    },
    reopenTodo: async (todoId) => {
      const result = await persistPaperTodoAction(
        project,
        { type: "reopen_todo", id: todoId },
        paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
      );
      if (!result.ok) throw new Error(result.message);
      if (result.diskHash) paperSourceHashRef.current = result.diskHash;
      router.refresh();
      await pushRemote("OpenBar: reopen paper TODO");
    },
    focusTodoInPaper: (todoId) => router.push(`/p/${project}/paper#${encodeURIComponent(todoId)}`),
    setFontSize: async (fontSize, expectedRevision) => {
      await persistWebMcpMutation({ type: "set-font-size", fontSize }, expectedRevision);
    },
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
  const inlineEditorSessionRef = useRef<InlineCardSession | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState(true);
  const [inspectorPresent, setInspectorPresent] = useState(true);
  useEffect(() => {
    if (cardMenuOpen) { setInspectorPresent(true); return; }
    const timeout = window.setTimeout(() => setInspectorPresent(false), 180);
    return () => window.clearTimeout(timeout);
  }, [cardMenuOpen]);
  useEffect(() => { if (window.matchMedia("(max-width: 899px)").matches) setCardMenuOpen(false); }, []);
  const [inspectorSections, setInspectorSections] = useState<Partial<Record<InspectorSectionId, boolean>>>({ organization: true });
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem("openbar:inspector-sections:v1") || "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const sections: Partial<Record<InspectorSectionId, boolean>> = { organization: true };
        for (const id of Object.keys(INSPECTOR_SECTION_LABELS) as InspectorSectionId[]) {
          const value = (saved as Record<string, unknown>)[id];
          if (typeof value === "boolean") sections[id] = value;
        }
        setInspectorSections(sections);
      }
    } catch { /* Browser storage may be unavailable. Keep the current preferences in memory. */ }
  }, []);
  const toggleInspectorSection = (id: InspectorSectionId) => {
    const next = { ...inspectorSections, [id]: !inspectorSections[id] };
    setInspectorSections(next);
    try { window.localStorage.setItem("openbar:inspector-sections:v1", JSON.stringify(next)); }
    catch { /* In-memory section controls remain available. */ }
  };
  const [convertingCardId, setConvertingCardId] = useState<string | null>(null);
  convertingCardIdRef.current = convertingCardId;
  const [todoProgressBusy, setTodoProgressBusy] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  useEffect(() => {
    if (!searchOpen && !moveOpen) return;
    document.getElementById(`mindmap-search-result-${searchIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [searchIndex, searchOpen, moveOpen]);
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number } | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  useEffect(() => {
    if (!moveNotice) return;
    const timer = window.setTimeout(() => setMoveNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [moveNotice]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState(() => mapSignature(initialMindmap));
  const saveErrorRef = useRef<string | null>(null);
  saveErrorRef.current = saveError;
  const savedSignatureRef = useRef(mapSignature(initialMindmap));
  savedSignatureRef.current = savedSignature;
  // Keep the card locked through router.refresh so stale paper props cannot
  // expose a temporary missing-TODO card for editing.
  useEffect(() => {
    const pending = pendingConversionRefreshRef.current;
    if (!pending || !paperState?.paper?.todos.some((todo) => todo.id === pending.todoId)) return;
    pendingConversionRefreshRef.current = null;
    if (convertingCardIdRef.current === pending.cardId) {
      convertingCardIdRef.current = null;
      setConvertingCardId((current) => current === pending.cardId ? null : current);
    }
  }, [mindmap, paperState?.paper?.todos]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<MindmapViewMode>("map");
  const readOnlyStorageKey = `openbar:mindmap-read-only:v1:${encodeURIComponent(project)}:${encodeURIComponent(collapseMapId)}`;
  const [manualReadOnly, setReadOnly] = useState(false);
  const saveConflict = Boolean(saveError && /conflict|changed.*reload|stale/i.test(saveError));
  const readOnly = manualReadOnly || remoteOutOfSync || applyingRemote || saveConflict;
  useEffect(() => {
    try { setReadOnly(window.localStorage.getItem(readOnlyStorageKey) === "true"); }
    catch { setReadOnly(false); }
  }, [readOnlyStorageKey]);
  const toggleReadOnly = () => {
    setReadOnly((current) => {
      const next = !current;
      try { window.localStorage.setItem(readOnlyStorageKey, String(next)); }
      catch { /* The toggle remains active for this browser session. */ }
      return next;
    });
  };
  const [unplacedOpen, setUnplacedOpen] = useState(true);
  const unplacedCount = availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes).length;
  const [labelDraft, setLabelDraft] = useState("");
  const [mapTitleDraft, setMapTitleDraft] = useState(initialMindmap.title || "");
  const mapTitleDirtyRef = useRef(false);
  const saveInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!mapTitleDirtyRef.current) setMapTitleDraft(mindmap.title || "");
  }, [mindmap.title]);

  useEffect(() => {
    setLabelDraft("");
  }, [selectedId]);

  const editBaselineRef = useRef<{ mindmap: Mindmap; nodeId: string } | null>(null);

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

  const [measuredCards, setMeasuredCards] = useState<Map<string, Dimensions>>(() => new Map());
  useEffect(() => { setMeasuredCards(new Map()); }, [mindmap.fontSize]);
  const pendingMeasurements = useRef(new Map<string, Dimensions>());
  const measurementFrame = useRef<number | null>(null);
  const measureCard = useCallback((id: string, size: Dimensions) => {
    // Virtualized cards report zero as they detach. Keep their last real size.
    if (size.width <= 0 || size.height <= 0) return;
    pendingMeasurements.current.set(id, size);
    if (measurementFrame.current !== null) return;
    measurementFrame.current = requestAnimationFrame(() => {
      measurementFrame.current = null;
      const batch = pendingMeasurements.current;
      pendingMeasurements.current = new Map();
      setMeasuredCards(current => {
        let next = current;
        for (const [nodeId, dimensions] of batch) {
          const previous = current.get(nodeId);
          if (previous && Math.abs(previous.width - dimensions.width) < .5 && Math.abs(previous.height - dimensions.height) < .5) continue;
          if (next === current) next = new Map(current);
          next.set(nodeId, dimensions);
        }
        return next;
      });
    });
  }, []);
  useEffect(() => () => { if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current); }, []);
  const layout = useMemo(() => {
    const extraHeight = new Map<string, number>();
    for (const node of mindmap.nodes) {
      let extra = 0;
      if (paperSectionRefs(node).length) extra += 16;
      const coverage = coverageById.get(node.id);
      if (coverage && coverage.total > 0) extra += 22;
      if (extra) extraHeight.set(node.id, extra);
    }
    const next = createCanvasLayout(mindmap, extraHeight, collapsedIds, paperState, measuredCards);
    return next;
  }, [mindmap, coverageById, collapsedIds, paperState?.paper?.todos, measuredCards]);
  const selected = selectedIds.length > 0
    ? layout.nodeById.get(selectedId) || layout.nodeById.get(mindmap.rootId)
    : undefined;
  const selectedCards = selectedIds.flatMap((id) => {
    const node = layout.nodeById.get(id);
    return node ? [node] : [];
  });
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const currentSignature = useMemo(() => mapSignature(mindmap), [mindmap]);
  const dirty = currentSignature !== savedSignature;
  useEffect(() => {
    if (dirty && remoteSaveState === "saved") setRemoteSaveState("local");
  }, [dirty, remoteSaveState]);
  const descendantCounts = useMemo(() => countMindmapDescendants(mindmap), [mindmap]);
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

  async function convertCardToTodo(
    id: string,
    sectionId?: string,
    expectedRevision?: number,
    requestId?: string,
  ): Promise<MindmapTodoConversionResult> {
    const current = sessionRef.current;
    const node = indexMindmap(current.mindmap).nodeById.get(id);
    const requestMindmap = cloneMindmap(current.mindmap);
    const expectedMapDiskHash = persistedDiskHashRef.current;
    const expectedPaperSourceHash = paperSourceHashRef.current ?? paperState?.paper?.sourceHash;
    const remoteNotAttempted = {
      status: "failed" as const,
      code: "not_attempted",
      message: "Remote sync was not attempted because the local conversion did not complete.",
      retryable: false,
    };
    const localNotAttempted = {
      paper: "failed" as const,
      map: "not_attempted" as const,
      message: "The card could not be converted locally.",
    };
    if (!node) {
      return {
        ok: false,
        code: "unknown_card",
        message: `Unknown mindmap card "${id}".`,
        retryable: false,
        local: localNotAttempted,
        remote: remoteNotAttempted,
      };
    }
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      return {
        ok: false,
        code: "stale_live_state",
        message: `Live mindmap revision is ${current.revision}, not ${String(expectedRevision)}.`,
        retryable: true,
        local: localNotAttempted,
        remote: remoteNotAttempted,
      };
    }
    const result = await convertMindmapCardToTodoAction(
      project,
      requestMindmap,
      id,
      sectionId,
      expectedMapDiskHash,
      expectedPaperSourceHash,
      requestId || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `convert-${Date.now()}`),
    );
    if (!result.ok) {
      setSaveError(result.message);
      return result;
    }
    const saved = result.value.mindmap;
    persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
    if (result.value.sourceHash) paperSourceHashRef.current = result.value.sourceHash;
    pendingConversionRefreshRef.current = { cardId: id, todoId: result.value.todoId };
    const latest = sessionRef.current;
    if (mapSignature(latest.mindmap) === mapSignature(requestMindmap)) {
      const hydrated = mindmapReducer(latest, { type: "hydrate", mindmap: saved });
      sessionRef.current = hydrated;
      dispatch({ type: "hydrate", mindmap: saved });
    } else {
      const merged = mergeMindmapAfterConversion(requestMindmap, saved, latest.mindmap);
      const rebased = mindmapReducer(latest, { type: "revert", mindmap: merged });
      sessionRef.current = rebased;
      dispatch({ type: "revert", mindmap: merged });
    }
    const savedMapSignature = mapSignature(saved);
    savedSignatureRef.current = savedMapSignature;
    setSavedSignature(savedMapSignature);
    setSaveError(result.value.remote.status === "pushed" ? null : `Saved locally. ${result.value.remote.message}`);
    if (result.value.remote.status === "pushed") {
      setRemoteSaveState("saved");
      setRemoteSaveError(null);
    } else {
      setRemoteSaveState(result.value.remote.status === "pending" ? "local" : "error");
      setRemoteSaveError(result.value.remote.message);
    }
    router.refresh();
    return result;
  }

  async function makeSelectedCardTodo() {
    const selectedCard = selected;
    if (!selectedCard || selectedCard.todoId || convertingCardIdRef.current) return;
    const id = selectedCard.id;
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
    convertingCardIdRef.current = id;
    setConvertingCardId(id);
    saveErrorRef.current = null;
    setSaveError(null);
    try {
      // Persist the latest ordinary-card content before the TeX transaction
      // reads the card. This keeps conversion content and the visible card in
      // agreement while unrelated map edits remain mergeable.
      await flushPendingSaves();
      const result = await convertCardToTodo(id);
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not make this card a paper TODO.");
    } finally {
      // The ref may be populated by the refresh effect while the conversion
      // request is suspended. Keep the post-await read widened for TypeScript.
      const pending = pendingConversionRefreshRef.current as { cardId: string; todoId: string } | null;
      if (convertingCardIdRef.current === id && pending?.cardId !== id) convertingCardIdRef.current = null;
      setConvertingCardId((current) => current === id && pending?.cardId !== id ? null : current);
    }
  }

  async function setSelectedTodoCompleted(
    completed: boolean,
    preservedProgress?: NonNullable<MindmapNode["progress"]> | null,
    expectedMapProgress = selected?.progress,
  ): Promise<boolean> {
    const selectedNode = selected;
    const todoId = selectedNode?.todoId;
    if (!selectedNode || !todoId || !selectedTodo || selectedMissing || todoProgressBusy) return false;
    const nodeId = selectedNode.id;
    const expectedPaperSourceHash = paperSourceHashRef.current ?? paperState?.paper?.sourceHash;
    setTodoProgressBusy(true);
    setSaveError(null);
    try {
      const result = await persistPaperTodoAction(
        project,
        { type: completed ? "complete_todo" : "reopen_todo", id: todoId },
        expectedPaperSourceHash,
      );
      if (!result.ok) {
        setSaveError(result.message);
        return false;
      }
      if (result.diskHash) paperSourceHashRef.current = result.diskHash;
      const currentNode = indexMindmap(sessionRef.current.mindmap).nodeById.get(nodeId);
      if (
        preservedProgress !== undefined
        && currentNode
        && currentNode.progress === expectedMapProgress
        && currentNode.progress !== (preservedProgress ?? undefined)
      ) {
        dispatch({ type: "patch-node", id: nodeId, patch: { progress: preservedProgress ?? undefined } });
      }
      // The local TeX mutation is durable even when Git sync fails. The
      // refresh projects local paper state into the card and paper views.
      router.refresh();
      await pushRemote(`OpenBar: ${completed ? "complete" : "reopen"} paper TODO`);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not update the paper TODO.");
      return false;
    } finally {
      setTodoProgressBusy(false);
    }
  }

  const [progressNotice, setProgressNotice] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!progressNotice) return;
    const timer = window.setTimeout(() => setProgressNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [progressNotice]);

  async function updateSelectedProgress(progress: MindmapNode["progress"]) {
    if (!selected) return;
    setProgressNotice(null);
    if (selected.todoId && !selectedMissing && progress === 6) {
      if (await setSelectedTodoCompleted(true, selected.progress, selected.progress)) setProgressNotice({ id: selected.id, text: "Completed in paper" });
      return;
    }
    if (selected.todoId && !selectedMissing && selectedTodo?.completed) {
      if (await setSelectedTodoCompleted(false, progress ?? null, selected.progress) && progress === undefined) setProgressNotice({ id: selected.id, text: "Reopened in paper" });
      return;
    }
    setSaveError(null);
    dispatch({ type: "patch-node", id: selected.id, patch: { progress } });
    if (progress === undefined || progress === 6) setProgressNotice({ id: selected.id, text: progress === undefined ? "Progress cleared" : "Progress complete" });
  }

  function beginTextTransaction(nodeId = sessionRef.current.selectedId) {
    if (!editBaselineRef.current) editBaselineRef.current = { mindmap: cloneMindmap(sessionRef.current.mindmap), nodeId };
  }

  function finishTextTransaction(commitChanges = true) {
    const before = editBaselineRef.current;
    editBaselineRef.current = null;
    setEditingId(null);
    if (!before) return;
    if (!commitChanges) {
      const baselineNode = indexMindmap(before.mindmap).nodeById.get(before.nodeId);
      const currentNode = indexMindmap(sessionRef.current.mindmap).nodeById.get(before.nodeId);
      // Cancel only this card's active fields. Other cards may have changed
      // while the editor was open and must remain in the live map.
      if (baselineNode && currentNode && !currentNode.todoId) {
        dispatch({ type: "edit-card", id: before.nodeId, title: baselineNode.title || "", text: baselineNode.text });
      }
      return;
    }
    dispatch({ type: "record-history", before: before.mindmap });
    setFocusRequest((current) => ({ id: before.nodeId, sequence: (current?.sequence || 0) + 1 }));
  }

  async function startEditing(id: string) {
    if (readOnly) return;
    if (convertingCardIdRef.current === id) return;
    if (inlineEditorSessionRef.current?.nodeId === id) return;
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node) return;
    if (editBaselineRef.current && editBaselineRef.current.nodeId !== id) finishTextTransaction(true);
    dispatch({ type: "select", id });
    beginTextTransaction(id);
    setViewMode("map");
    setFocusRequest((current) => ({ id, sequence: (current?.sequence || 0) + 1 }));
    setEditingId(id);
  }

  function selectCard(id: string, additive = false) {
    setMapSettingsOpen(false);
    if (additive) setCardMenuOpen(true);
    dispatch({ type: "select", id, additive });
    const node = sessionRef.current.mindmap.nodes.find(card => card.id === id);
    if (!additive && !readOnly && node && !node.todoId && !editableCardText(node).trim()) void startEditing(id);
  }

  function indentSelected() {
    const id = sessionRef.current.selectedId;
    const payload = indentMindmapNode(sessionRef.current.mindmap, id);
    if (!payload) return;
    setSaveError(null);
    dispatch({ type: "reparent", id, parentId: payload.parentId });
  }

  function outdentSelected() {
    const id = sessionRef.current.selectedId;
    const payload = outdentMindmapNode(sessionRef.current.mindmap, id);
    if (!payload) return;
    setSaveError(null);
    dispatch({ type: "reparent", id, parentId: payload.parentId, afterId: payload.afterId });
  }

  function moveSelectedTo(parentId: string) {
    const id = sessionRef.current.selectedId;
    if (id === parentId) return;
    setSaveError(null);
    dispatch({ type: "reparent", id, parentId });
    setLocalCollapsed(parentId, false);
    setFocusRequest((current) => ({ id, sequence: (current?.sequence || 0) + 1 }));
    setMoveOpen(false);
    setMoveQuery("");
  }

  function updateNodeText(id: string, text: string, contentFormat?: MindmapNode["contentFormat"]) {
    if (convertingCardIdRef.current === id) return;
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node || node.todoId) return;
    const parts = contentFormat === "markdown" && startsWithMarkdownTable(text) ? { title: "", body: text.trimStart() } : splitCardText(text);
    setSaveError(null);
    const action: MindmapTreeAction = { type: "edit-card", id, title: parts.title, text: parts.body, contentFormat };
    sessionRef.current = mindmapReducer(sessionRef.current, action);
    dispatch(action);
  }

  async function saveAgentDraft(id: string) {
    if (readOnly) return;
    if (inlineEditorSessionRef.current?.nodeId === id && !await inlineEditorSessionRef.current.commit()) return;
    try {
      await persistWebMcpMutation({ type: "patch-node", id, patch: { agentDraft: undefined } });
    } catch (error) {
      const restore: MindmapTreeAction = { type: "patch-node", id, patch: { agentDraft: true } };
      sessionRef.current = mindmapReducer(sessionRef.current, restore);
      dispatch(restore);
      setSaveError(error instanceof Error ? error.message : "Could not save the card.");
    }
  }

  function addChild(parentId?: string) {
    if (readOnly) return;
    const current = sessionRef.current.mindmap;
    const currentIndex = indexMindmap(current);
    const currentSelected = currentIndex.nodeById.get(sessionRef.current.selectedId);
    const nextParentId = parentId || currentSelected?.id || current.rootId;
    const parent = currentIndex.nodeById.get(nextParentId);
    if (!parent) return;
    if (collapsedIdsRef.current.has(parent.id)) setLocalCollapsed(parent.id, false);
    const id = newNodeId();
    setSaveError(null);
    dispatch({ type: "add-node", parentId: nextParentId, id, title: "" });
    setFocusRequest((current) => ({ id, sequence: (current?.sequence || 0) + 1 }));
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
    dispatch({ type: "delete-node-keep-children", id: node.id });
  }

  function deleteSelectedBranch() {
    const current = sessionRef.current.mindmap;
    const node = indexMindmap(current).nodeById.get(selected?.id || "");
    if (!node || node.id === current.rootId) return;
    const descendants = descendantCounts.get(node.id) || 0;
    const label = node.title?.trim() || firstLine(node.text) || node.id;
    if (!window.confirm(`Delete "${label}" and its ${descendants} descendant card${descendants === 1 ? "" : "s"}? This removes the whole branch.`)) return;
    setSaveError(null);
    dispatch({ type: "delete-subtree", id: node.id });
  }

  function placeUnplacedTodo(todoId: string, parentId = selected?.id || mindmap.rootId) {
    if (readOnly) return;
    const existing = sessionRef.current.mindmap.nodes.find((node) => node.todoId === todoId);
    if (existing) {
      dispatch({ type: "select", id: existing.id });
      return;
    }
    if (!indexMindmap(sessionRef.current.mindmap).nodeById.has(parentId)) return;
    const id = newNodeId();
    setSaveError(null);
    dispatch({ type: "add-node", parentId, id, todoId });
    setLocalCollapsed(parentId, false);
    setMoveNotice("Paper TODO added to this map");
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

  function moveNodeById(id: string, direction: -1 | 1) {
    const current = sessionRef.current.mindmap;
    const node = indexMindmap(current).nodeById.get(id);
    if (!node?.parentId) return;
    const siblings = indexMindmap(current).childrenByParent.get(node.parentId) || [];
    const index = siblings.findIndex((item) => item.id === id);
    const neighbor = siblings[index + direction];
    if (!neighbor) return;
    setSaveError(null);
    dispatch({
      type: "reparent",
      id,
      parentId: node.parentId,
      ...(direction < 0 ? { beforeId: neighbor.id } : { afterId: neighbor.id }),
    });
  }

  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const save = useCallback((): Promise<void> | undefined => {
    if (webMcpSaveCountRef.current > 0) return webMcpSaveQueueRef.current;
    if (isPending) return saveInFlightRef.current || Promise.resolve();
    const snapshot = cloneMindmap(sessionRef.current.mindmap);
    const signature = mapSignature(snapshot);
    saveErrorRef.current = null;
    setSaveError(null);
    const job = (async () => {
      try {
        const saved = await saveMindmapAction(project, snapshot, persistedDiskHashRef.current);
        persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
        const savedMapSignature = mapSignature(saved);
        savedSignatureRef.current = savedMapSignature;
        setSavedSignature(savedMapSignature);
        const current = sessionRef.current;
        if (mapSignature(current.mindmap) === signature) {
          const acknowledged = mindmapReducer(current, {
            type: "ack-save",
            diskHash: saved.diskHash,
            persistedRevision: saved.revision,
            updatedAt: saved.updatedAt,
          });
          sessionRef.current = acknowledged;
          dispatch({
            type: "ack-save",
            diskHash: saved.diskHash,
            persistedRevision: saved.revision,
            updatedAt: saved.updatedAt,
          });
        } else {
          // Keep edits made while the request was in flight and carry forward
          // the server's fresh CAS hash for the next save.
          const rebased = mindmapReducer(current, { type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
          sessionRef.current = rebased;
          dispatch({ type: "rebase-disk-hash", diskHash: persistedDiskHashRef.current });
        }
        await pushRemote("OpenBar: save mindmap");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save the mindmap.";
        saveErrorRef.current = message;
        setSaveError(message);
      }
    })();
    saveInFlightRef.current = job;
    void job.finally(() => {
      if (saveInFlightRef.current === job) saveInFlightRef.current = null;
    });
    startTransition(async () => {
      await job;
    });
    return job;
  }, [isPending, project, pushRemote]);

  const flushPendingSaves = useCallback(async () => {
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) {
      throw new Error("Finish saving the open card before leaving this map.");
    }
    await imageUploadQueue.current;
    if (webMcpSaveCountRef.current > 0) await webMcpSaveQueueRef.current;
    if (saveInFlightRef.current) await saveInFlightRef.current;
    const latestDirty = mapSignature(sessionRef.current.mindmap) !== savedSignatureRef.current;
    if (latestDirty && !saveErrorRef.current && webMcpSaveCountRef.current === 0) {
      await save();
    }
    if (saveErrorRef.current) throw new Error(saveErrorRef.current);
  }, [dirty, save, saveError]);

  useEffect(() => {
    const browserWindow = window as Window & { __openbarFlushMindmap?: () => Promise<void> };
    browserWindow.__openbarFlushMindmap = flushPendingSaves;
    return () => {
      if (browserWindow.__openbarFlushMindmap === flushPendingSaves) delete browserWindow.__openbarFlushMindmap;
    };
  }, [flushPendingSaves]);

  // Persist edits shortly after the user pauses.
  useEffect(() => {
    if (!dirty || isPending || saveError) return;
    const timer = window.setTimeout(() => save(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [dirty, isPending, mindmap, save, saveError]);

  const navigationPendingRef = useRef(false);
  useEffect(() => {
    const onNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href || navigationPendingRef.current) return;
      if (!pendingImageUploads.current && !inlineEditorSessionRef.current && !saveInFlightRef.current && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current) return;
      event.preventDefault();
      navigationPendingRef.current = true;
      void flushPendingSaves().then(() => router.push(`${url.pathname}${url.search}${url.hash}`))
        .catch((error) => setSaveError(error instanceof Error ? error.message : "Finish saving before leaving the map."))
        .finally(() => { navigationPendingRef.current = false; });
    };
    window.addEventListener("click", onNavigate, true);
    return () => window.removeEventListener("click", onNavigate, true);
  }, [flushPendingSaves, router]);

  const hydrateSavedMap = useCallback((saved: Mindmap) => {
    persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
    sessionRef.current = mindmapReducer(sessionRef.current, { type: "hydrate", mindmap: saved });
    dispatch({ type: "hydrate", mindmap: saved });
    savedSignatureRef.current = mapSignature(saved);
    setSavedSignature(savedSignatureRef.current);
    setSaveError(null);
  }, []);

  const canAutoPull = () => !isPending && !saveInFlightRef.current && !saveErrorRef.current
    && !inlineEditorSessionRef.current && !editingId && !pendingImageUploads.current
    && webMcpSaveCountRef.current === 0 && !convertingCardIdRef.current
    && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]");
  useGitAutoSync({
    project,
    isBusy: () => checkingRemote || remoteSaveState === "saving" || isPending,
    canPull: canAutoPull,
    check: () => refreshRemoteStatus(true, false),
    onApplying: (applying) => {
      applyingRemoteRef.current = applying;
      if (applying) remoteOutOfSyncRef.current = true;
      setApplyingRemote(applying);
    },
    onApplied: async () => {
      const saved = await getMindmapAction(project, sessionRef.current.mindmap.id || "draft");
      if (!canAutoPull()) throw new Error("Git updates arrived while this editor changed. Save your draft and reload the latest map.");
      if (saved) hydrateSavedMap(saved);
      else router.push(`/p/${project}/mindmap`);
      await refreshRemoteStatus(false, false);
      router.refresh();
    },
    onError: (message) => { setRemoteSaveState("error"); setRemoteSaveError(message); },
  });

  const reloadSavedMap = useCallback(() => {
    if (isPending) return;
    if (!window.confirm("Load the newer saved map? Local unsaved edits will be replaced.")) return;
    startTransition(async () => {
      try {
        const mapId = sessionRef.current.mindmap.id || initialMindmap.id || "draft";
        const saved = await getMindmapAction(project, mapId);
        if (!saved) throw new Error("The saved mindmap is unavailable.");
        hydrateSavedMap(saved);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not reload the saved mindmap.");
      }
    });
  }, [initialMindmap.id, isPending, project, hydrateSavedMap]);

  // Global key navigation and canvas shortcuts
  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "/") {
        event.preventDefault();
        setMoveOpen(false);
        setMoveQuery("");
        setSearchIndex(0);
        setSearchOpen(true);
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
      }
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", onGlobalKeyDown);
    };
  }, [dirty, isPending, redo, save, undo]);

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

  function onNodeDoubleClick(id: string) {
    if (readOnly) return;
    startEditing(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.closest(".cm-editor")) return;
    const key = event.key.toLowerCase();
    if (event.key === "Escape" && cardMenuOpen) {
      event.preventDefault();
      setCardMenuOpen(false);
      return;
    }
    if (target.closest("#mindmap-card-menu, button, a, input, textarea, select, .cm-editor")) return;
    if (readOnly && (event.key === "Tab" || event.key === "Enter" || event.key === "Backspace" || event.key === "Delete" || key === "e" || event.altKey)) return;

    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) outdentSelected();
      else addChild();
    } else if (event.key === "Enter") {
      event.preventDefault();
      addSibling();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      deleteSelected();
    } else if (key === "e") {
      event.preventDefault();
      if (selected) startEditing(selected.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (event.altKey) outdentSelected(); else selectDirection("parent");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (event.altKey) indentSelected(); else selectDirection("child");
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

  const selectedTodo = selected ? paperTodoFor(selected, paperState) : undefined;
  const selectedMissing = Boolean(selected?.todoId && !selectedTodo);
  const selectedRefs = selected?.refs || [];
  const paperSourceHash = paperSourceHashRef.current ?? paperState?.paper?.sourceHash;
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
  function updateCardImages(id: string, update: (refs: ArtifactRef[]) => ArtifactRef[]) {
    if (readOnly) return;
    const current = sessionRef.current.mindmap.nodes.find(node => node.id === id);
    if (!current) return;
    const refs = update(current.refs || []);
    dispatch({ type: "patch-node", id, patch: { refs } });
    if (refs.length < (current.refs || []).length) setMoveNotice("Image removed from card");
  }

  function addImagesToCard(files: File[], nodeId: string) {
    if (readOnly || !files.length) return;
    setAssetError(null);
    pendingImageUploads.current += files.length;
    setImageUploads(current => ({ ...current, [nodeId]: (current[nodeId] || 0) + files.length }));
    imageUploadQueue.current = imageUploadQueue.current.then(async () => {
      const uploaded: ArtifactRef[] = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          if (file.size > 8 * 1024 * 1024) throw new Error("Images are limited to 8 MB each.");
          const formData = new FormData();
          formData.set("file", file);
          const upload = await uploadMindmapImageAction(project, formData);
          uploaded.push(upload.ref);
        } catch (error) {
          errors.push(file.name + ": " + (error instanceof Error ? error.message : "Upload failed."));
        } finally {
          setImageUploads(current => ({ ...current, [nodeId]: Math.max(0, (current[nodeId] || 0) - 1) }));
        }
      }
      const current = sessionRef.current.mindmap.nodes.find(node => node.id === nodeId);
      if (current && uploaded.length) {
        const childCount = uploaded.length - (current.refs?.some(ref => ref.kind === "figure") ? 0 : 1);
        dispatch({ type: "paste-images", id: nodeId, images: uploaded.map(ref => ({ ref, childId: newNodeId() })) });
        if (childCount > 0) setLocalCollapsed(nodeId, false);
        setMoveNotice(childCount > 0 ? childCount + " image child card" + (childCount === 1 ? "" : "s") + " added" : "Image attached to card");
        // Let React publish the latest refs before the next queued batch attaches.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (errors.length) setAssetError(errors.join(" "));
    }).finally(() => { pendingImageUploads.current -= files.length; });
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

  const flowNodes = useMemo(() => (
    layout.nodes.flatMap((node) => {
      const position = layout.positions.get(node.id);
      const dimensions = layout.dimensions.get(node.id);
      if (!position || !dimensions) return [];
      return [{
        id: node.id,
        x: position.x,
        y: position.y,
        width: dimensions.width,
        height: dimensions.height,
        selected: selectedIdSet.has(node.id),
        renderVersion: `${editingId || ""}:${mindmap.fontSize || 12}`,
      }];
    })
  ), [editingId, layout, selectedIdSet, mindmap.fontSize]);

  const renderCard = useCallback((id: string) => {
    const node = layout.nodeById.get(id);
    const dimensions = layout.dimensions.get(id);
    if (!node || !dimensions) return null;
    return (
      <CanvasNode
        project={project}
        fontSize={mindmap.fontSize || 12}
        readOnly={readOnly}
        uploading={imageUploads[node.id] || 0}
        onImageChange={update => updateCardImages(node.id, update)}
        onImageFiles={files => addImagesToCard(files, node.id)}
        node={node}
        cardContent={cardContentForNodeWithPaperState(node, paperState)}
        completed={Boolean(paperTodoFor(node, paperState)?.completed)}
        missing={Boolean(node.todoId && !paperTodoFor(node, paperState))}
        collapsed={collapsedIds.has(node.id)}
        collapsedDescendantCount={descendantCounts.get(node.id) || 0}
        coverage={coverageById.get(node.id)}
        activityLabel={activityNodeIds.has(node.id) ? relativeActivityLabel(nodeActivityAt(node, reconciliation)) : null}
        dimensions={dimensions}
        onMeasure={measureCard}
        orphan={!layout.reachable.has(node.id)}
        selected={selectedIdSet.has(node.id)}
        active={activityNodeIds.has(node.id)}
        editing={node.id === editingId}
        editSessionRef={inlineEditorSessionRef}
        dropPreviewKind={dropPreview?.targetId === node.id ? dropPreview.kind : null}
        dropPreviewLabel={dropPreview?.targetId === node.id ? dropPreviewLabel(dropPreview, layout.nodeById) : undefined}
        onToggleCollapse={() => toggleCollapse(node.id)}
        onDropTodo={(todoId) => placeUnplacedTodo(todoId, node.id)}
        onTextChange={(text, contentFormat) => updateNodeText(node.id, text, contentFormat)}
        onSaveDraft={() => saveAgentDraft(node.id)}
        onDeleteDraft={() => dispatch({ type: "delete-node-keep-children", id: node.id })}
        onTextFocus={() => beginTextTransaction(node.id)}
        onCommit={() => finishTextTransaction(true)}
        onCancel={() => finishTextTransaction(false)}
        onTodoCommit={async (todoTitle, todoText) => {
          if (convertingCardIdRef.current === node.id) return false;
          if (!node.todoId) return true;
          try {
            const result = await persistPaperTodoAction(
              project,
              {
                type: "update_todo",
                id: node.todoId,
                title: todoTitle,
                text: todoText,
                textFormat: "tex",
                expectedSourceHash: paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
              },
              paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
            );
            if (!result.ok) {
              setSaveError(result.message);
              return false;
            }
            if (result.diskHash) paperSourceHashRef.current = result.diskHash;
            // The local TeX write is the commit point for the card. A remote
            // failure is surfaced by the sync status but must not discard the
            // successfully saved editor draft.
            router.refresh();
            void pushRemote("OpenBar: edit paper TODO");
            return true;
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Could not save the paper TODO.");
            return false;
          }
        }}
      />
    );
  }, [
    mindmap.fontSize,
    activityNodeIds,
    imageUploads,
    collapsedIds,
    coverageById,
    descendantCounts,
    dropPreview,
    editingId,
    layout,
    paperState,
    project,
    reconciliation,
    pushRemote,
    router,
    selected?.id,
    selectedIdSet,
    readOnly,
    toggleCollapse,
    measureCard,
  ]);

  const moveTargets = useMemo(() => {
    if (!selected) return [];
    const all = mindmapMoveTargets(mindmap, selected.id);
    const needle = moveQuery.trim().toLowerCase();
    return needle ? all.filter((item) => item.label.toLowerCase().includes(needle)) : all;
  }, [mindmap, moveQuery, selected]);

  const searchResults = moveOpen ? moveTargets : mindmap.nodes
    .filter((node) => {
      const content = cardContentForNodeWithPaperState(node, paperState);
      return `${content.title} ${content.body} ${(node.tags || []).join(" ")}`.toLocaleLowerCase().includes(moveQuery.trim().toLocaleLowerCase());
    })
    .map((node) => ({ id: node.id, label: cardContentForNodeWithPaperState(node, paperState).title || "Untitled card", depth: 0 }));
  const visibleSearchResults = searchResults.slice(0, 60);
  const chooseSearchResult = (id: string) => {
    if (moveOpen) moveSelectedTo(id);
    else {
      let parent = layout.nodeById.get(id)?.parentId;
      const visited = new Set<string>();
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        setLocalCollapsed(parent, false);
        parent = layout.nodeById.get(parent)?.parentId;
      }
      selectCard(id);
      setViewMode("map");
      setFocusRequest((current) => ({ id, sequence: (current?.sequence || 0) + 1 }));
    }
    setSearchOpen(false);
    setMoveOpen(false);
    setMoveQuery("");
  };

  return (
    <section
      className={styles.editor}
      data-mindmap-editor
      onPasteCapture={(event) => {
        const files = imageFilesFromTransfer(event.clipboardData);
        const targetId = (event.target as HTMLElement).closest("[data-mind-node]")?.getAttribute("data-mind-node") || selected?.id;
        if (!files.length || !targetId || readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        addImagesToCard(files, targetId);
      }}
      onKeyDown={onKeyDown}
    >
      <header className={styles.toolbar} aria-label="Mindmap controls">
        <div className={styles.canvasTools}>
          {viewMode === "changes" && <button type="button" onClick={() => setViewMode("map")}>Back to map</button>}
          <button type="button" aria-expanded={unplacedOpen} onClick={() => { setUnplacedOpen((open) => !open); setViewMode("map"); }}>Unplaced TODOs <span>{unplacedCount}</span></button>
        </div>
        <div className={styles.toolbarActions}>
          <Popover.Root open={searchOpen || moveOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setMoveOpen(false); }}>
            <Popover.Trigger asChild>
              <button type="button" className={styles.searchTrigger} aria-label="Find a card" onClick={() => { setMoveQuery(""); setSearchIndex(0); }}>
                <Search size={15} /><span>Find a card</span><kbd>/</kbd>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className={styles.searchPanel} sideOffset={10} align="end" collisionPadding={12} aria-label={moveOpen ? "Move card" : "Find a card"}>
                <div className={styles.searchField}>
                  <Search size={17} />
                  <input autoFocus value={moveQuery} placeholder={moveOpen ? "Move under…" : "Search titles, text, and labels…"} aria-label={moveOpen ? "Search move destination" : "Search cards"} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="mindmap-search-results" aria-activedescendant={visibleSearchResults[searchIndex] ? `mindmap-search-result-${searchIndex}` : undefined}
                    onChange={(event) => { setMoveQuery(event.target.value); setSearchIndex(0); }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setSearchIndex((index) => Math.max(0, Math.min(visibleSearchResults.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                      }
                      if (event.key === "Enter" && visibleSearchResults[searchIndex]) { event.preventDefault(); chooseSearchResult(visibleSearchResults[searchIndex].id); }
                    }} />
                </div>
                <div id="mindmap-search-results" role="listbox" aria-label="Cards" className={styles.searchResults}>
                  {visibleSearchResults.map((result, index) => <button key={result.id} id={`mindmap-search-result-${index}`} type="button" role="option" aria-selected={index === searchIndex} onMouseEnter={() => setSearchIndex(index)} onClick={() => chooseSearchResult(result.id)}><span>{result.label}</span><span>↵</span></button>)}
                  {visibleSearchResults.length === 0 && <p>No matching cards.</p>}
                </div>
                <div className={styles.searchFooter}>{searchResults.length} cards · ↑ ↓ to choose · Enter to {moveOpen ? "move" : "jump"}</div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button type="button" className={styles.primaryButton} disabled={readOnly} onClick={() => addChild()} title="Add a child to the selected card (Tab)"><Plus size={16} /><span>Add card</span></button>
          <button type="button" className={styles.iconButton} disabled={selectedCards.length === 0} aria-label="Open selected card actions" aria-expanded={cardMenuOpen && selectedCards.length > 0} aria-controls="mindmap-card-menu" onClick={() => setCardMenuOpen((open) => !open)} title="Card inspector"><PanelRight size={17} /></button>
          <Popover.Root open={mapSettingsOpen} onOpenChange={setMapSettingsOpen}>
            <Popover.Trigger asChild><button type="button" className={styles.iconButton} aria-label="Open map settings" title="Map options"><MoreHorizontal size={18} /></button></Popover.Trigger>
            <Popover.Portal><Popover.Content id="mindmap-map-settings" className={styles.optionsPanel} sideOffset={10} align="end" collisionPadding={12} aria-label="Map options">
                  <label className="mindmap-field">
                    <span>Map title</span>
                    <input
                      value={mapTitleDraft}
                      disabled={readOnly}
                      onChange={(event) => {
                        mapTitleDirtyRef.current = true;
                        setMapTitleDraft(event.target.value);
                      }}
                      onBlur={() => {
                        const title = mapTitleDraft.trim();
                        if (title && title !== (mindmap.title || "")) {
                          setSaveError(null);
                          dispatch({ type: "rename-map", title });
                        } else {
                          setMapTitleDraft(mindmap.title || "");
                        }
                        mapTitleDirtyRef.current = false;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        if (event.key === "Escape") setMapSettingsOpen(false);
                      }}
                      placeholder="Map title"
                      aria-label="Mindmap title"
                    />
                  </label>
              <label className={`mindmap-field ${styles.fontSizeField}`}>
                <span>Font size <output>{mindmap.fontSize || 12} px</output></span>
                <input type="range" min={10} max={20} step={1} value={mindmap.fontSize || 12} disabled={readOnly} aria-label="Card font size" onChange={event => dispatch({ type: "set-font-size", fontSize: Number(event.target.value) })} />
              </label>
              <button type="button" className={styles.optionRow} onClick={() => { setViewMode("changes"); setMapSettingsOpen(false); }}><GitBranch size={15} />Change history</button>
              <button type="button" className={styles.optionRow} aria-pressed={readOnly} disabled={remoteOutOfSync} onClick={toggleReadOnly}><LockKeyhole size={15} />Read-only mode{readOnly && <Check size={14} />}</button>
              <button type="button" className={styles.optionRow} aria-pressed={Boolean(activitySince)} onClick={() => setActivitySince((current) => current ? null : daysAgoDate(LAST_WEEK_DAYS))}><CalendarDays size={15} />Highlight recent activity{activitySince && <Check size={14} />}</button>
              <button type="button" className={styles.optionRow} aria-expanded={showShortcuts} onClick={() => setShowShortcuts((open) => !open)}><Keyboard size={15} />Keyboard shortcuts</button>
              {showShortcuts && <dl className={styles.shortcutList}>
                <div><dt>Pan canvas</dt><dd>Drag background</dd></div><div><dt>Nest card</dt><dd>Drop on card</dd></div><div><dt>Reorder card</dt><dd>Drop on edge</dd></div><div><dt>Add child</dt><dd>Tab</dd></div><div><dt>Add sibling</dt><dd>Enter</dd></div><div><dt>Edit card</dt><dd>E / double-click</dd></div><div><dt>Reorder</dt><dd>Alt + ↑ / ↓</dd></div><div><dt>Indent / outdent</dt><dd>Alt + → / ←</dd></div><div><dt>Find card</dt><dd>/</dd></div><div><dt>Undo</dt><dd>⌘ / Ctrl + Z</dd></div>
              </dl>}
            </Popover.Content></Popover.Portal>
          </Popover.Root>
        </div>
      </header>
      <div className="mindmap-workspace">

        <div
          className="mindmap-viewport"
          tabIndex={0}
          role="application"
          aria-label={`Mindmap ${viewMode} view. Tab adds a child. Enter adds a sibling. E edits the selected card.`}
        >
          {viewMode === "map" ? (<div className={styles.canvasLayout}>
          {unplacedOpen && unplacedCount > 0 && <MindmapUnplacedTray paperState={paperState} nodes={mindmap.nodes} selectedParentId={selected?.id || mindmap.rootId} onPlaceTodo={placeUnplacedTodo} />}
          <div className={styles.canvasSurface}>
          <MindmapCanvas
            virtualize={mindmap.nodes.length > 80 && !editingId && flowNodes.every(node => measuredCards.has(node.id))}
            mindmap={mindmap}
            nodes={flowNodes}
            renderCard={renderCard}
            readOnly={readOnly}
            focusRequest={focusRequest}
            onSelect={selectCard}
            onDoubleClick={onNodeDoubleClick}
            onPaneClick={() => {
              setMapSettingsOpen(false);
              dispatch({ type: "clear-selection" });
              void inlineEditorSessionRef.current?.commit();
            }}
            onReparent={(id, parentId, beforeId, afterId) => {
              setSaveError(null);
              dispatch({ type: "reparent", id, parentId, beforeId, afterId });
              setLocalCollapsed(parentId, false);
              const destination = layout.nodeById.get(beforeId || afterId || parentId);
              const label = destination ? cardContentForNodeWithPaperState(destination, paperState).title : "card";
              setMoveNotice(`Moved ${beforeId ? "above" : afterId ? "below" : "inside"} “${label}”`);
            }}
            onDropPreview={updateDropPreview}
          />

          </div></div>          ) : (
            <MindmapChangesView project={project} recent={paperState?.recent || []} />
          )}
        </div>

        {assetError && <p className="mindmap-save-error" role="alert">{assetError} <button type="button" onClick={() => setAssetError(null)}>Dismiss</button></p>}


        <footer className={styles.workspaceFooter}>
          <div className={styles.historyControls}>
            <ToolbarButton title="Undo (⌘Z / Ctrl+Z)" onClick={undo} disabled={readOnly || !history.length}><Undo2 size={15} /></ToolbarButton>
            <ToolbarButton title="Redo (⌘⇧Z / Ctrl+Y)" onClick={redo} disabled={readOnly || !future.length}><Redo2 size={15} /></ToolbarButton>
            <span>{mindmap.nodes.length} cards</span>
          </div>

        </footer>
        {moveNotice && <div className={styles.moveNotice} role="status"><Check size={14} /><span>{moveNotice}</span><button type="button" onClick={() => { undo(); setMoveNotice(""); }}>Undo</button></div>}

      </div>

      {saveError && <EditorNotice project={project} title={saveConflict ? "Saved file conflict" : "Saving needs attention"} label={saveConflict ? "Editing paused · saved file changed" : "Saving needs attention"} message={saveError} paused={saveConflict}>
        <button type="button" className="btn-outline" onClick={saveConflict ? reloadSavedMap : save}>{saveConflict ? "Reload saved map" : "Retry save"}</button>
      </EditorNotice>}
      {!saveError && remoteSaveError && <OverleafSyncNotice
        project={project} message={remoteSaveError} editingPaused={remoteOutOfSync}
        disabled={isPending || applyingRemote} checking={checkingRemote || remoteSaveState === "saving"}
        beforeReview={async () => { await flushPendingSaves(); return true; }}
        onApplied={async () => {
          const saved = await getMindmapAction(project, sessionRef.current.mindmap.id || "draft");
          if (saved) hydrateSavedMap(saved);
          else router.push(`/p/${project}/mindmap`);
          router.refresh();
          await refreshRemoteStatus(false);
        }}
        onClosed={() => { void refreshRemoteStatus(false); }}
        onCheck={async () => { await refreshRemoteStatus(); }}
        onPush={() => { void pushRemote("OpenBar: save mindmap"); }}
      />}

      {!cardMenuOpen && viewMode === "map" && selectedCards.length > 0 && (
        <button
          type="button"
          className={styles.inspectorHandle}
          aria-label={`Open card inspector for ${selectedCards.length === 1 ? "selected card" : `${selectedCards.length} selected cards`}`}
          title="Open card inspector"
          onClick={() => setCardMenuOpen(true)}
        >
          <PanelRight size={18} />
          {selectedCards.length > 1 && <span>{selectedCards.length}</span>}
        </button>
      )}

      {(cardMenuOpen || inspectorPresent) && selectedCards.length > 1 && (
        <MultiCardInspector
          open={cardMenuOpen}
          cards={selectedCards}
          rootId={mindmap.rootId}
          projectLabels={projectLabels}
          sections={inspectorSections}
          readOnly={readOnly}
          onToggleSection={toggleInspectorSection}
          onClose={() => setCardMenuOpen(false)}
          onPatch={(patch) => {
            setSaveError(null);
            dispatch({ type: "patch-nodes", ids: selectedCards.map((card) => card.id), patch });
          }}
          onUpdateTag={(tag, operation) => {
            setSaveError(null);
            dispatch({ type: "update-tags", ids: selectedCards.map((card) => card.id), tag, operation });
          }}
        />
      )}
      {(cardMenuOpen || inspectorPresent) && selectedCards.length === 1 && selected && (
        <aside
          id="mindmap-card-menu"
          data-state={cardMenuOpen ? "open" : "closed"}
          aria-hidden={!cardMenuOpen}
          inert={!cardMenuOpen}
          className={styles.inspector}
          aria-label="Card inspector"
          aria-describedby="mindmap-card-menu-description"
        >
          <div className="mindmap-card-menu-header">
            <div className="mindmap-card-menu-heading min-w-0">
              <div className="min-w-0">
                <span className="mindmap-card-menu-kicker">
                  <span className="mindmap-card-menu-dot" aria-hidden="true" />
                  {selected.todoId ? "Paper TODO" : "Card"}
                </span>
                <h2 id="mindmap-card-menu-title" className="mindmap-card-menu-title">
                  {selectedCardContent?.title || "Untitled card"}
                </h2>
              </div>
            </div>
            <button
              type="button"
              className="mindmap-icon-button"
              aria-label="Close card actions"
              title="Close card actions"
              onClick={() => setCardMenuOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p id="mindmap-card-menu-description" className="sr-only">
            Selected card controls.
          </p>

            <div className="mindmap-card-menu-list" aria-label="Card actions">
              <button
                type="button"
                className="mindmap-card-menu-row"
                disabled={readOnly || convertingCardId === selected.id}
                onClick={() => {
                  startEditing(selected.id);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                <span>Edit</span>
                <kbd>E</kbd>
              </button>
              {!selected.todoId && paperState?.paper && (
                <button
                  type="button"
                  className="mindmap-card-menu-row"
                  disabled={readOnly || convertingCardId === selected.id}
                  onClick={() => void makeSelectedCardTodo()}
                >
                  {convertingCardId === selected.id ? <LoaderCircle size={14} className="animate-spin" /> : <FilePlus2 size={14} aria-hidden="true" />}
                  <span>{convertingCardId === selected.id ? "Making paper TODO…" : "Make paper TODO"}</span>
                </button>
              )}
              {selected.todoId && selectedTodo && !selectedMissing && (
                <>
                  <button
                    type="button"
                    className="mindmap-card-menu-row"
                    disabled={readOnly || todoProgressBusy}
                    onClick={() => void setSelectedTodoCompleted(!selectedTodo.completed)}
                  >
                    <CircleCheck size={14} aria-hidden="true" />
                    <span>{selectedTodo.completed ? "Reopen TODO" : "Complete TODO"}</span>
                  </button>
                  <a className="mindmap-card-menu-row" href={"/p/" + project + "/paper#" + encodeURIComponent(selected.todoId)}>
                    <Link2 size={14} aria-hidden="true" />
                    <span>Jump to paper</span>
                  </a>
                </>
              )}
            </div>

          {selectedMissing && (
            <div className="mindmap-card-menu-warning" role="status">
              <div>
                <strong>Paper TODO missing</strong>
                <span>{selected.todoId}</span>
              </div>
              <div className="mindmap-card-menu-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    const content = selectedCardContent || { title: "Recovered paper TODO", body: "" };
                    dispatch({ type: "unbind-todo", id: selected.id, title: content.title, text: content.body });
                  }}
                >
                  Convert to ordinary card
                </button>
                <button
                  type="button"
                  className="btn-outline text-danger"
                  onClick={() => {
                    setCardMenuOpen(false);
                    dispatch({ type: "delete-subtree", id: selected.id });
                  }}
                >
                  Delete card
                </button>
              </div>
              {availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).length > 0 && (
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
            </div>
          )}

          <InspectorSection id="organization" open={Boolean(inspectorSections.organization)} onToggle={() => toggleInspectorSection("organization")}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section">
            <div className="mindmap-card-menu-section-body">
              <div className="mindmap-field">
                <span>Labels</span>
                {(selected.tags || []).length > 0 && (
                  <div className="mindmap-chip-list">
                    {(selected.tags || []).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="mindmap-chip"
                        title={"Remove " + tag}
                        onClick={() => dispatch({
                          type: "patch-node",
                          id: selected.id,
                          patch: { tags: (selected.tags || []).filter((item) => item !== tag) },
                        })}
                      >
                        {tag}
                        <X size={11} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                <input
                  value={labelDraft}
                  list="mindmap-label-suggestions"
                  maxLength={MAX_MINDMAP_LABEL_CHARS}
                  placeholder="Add a label and press Enter"
                  aria-label="Add label"
                  disabled={(selected.tags || []).length >= MAX_MINDMAP_LABELS}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const next = labelDraft.trim();
                    if (!next || next.length > MAX_MINDMAP_LABEL_CHARS) return;
                    setSaveError(null);
                    dispatch({ type: "patch-node", id: selected.id, patch: { tags: clampMindmapLabels([...(selected.tags || []), next]) } });
                    setLabelDraft("");
                  }}
                />
                <datalist id="mindmap-label-suggestions">
                  {projectLabels.map((tag) => <option key={tag} value={tag} />)}
                </datalist>
              </div>
              <div className="mindmap-field">
                <span>Priority</span>
                <ChoiceButtons label="Card priority" value={selected.priority || ""} options={[{value:"",label:"Clear"}, ...["P0", "P1", "P2", "P3"].map(value => ({value,label:value}))]} onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { priority: value ? value as MindmapNode["priority"] : undefined } })} />
              </div>
              {!selected.todoId && <div className="mindmap-field">
                <span>Extended note</span>
                <textarea
                  value={selected.caption || ""}
                  maxLength={20_000}
                  placeholder="Hidden context for model readers"
                  aria-label="Extended note"
                  onChange={(event) => {
                    if (captionWordCount(event.target.value) <= MAX_MINDMAP_CAPTION_WORDS) {
                      dispatch({ type: "patch-node", id: selected.id, patch: { caption: event.target.value } });
                    }
                  }}
                />
                <small>{captionWordCount(selected.caption)} / {MAX_MINDMAP_CAPTION_WORDS} words · model context</small>
              </div>}
            </div>
          </div>
          </fieldset>
          </InspectorSection>

          <InspectorSection id="appearance" open={Boolean(inspectorSections.appearance)} onToggle={() => toggleInspectorSection("appearance")}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section">
            <div className="mindmap-card-menu-section-body">
              <div className="mindmap-field">
                <span>Progress</span>
                <ProgressCircles
                  value={selectedTodo?.completed && selected.todoId ? 6 : selected.progress}
                  label={selected.todoId ? "TODO progress" : "Topic progress"}
                  disabled={todoProgressBusy}
                  onChange={updateSelectedProgress}
                />
                {progressNotice?.id === selected.id && <small role="status">{progressNotice.text}</small>}
              </div>
              <div className="mindmap-field">
                <span>Content format</span>
                {selected.todoId ? <span className="mindmap-paper-format-note">TeX · shared with the paper</span> : (
                <ChoiceButtons label="Card content format" value={selected.contentFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"Markdown"},{value:"tex",label:"TeX"}]} onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { contentFormat: value as MindmapNode["contentFormat"] } })} />
                )}
              </div>
              {!selected.todoId && selected.contentFormat === "markdown" && markdownTableColumns(selected.text) > 0 && (
                <div className="mindmap-field">
                  <span>Table width</span>
                  <ChoiceButtons
                    label="Table width"
                    value={selected.tableLayout || "wide"}
                    options={[{ value: "wide", label: "Full width" }, { value: "scroll", label: "Scroll in card" }]}
                    onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { tableLayout: value as MindmapNode["tableLayout"] } })}
                  />
                </div>
              )}
              {selected.parentId !== null && (
                <div className="mindmap-field">
                  <span>Shape</span>
                  <ChoiceButtons label="Card shape" value={selected.shape === "callout" ? selected.shape : "leaf"} options={[{value:"leaf",label:"Card"},{value:"callout",label:"Callout"}]} onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { shape: value as MindmapNode["shape"] } })} />
                </div>
              )}
              <div className="mindmap-field">
                <span>Accent</span>
                <div className="mindmap-color-palette" role="group" aria-label="Card accent palette">
                  {CARD_PALETTE.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={cn("mindmap-color-swatch", selected.color === color.value && "mindmap-color-swatch-selected")}
                      style={{ backgroundColor: color.value }}
                      aria-label={color.label + " accent"}
                      aria-pressed={selected.color === color.value}
                      title={color.label}
                      onClick={() => dispatch({ type: "patch-node", id: selected.id, patch: { color: color.value } })}
                    />
                  ))}
                  <button
                    type="button"
                    className={cn("mindmap-color-swatch mindmap-color-swatch-auto", !selected.color && "mindmap-color-swatch-selected")}
                    aria-label="Use default accent"
                    aria-pressed={!selected.color}
                    title="Use default accent"
                    onClick={() => dispatch({ type: "patch-node", id: selected.id, patch: { color: undefined } })}
                  >
                    <span aria-hidden="true">Auto</span>
                  </button>
                </div>
                <input
                  value={selected.color || ""}
                  onChange={(event) => dispatch({
                    type: "patch-node",
                    id: selected.id,
                    patch: { color: event.target.value.trim() || undefined },
                  })}
                  placeholder="#785ef0 or CSS color"
                  aria-label="Custom card accent"
                />
              </div>
              <div
                className="mindmap-card-assets"
                onPaste={(event) => {
                  const files = imageFilesFromTransfer(event.clipboardData);
                  if (!files.length || readOnly) return;
                  event.preventDefault();
                  event.stopPropagation();
                  addImagesToCard(files, selected.id);
                }}
                onDragOver={(event) => {
                  if (!readOnly && hasImageTransfer(event.dataTransfer)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(event) => {
                  const files = imageFilesFromTransfer(event.dataTransfer);
                  if (!files.length || readOnly) return;
                  event.preventDefault();
                  event.stopPropagation();
                  addImagesToCard(files, selected.id);
                }}
              >
                <span className="mindmap-field-label">Images</span>
                <div className="mindmap-card-asset-grid">
                  {selectedRefs.filter((ref) => ref.kind === "figure").map((ref) => {
                    const href = artifactHref(project, ref);
                    return (
                      <div key={ref.kind + ":" + ref.id} className="mindmap-card-asset-item">
                        <a href={href} target="_blank" rel="noreferrer" className="mindmap-card-asset" title={ref.label || ref.id}>
                          {/\.pdf$/i.test(ref.id) ? <span>PDF · Open</span> : <img src={href} alt={ref.label || "Card image"} loading="lazy" />}
                        </a>
                        <input
                          value={ref.label || ""}
                          placeholder="Caption / alt text"
                          aria-label={"Caption for " + ref.id}
                          onChange={(event) => dispatch({ type: "patch-node", id: selected.id, patch: { refs: captionMindmapImage(selected.refs || [], ref.id, event.target.value) } })}
                        />
                        <label className="text-xs text-muted">Width {ref.imageWidth || 100}%
                          <input type="range" min={25} max={100} step={5} value={ref.imageWidth || 100} aria-label={"Image width for " + ref.id}
                            onChange={event => {
                              const imageWidth = Number(event.target.value);
                              updateCardImages(selected.id, refs => refs.map(item => item.kind === "figure" && item.id === ref.id ? { ...item, imageWidth } : item));
                            }} />
                        </label>
                        <div className="mindmap-card-asset-controls">
                          <button type="button" className="mindmap-ref-remove" aria-label="Remove image" onClick={() => updateCardImages(selected.id, refs => detachMindmapImage(refs, ref.id))}><X size={11} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {Boolean(imageUploads[selected.id]) && <small role="status">Adding images…</small>}
              </div>
            </div>
          </div>
          </fieldset>
          </InspectorSection>

          {(selected.id !== mindmap.rootId || Boolean(selected.todoId && selectedTodo && !selectedMissing && paperSourceHash)) && (
          <InspectorSection id="more" open={Boolean(inspectorSections.more)} onToggle={() => toggleInspectorSection("more")}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-danger">
            {selected.id !== mindmap.rootId && <button type="button" className="mindmap-text-button" onClick={() => { setMoveQuery(""); setSearchIndex(0); setMoveOpen(true); }}>Move card…</button>}
            <button type="button" className="mindmap-text-button" onClick={() => addChild(selected.id)}>Add child card</button>
            {selected.todoId && selectedTodo && !selectedMissing && paperSourceHash && (
              <button
                type="button"
                className="mindmap-text-button text-warn"
                onClick={() => {
                  if (!window.confirm("Delete this TODO from the paper? Its mindmap card and child topics will stay in place so you can repair or convert the card.")) return;
                  setCardMenuOpen(false);
                  void removePaperTodoAction(project, selected.todoId!, paperSourceHashRef.current ?? paperSourceHash)
                    .then(async (result) => {
                      if (!result.ok) {
                        setSaveError(result.message);
                        return;
                      }
                      if (result.diskHash) paperSourceHashRef.current = result.diskHash;
                      router.refresh();
                      await pushRemote("OpenBar: remove paper TODO");
                    })
                    .catch((error) => setSaveError(error instanceof Error ? error.message : "Could not delete the paper TODO."));
                }}
              >
                Delete paper TODO
              </button>
            )}
            {selected.id !== mindmap.rootId && (
              <>
                <button
                  type="button"
                  className="mindmap-text-button text-warn"
                  onClick={() => {
                    setCardMenuOpen(false);
                    deleteSelected();
                  }}
                >
                  Delete card, keep children
                </button>
                {(descendantCounts.get(selected.id) || 0) > 0 && (
                  <button
                    type="button"
                    className="mindmap-text-button text-danger"
                    onClick={() => {
                      setCardMenuOpen(false);
                      deleteSelectedBranch();
                    }}
                  >
                    Delete branch…
                  </button>
                )}
              </>
            )}
          </div>
          </fieldset>
          </InspectorSection>
          )}
        </aside>
      )}
    </section>
  );
}

function commonCardValue<T>(cards: MindmapNode[], read: (card: MindmapNode) => T): T | null {
  const first = read(cards[0]!);
  return cards.every((card) => Object.is(read(card), first)) ? first : null;
}

function MultiCardInspector({ open, cards, rootId, projectLabels, sections, readOnly, onToggleSection, onClose, onPatch, onUpdateTag }: {
  open: boolean;
  cards: MindmapNode[];
  rootId: string;
  projectLabels: string[];
  sections: Partial<Record<InspectorSectionId, boolean>>;
  readOnly: boolean;
  onToggleSection: (id: InspectorSectionId) => void;
  onClose: () => void;
  onPatch: (patch: MindmapNodePatch) => void;
  onUpdateTag: (tag: string, operation: "add" | "remove") => void;
}) {
  const [labelDraft, setLabelDraft] = useState("");
  const priority = commonCardValue(cards, (card) => card.priority || "");
  const progress = commonCardValue(cards, (card) => card.progress);
  const contentFormat = commonCardValue(cards, (card) => card.contentFormat || "plain");
  const tableLayout = commonCardValue(cards, (card) => card.tableLayout || "wide");
  const shape = commonCardValue(cards, (card) => card.shape === "callout" ? card.shape : "leaf");
  const color = commonCardValue(cards, (card) => card.color || "");
  const allOrdinary = cards.every((card) => !card.todoId);
  const allTables = allOrdinary && cards.every((card) => (card.contentFormat || "plain") === "markdown" && markdownTableColumns(card.text) > 0);
  const allMovable = cards.every((card) => card.id !== rootId);
  const commonTags = (cards[0]?.tags || []).filter((tag) => cards.every((card) => (card.tags || []).some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())));
  const mixed = <small className="mindmap-mixed-value">Mixed values · choose one to apply it to {cards.length} cards</small>;

  return (
    <aside id="mindmap-card-menu" data-state={open ? "open" : "closed"} aria-hidden={!open} inert={!open} className={styles.inspector} aria-label="Card inspector" aria-describedby="mindmap-card-menu-description">
      <div className="mindmap-card-menu-header">
        <div className="mindmap-card-menu-heading min-w-0">
          <div className="min-w-0">
            <span className="mindmap-card-menu-kicker"><span className="mindmap-card-menu-dot" aria-hidden="true" />Multiple selection</span>
            <h2 id="mindmap-card-menu-title" className="mindmap-card-menu-title">{cards.length} cards selected</h2>
          </div>
        </div>
        <button type="button" className="mindmap-icon-button" aria-label="Close card actions" title="Close card actions" onClick={onClose}><X size={16} /></button>
      </div>
      <p id="mindmap-card-menu-description" className="sr-only">Shared controls for {cards.length} selected cards.</p>
      <p className={styles.multiSelectionHint}>Shift-click cards to add or remove them from this selection.</p>

      <InspectorSection id="organization" open={Boolean(sections.organization)} onToggle={() => onToggleSection("organization")}>
        <fieldset disabled={readOnly} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section"><div className="mindmap-card-menu-section-body">
            <div className="mindmap-field">
              <span>Common labels</span>
              {commonTags.length > 0 && <div className="mindmap-chip-list">{commonTags.map((tag) => <button key={tag} type="button" className="mindmap-chip" title={`Remove ${tag} from selected cards`} onClick={() => onUpdateTag(tag, "remove")}>{tag}<X size={11} aria-hidden="true" /></button>)}</div>}
              <input
                value={labelDraft}
                list="mindmap-label-suggestions"
                maxLength={MAX_MINDMAP_LABEL_CHARS}
                placeholder="Add a label to all selected cards"
                aria-label="Add label to selected cards"
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const tag = labelDraft.trim();
                  if (!tag || tag.length > MAX_MINDMAP_LABEL_CHARS) return;
                  onUpdateTag(tag, "add");
                  setLabelDraft("");
                }}
              />
              <datalist id="mindmap-label-suggestions">{projectLabels.map((tag) => <option key={tag} value={tag} />)}</datalist>
            </div>
            <div className="mindmap-field">
              <span>Priority</span>
              {priority === null && mixed}
              <ChoiceButtons<string>
                label="Selected cards priority"
                value={priority ?? "__mixed__"}
                options={[{ value: "", label: "Clear" }, ...["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))]}
                onChange={(value) => onPatch({ priority: value ? value as MindmapNode["priority"] : undefined })}
              />
            </div>
          </div></div>
        </fieldset>
      </InspectorSection>

      <InspectorSection id="appearance" open={Boolean(sections.appearance)} onToggle={() => onToggleSection("appearance")}>
        <fieldset disabled={readOnly} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section"><div className="mindmap-card-menu-section-body">
            {allOrdinary && (
              <div className="mindmap-field">
                <span>Progress</span>
                {progress === null && mixed}
                <ProgressCircles value={progress ?? undefined} label="Selected cards progress" onChange={(value) => onPatch({ progress: value })} />
              </div>
            )}
            {allOrdinary && (
              <div className="mindmap-field">
                <span>Content format</span>
                {contentFormat === null && mixed}
                <ChoiceButtons<string>
                  label="Selected cards content format"
                  value={contentFormat ?? "__mixed__"}
                  options={[{ value: "plain", label: "Plain" }, { value: "markdown", label: "Markdown" }, { value: "tex", label: "TeX" }]}
                  onChange={(value) => onPatch({ contentFormat: value as MindmapNode["contentFormat"] })}
                />
              </div>
            )}
            {allTables && (
              <div className="mindmap-field">
                <span>Table width</span>
                {tableLayout === null && mixed}
                <ChoiceButtons<string>
                  label="Selected cards table width"
                  value={tableLayout ?? "__mixed__"}
                  options={[{ value: "wide", label: "Full width" }, { value: "scroll", label: "Scroll in card" }]}
                  onChange={(value) => onPatch({ tableLayout: value as MindmapNode["tableLayout"] })}
                />
              </div>
            )}
            {allMovable && (
              <div className="mindmap-field">
                <span>Shape</span>
                {shape === null && mixed}
                <ChoiceButtons<string>
                  label="Selected cards shape"
                  value={shape ?? "__mixed__"}
                  options={[{ value: "leaf", label: "Card" }, { value: "callout", label: "Callout" }]}
                  onChange={(value) => onPatch({ shape: value as MindmapNode["shape"] })}
                />
              </div>
            )}
            <div className="mindmap-field">
              <span>Accent</span>
              {color === null && mixed}
              <div className="mindmap-color-palette" role="group" aria-label="Selected cards accent palette">
                {CARD_PALETTE.map((option) => (
                  <button key={option.value} type="button" className={cn("mindmap-color-swatch", color === option.value && "mindmap-color-swatch-selected")} style={{ backgroundColor: option.value }} aria-label={option.label + " accent"} aria-pressed={color === option.value} title={option.label} onClick={() => onPatch({ color: option.value })} />
                ))}
                <button type="button" className={cn("mindmap-color-swatch mindmap-color-swatch-auto", color === "" && "mindmap-color-swatch-selected")} aria-label="Use default accent" aria-pressed={color === ""} title="Use default accent" onClick={() => onPatch({ color: undefined })}><span aria-hidden="true">Auto</span></button>
              </div>
              <input value={color ?? ""} onChange={(event) => onPatch({ color: event.target.value.trim() || undefined })} placeholder={color === null ? "Mixed accents" : "#785ef0 or CSS color"} aria-label="Custom selected cards accent" />
            </div>
          </div></div>
        </fieldset>
      </InspectorSection>
    </aside>
  );
}

function InspectorSection({ id, open, onToggle, children }: {
  id: InspectorSectionId;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.inspectorSection}>
      <h3>
        <button type="button" className={styles.sectionToggle} aria-expanded={open} aria-controls={`mindmap-inspector-${id}`} onClick={onToggle}>
          <ChevronRight size={14} aria-hidden="true" className={open ? styles.sectionChevronOpen : undefined} />
          {INSPECTOR_SECTION_LABELS[id]}
        </button>
      </h3>
      <div id={`mindmap-inspector-${id}`} hidden={!open}>{children}</div>
    </section>
  );
}

function MindmapUnplacedTray({ paperState, nodes, selectedParentId, onPlaceTodo }: {
  paperState?: ProjectState | null;
  nodes: ReadonlyArray<Pick<MindmapNode, "id" | "todoId" | "title" | "text">>;
  selectedParentId: string;
  onPlaceTodo: (todoId: string, parentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const drag = useRef<{ todoId: string; title: string; x: number; y: number; active: boolean } | null>(null);
  const candidates = availableTodoCandidates(paperState?.paper?.todos || [], nodes);
  const visible = candidates.filter((todo) => `${todo.title || ""} ${todo.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const destination = nodes.find((node) => node.id === selectedParentId);
  const destinationLabel = destination?.title || destination?.text.split("\n")[0] || "selected card";
  function clearTarget() { document.querySelectorAll("[data-todo-drop-target]").forEach((element) => element.removeAttribute("data-todo-drop-target")); }
  return <aside className={styles.unplacedTray} aria-label="Unplaced paper TODOs">
    <header><strong>Unplaced TODOs</strong><span>{candidates.length}</span></header>
    <p>Drag a TODO onto any card.</p>
    <input aria-label="Search unplaced paper TODOs" placeholder="Find a TODO…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <ul>{visible.map((todo) => <li key={todo.id} data-unplaced-todo={todo.id}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest("[data-place-todo]")) return;
        if (event.pointerType === "touch" && !target.closest("[data-todo-drag-handle]")) return;
        drag.current = { todoId: todo.id, title: todo.title || "Paper TODO", x: event.clientX, y: event.clientY, active: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.todoId !== todo.id) return;
        if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
        current.active = true;
        setGhost({ x: event.clientX, y: event.clientY, title: current.title });
        clearTarget();
        document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-mind-node]")?.setAttribute("data-todo-drop-target", "true");
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        const target = current?.active ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-mind-node]")?.dataset.mindNode : undefined;
        clearTarget(); setGhost(null); drag.current = null;
        if (target && current) onPlaceTodo(current.todoId, target);
      }}
      onPointerCancel={() => { clearTarget(); setGhost(null); drag.current = null; }}>
      <div className={styles.unplacedTitle}><button type="button" data-todo-drag-handle aria-label={`Drag ${todo.title || "paper TODO"}`} title="Drag onto a card">⠿</button><strong><NodeRichText text={todo.title || "Paper TODO"} format="tex" /></strong></div>
      <div className={styles.unplacedCopy}><NodeRichText text={todo.text} format="tex" /></div>
      <button type="button" data-place-todo title={`Place under ${destinationLabel}`} onClick={() => onPlaceTodo(todo.id, selectedParentId)}>Place under selected card</button>
    </li>)}</ul>
    {visible.length === 0 && <p>{candidates.length ? "No matching TODOs" : "All paper TODOs are represented on this map."}</p>}
    {ghost && createPortal(<div className={styles.todoDragGhost} style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.title}</div>, document.body)}
  </aside>;
}

const tableWidthCache = new Map<string, number>();

function CanvasNode({
  fontSize,
  project,
  readOnly,
  uploading,
  onImageChange,
  onImageFiles,
  node,
  cardContent,
  completed,
  missing,
  collapsed,
  collapsedDescendantCount,
  coverage,
  activityLabel,
  dimensions,
  onMeasure,
  orphan,
  selected,
  active,
  editing,
  editSessionRef,
  dropPreviewKind,
  dropPreviewLabel,
  onToggleCollapse,
  onDropTodo,
  onTextChange,
  onTextFocus,
  onSaveDraft,
  onDeleteDraft,
  onCommit,
  onCancel,
  onTodoCommit,
}: {
  project: string;
  readOnly: boolean;
  uploading: number;
  onImageChange: (update: (refs: ArtifactRef[]) => ArtifactRef[]) => void;
  onImageFiles: (files: File[]) => void;
  node: MindmapNode;
  cardContent: { title: string; body: string };
  completed: boolean;
  missing: boolean;
  collapsed: boolean;
  collapsedDescendantCount: number;
  coverage?: { complete: number; total: number };
  activityLabel?: string | null;
  dimensions: Dimensions;
  fontSize: number;
  onMeasure: (id: string, size: Dimensions) => void;
  orphan: boolean;
  selected: boolean;
  active: boolean;
  editing: boolean;
  editSessionRef: RefObject<InlineCardSession | null>;
  dropPreviewKind: MindmapDrop["kind"] | null;
  dropPreviewLabel?: string;
  onToggleCollapse: () => void;
  onDropTodo: (todoId: string) => void;
  onTextChange: (text: string, contentFormat?: MindmapNode["contentFormat"]) => void;
  onTextFocus: () => void;
  onSaveDraft: () => Promise<void>;
  onDeleteDraft: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onTodoCommit?: (title: string, text: string) => Promise<boolean>;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [imageDropActive, setImageDropActive] = useState(false);
  const tableFitKey = node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0
    ? JSON.stringify([project, node, cardContent, coverage, activityLabel, fontSize]) : null;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !tableFitKey || editing) return;
    let width = tableWidthCache.get(tableFitKey);
    if (width === undefined) {
      const maximum = nodeDimensions(node).width;
      card.style.width = `${maximum}px`;
      const height = card.offsetHeight;
      let low = Math.min(NODE_WIDTH, maximum), high = maximum;
      // Minimize area at the full-width height with a bounded width search.
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        card.style.width = `${middle}px`;
        if (card.offsetHeight <= height) high = middle;
        else low = middle;
      }
      width = Math.min(maximum, high + 1);
      if (tableWidthCache.size >= 2000) tableWidthCache.delete(tableWidthCache.keys().next().value!);
      tableWidthCache.set(tableFitKey, width);
    }
    card.style.width = `${width}px`;
    onMeasure(node.id, { width, height: card.offsetHeight });
  }, [tableFitKey, editing, node.id, onMeasure]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      onMeasure(node.id, { width: box?.inlineSize ?? card.offsetWidth, height: box?.blockSize ?? card.offsetHeight });
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [node.id, onMeasure]);
  const { title, body } = cardContent;
  const tags = node.tags || [];
  const initial = node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node);
  const [draft, setDraft] = useState(initial);
  const [commitError, setCommitError] = useState<string | null>(null);
  const commitInFlightRef = useRef<Promise<boolean> | null>(null);
  const finishedRef = useRef(false);
  const [draftFormat, setDraftFormat] = useState<MindmapNode["contentFormat"]>(node.contentFormat || "plain");
  const [formatHint, setFormatHint] = useState("");
  const editingNodeRef = useRef<string | null>(null);
  const editorRef = useRef<TexCodeMirrorHandle>(null);
  const commit = useCallback((): Promise<boolean> => {
    if (finishedRef.current) return Promise.resolve(true);
    if (commitInFlightRef.current) return commitInFlightRef.current;
    const text = editorRef.current?.getLiveSource() ?? draft;
    if (!node.todoId) {
      onTextChange(text, draftFormat);
      finishedRef.current = true;
      onCommit();
      return Promise.resolve(true);
    }
    if (text === initial) {
      finishedRef.current = true;
      onCommit();
      return Promise.resolve(true);
    }
    const parts = splitCardText(text);
    const pending = (onTodoCommit?.(parts.title.trim(), parts.body.trim()) ?? Promise.resolve(false))
      .then((ok) => {
        if (ok) {
          finishedRef.current = true;
          onCommit();
        }
        else setCommitError("Saving needs another try. Your draft is still open.");
        return ok;
      })
      .catch(() => {
        setCommitError("Saving needs another try. Your draft is still open.");
        return false;
      })
      .finally(() => { commitInFlightRef.current = null; });
    commitInFlightRef.current = pending;
    return pending;
  }, [draft, draftFormat, initial, node.todoId, onTextChange, onCommit, onTodoCommit]);

  useEffect(() => {
    if (!editing) return;
    const session = { nodeId: node.id, commit };
    editSessionRef.current = session;
    const finishOutside = (event: Event) => {
      const belongsToEditor = event.composedPath().some((target) => target instanceof Element && (
        target.getAttribute("data-mind-editor") === node.id
        || target.matches('[role="toolbar"][aria-label="Card formatting"]')
      ));
      if (belongsToEditor) return;
      void commit();
    };
    document.addEventListener("pointerdown", finishOutside, true);
    return () => {
      if (editSessionRef.current === session) editSessionRef.current = null;
      document.removeEventListener("pointerdown", finishOutside, true);
    };
  }, [editing, node.id, commit, editSessionRef]);

  function formatSelection(kind: "bold" | "italic") {
    const syntax = node.todoId || draftFormat === "tex" ? "tex" : "markdown";
    const applied = editorRef.current?.format(syntax, kind);
    if (applied && !node.todoId && draftFormat === "plain") setDraftFormat("markdown");
    setFormatHint(applied ? "" : "Select a word or phrase to format.");
  }
  useEffect(() => {
    if (editing && editingNodeRef.current !== node.id) {
      finishedRef.current = false;
      setDraftFormat(node.contentFormat || "plain");
      setFormatHint("");
      setDraft(node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node));
      setCommitError(null);
      editingNodeRef.current = node.id;
    } else if (!editing) {
      editingNodeRef.current = null;
      setCommitError(null);
    }
  }, [editing, node.id, title, body]);
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
      requestAnimationFrame(() => editorRef.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  return (
    <>
    <NodeToolbar
      isVisible={editing && !readOnly}
      position={Position.Top}
      align="start"
      offset={8}
      className={cn(styles.editToolbar, "nodrag nopan")}
      data-mind-editor={node.id}
      role="toolbar"
      aria-label="Card formatting"
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" className={styles.editToolbarButton} aria-label="Bold selection" title="Bold (⌘B / Ctrl+B)" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("bold")}><Bold size={15} /></button>
      <button type="button" className={styles.editToolbarButton} aria-label="Italic selection" title="Italic (⌘I / Ctrl+I)" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("italic")}><Italic size={15} /></button>
      {node.todoId ? <span className="mindmap-inline-editor-hint" title="Paper TODO formatting is saved in TeX">TeX</span> : (
        <ChoiceButtons label="Editing card content format" value={draftFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"Markdown"},{value:"tex",label:"TeX"}]} onChange={(value) => setDraftFormat(value as MindmapNode["contentFormat"])} />
      )}
      <span className="mindmap-inline-editor-divider" />
      <button type="button" className={styles.editToolbarButton} aria-label="Finish editing card" title="Done (⌘Enter / Ctrl+Enter)" onClick={() => void commit()}><Check size={15} /><span>{node.agentDraft ? "Keep draft" : "Done"}</span></button>
      {formatHint && <span className="mindmap-format-hint" role="status">{formatHint}</span>}
    </NodeToolbar>
    <article
      ref={cardRef}
      data-drop-kind={dropPreviewKind || undefined}
      data-mind-node={node.id}
      data-mind-editor={editing ? node.id : undefined}
      role="treeitem"
      aria-selected={selected}
      aria-label={title || mindmapNodeLabel(node)}
      title={title || mindmapNodeLabel(node)}
      className={cn(
        "mindmap-node-card",
        node.todoId && "mindmap-node-todo",
        node.parentId === null && "mindmap-node-root",
        node.agentDraft && styles.agentDraft,
        node.shape === "callout" && "mindmap-node-callout",
        orphan && "mindmap-node-orphan",
        selected && "mindmap-node-selected",
        imageDropActive && "mindmap-image-drop-active",
        active && "mindmap-node-active",
        styles.card,
        editing && "mindmap-node-editing nodrag",
        dropPreviewKind && "mindmap-node-drop-target",
        dropPreviewKind === "child" && "mindmap-node-drop-parent",
        completed && "mindmap-node-complete",
        missing && "mindmap-node-missing",
      )}
      style={{ "--map-font-scale": fontSize / 12,
        width: dimensions.width,
        "--mind-node-accent": nodeAccent(node),
      } as CSSProperties}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setImageDropActive(false);
      }}
      onDragOver={(event) => {
        if (hasImageTransfer(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = readOnly ? "none" : "copy";
          setImageDropActive(!readOnly);
          return;
        }
        if (event.dataTransfer.types.includes("application/x-openbar-todo")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        setImageDropActive(false);
        const files = imageFilesFromTransfer(event.dataTransfer);
        if (files.length) {
          event.preventDefault();
          event.stopPropagation();
          if (!readOnly) onImageFiles(files);
          return;
        }
        const todoId = event.dataTransfer.getData("application/x-openbar-todo");
        if (!todoId) return;
        event.preventDefault();
        onDropTodo(todoId);
      }}
    >
      {node.agentDraft && <div className={styles.draftHeading}>Agent draft</div>}
      {node.todoId && (
        <div className={styles.todoHeading}>
          <span className={styles.todoKind}><FileText size={12} aria-hidden="true" />Paper TODO</span>
          <span className={cn(styles.todoStatus, completed && styles.todoComplete, missing && styles.todoMissing)}>
            {missing ? <AlertCircle size={12} aria-hidden="true" /> : <span className={styles.progressCompact}><ProgressGlyph value={completed ? 6 : node.progress ?? 0} size={18} /></span>}
            {missing ? "Missing in paper" : completed ? "Complete" : node.progress ? `${Math.round(node.progress / 6 * 100)}%` : "Open"}
          </span>
        </div>
      )}
      {!node.todoId && node.progress !== undefined && <div className={styles.cardProgress}><ProgressCircles value={node.progress} compact label="Topic progress" /></div>}
      {editing ? (
        <div className="nodrag nopan mindmap-inline-editor" onPointerDown={(event) => event.stopPropagation()} onKeyDownCapture={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          const key = event.key.toLowerCase();
          if (key !== "b" && key !== "i") return;
          event.preventDefault();
          event.stopPropagation();
          formatSelection(key === "b" ? "bold" : "italic");
        }}>
          <TexCodeMirror
            ref={editorRef}
            variant="compact"
            readOnly={readOnly}
            texHighlighting={draftFormat === "tex"}
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setFormatHint("");
              if (commitError) setCommitError(null);
            }}
            onFocus={onTextFocus}
            onCommit={() => void commit()}
            onCancel={() => {
              if (commitInFlightRef.current) return;
              finishedRef.current = true;
              onCancel();
            }}
            placeholder="Card text"
            className="overflow-hidden"
          />
          {commitError && <small className="mt-1 block text-danger" role="alert">{commitError}</small>}
        </div>
      ) : (
        <>
          {node.todoId ? (
            <div className="mindmap-node-todo-text">
              {title.trim() && <div className="mindmap-node-todo-title"><NodeRichText text={title} format="tex" /></div>}
              {body.trim() && <div className="mindmap-node-detail"><NodeRichText text={body} format="tex" /></div>}
            </div>
          ) : (
            <>
              {!title.trim() && !body.trim() && <div className={styles.cardPlaceholder}>New card</div>}
              {title.trim() && <div className="mindmap-node-title"><NodeRichText text={title} format={node.contentFormat} tableLayout={node.tableLayout} /></div>}
              {body.trim() && <div className="mindmap-node-detail"><NodeRichText text={body} format={node.contentFormat} tableLayout={node.tableLayout} /></div>}
            </>
          )}
        </>
      )}
          {(uploading > 0 || node.refs?.some(ref => ref.kind === "figure")) && (
            <CardImages project={project} refs={node.refs || []} readOnly={readOnly} uploading={uploading}
              onChange={onImageChange} />
          )}
          {node.caption?.trim() && <Popover.Root>
            <Popover.Trigger asChild><button type="button" className={cn(styles.noteTrigger, "nodrag nopan")} onClick={event => event.stopPropagation()}><FileText size={13} />Extended note</button></Popover.Trigger>
            <Popover.Portal><Popover.Content className={cn(styles.noteWindow, "nodrag nopan")} side="right" align="start" sideOffset={14} collisionPadding={16} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} aria-label="Extended note">
              <header><span><FileText size={15} />Extended note</span><Popover.Close aria-label="Close extended note"><X size={16} /></Popover.Close></header>
              <div className={styles.noteBody}>{node.caption}</div>
            </Popover.Content></Popover.Portal>
          </Popover.Root>}
          {node.agentDraft && !readOnly && <div className={cn(styles.draftActions, "nodrag nopan")} data-mind-editor={node.id} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <button type="button" aria-label="Save card" title="Save card" onClick={() => void onSaveDraft()}><Check size={13} /></button>
            <button type="button" aria-label="Delete draft" title="Delete draft" onClick={onDeleteDraft}><X size={13} /></button>
          </div>}
          {coverage && coverage.total > 0 && (
            <div className="mindmap-coverage">
              <span className="tabular-nums">{coverage.complete} / {coverage.total} TODOs</span>
              <div className="mindmap-coverage-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((coverage.complete / coverage.total) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="mindmap-node-meta">
            {node.priority && <span aria-label={`Priority ${node.priority}`}>{node.priority}</span>}
            {activityLabel && <span>{activityLabel}</span>}
            {tags.slice(0, 2).map((tag) => <span className="mindmap-node-tag" key={tag}>{tag}</span>)}
            {tags.length > 2 && <span className="mindmap-node-tag">+{tags.length - 2}</span>}
          </div>
      {collapsedDescendantCount > 0 && (
        <button
          type="button"
          className={cn("mindmap-collapse-toggle", collapsed && "mindmap-collapse-toggle-visible")}
          aria-label={collapsed ? `Expand ${collapsedDescendantCount} child cards` : `Collapse ${collapsedDescendantCount} child cards`}
          aria-expanded={!collapsed}
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
          {collapsed ? (
            <>
              <Plus size={11} strokeWidth={2.75} aria-hidden="true" />
              <span className="ml-0.5 tabular-nums">{collapsedDescendantCount}</span>
            </>
          ) : (
            <Minus size={12} strokeWidth={2.75} aria-hidden="true" />
          )}
        </button>
      )}
      {dropPreviewKind && (
        <span className={cn("mindmap-drop-preview", styles.dropPreview)} data-drop-kind={dropPreviewKind} role="status">
          <small>{dropPreviewKind === "before" ? "Top edge" : dropPreviewKind === "after" ? "Bottom edge" : "Card center"}</small>
          <span>{dropPreviewLabel}</span>
        </span>
      )}
    </article>
    </>
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

function formatProgress(progress: MindmapNode["progress"]): string {
  return `${progress ?? 0} of 6`;
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
  if (node.priority) bits.push(`Priority ${node.priority}`);
  if (node.progress !== undefined) bits.push(`${formatProgress(node.progress)} progress`);
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
  ariaLabel,
  ariaHaspopup,
  ariaExpanded,
  ariaControls,
  buttonRef,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  ariaLabel?: string;
  ariaHaspopup?: React.AriaAttributes["aria-haspopup"];
  ariaExpanded?: boolean;
  ariaControls?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      title={title}
      aria-label={ariaLabel || title}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
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
  measuredCards?: Map<string, Dimensions>,
): CanvasLayout {
  const safeNodes = Array.isArray(mindmap?.nodes) ? mindmap.nodes : [];
  const visibleNodes = safeNodes;
  const visibleMindmap = {
    ...mindmap,
    nodes: visibleNodes.map((node) => ({ ...node, collapsed: collapsedIds.has(node.id) })),
  };
  const { nodeById, childrenByParent: children } = indexMindmap(visibleMindmap);
  const displayTextById = new Map(visibleNodes.map((node) => [node.id, paperTodoText(node, paperState)]));
  const dimensions = new Map<string, Dimensions>();
  for (const node of visibleNodes) {
    const size = nodeDimensions(node, displayTextById.get(node.id));
    const extra = extraHeight?.get(node.id) || 0;
    const measured = measuredCards?.get(node.id);
    const fittedTable = node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0;
    const widthMatches = measured && (fittedTable
      ? measured.width <= size.width && measured.width >= Math.min(NODE_WIDTH, size.width)
      : Math.abs(measured.width - size.width) < 1);
    dimensions.set(node.id, measured && widthMatches
      ? { width: measured.width, height: measured.height }
      : { ...size, height: size.height + extra });
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


function dropPreviewLabel(drop: MindmapDrop, nodeById: Map<string, MindmapNode>): string {
  const target = nodeById.get(drop.targetId);
  const label = target?.title?.trim() || (target ? firstLine(target.text) : "card");
  return drop.kind === "child" ? `Drop to nest under “${label}”` : `Drop to place ${drop.kind === "before" ? "before" : "after"} “${label}”`;
}

function ProgressGlyph({ value, size = 24 }: { value: number; size?: number }) {
  const angle = value / 6 * Math.PI * 2;
  const x = (12 + 10 * Math.sin(angle)).toFixed(3);
  const y = (12 - 10 * Math.cos(angle)).toFixed(3);
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill={value === 6 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" />
    {value === 0 ? <path d="M9 6.5 17 12 9 17.5Z" fill="currentColor" /> : value === 6 ? <path d="m7.5 12 3 3.5 6-7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <path d={`M12 12V2A10 10 0 ${value > 3 ? 1 : 0} 1 ${x} ${y}Z`} fill="currentColor" />}
  </svg>;
}

function ProgressCircles({ value, onChange, disabled = false, compact = false, label = "Progress" }: {
  value: MindmapNode["progress"];
  onChange?: (value: MindmapNode["progress"]) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  if (compact) return <span className={styles.progressCompact} aria-label={`${label}: ${value ?? 0} of 6`} title={`${label}: ${value ?? 0} of 6`}><ProgressGlyph value={value ?? 0} size={16} /></span>;
  return <div className={styles.progressChoices} role="group" aria-label={label}>
    <button type="button" className={styles.progressClear} aria-label={`Clear ${label.toLowerCase()}`} aria-pressed={value === undefined} disabled={disabled} onClick={() => onChange?.(undefined)}>Clear</button>
    {([0, 1, 2, 3, 4, 5, 6] as const).map((state) => <button key={state} type="button" aria-label={state === 6 ? `Finish ${label.toLowerCase()}` : `${label}: ${state} of 6`} aria-pressed={state === value} title={state === 6 ? "Finished" : state === 0 ? "Ready to start" : `${Math.round(state / 6 * 100)}%`} disabled={disabled} onClick={() => onChange?.(state)}><ProgressGlyph value={state} /></button>)}
  </div>;
}


function nodeAccent(node: MindmapNode) {
  return node.color || "rgb(var(--accent))";
}

function paperTodoFor(node: MindmapNode, paperState?: ProjectState | null) {
  if (!node.todoId) return undefined;
  return paperState?.paper?.todos.find((todo) => todo.id === node.todoId);
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

function paperTodoText(node: MindmapNode, paperState?: ProjectState | null): string {
  return joinMindmapCardContent(cardContentForNodeWithPaperState(node, paperState));
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
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true'], .cm-editor"));
}
