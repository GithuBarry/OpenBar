"use client";

import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { ResumeEditControl } from "@/components/project-session/resume-edit-control";
import { BackendStatusNotice } from "@/components/backend-status-notice";
import { isBackendTransportError } from "@/lib/backend-connection";
import { selectEditorIssue, type EditorIssue } from "@/lib/editor-issue-priority";
import { registerProjectFileEditor } from "@/features/project-files-bridge";

import "katex/dist/katex.min.css";
import { Select } from "@/components/select";
import { getBrowserEditablePaper } from "@/features/paper/browser-source";
import { FastTooltip } from "@/components/fast-tooltip";
import paperStyles from "@/features/paper/paper-outline-rail.module.css";
import styles from "./mindmap-editor.module.css";
import { RichText as NodeRichText } from "@/components/rich-text";
import { ChildNavigation, type CardNavigationItem } from "./child-navigation";
import { ParentNavigation } from "./parent-navigation";
import { MapNavigationDock } from "./map-navigation-dock";
import { CardResizeGrip } from "./card-resize-grip";
import { useAgentReplies } from "./use-agent-replies";
import { agentReplyContentHash, cleanAgentReplyDisplay } from "@/lib/research/agent-reply-state";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { NodeToolbar, Position } from "@xyflow/react";
import {
  AlertCircle,
  Check,
  Circle,
  CheckSquare,
  Crosshair,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus2,
  FileText,
  Bold,
  Italic,
  Keyboard,
  LoaderCircle,
  ListTodo,
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
import { MINDMAP_PROGRESS_STATES, progressLabel } from "@/lib/mindmap/progress";
import { useGitAutoSync } from "@/components/use-git-auto-sync";
import { OverleafSyncNotice } from "@/components/overleaf-sync-notice";
import { EditorNotice } from "@/components/editor-notice";
import { SaveSyncStatus, type SaveRemoteState } from "@/components/save-sync-status";
import { convertMindmapCardToTodoAction, finishForceProjectSyncAction, persistPaperTodoAction, removePaperTodoAction, uploadMindmapImageAction } from "@/app/actions";
import { clearPendingBrowserPull, getBrowserGitStatus, pullBrowserProject, pushBrowserProject, readPendingBrowserPull, requireGitPullBarrier, type PendingBrowserPull } from "@/lib/research/browser-git-sync";
import { clearPendingForcePull, finishForceRequest, readPendingForcePull, requireResolvedForcePull, type ForcePullReconciliation, type PendingForcePull } from "@/lib/research/force-sync-client";
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
import { DEFAULT_MINDMAP_FONT_SIZE, mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { createMindmapSaveQueue } from "@/lib/mindmap/save-queue";
import { mergeSavedMindmap } from "@/lib/mindmap/merge-saved";
import { captureDeletedMindmapBranch, restoreDeletedMindmapBranch, type DeletedMindmapBranch } from "@/lib/mindmap/deleted-branch";
import { isOutdatedMindmapPage, loadBrowserMindmap, saveBrowserMindmap } from "@/lib/mindmap/browser-save";
import { hasMindmapCardRecoveryChanges, mindmapRecoveryKey, readMindmapRecovery, writeMindmapRecovery, type MindmapCardRecoveryDraft, type MindmapRecoveryDraft } from "@/lib/mindmap/browser-recovery";
import {
  expandMindmapImmediateChildren,
  mindmapCollapseStorageKey,
  parseMindmapCollapsePreference,
  serializeMindmapCollapsePreference,
} from "@/lib/mindmap/collapse-preferences";
import { cn } from "@/lib/utils";
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
import { flushBeforeOperation } from "@/lib/research/editor-operation-races";
import {
  getMindmapRemoteSyncQueue,
  type MindmapRemoteQueueEvent,
} from "@/lib/research/mindmap-remote-sync-queue";
import type { ArtifactRef, Mindmap, MindmapNode } from "@/lib/types";
import type { ProjectState } from "@/lib/research/project-state";
import type { MindmapTodoConversionResult } from "@/lib/research/webmcp-mindmap-contract";
import {
  joinMindmapCardContent,
  nodeActivityAt,
  ordinaryMindmapCardContent,
  paperSectionRefs,
  reconcileTodos,
  todoCountsByParent,
  todosFromPaperState,
} from "@/lib/research/todo-map";
import { CardImages, hasImageTransfer, imageFilesFromTransfer } from "./card-images";
import { CardCaution } from "./card-caution";
import { CardScratchpad, type CardNoteField } from "./card-scratchpad";
import { CautionEditor } from "./caution-editor";
import { MindmapCanvas, type MindmapFocusRequest } from "./mindmap-canvas";
import { MindmapChangesView } from "./mindmap-changes";
import { CardLinkIndicator, CardLinks, CardProperties, hasCardLinks } from "./card-details";
import { TexCodeMirror, type TexCodeMirrorHandle } from "@/features/paper/tex-codemirror";
import { MindmapFontSize, MindmapFontSizeSlider } from "./mindmap-font-size";
import { useMindmapTitle } from "./mindmap-title-context";

const AUTOSAVE_DELAY = 700;
const LAST_WEEK_DAYS = 7;
const CARD_PALETTE = [
  { value: "#ffb000", label: "Amber" },
  { value: "#fe6100", label: "Orange" },
  { value: "#dc267f", label: "Pink" },
  { value: "#785ef0", label: "Violet" },
  { value: "#648fff", label: "Blue" },
] as const;

type LocalSaveState = "dirty" | "saving" | "saved" | "conflict";
type MindmapRemotePushResult = Awaited<ReturnType<typeof pushBrowserProject>>;

type Point = { x: number; y: number };
type Dimensions = { width: number; height: number };
type MindmapViewMode = "map" | "changes";
type InspectorSectionId = "more";
type InlineCardDraft = Pick<MindmapCardRecoveryDraft, "text" | "contentFormat" | "selection">;
type InlineCardSession = { nodeId: string; commit: () => Promise<boolean>; getDraft: () => InlineCardDraft | null };

const INSPECTOR_SECTION_LABELS: Record<InspectorSectionId, string> = {
  more: "Notes & actions",
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

function mindmapRemoteCheckpoint(mindmap: Mindmap): string {
  return `${mindmap.id || "draft"}:${mindmap.revision ?? 0}:${mindmap.diskHash || mindmapDiskHash(mindmap)}`;
}


export function MindmapEditor({
  project,
  initialMindmap,
  draftMindmap,
  paperState,
  header,
}: {
  header?: ReactNode;
  project: string;
  initialMindmap: Mindmap;
  /** A non-destructive fallback the user can explicitly restore from. */
  draftMindmap?: Mindmap | null;
  paperState?: ProjectState | null;
}) {
  const router = useRouter();
  const { writable: sessionWritable, setPendingWork, connectionState, isBackendUnavailable, accessMessage, accessError, inboxRevision } = useProjectWriteSession();
  const [connectionDetailsOpenRequest, setConnectionDetailsOpenRequest] = useState(0);
  const sessionWritableRef = useRef(sessionWritable);
  sessionWritableRef.current = sessionWritable;
  const remoteQueue = useMemo(
    () => getMindmapRemoteSyncQueue<MindmapRemotePushResult>(project, (result) => result.ok),
    [project],
  );
  const [remoteOutOfSync, setRemoteOutOfSync] = useState(false);
  const [quickPullAvailable, setQuickPullAvailable] = useState(false);
  const quickPullErrorRef = useRef<string | null>(null);
  const [hydrationPending, setHydrationPending] = useState(false);
  const hydrationPendingRef = useRef(false);
  const forceReconciliationRef = useRef<ForcePullReconciliation | null>(null);
  const forcePullRef = useRef<PendingForcePull | null>(null);
  const directPullBarrierRef = useRef<string | null>(null);
  const directPullPersistedRef = useRef(true);
  const [reconciliationPending, setReconciliationPending] = useState(false);
  const [applyingRemote, setApplyingRemote] = useState(false);
  const applyingRemoteRef = useRef(false);
  const remoteOutOfSyncRef = useRef(false);
  remoteOutOfSyncRef.current = remoteOutOfSync || applyingRemoteRef.current || hydrationPendingRef.current;
  const [session, rawDispatch] = useReducer(mindmapReducer, initialMindmap, createMindmapSession);
  const dispatch = useCallback((action: Parameters<typeof mindmapReducer>[1]) => {
    // Preserve navigation, hydration, and text typed before a conflict arrived.
    const allowed = ["select", "select-many", "clear-selection", "replace", "hydrate", "ack-save", "record-history", "edit-card", "edit-text"];
    if (remoteOutOfSyncRef.current && !allowed.includes(action.type) && !(action.type === "patch-node" && action.transient)) return;
    if (!["select", "select-many", "clear-selection", "replace", "hydrate", "ack-save", "record-history"].includes(action.type)) remoteQueue.noteEdit();
    rawDispatch(action);
  }, [remoteQueue]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { mindmap, selectedId, selectedIds, past: history, future, revision } = session;
  const persistedDiskHashRef = useRef(initialMindmap.diskHash || mindmapDiskHash(initialMindmap));
  const lastAcknowledgedMapRef = useRef(initialMindmap);
  const [recoveryDraft, setRecoveryDraft] = useState<MindmapRecoveryDraft | null>(null);
  const recoveryDraftRef = useRef<MindmapRecoveryDraft | null>(null);
  recoveryDraftRef.current = recoveryDraft;
  const recoveryLoadedRef = useRef(false);
  const [recoveryStored, setRecoveryStored] = useState<boolean | null>(null);
  const recoverySavedAtRef = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inlineEditorSessionRef = useRef<InlineCardSession | null>(null);
  const activeCardDraftRef = useRef<MindmapCardRecoveryDraft | null>(null);
  const [restoredCardDraft, setRestoredCardDraft] = useState<MindmapCardRecoveryDraft | null>(null);
  const editBaselineRef = useRef<{ mindmap: Mindmap; nodeId: string; noteFields: Set<CardNoteField>; text: string; paperSourceHash?: string } | null>(null);
  const refreshingWithRecoveryRef = useRef(false);
  const localSaveQueue = useMemo(() => createMindmapSaveQueue(), []);
  const paperSourceHashRef = useRef<string | undefined>(paperState?.paper?.sourceHash);
  const paperMutationGenerationRef = useRef(0);
  const recordPaperSourceHash = useCallback((hash?: string) => {
    if (hash) paperSourceHashRef.current = hash;
  }, []);
  const convertingCardIdRef = useRef<string | null>(null);
  const conversionStartingCardIdRef = useRef<string | null>(null);
  const pendingConversionRefreshRef = useRef<{ cardId: string; todoId: string } | null>(null);
  useEffect(() => {
    const hash = paperState?.paper?.sourceHash;
    if (!hash || hash === paperSourceHashRef.current) return;
    // A refresh can arrive after a newer local mutation. Confirm the displayed
    // hash against the current source before adopting it, including undo and
    // pull operations that legitimately restore an earlier hash.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const verify = async () => {
      await localSaveQueue.idle();
      if (cancelled) return;
      const generation = paperMutationGenerationRef.current;
      try {
        const paper = await getBrowserEditablePaper(project);
        if (cancelled) return;
        if (generation !== paperMutationGenerationRef.current || localSaveQueue.pending) {
          void verify();
          return;
        }
        if (paper?.bundle.bundleHash === hash) paperSourceHashRef.current = hash;
      } catch {
        // Keep the compare-and-swap guard and retry a transient read failure.
        if (!cancelled) retryTimer = setTimeout(() => { void verify(); }, 2_000);
      }
    };
    void verify();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [localSaveQueue, paperState?.paper?.sourceHash, project]);
  const [activityMode, setActivityMode] = useState<"off" | "week" | "custom">("off");
  const [activitySince, setActivitySince] = useState<string | null>(null);
  const [customActivityDate, setCustomActivityDate] = useState(() => daysAgoDate(LAST_WEEK_DAYS));
  const collapseMapId = mindmap.id || initialMindmap.id || "draft";
  const { replies: agentReplies, unreadNodeIds, answeredRequestNodeIds, markRead: markReplyRead } = useAgentReplies(project, collapseMapId, inboxRevision, persistedDiskHashRef.current);
  const [replyReadRequest, setReplyReadRequest] = useState(0);
  const readAgentReply = useCallback((id: string, visibleNode?: MindmapNode) => {
    if (inlineEditorSessionRef.current?.nodeId === id || editingId === id) return;
    const current = visibleNode ?? mindmap.nodes.find(node => node.id === id);
    if (current) markReplyRead(id, agentReplyContentHash(current, paperTodoFor(current, paperState)));
    if (unreadNodeIds.has(id)) setReplyReadRequest(value => value + 1);
  }, [editingId, markReplyRead, paperState, unreadNodeIds, mindmap]);
  const collapseStorageKey = mindmapCollapseStorageKey(project, collapseMapId);
  const centerOnEditStorageKey = `openbar:mindmap-center-on-edit:v1:${encodeURIComponent(project)}:${encodeURIComponent(collapseMapId)}`;
  const [centerOnEdit, setCenterOnEdit] = useState(true);
  const centerOnEditRef = useRef(centerOnEdit);
  const setCenterOnEditPreference = useCallback((enabled: boolean) => {
    centerOnEditRef.current = enabled;
    setCenterOnEdit(enabled);
    try { window.localStorage.setItem(centerOnEditStorageKey, String(enabled)); }
    catch { /* The preference remains active for this browser session. */ }
  }, [centerOnEditStorageKey]);
  useEffect(() => {
    let enabled = true;
    try { enabled = window.localStorage.getItem(centerOnEditStorageKey) !== "false"; }
    catch { /* Keep the default while browser storage is unavailable. */ }
    centerOnEditRef.current = enabled;
    setCenterOnEdit(enabled);
  }, [centerOnEditStorageKey]);
  const collapseNodeSignature = useMemo(
    () => mindmap.nodes.map((node) => `${node.id}:${node.parentId || ""}`).sort().join("|"),
    [mindmap.nodes],
  );
  const hierarchyDepths = useMemo(() => {
    const { childrenByParent } = indexMindmap(mindmap);
    const depths = new Map<string, number>([[mindmap.rootId, 0]]);
    const queue = [mindmap.rootId];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      for (const child of childrenByParent.get(id) || []) {
        if (depths.has(child.id)) continue;
        depths.set(child.id, (depths.get(id) || 0) + 1);
        queue.push(child.id);
      }
    }
    return depths;
  }, [collapseNodeSignature, mindmap.rootId]);
  const maxCollapseDepth = Math.max(2, ...hierarchyDepths.values());
  const [chosenCollapseDepth, setCollapseDepth] = useState(2);
  const collapseDepth = Math.min(chosenCollapseDepth, maxCollapseDepth);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const collapsedIdsRef = useRef<Set<string>>(new Set());
  collapsedIdsRef.current = collapsedIds;
  const [shiftExpandHeld, setShiftExpandHeld] = useState(false);
  useEffect(() => {
    let held = false;
    const update = (next: boolean) => {
      if (next === held) return;
      held = next;
      setShiftExpandHeld(next);
    };
    const key = (event: globalThis.KeyboardEvent) => update(event.shiftKey);
    const blur = () => update(false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const setLocalCollapsedIds = useCallback((next: Set<string>) => {
    collapsedIdsRef.current = next;
    setCollapsedIds(next);
    try {
      window.localStorage.setItem(
        collapseStorageKey,
        serializeMindmapCollapsePreference(next),
      );
    } catch {
      // Browser storage can be unavailable in private or restricted sessions.
    }
  }, [collapseStorageKey]);

  const setLocalCollapsed = useCallback((id: string, collapsed: boolean) => {
    const next = new Set(collapsedIdsRef.current);
    if (collapsed) next.add(id);
    else next.delete(id);
    setLocalCollapsedIds(next);
  }, [setLocalCollapsedIds]);

  useEffect(() => {
    let next = new Set<string>();
    try {
      const raw = window.localStorage.getItem(collapseStorageKey);
      const preference = parseMindmapCollapsePreference(raw, mindmap.nodes);
      if (preference) {
        next = new Set(preference.collapsedIds);
        // Rewrite legacy or stale entries into the canonical, node-filtered
        // browser format while retaining the preference in this map's store.
        if (raw !== null && raw !== serializeMindmapCollapsePreference(next)) {
          window.localStorage.setItem(collapseStorageKey, serializeMindmapCollapsePreference(next));
        }
      } else if (raw !== null) {
        window.localStorage.removeItem(collapseStorageKey);
      }
    } catch {
      next = new Set();
    }
    collapsedIdsRef.current = next;
    setCollapsedIds(next);
  }, [collapseNodeSignature, collapseStorageKey]);

  const [remoteSaveState, setRemoteSaveState] = useState<SaveRemoteState>(() => {
    const snapshot = remoteQueue.getSnapshot();
    return snapshot.phase === "pending" || snapshot.phase === "syncing" ? snapshot.phase : "checking";
  });
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  const [reviewingRemote, setReviewingRemote] = useState(false);
  const reviewingRemoteRef = useRef(false);
  useEffect(() => () => { if (reviewingRemoteRef.current) remoteQueue.resume(); }, [remoteQueue]);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [imageUploads, setImageUploads] = useState<Record<string, number>>({});
  const imageUploadQueue = useRef(Promise.resolve());
  const pendingImageUploads = useRef(0);
  const remoteStatusRequestRef = useRef(0);
  const activeRemoteStatusRequestRef = useRef<number | null>(null);
  const remoteSyncRef = useRef<RemoteSyncOutcome | undefined>(undefined);

  useEffect(() => {
    let initial = true;
    const applyQueueEvent = (event: MindmapRemoteQueueEvent<MindmapRemotePushResult>) => {
      const initialSettled = initial && (event.phase === "synced" || event.phase === "failed");
      initial = false;
      if (event.sequence === 0 || initialSettled) return;
      if (hydrationPendingRef.current) return;
      if (isBackendTransportError(event.error) || isBackendUnavailable()) return;
      setCheckingRemote(false);
      if (event.phase === "pending") {
        setRemoteSaveState("pending");
        setRemoteSaveError(null);
        remoteSyncRef.current = {
          status: "pending",
          code: "remote_sync_queued",
          message: "Local save complete. Waiting to push the latest checkpoint.",
          retryable: true,
        };
        return;
      }
      if (event.phase === "syncing") {
        setRemoteSaveState("syncing");
        setRemoteSaveError(null);
        remoteSyncRef.current = {
          status: "pending",
          code: "push_in_progress",
          message: "Local save complete. Pushing to Git…",
          retryable: true,
        };
        return;
      }
      if (event.phase === "synced") {
        if (!event.result) return;
        remoteSyncRef.current = remoteSyncResult(event.result);
        setRemoteSaveState("synced");
        setRemoteOutOfSync(false);
        setRemoteSaveError(null);
        return;
      }
      const result = event.result;
      const message = result && !result.ok
        ? result.message
        : event.error instanceof Error
          ? event.error.message
          : "Could not save to the remote.";
      remoteSyncRef.current = result && !result.ok
        ? remoteSyncResult(result)
        : {
            status: "failed",
            code: "remote_save_failed",
            message,
            retryable: true,
          };
      if (result && !result.ok && (result.code === "remote_ahead" || result.code === "remote_conflict")) {
        setRemoteOutOfSync(true);
      }
      setRemoteSaveState(remoteSyncRef.current.status === "unconfigured" ? "unconfigured" : result && !result.ok && result.code === "pre_staged_work" ? "blocked" : "failed");
      setRemoteSaveError(remoteSyncRef.current.status === "unconfigured" ? null : message);
    };
    return remoteQueue.subscribe(applyQueueEvent);
  }, [isBackendUnavailable, remoteQueue]);

  const runPaperMutation = useCallback(<T,>(write: () => Promise<T>): Promise<T> => {
    // Mark activity before queueing so a running Git operation cannot publish
    // a stale status while this local mutation is waiting to run.
    remoteQueue.noteEdit();
    paperMutationGenerationRef.current += 1;
    return localSaveQueue.enqueue(async () => {
      try {
        // A queued edit can reach the front after a pull began. Keep its draft
        // available until the pulled source has been loaded into the editor.
        if (applyingRemoteRef.current || hydrationPendingRef.current) {
          throw Object.assign(new Error("Git updates are being applied. Retry this edit after the project reloads."), { code: "remote_conflict" });
        }
        return await write();
      } finally {
        paperMutationGenerationRef.current += 1;
      }
    });
  }, [localSaveQueue, remoteQueue]);
  const nextRemoteCheckpointRef = useRef(`initial:${project}`);
  const enqueueRemote = useCallback((message: string, checkpoint = nextRemoteCheckpointRef.current, deferred = false) => {
    if (reviewingRemoteRef.current) return Promise.resolve({ ok: false as const, code: "review_in_progress", message: "Local changes saved for pull review." });
    // Any status request that predates this checkpoint cannot clear its queue
    // state when its response arrives.
    ++remoteStatusRequestRef.current;
    return remoteQueue.enqueue(checkpoint, async () => {
      try {
        return await pushBrowserProject(project, message);
      } catch (error) {
        if (isBackendTransportError(error) || isBackendUnavailable()) throw error;
        return {
          ok: false as const,
          code: "remote_save_failed",
          message: error instanceof Error ? error.message : "Could not save to the remote.",
        };
      }
    }, deferred, () => !inlineEditorSessionRef.current && !localSaveQueue.pending
      && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current);
  }, [isBackendUnavailable, project, remoteQueue, localSaveQueue]);

  const pushRemote = useCallback((message: string) => enqueueRemote(message), [enqueueRemote]);
  const scheduleRemote = useCallback((message: string) => {
    void enqueueRemote(message, nextRemoteCheckpointRef.current, true);
  }, [enqueueRemote]);

  const refreshRemoteStatus = useCallback(async (refreshRemote = true, announce = true) => {
    const requestId = ++remoteStatusRequestRef.current;
    activeRemoteStatusRequestRef.current = requestId;
    const queueSequence = remoteQueue.getSnapshot().sequence;
    const activityGeneration = remoteQueue.activityGeneration;
    const queueWasBusy = remoteQueue.isBusy;
    setCheckingRemote(true);
    if (announce && !queueWasBusy) setRemoteSaveState(current => current === "changed" || current === "blocked" || current === "failed" || current === "unavailable" ? current : "checking");
    try {
      const status = await getBrowserGitStatus(project, refreshRemote);
      if (requestId !== remoteStatusRequestRef.current || activityGeneration !== remoteQueue.activityGeneration) return;
      const queueSnapshot = remoteQueue.getSnapshot();
      if (queueWasBusy || remoteQueue.isBusy || queueSnapshot.sequence !== queueSequence) return status;
      if (hydrationPendingRef.current) return status;
      if (!status.isGitRepo) {
        setRemoteSaveState("unconfigured");
        setRemoteSaveError(null);
        return status;
      }
      if (status.error && status.isOverleafRemote !== false) {
        setRemoteSaveState("unavailable");
        setRemoteSaveError(`Git status unavailable: ${status.error}`);
        return status;
      }
      if (!status.isOverleafRemote) {
        setRemoteSaveState("unconfigured");
        setRemoteSaveError(null);
        return status;
      }
      if (!Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind)
        || status.ahead! < 0 || status.behind! < 0 || typeof status.isClean !== "boolean") {
        const message = "Git synchronization status could not be verified. Check the remote connection and try again.";
        setRemoteSaveState("unavailable");
        setRemoteSaveError(message);
        return { ...status, error: message };
      }
      setQuickPullAvailable(status.behind! > 0 && status.ahead === 0);
      if ((status.behind || 0) > 0) {
        remoteOutOfSyncRef.current = true;
        setRemoteOutOfSync(true);
        setRemoteSaveState("changed");
        setRemoteSaveError(quickPullErrorRef.current || "Git has newer commits. Pull before saving to Git.");
        return status;
      }
      quickPullErrorRef.current = null;
      remoteOutOfSyncRef.current = applyingRemoteRef.current;
      setRemoteOutOfSync(false);
      setRemoteSaveError(null);
      setRemoteSaveState(current => (status.ahead || 0) > 0 || !status.isClean ? "pending" : refreshRemote || current === "synced" ? "synced" : "local");
      return status;
    } catch (error) {
      if (requestId !== remoteStatusRequestRef.current || activityGeneration !== remoteQueue.activityGeneration) return;
      if (queueWasBusy || remoteQueue.isBusy || remoteQueue.getSnapshot().sequence !== queueSequence) return;
      if (isBackendTransportError(error) || isBackendUnavailable()) return;
      const message = `Git status unavailable: ${error instanceof Error ? error.message : "Could not check Git."}`;
      setRemoteSaveState("unavailable");
      setRemoteSaveError(message);
      return { isGitRepo: true, error: message };
    } finally {
      if (activeRemoteStatusRequestRef.current === requestId) {
        activeRemoteStatusRequestRef.current = null;
        setCheckingRemote(false);
        setRemoteSaveState(current => current === "checking"
          ? remoteQueue.isRunning ? "syncing" : remoteQueue.isBusy ? "pending" : "local"
          : current);
      }
    }
  }, [isBackendUnavailable, project, remoteQueue]);

  useEffect(() => {
    void refreshRemoteStatus(sessionWritable, false);
  }, [refreshRemoteStatus, sessionWritable]);

  const webMcpSaveCountRef = useRef(0);
  const captureRecoveryDraft = useCallback((): MindmapRecoveryDraft => {
    const baseline = editBaselineRef.current;
    const live = inlineEditorSessionRef.current?.getDraft();
    const baseNode = baseline?.mindmap.nodes.find(node => node.id === baseline.nodeId);
    const activeCard = baseline && baseNode && live ? {
      nodeId: baseline.nodeId,
      ...live,
      baseNode: cloneMindmap(baseNode),
      baseText: baseline.text,
      paperSourceHash: baseline.paperSourceHash,
      noteFields: [...baseline.noteFields],
    } : baseline && !inlineEditorSessionRef.current ? activeCardDraftRef.current || undefined : undefined;
    activeCardDraftRef.current = activeCard || null;
    return {
      version: 1,
      project,
      mapId: sessionRef.current.mindmap.id || "draft",
      baseHash: persistedDiskHashRef.current,
      savedAt: new Date().toISOString(),
      mindmap: cloneMindmap(sessionRef.current.mindmap),
      ...(activeCard ? { activeCard } : {}),
    };
  }, [project]);
  const preserveBrowserDraft = useCallback(() => {
    const draft = recoveryDraftRef.current || captureRecoveryDraft();
    let stored = false;
    try { stored = writeMindmapRecovery(window.sessionStorage, draft); }
    catch { /* Browser storage can be disabled. Keep the live editor open. */ }
    if (stored) recoverySavedAtRef.current = draft.savedAt;
    setRecoveryStored(stored);
    return stored;
  }, [captureRecoveryDraft]);
  const clearBrowserDraft = useCallback(() => {
    if (captureRecoveryDraft().activeCard) { preserveBrowserDraft(); return; }
    try { window.sessionStorage.removeItem(mindmapRecoveryKey(project, sessionRef.current.mindmap.id || "draft")); }
    catch { /* A saved map remains durable when browser storage is unavailable. */ }
    setRecoveryStored(null);
    recoverySavedAtRef.current = null;
  }, [captureRecoveryDraft, preserveBrowserDraft, project]);
  const persistCurrentSnapshot = useCallback(async (actor: "human" | "webmcp" = "human"): Promise<Mindmap> => {
    if (recoveryDraftRef.current) throw new Error("Review the recovered draft before saving this map.");
    const snapshot = cloneMindmap(sessionRef.current.mindmap);
    const signature = mapSignature(snapshot);
    if (signature === savedSignatureRef.current) return snapshot;
    const previousSaveError = saveErrorRef.current;
    saveErrorRef.current = null;
    setSaveError(null);
    setLocalSaveState("saving");
    preserveBrowserDraft();
    try {
      const saved = await saveBrowserMindmap(project, snapshot, persistedDiskHashRef.current, actor);
      lastAcknowledgedMapRef.current = saved;
      persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
      const savedMapSignature = mapSignature(saved);
      savedSignatureRef.current = savedMapSignature;
      setSavedSignature(savedMapSignature);
      const latest = sessionRef.current;
      const acknowledgement = { type: "ack-save" as const, base: snapshot, saved };
      sessionRef.current = mindmapReducer(latest, acknowledgement);
      dispatch(acknowledgement);
      const clean = mapSignature(sessionRef.current.mindmap) === savedMapSignature;
      setLocalSaveState(clean ? "saved" : "dirty");
      if (clean) clearBrowserDraft();
      else preserveBrowserDraft();
      nextRemoteCheckpointRef.current = mindmapRemoteCheckpoint(saved);
      void enqueueRemote("OpenBar: save mindmap", nextRemoteCheckpointRef.current, true);
      return saved;
    } catch (error) {
      if (isBackendTransportError(error) || isBackendUnavailable()) {
        saveErrorRef.current = previousSaveError;
        setSaveError(previousSaveError);
        preserveBrowserDraft();
        setLocalSaveState(previousSaveError && /conflict|changed.*reload|stale/i.test(previousSaveError) ? "conflict" : "dirty");
        throw error;
      }
      const message = error instanceof Error ? error.message : "Could not save the mindmap.";
      saveErrorRef.current = message;
      setSaveError(message);
      preserveBrowserDraft();
      setLocalSaveState(/conflict|changed.*reload|stale/i.test(message) ? "conflict" : "dirty");
      throw error;
    }
  }, [clearBrowserDraft, enqueueRemote, isBackendUnavailable, preserveBrowserDraft, project]);

  const persistWebMcpMutation = useCallback(async (
    action: MindmapTreeAction | ((current: MindmapSession) => MindmapTreeAction | null),
    expectedRevision?: number,
    actor: "human" | "webmcp" = "webmcp",
  ): Promise<Mindmap> => {
    webMcpSaveCountRef.current += 1;
    try {
      return await localSaveQueue.enqueue(async () => {
        if (!sessionWritableRef.current) throw Object.assign(new Error("This tab is viewing. Start editing here to change this map."), { code: "write_session_required" });
        if (recoveryDraftRef.current) throw new Error("Review the recovered draft before editing this map.");
        if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Editing is paused. Review and synchronize Git updates to resume."), { code: "remote_conflict" });
        // Flush pending human edits before attributing an agent operation.
        await persistCurrentSnapshot("human");
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
        sessionRef.current = nextSession;
        dispatch(nextAction);
        return persistCurrentSnapshot(actor);
      });
    } finally {
      webMcpSaveCountRef.current -= 1;
    }
  }, [localSaveQueue, persistCurrentSnapshot]);

  useMindmapWebMcp({
    sharedActions: sharedWebMcpActions,
    getSnapshot: () => {
      const current = sessionRef.current.mindmap;
      return {
        project,
        mapId: current.id || "draft",
        title: current.title,
        fontSize: current.fontSize || DEFAULT_MINDMAP_FONT_SIZE,
        role: current.role,
        isPrimary: isPrimaryMindmap(current),
        revision: sessionRef.current.revision,
        diskHash: persistedDiskHashRef.current,
        remoteSync: remoteSyncRef.current,
        editingBlocked: remoteOutOfSyncRef.current || Boolean(recoveryDraftRef.current),
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
            caution: node.caution,
            tableLayout: node.tableLayout,
            cardWidth: node.cardWidth,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            completed: Boolean(node.todoId && paperTodoFor(node, paperState)?.completed),
          };
        }),
        selectedId: sessionRef.current.selectedId,
        activitySince: activitySince || undefined,
        viewLocal: { collapsedIds: [...collapsedIdsRef.current].sort(), centerOnEdit: centerOnEditRef.current },
        localSaveState,
        remoteSaveState,
      };
    },
    focusNode: (id) => dispatch({ type: "select", id }),
    setViewPreferences: ({ centerOnEdit }) => setCenterOnEditPreference(centerOnEdit),
    hasTodo: (todoId) => Boolean(paperState?.paper?.todos.some((todo) => todo.id === todoId)),
    addNode: async (parentId, text, expectedRevision, title, caution, caption) => {
      const id = newNodeId();
      await persistWebMcpMutation({ type: "add-node", parentId, id, text, title, caution, caption, agentDraft: true }, expectedRevision);
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
        caption?: string;
        caution?: MindmapNode["caution"];
        tags?: string[];
        refs?: ArtifactRef[];
        metadata?: Record<string, unknown>;
        contentFormat?: MindmapNode["contentFormat"];
        shape?: MindmapNode["shape"];
        color?: string;
        progress?: MindmapNode["progress"];
        priority?: MindmapNode["priority"];
        tableLayout?: MindmapNode["tableLayout"];
        cardWidth?: number;
      } = {};
      if (patch.title !== undefined) nodePatch.title = patch.title;
      if (patch.text !== undefined) nodePatch.text = patch.text;
      if (patch.caption !== undefined) nodePatch.caption = patch.caption;
      if (patch.caution !== undefined) nodePatch.caution = patch.caution;
      if (patch.labels) nodePatch.tags = patch.labels;
      if (patch.refs) nodePatch.refs = patch.refs;
      if (patch.metadata !== undefined) nodePatch.metadata = patch.metadata || undefined;
      if (Object.prototype.hasOwnProperty.call(patch, "priority")) nodePatch.priority = patch.priority;
      if (patch.presentation?.tableLayout !== undefined) nodePatch.tableLayout = patch.presentation.tableLayout;
      if (patch.presentation && Object.hasOwn(patch.presentation, "cardWidth")) nodePatch.cardWidth = patch.presentation.cardWidth ?? undefined;
      if (patch.presentation) {
        if (patch.presentation.contentFormat !== undefined) nodePatch.contentFormat = patch.presentation.contentFormat;
        if (patch.presentation.shape !== undefined) nodePatch.shape = patch.presentation.shape;
        if (Object.prototype.hasOwnProperty.call(patch.presentation, "color")) nodePatch.color = patch.presentation.color;
        if (patch.presentation.progress === null) nodePatch.progress = undefined;
        else if (patch.presentation.progress !== undefined) nodePatch.progress = patch.presentation.progress;
      }
      if (Object.keys(nodePatch).length === 0) return;
      await persistWebMcpMutation((current) => {
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        return node ? { type: "patch-node", id, patch: nodePatch } : null;
      }, expectedRevision);
    },
    setActivityHighlight: (since) => {
      setActivityMode(since ? "custom" : "off");
      if (since) setCustomActivityDate(since);
      setActivitySince(since || null);
    },
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
      if (convertingCardIdRef.current || conversionStartingCardIdRef.current) {
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
      // The flush must run before the conversion lock blocks ordinary-card
      // commits. The separate preflight ref still serializes concurrent calls.
      conversionStartingCardIdRef.current = id;
      return flushBeforeOperation(flushPendingSaves, async () => {
        convertingCardIdRef.current = id;
        setConvertingCardId(id);
        return convertCardToTodo(id, sectionId, expectedRevision, requestId);
      }).finally(() => {
        if (conversionStartingCardIdRef.current === id) conversionStartingCardIdRef.current = null;
        const pending = pendingConversionRefreshRef.current;
        if (convertingCardIdRef.current === id && pending?.cardId !== id) convertingCardIdRef.current = null;
        setConvertingCardId((current) => current === id && pending?.cardId !== id ? null : current);
      });
    },
    completeTodo: async (todoId) => runPaperMutation(async () => {
      const result = await persistPaperTodoAction(
        project,
        { type: "complete_todo", id: todoId },
        paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
      );
      if (!result.ok) throw new Error(result.message);
      recordPaperSourceHash(result.diskHash);
      router.refresh();
      scheduleRemote("OpenBar: complete paper TODO");
    }),
    reopenTodo: async (todoId) => runPaperMutation(async () => {
      const result = await persistPaperTodoAction(
        project,
        { type: "reopen_todo", id: todoId },
        paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
      );
      if (!result.ok) throw new Error(result.message);
      recordPaperSourceHash(result.diskHash);
      router.refresh();
      scheduleRemote("OpenBar: reopen paper TODO");
    }),
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
  const [cardMenuOpen, setCardMenuOpen] = useState(true);
  const [unplacedOpen, setUnplacedOpen] = useState(true);
  const controlDockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = controlDockRef.current;
    const editor = dock?.closest<HTMLElement>("[data-mindmap-editor]");
    if (!dock || !editor) return;
    const measure = () => {
      if (getComputedStyle(dock).display === "contents") editor.style.removeProperty("--mindmap-control-clearance");
      else editor.style.setProperty("--mindmap-control-clearance", `${editor.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 8}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => { observer.disconnect(); editor.style.removeProperty("--mindmap-control-clearance"); };
  }, []);
  const [selectMultiple, setSelectMultiple] = useState(false);
  const [inspectorPresent, setInspectorPresent] = useState(true);
  useEffect(() => {
    if (cardMenuOpen) { setInspectorPresent(true); return; }
    const timeout = window.setTimeout(() => setInspectorPresent(false), 180);
    return () => window.clearTimeout(timeout);
  }, [cardMenuOpen]);
  useEffect(() => {
    if (window.matchMedia("(max-width: 899px)").matches) {
      setCardMenuOpen(false);
      setUnplacedOpen(false);
    }
  }, []);
  const [inspectorSections, setInspectorSections] = useState<Partial<Record<InspectorSectionId, boolean>>>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem("openbar:inspector-sections:v1") || "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const sections: Partial<Record<InspectorSectionId, boolean>> = {};
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
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchDismissedOutsideRef = useRef(false);
  useEffect(() => {
    if (!searchOpen && !moveOpen) return;
    searchDismissedOutsideRef.current = false;
    // Canvas gestures intercept bubbling events used by the popover's dismissal.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchTriggerRef.current?.contains(target) || searchPanelRef.current?.contains(target)) return;
      searchDismissedOutsideRef.current = true;
      setSearchOpen(false);
      setMoveOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchOpen, moveOpen]);
  useEffect(() => {
    if (!searchOpen && !moveOpen) return;
    document.getElementById(`mindmap-search-result-${searchIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [searchIndex, searchOpen, moveOpen]);
  const [focusRequest, setFocusRequest] = useState<MindmapFocusRequest | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  const [deletedBranchNotice, setDeletedBranchNotice] = useState<{
    token: string; branch: DeletedMindmapBranch; collapsedIds: string[]; expiresAt: number; error?: string;
  } | null>(null);
  useEffect(() => {
    if (!deletedBranchNotice) return;
    const timer = window.setTimeout(() => setDeletedBranchNotice(current => current?.token === deletedBranchNotice.token ? null : current), Math.max(0, deletedBranchNotice.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deletedBranchNotice]);
  useEffect(() => setDeletedBranchNotice(null), [project, collapseMapId]);
  useEffect(() => {
    if (!moveNotice) return;
    const timer = window.setTimeout(() => setMoveNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [moveNotice]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localSaveState, setLocalSaveState] = useState<LocalSaveState>("saved");
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
  const outdatedSave = Boolean(saveError && isOutdatedMindmapPage(saveError));
  const readOnly = !sessionWritable || manualReadOnly || remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft);
  const titleContext = useMindmapTitle();
  const setTitleEditor = titleContext?.setEditor;
  const renameFromSwitcher = useCallback(async (title: string) => {
    if (readOnly) throw new Error("Enable editing to rename this map.");
    await persistWebMcpMutation({ type: "rename-map", title }, undefined, "human");
  }, [persistWebMcpMutation, readOnly]);
  useEffect(() => {
    setTitleEditor?.({ id: mindmap.id || "draft", title: mindmap.title || "", readOnly, rename: renameFromSwitcher });
    return () => setTitleEditor?.(null);
  }, [mindmap.id, mindmap.title, readOnly, renameFromSwitcher, setTitleEditor]);
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
  const unplacedCount = availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes).length;
  const [labelDraft, setLabelDraft] = useState("");
  const [mapTitleDraft, setMapTitleDraft] = useState(initialMindmap.title || "");
  const mapTitleDirtyRef = useRef(false);

  useEffect(() => {
    if (!mapTitleDirtyRef.current) setMapTitleDraft(mindmap.title || "");
  }, [mindmap.title]);

  useEffect(() => {
    setLabelDraft("");
  }, [selectedId]);

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
    const counts = todoCountsByParent(reconciliation, mindmap);
    for (const node of mindmap.nodes) {
      if (node.todoId) continue;
      const linked = paperSectionRefs(node).length > 0;
      const directTodo = (childrenByParent.get(node.id) || []).some((child) => Boolean(child.todoId));
      if (!linked && !directTodo) continue;
      map.set(node.id, counts.get(node.id)!);
    }
    return map;
  }, [mindmap, reconciliation]);

  const [cardWidthPreviews, setCardWidthPreviews] = useState<Map<string, number>>(() => new Map());
  useEffect(() => { if (readOnly) setCardWidthPreviews(new Map()); }, [readOnly]);
  const previewCardWidth = useCallback((id: string, width: number | undefined) => {
    setCardWidthPreviews(current => {
      const next = new Map(current);
      if (width === undefined) next.delete(id);
      else next.set(id, width);
      return next;
    });
  }, []);
  const commitCardWidth = useCallback((id: string, width: number | undefined) => {
    previewCardWidth(id, undefined);
    if (readOnly) return;
    dispatch({ type: "patch-node", id, patch: { cardWidth: width } });
  }, [dispatch, previewCardWidth, readOnly]);
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
    const displayed = cardWidthPreviews.size ? { ...mindmap, nodes: mindmap.nodes.map(node => cardWidthPreviews.has(node.id) ? { ...node, cardWidth: cardWidthPreviews.get(node.id) } : node) } : mindmap;
    const next = createCanvasLayout(displayed, extraHeight, collapsedIds, paperState, measuredCards);
    return next;
  }, [mindmap, coverageById, collapsedIds, paperState?.paper?.todos, measuredCards, cardWidthPreviews]);
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
    setPendingWork("mindmap", dirty || isPending || localSaveState === "saving" || Boolean(editingId));
    return () => setPendingWork("mindmap", false);
  }, [dirty, editingId, isPending, localSaveState, setPendingWork]);
  useEffect(() => {
    if (recoveryLoadedRef.current) return;
    recoveryLoadedRef.current = true;
    try {
      const draft = readMindmapRecovery(window.sessionStorage, project, collapseMapId);
      if (draft && (mapSignature(draft.mindmap) !== savedSignatureRef.current || hasMindmapCardRecoveryChanges(draft))) {
        recoveryDraftRef.current = draft;
        setRecoveryDraft(draft);
        setRecoveryStored(true);
        recoverySavedAtRef.current = draft.savedAt;
      } else if (draft) clearBrowserDraft();
    } catch { /* Keep malformed or unavailable recovery data untouched. */ }
  }, [clearBrowserDraft, collapseMapId, project]);
  useEffect(() => {
    if (recoveryLoadedRef.current && !recoveryDraftRef.current && dirty) preserveBrowserDraft();
  }, [dirty, mindmap, preserveBrowserDraft]);
  useEffect(() => {
    if (recoveryLoadedRef.current && !sessionWritable && (dirty || editingId)) preserveBrowserDraft();
  }, [dirty, editingId, preserveBrowserDraft, sessionWritable]);
  useEffect(() => {
    if (saveConflict) {
      if (localSaveState !== "conflict") setLocalSaveState("conflict");
    } else if (dirty) {
      if (!localSaveQueue.pending && localSaveState === "saved") setLocalSaveState("dirty");
    } else if (!localSaveQueue.pending && localSaveState !== "saved") {
      setLocalSaveState("saved");
    }
    if (dirty && remoteSaveState === "synced") setRemoteSaveState("pending");
  }, [dirty, localSaveState, remoteSaveState, saveConflict]);
  const descendantCounts = useMemo(() => countMindmapDescendants(mindmap), [mindmap]);
  const collapseTargetIds = useMemo(() => mindmap.nodes
    .filter(node => hierarchyDepths.get(node.id) === collapseDepth - 1 && (descendantCounts.get(node.id) || 0) > 0)
    .map(node => node.id), [mindmap.nodes, hierarchyDepths, collapseDepth, descendantCounts]);
  const depthCollapsed = collapseTargetIds.length > 0
    && [...hierarchyDepths].every(([id, depth]) => depth >= collapseDepth - 1 || !collapsedIds.has(id))
    && collapseTargetIds.every(id => collapsedIds.has(id));
  const expandAllFromToolbar = depthCollapsed || (collapseTargetIds.length === 0 && collapsedIds.size > 0);
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
    return runPaperMutation(async () => {
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
      recordPaperSourceHash(result.value.sourceHash);
      pendingConversionRefreshRef.current = { cardId: id, todoId: result.value.todoId };
      const latest = sessionRef.current;
      if (mapSignature(latest.mindmap) === mapSignature(requestMindmap)) {
        const hydrated = mindmapReducer(latest, { type: "hydrate", mindmap: saved });
        sessionRef.current = hydrated;
        dispatch({ type: "hydrate", mindmap: saved });
      } else {
        const merged = mergeSavedMindmap(requestMindmap, saved, latest.mindmap);
        const rebased = mindmapReducer(latest, { type: "revert", mindmap: merged });
        sessionRef.current = rebased;
        dispatch({ type: "revert", mindmap: merged });
      }
      const savedMapSignature = mapSignature(saved);
      savedSignatureRef.current = savedMapSignature;
      setSavedSignature(savedMapSignature);
      nextRemoteCheckpointRef.current = mindmapRemoteCheckpoint(saved);
      saveErrorRef.current = null;
      setSaveError(null);
      setLocalSaveState(mapSignature(sessionRef.current.mindmap) === savedMapSignature ? "saved" : "dirty");
      if (result.value.remote.status === "pushed") {
        setRemoteSaveState("synced");
        setRemoteSaveError(null);
      } else {
        setRemoteSaveState(result.value.remote.status === "unconfigured" ? "unconfigured" : result.value.remote.status === "pending" ? "pending" : "failed");
        setRemoteSaveError(result.value.remote.status === "unconfigured" ? null : result.value.remote.message);
      }
      router.refresh();
      scheduleRemote("OpenBar: convert mindmap card to paper TODO");
      return result;
    });
  }

  async function makeSelectedCardTodo() {
    const selectedCard = selected;
    if (!selectedCard || selectedCard.todoId || convertingCardIdRef.current || conversionStartingCardIdRef.current) return;
    const id = selectedCard.id;
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
    conversionStartingCardIdRef.current = id;
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
      if (conversionStartingCardIdRef.current === id) conversionStartingCardIdRef.current = null;
      // The ref may be populated by the refresh effect while the conversion
      // request is suspended. Keep the post-await read widened for TypeScript.
      const pending = pendingConversionRefreshRef.current as { cardId: string; todoId: string } | null;
      if (convertingCardIdRef.current === id && pending?.cardId !== id) convertingCardIdRef.current = null;
      setConvertingCardId((current) => current === id && pending?.cardId !== id ? null : current);
    }
  }

  const setTodoCompleted = useCallback(async (todoId: string, completed: boolean): Promise<boolean> => {
    if (readOnly || todoProgressBusy || !paperState?.paper?.todos.some(todo => todo.id === todoId)) return false;
    setTodoProgressBusy(true);
    setSaveError(null);
    try {
      const result = await runPaperMutation(async () => {
        const result = await persistPaperTodoAction(
          project,
          { type: completed ? "complete_todo" : "reopen_todo", id: todoId },
          paperSourceHashRef.current ?? paperState?.paper?.sourceHash,
        );
        if (result.ok) recordPaperSourceHash(result.diskHash);
        return result;
      });
      if (!result.ok) {
        setSaveError(result.message);
        return false;
      }
      // The local TeX mutation is durable even when Git sync fails. The
      // refresh projects local paper state into the card and paper views.
      router.refresh();
      scheduleRemote(`OpenBar: ${completed ? "complete" : "reopen"} paper TODO`);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not update the paper TODO.");
      return false;
    } finally {
      setTodoProgressBusy(false);
    }
  }, [paperState, project, readOnly, recordPaperSourceHash, router, runPaperMutation, scheduleRemote, todoProgressBusy]);

  const [progressNotice, setProgressNotice] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!progressNotice) return;
    const timer = window.setTimeout(() => setProgressNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [progressNotice]);

  async function updateSelectedProgress(progress: MindmapNode["progress"]) {
    if (!selected) return;
    setProgressNotice(null);
    setSaveError(null);
    dispatch({ type: "patch-node", id: selected.id, patch: { progress } });
    if (progress === undefined || progress === 6 || progress === "ditched") setProgressNotice({ id: selected.id, text: progress === undefined ? "Progress cleared" : progress === "ditched" ? "Marked ditched" : "Progress complete" });
  }

  function beginTextTransaction(nodeId = sessionRef.current.selectedId) {
    if (editBaselineRef.current) return;
    const node = sessionRef.current.mindmap.nodes.find(node => node.id === nodeId);
    if (!node) return;
    const content = cardContentForNodeWithPaperState(node, paperState);
    editBaselineRef.current = {
      mindmap: cloneMindmap(sessionRef.current.mindmap), nodeId, noteFields: new Set(),
      text: node.todoId ? `${content.title}${content.body ? `\n${content.body}` : ""}`.trim() : editableCardText(node),
      paperSourceHash: paperSourceHashRef.current,
    };
  }

  function finishTextTransaction(commitChanges = true) {
    const before = editBaselineRef.current;
    editBaselineRef.current = null;
    activeCardDraftRef.current = null;
    setRestoredCardDraft(null);
    setEditingId(null);
    if (!before) return;
    if (!commitChanges) {
      const baselineNode = indexMindmap(before.mindmap).nodeById.get(before.nodeId);
      const currentNode = indexMindmap(sessionRef.current.mindmap).nodeById.get(before.nodeId);
      // Cancel only this card's active fields. Other cards may have changed
      // while the editor was open and must remain in the live map.
      if (baselineNode && currentNode && !currentNode.todoId) {
        const action = { type: "edit-card" as const, id: before.nodeId, title: baselineNode.title || "", text: baselineNode.text, contentFormat: baselineNode.contentFormat };
        sessionRef.current = mindmapReducer(sessionRef.current, action);
        dispatch(action);
      }
      if (baselineNode && currentNode && before.noteFields.size) {
        const action = { type: "patch-node" as const, id: before.nodeId, transient: true, patch: {
          ...(before.noteFields.has("caption") ? { caption: baselineNode.caption } : {}),
          ...(before.noteFields.has("background") ? { caution: { ...currentNode.caution, background: baselineNode.caution?.background } } : {}),
        } };
        sessionRef.current = mindmapReducer(sessionRef.current, action);
        dispatch(action);
      }
      if (mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current) clearBrowserDraft();
      else preserveBrowserDraft();
      return;
    }
    dispatch({ type: "record-history", before: before.mindmap });
    if (mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current) clearBrowserDraft();
    else preserveBrowserDraft();
    setFocusRequest((current) => ({ id: before.nodeId, sequence: (current?.sequence || 0) + 1, center: centerOnEditRef.current }));
  }

  async function startEditing(id: string, center = centerOnEditRef.current) {
    if (readOnly) return;
    if (convertingCardIdRef.current === id) return;
    if (inlineEditorSessionRef.current?.nodeId === id) return;
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node) return;
    readAgentReply(id);
    if (editBaselineRef.current && editBaselineRef.current.nodeId !== id) finishTextTransaction(true);
    dispatch({ type: "select", id });
    beginTextTransaction(id);
    setViewMode("map");
    setFocusRequest((current) => ({ id, sequence: (current?.sequence || 0) + 1, center }));
    setEditingId(id);
  }

  const selectCard = useCallback((id: string, additive = false) => {
    readAgentReply(id);
    setMapSettingsOpen(false);
    setCardMenuOpen(true);
    dispatch({ type: "select", id, additive: additive || selectMultiple });
  }, [readAgentReply, selectMultiple]);

  const focusCard = useCallback((id: string) => {
    let parent = layout.nodeById.get(id)?.parentId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      setLocalCollapsed(parent, false);
      parent = layout.nodeById.get(parent)?.parentId;
    }
    selectCard(id);
    setViewMode("map");
    setFocusRequest(current => ({ id, sequence: (current?.sequence || 0) + 1 }));
  }, [layout.nodeById, selectCard, setLocalCollapsed]);

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
    preserveBrowserDraft();
  }

  function updateNodeNote(id: string, value: string) {
    if (readOnly) return;
    const before = editBaselineRef.current;
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node) return;
    const transient = before?.nodeId === id;
    if (transient) {
      before.noteFields.add("caption");
      before.noteFields.add("background");
    }
    const action: MindmapTreeAction = { type: "patch-node", id, transient,
      patch: { caption: value, caution: { ...node.caution, background: undefined } } };
    sessionRef.current = mindmapReducer(sessionRef.current, action);
    dispatch(action);
    preserveBrowserDraft();
  }

  async function saveAgentDraft(id: string) {
    if (readOnly) return;
    if (inlineEditorSessionRef.current?.nodeId === id && !await inlineEditorSessionRef.current.commit()) return;
    try {
      await persistWebMcpMutation({ type: "patch-node", id, patch: { agentDraft: undefined } }, undefined, "human");
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
    requestAnimationFrame(() => startEditing(id, true));
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

  const deleteCardBranch = useCallback(async (id: string) => {
    if (readOnly) return;
    try {
      if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
      if (!sessionWritableRef.current || remoteOutOfSyncRef.current || applyingRemoteRef.current || recoveryDraftRef.current) return;
      const branch = captureDeletedMindmapBranch(sessionRef.current.mindmap, id);
      if (!branch) return;
      const removedIds = new Set(branch.nodes.map(node => node.id));
      const action: MindmapTreeAction = { type: "delete-subtree", id };
      sessionRef.current = mindmapReducer(sessionRef.current, action);
      dispatch(action);
      setSaveError(null);
      setMoveNotice("");
      setDeletedBranchNotice({ token: newNodeId(), branch, expiresAt: Date.now() + 5000,
        collapsedIds: [...collapsedIdsRef.current].filter(nodeId => removedIds.has(nodeId)) });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not delete the card.");
    }
  }, [readOnly]);

  function deleteSelected() {
    void deleteCardBranch(sessionRef.current.selectedId);
  }

  async function revertDeletedBranch() {
    const notice = deletedBranchNotice;
    if (!notice || readOnly) return;
    if (Date.now() >= notice.expiresAt) { setDeletedBranchNotice(null); return; }
    try {
      if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
      if (!sessionWritableRef.current || remoteOutOfSyncRef.current || applyingRemoteRef.current || recoveryDraftRef.current) return;
      const restored = restoreDeletedMindmapBranch(sessionRef.current.mindmap, notice.branch);
      if (!restored.ok) {
        setDeletedBranchNotice(current => current?.token === notice.token ? { ...current, error: restored.message } : current);
        return;
      }
      if (restored.mindmap !== sessionRef.current.mindmap) {
        const action: MindmapTreeAction = { type: "replace", mindmap: restored.mindmap, selectedId: notice.branch.nodeId };
        sessionRef.current = mindmapReducer(sessionRef.current, action);
        dispatch(action);
        setLocalCollapsedIds(new Set([...collapsedIdsRef.current, ...notice.collapsedIds]));
      }
      setDeletedBranchNotice(current => current?.token === notice.token ? null : current);
    } catch (error) {
      setDeletedBranchNotice(current => current?.token === notice.token ? { ...current, error: error instanceof Error ? error.message : "Could not revert the deletion." } : current);
    }
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

  const toggleCollapse = useCallback((id = selected?.id, immediateChildrenOnly = false) => {
    if (!id) return;
    if (!(descendantCounts.get(id) || 0)) return;
    setSaveError(null);
    if (immediateChildrenOnly && collapsedIdsRef.current.has(id)) {
      setLocalCollapsedIds(expandMindmapImmediateChildren(collapsedIdsRef.current, sessionRef.current.mindmap.nodes, id));
    } else {
      setLocalCollapsed(id, !collapsedIdsRef.current.has(id));
    }
  }, [descendantCounts, selected?.id, setLocalCollapsed, setLocalCollapsedIds]);

  async function toggleDepthCollapse() {
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) return;
    setLocalCollapsedIds(new Set(expandAllFromToolbar ? [] : collapseTargetIds));
    setViewMode("map");
    if (!expandAllFromToolbar) {
      setFocusRequest(current => ({ id: mindmap.rootId, sequence: (current?.sequence || 0) + 1 }));
    }
  }

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

  const save = useCallback((): Promise<void> => {
    const job = localSaveQueue.enqueue(persistCurrentSnapshot).then(() => undefined, () => undefined);
    startTransition(async () => { await job; });
    return job;
  }, [localSaveQueue, persistCurrentSnapshot]);

  const flushPendingSaves = useCallback(async () => {
    if (inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) {
      throw new Error("Finish saving the open card before leaving this map.");
    }
    await imageUploadQueue.current;
    await localSaveQueue.idle();
    if (saveErrorRef.current) throw new Error(saveErrorRef.current);
    while (mapSignature(sessionRef.current.mindmap) !== savedSignatureRef.current) {
      await save();
      await localSaveQueue.idle();
      if (saveErrorRef.current) throw new Error(saveErrorRef.current);
    }
  }, [localSaveQueue, save]);

  const retrySave = useCallback(() => {
    preserveBrowserDraft();
    saveErrorRef.current = null;
    setSaveError(null);
    void flushPendingSaves().catch(error => setSaveError(error instanceof Error ? error.message : "Could not save the open card."));
  }, [flushPendingSaves, preserveBrowserDraft]);

  useEffect(() => {
    const browserWindow = window as Window & { __openbarFlushMindmap?: () => Promise<void> };
    browserWindow.__openbarFlushMindmap = flushPendingSaves;
    const releaseFiles = registerProjectFileEditor(project, async (operation, writing) => {
      await flushPendingSaves();
      const result = await operation();
      if (result.ok && writing) router.refresh();
      return result;
    });
    return () => {
      releaseFiles();
      if (browserWindow.__openbarFlushMindmap === flushPendingSaves) delete browserWindow.__openbarFlushMindmap;
    };
  }, [flushPendingSaves, project, router]);

  // Persist edits shortly after the user pauses.
  useEffect(() => {
    if (connectionState === "reconnecting" || !sessionWritable || !dirty || isPending || saveError || recoveryDraft) return;
    const timer = window.setTimeout(() => save(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [connectionState, dirty, isPending, mindmap, recoveryDraft, save, saveError, sessionWritable]);

  useEffect(() => {
    const hasPendingChanges = () => pendingImageUploads.current || inlineEditorSessionRef.current || localSaveQueue.pending
      || mapSignature(sessionRef.current.mindmap) !== savedSignatureRef.current;
    const flush = () => {
      if (!hasPendingChanges() || recoveryDraftRef.current) return;
      preserveBrowserDraft();
      if (!inlineEditorSessionRef.current && sessionWritableRef.current) void flushPendingSaves().catch(() => undefined);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (refreshingWithRecoveryRef.current) return;
      if (!hasPendingChanges()) return;
      flush();
      event.preventDefault();
      event.returnValue = "";
    };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushPendingSaves, localSaveQueue, preserveBrowserDraft]);

  const navigationPendingRef = useRef(false);
  useEffect(() => {
    const onNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href || navigationPendingRef.current) return;
      if (!pendingImageUploads.current && !inlineEditorSessionRef.current && !localSaveQueue.pending && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current) return;
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
    lastAcknowledgedMapRef.current = saved;
    persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
    nextRemoteCheckpointRef.current = mindmapRemoteCheckpoint(saved);
    sessionRef.current = mindmapReducer(sessionRef.current, { type: "hydrate", mindmap: saved });
    dispatch({ type: "hydrate", mindmap: saved });
    savedSignatureRef.current = mapSignature(saved);
    setSavedSignature(savedSignatureRef.current);
    setLocalSaveState("saved");
    setSaveError(null);
  }, []);

  const canHydrateMindmap = () => !isPending && !localSaveQueue.pending && !saveErrorRef.current && !recoveryDraftRef.current
    && !inlineEditorSessionRef.current && !editingId && !pendingImageUploads.current
    && webMcpSaveCountRef.current === 0 && !convertingCardIdRef.current
    && (!remoteQueue.isBusy || (reviewingRemoteRef.current && !remoteQueue.isRunning))
    && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current;
  const canAutoPull = () => sessionWritableRef.current && canHydrateMindmap() && !reviewingRemoteRef.current && !hydrationPendingRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]");
  const canAutoPush = () => sessionWritableRef.current && !isPending && !localSaveQueue.pending && !saveErrorRef.current && !recoveryDraftRef.current
    && !reviewingRemoteRef.current
    && !saveConflict && !applyingRemoteRef.current && !remoteOutOfSyncRef.current
    && !inlineEditorSessionRef.current && !editingId && !pendingImageUploads.current
    && webMcpSaveCountRef.current === 0 && !convertingCardIdRef.current && !remoteQueue.isBusy
    && mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current;
  const loadSavedProjectView = useCallback(() => Promise.all([
    loadBrowserMindmap(project, sessionRef.current.mindmap.id || "draft"),
    getBrowserEditablePaper(project),
  ]), [project]);
  const replyHydrationAllowed = useRef<() => boolean>(() => false);
  replyHydrationAllowed.current = () => canHydrateMindmap() && !isBackendUnavailable()
    && !editBaselineRef.current && !reviewingRemoteRef.current && !hydrationPendingRef.current
    && !applyingRemoteRef.current && !remoteOutOfSyncRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]")
    && !document.querySelector(".react-flow__node.dragging");
  useEffect(() => {
    const changedReply = agentReplies.some(reply => {
      const node = mindmap.nodes.find(item => item.id === reply.nodeId);
      return unreadNodeIds.has(reply.nodeId) && (!node
        || agentReplyContentHash(node, paperTodoFor(node, paperState)) !== reply.contentHash);
    });
    if (!changedReply || !replyHydrationAllowed.current()) return;
    let cancelled = false;
    const baseHash = persistedDiskHashRef.current;
    const basePaperHash = paperSourceHashRef.current;
    const activityGeneration = remoteQueue.activityGeneration;
    void loadSavedProjectView().then(([saved, paper]) => {
      if (cancelled || !saved || !paper || !replyHydrationAllowed.current() || persistedDiskHashRef.current !== baseHash
        || paperSourceHashRef.current !== basePaperHash || remoteQueue.activityGeneration !== activityGeneration) return;
      if ((saved.diskHash || mindmapDiskHash(saved)) !== baseHash || paper.bundle.bundleHash !== paperSourceHashRef.current) {
        paperMutationGenerationRef.current += 1;
        recordPaperSourceHash(paper.bundle.bundleHash);
        hydrateSavedMap(saved);
      }
      router.refresh();
    }).catch(error => {
      if (!cancelled && !isBackendTransportError(error) && !isBackendUnavailable()) console.warn("OpenBar could not refresh the agent reply", error);
    });
    return () => { cancelled = true; };
  }, [agentReplies, unreadNodeIds, replyReadRequest, mindmap, paperState, connectionState, dirty, editingId, isPending, recoveryDraft,
    applyingRemote, reviewingRemote, hydrationPending, remoteOutOfSync, localSaveState, remoteSaveState, imageUploads,
    hydrateSavedMap, loadSavedProjectView, recordPaperSourceHash, isBackendUnavailable, remoteQueue, router]);
  const setRemoteApplying = (applying: boolean) => {
    applyingRemoteRef.current = applying;
    if (applying) remoteOutOfSyncRef.current = true;
    setApplyingRemote(applying);
  };
  const requireMindmapHydration = (message: string) => {
    hydrationPendingRef.current = true;
    setHydrationPending(true);
    remoteOutOfSyncRef.current = true;
    setRemoteOutOfSync(true);
    setRemoteSaveError(message);
  };
  const withPullStorageWarning = (message: string) => (directPullBarrierRef.current && !directPullPersistedRef.current) || (forcePullRef.current && !forcePullRef.current.persisted)
    ? `${message} Keep this tab open. Browser recovery storage is unavailable.` : message;
  const markPullUncertain = (pending: PendingBrowserPull) => {
    directPullBarrierRef.current = pending.operationId;
    directPullPersistedRef.current = pending.persisted;
    setReconciliationPending(true);
    requireMindmapHydration(withPullStorageWarning("Git may have updated the project. Check the Git update before continuing."));
  };
  useEffect(() => {
    const operationId = readPendingBrowserPull(project);
    if (operationId) markPullUncertain({ operationId, persisted: true });
  }, [project]);
  const markForcePullUncertain = (reconcile: ForcePullReconciliation, pending: PendingForcePull) => {
    forceReconciliationRef.current = reconcile;
    forcePullRef.current = pending;
    setReconciliationPending(true);
    requireMindmapHydration(withPullStorageWarning("Git may have updated the project. Check the Git update before continuing."));
  };
  useEffect(() => {
    const token = readPendingForcePull(project);
    if (token) markForcePullUncertain(() => finishForceRequest("pull", () => finishForceProjectSyncAction(project, token, "", "", true)), { token, persisted: true });
  }, [project]);
  const applyPulledMindmap = async (pending?: PendingBrowserPull) => {
    if (pending) { directPullBarrierRef.current = pending.operationId; directPullPersistedRef.current = pending.persisted; }
    requireMindmapHydration(withPullStorageWarning("Git updates were applied. Reload the editor to continue."));
    const [saved, paper] = await loadSavedProjectView();
    if (!canHydrateMindmap()) throw new Error("Git updates arrived while this editor changed. Save your draft and reload the latest map.");
    if (!saved) { router.push(`/p/${project}/mindmap`); return; }
    if (!paper) throw new Error("The updated paper could not be loaded. Try reloading the editor.");
    paperMutationGenerationRef.current += 1;
    recordPaperSourceHash(paper.bundle.bundleHash);
    hydrateSavedMap(saved);
    if (directPullBarrierRef.current) {
      clearPendingBrowserPull(project, directPullBarrierRef.current);
      directPullBarrierRef.current = null;
      setReconciliationPending(false);
    }
    if (forcePullRef.current) { clearPendingForcePull(project, forcePullRef.current.token); forcePullRef.current = null; }
    hydrationPendingRef.current = false;
    setHydrationPending(false);
    await refreshRemoteStatus(false, false);
    router.refresh();
  };
  const retryHydration = async () => {
    if (applyingRemoteRef.current) return;
    setRemoteApplying(true);
    try {
      if (forceReconciliationRef.current) {
        await requireResolvedForcePull(forceReconciliationRef.current);
        forceReconciliationRef.current = null;
        setReconciliationPending(Boolean(directPullBarrierRef.current));
      }
      if (directPullBarrierRef.current) {
        await requireGitPullBarrier(project, directPullBarrierRef.current);
        setReconciliationPending(false);
      }
      await applyPulledMindmap();
    }
    catch (error) { if (!isBackendTransportError(error) && !isBackendUnavailable()) setRemoteSaveError(withPullStorageWarning(error instanceof Error ? error.message : "Could not reload the map. Try again.")); }
    finally { setRemoteApplying(false); }
  };
  const quickPull = async () => {
    if (applyingRemoteRef.current) return;
    if (!canAutoPull()) { quickPullErrorRef.current = "Save the current draft or use Git review before pulling updates."; setRemoteSaveError(quickPullErrorRef.current); return; }
    quickPullErrorRef.current = null;
    setRemoteApplying(true);
    let pulled = false;
    try {
      const result = await pullBrowserProject(project, markPullUncertain);
      if (!result.ok) throw new Error(result.message);
      pulled = true;
      await applyPulledMindmap(result);
    } catch (error) {
      if (isBackendTransportError(error) || isBackendUnavailable()) return;
      setRemoteSaveState("failed");
      const message = error instanceof Error ? error.message : "Could not pull Git updates.";
      quickPullErrorRef.current = pulled ? `Git updates were pulled, but the editor could not reload. ${message}`
        : hydrationPendingRef.current ? `Git may have updated the project. Reload the editor to check. ${message}` : message;
      setRemoteSaveError(withPullStorageWarning(quickPullErrorRef.current));
    } finally { setRemoteApplying(false); }
  };
  useGitAutoSync({
    project,
    isBusy: () => isBackendUnavailable() || !sessionWritable || checkingRemote || remoteQueue.isBusy || remoteQueue.editingRecently || Boolean(inlineEditorSessionRef.current) || isPending || reviewingRemoteRef.current || applyingRemoteRef.current,
    canPull: canAutoPull,
    canPush: canAutoPush,
    push: () => pushRemote("OpenBar: resume saved project sync"),
    check: () => refreshRemoteStatus(true, false),
    onApplying: setRemoteApplying,
    onApplied: applyPulledMindmap,
    onPullUncertain: markPullUncertain,
    onError: (message) => { if (isBackendUnavailable()) return; setRemoteSaveState("failed"); setRemoteSaveError(withPullStorageWarning(hydrationPendingRef.current ? `Reload the editor to confirm the saved project state. ${message}` : message)); },
  });

  const reloadSavedMap = useCallback(() => {
    if (isPending) return;
    if (!preserveBrowserDraft()) return;
    const draft = captureRecoveryDraft();
    startTransition(async () => {
      try {
        const mapId = sessionRef.current.mindmap.id || initialMindmap.id || "draft";
        const saved = await loadBrowserMindmap(project, mapId);
        if (!saved) throw new Error("The saved mindmap is unavailable.");
        recoveryDraftRef.current = draft;
        setRecoveryDraft(draft);
        editBaselineRef.current = null;
        activeCardDraftRef.current = null;
        inlineEditorSessionRef.current = null;
        setRestoredCardDraft(null);
        setEditingId(null);
        hydrateSavedMap(saved);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not reload the saved mindmap.");
      }
    });
  }, [captureRecoveryDraft, initialMindmap.id, isPending, project, hydrateSavedMap, preserveBrowserDraft]);

  const restoreBrowserDraft = useCallback(() => {
    const draft = recoveryDraftRef.current;
    if (!draft) return;
    const sameBase = draft.baseHash === persistedDiskHashRef.current;
    persistedDiskHashRef.current = draft.baseHash;
    const active = draft.activeCard;
    if (active) {
      const baseline = cloneMindmap(draft.mindmap);
      baseline.nodes = baseline.nodes.map(node => node.id === active.nodeId ? cloneMindmap(active.baseNode) : node);
      editBaselineRef.current = {
        mindmap: baseline, nodeId: active.nodeId, text: active.baseText,
        paperSourceHash: active.paperSourceHash, noteFields: new Set(active.noteFields),
      };
      activeCardDraftRef.current = active;
      setRestoredCardDraft(active);
      setEditingId(active.nodeId);
      setViewMode("map");
      let parent = draft.mindmap.nodes.find(node => node.id === active.nodeId)?.parentId;
      const visited = new Set<string>();
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        setLocalCollapsed(parent, false);
        parent = draft.mindmap.nodes.find(node => node.id === parent)?.parentId;
      }
      setFocusRequest(current => ({ id: active.nodeId, sequence: (current?.sequence || 0) + 1, center: true }));
    }
    const action = { type: "replace" as const, mindmap: draft.mindmap, selectedId: active?.nodeId };
    sessionRef.current = mindmapReducer(sessionRef.current, action);
    dispatch(action);
    recoveryDraftRef.current = null;
    setRecoveryDraft(null);
    const message = sameBase ? null : "conflict: The saved map changed while this draft was open. Your recovered edits are preserved. Download the draft or load the saved map to review both versions.";
    saveErrorRef.current = message;
    setSaveError(message);
    setLocalSaveState(sameBase ? "dirty" : "conflict");
  }, [dispatch, setLocalCollapsed]);

  const keepSavedMap = useCallback(() => {
    recoveryDraftRef.current = null;
    editBaselineRef.current = null;
    activeCardDraftRef.current = null;
    inlineEditorSessionRef.current = null;
    setRestoredCardDraft(null);
    setEditingId(null);
    setRecoveryDraft(null);
    clearBrowserDraft();
  }, [clearBrowserDraft]);

  const downloadBrowserDraft = useCallback(() => {
    const draft = recoveryDraftRef.current || captureRecoveryDraft();
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `openbar-${project}-${draft.mapId}-draft.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [captureRecoveryDraft, project]);

  const refreshWithDraft = useCallback(async () => {
    await localSaveQueue.idle();
    if (!preserveBrowserDraft()) return;
    refreshingWithRecoveryRef.current = true;
    window.location.reload();
  }, [localSaveQueue, preserveBrowserDraft]);

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
    if (event.defaultPrevented || isEditableTarget(target)) return;
    const key = event.key.toLowerCase();
    if (event.key === "Escape" && cardMenuOpen) {
      event.preventDefault();
      setCardMenuOpen(false);
      return;
    }
    if (target.closest("#mindmap-card-menu, button, a, input, textarea, select, .cm-editor")) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "a" && viewMode === "map" && target.closest(".mindmap-viewport")) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "select-many", ids: flowNodes.map(node => node.id) });
      return;
    }
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
      event.stopPropagation();
      if (!event.repeat) deleteSelected();
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
        renderVersion: `${editingId || ""}:${mindmap.fontSize || DEFAULT_MINDMAP_FONT_SIZE}:${shiftExpandHeld}`,
      }];
    })
  ), [editingId, layout, selectedIdSet, mindmap.fontSize, shiftExpandHeld]);

  const renderCard = useCallback((id: string) => {
    const node = layout.nodeById.get(id);
    const dimensions = layout.dimensions.get(id);
    if (!node || !dimensions) return null;
    const activityAt = nodeActivityAt(node, reconciliation);
    const parent = node.parentId ? layout.nodeById.get(node.parentId) : undefined;
    return (
      <CanvasNode
        project={project}
        fontSize={mindmap.fontSize || DEFAULT_MINDMAP_FONT_SIZE}
        readOnly={readOnly}
        uploading={imageUploads[node.id] || 0}
        onImageChange={update => updateCardImages(node.id, update)}
        onImageFiles={files => addImagesToCard(files, node.id)}
        node={node}
        cardContent={cardContentForNodeWithPaperState(node, paperState)}
        childNavigation={(layout.children.get(node.id) || []).map(child => ({
          id: child.id,
          ...cardContentForNodeWithPaperState(child, paperState),
          format: child.todoId ? "tex" : child.contentFormat,
        }))}
        parentNavigation={parent ? {
          id: parent.id,
          ...cardContentForNodeWithPaperState(parent, paperState),
          format: parent.todoId ? "tex" : parent.contentFormat,
        } : undefined}
        onJumpToCard={focusCard}
        completed={Boolean(paperTodoFor(node, paperState)?.completed)}
        todoBusy={todoProgressBusy}
        onToggleTodo={node.todoId ? completed => setTodoCompleted(node.todoId!, completed) : undefined}
        missing={Boolean(node.todoId && !paperTodoFor(node, paperState))}
        collapsed={collapsedIds.has(node.id)}
        collapsedDescendantCount={descendantCounts.get(node.id) || 0}
        shiftExpandHeld={shiftExpandHeld}
        coverage={coverageById.get(node.id)}
        activityLabel={activityNodeIds.has(node.id) ? Date.parse(activityAt) >= Date.parse(activitySince || "") ? relativeActivityLabel(activityAt) : "recent activity in this branch" : null}
        unreadReply={unreadNodeIds.has(node.id)}
        answeredRequest={answeredRequestNodeIds.has(node.id)}
        onRead={() => readAgentReply(node.id, node)}
        dimensions={dimensions}
        onMeasure={measureCard}
        onResizePreview={width => previewCardWidth(node.id, width)}
        onResizeCommit={width => commitCardWidth(node.id, width)}
        orphan={!layout.reachable.has(node.id)}
        selected={selectedIdSet.has(node.id)}
        editing={node.id === editingId}
        restoredDraft={restoredCardDraft?.nodeId === node.id ? restoredCardDraft : undefined}
        editSessionRef={inlineEditorSessionRef}
        dropPreviewKind={dropPreview?.targetId === node.id ? dropPreview.kind : null}
        dropPreviewLabel={dropPreview?.targetId === node.id ? dropPreviewLabel(dropPreview, layout.nodeById) : undefined}
        onToggleCollapse={immediateChildrenOnly => toggleCollapse(node.id, immediateChildrenOnly)}
        onDropTodo={(todoId) => placeUnplacedTodo(todoId, node.id)}
        onDraftActivity={() => { remoteQueue.noteEdit(); preserveBrowserDraft(); }}
        onTextChange={(text, contentFormat) => updateNodeText(node.id, text, contentFormat)}
        onNoteChange={value => updateNodeNote(node.id, value)}
        onSaveDraft={() => saveAgentDraft(node.id)}
        onDeleteDraft={() => void deleteCardBranch(node.id)}
        onTextFocus={() => beginTextTransaction(node.id)}
        onCommit={() => finishTextTransaction(true)}
        onCancel={() => finishTextTransaction(false)}
        onTodoCommit={async (todoTitle, todoText) => {
          if (convertingCardIdRef.current === node.id) return false;
          if (!node.todoId) return true;
          try {
            const result = await runPaperMutation(async () => {
              const baseline = editBaselineRef.current;
              const expectedSourceHash = (baseline?.nodeId === node.id ? baseline.paperSourceHash : undefined)
                ?? paperSourceHashRef.current ?? paperState?.paper?.sourceHash;
              const result = await persistPaperTodoAction(
                project,
                {
                  type: "update_todo",
                  id: node.todoId!,
                  title: todoTitle,
                  text: todoText,
                  textFormat: "tex",
                  expectedSourceHash,
                },
                expectedSourceHash,
              );
              if (result.ok) recordPaperSourceHash(result.diskHash);
              return result;
            });
            if (!result.ok) {
              setSaveError(result.message);
              return false;
            }
            // The local TeX write is the commit point for the card. A remote
            // failure is surfaced by the sync status but must not discard the
            // successfully saved editor draft.
            router.refresh();
            scheduleRemote("OpenBar: edit paper TODO");
            return true;
          } catch (error) {
            if (!isBackendTransportError(error) && !isBackendUnavailable()) setSaveError(error instanceof Error ? error.message : "Could not save the paper TODO.");
            return false;
          }
        }}
      />
    );
  }, [
    mindmap.fontSize,
    focusCard,
    activityNodeIds,
    activitySince,
    unreadNodeIds,
    answeredRequestNodeIds,
    readAgentReply,
    imageUploads,
    collapsedIds,
    shiftExpandHeld,
    coverageById,
    descendantCounts,
    dropPreview,
    editingId,
    restoredCardDraft,
    layout,
    paperState,
    project,
    reconciliation,
    recordPaperSourceHash,
    remoteQueue,
    router,
    runPaperMutation,
    scheduleRemote,
    selected?.id,
    selectedIdSet,
    readOnly,
    todoProgressBusy,
    setTodoCompleted,
    toggleCollapse,
    measureCard,
    previewCardWidth,
    commitCardWidth,
    deleteCardBranch,
  ]);

  const moveTargets = useMemo(() => {
    if (!selected) return [];
    const all = mindmapMoveTargets(mindmap, selected.id);
    const needle = moveQuery.trim().toLowerCase();
    return needle ? all.filter((item) => item.label.toLowerCase().includes(needle)) : all;
  }, [mindmap, moveQuery, selected]);

  const searchResults = (moveOpen ? moveTargets : mindmap.nodes
    .filter((node) => {
      const content = cardContentForNodeWithPaperState(node, paperState);
      return `${content.title} ${content.body} ${(node.tags || []).join(" ")}`.toLocaleLowerCase().includes(moveQuery.trim().toLocaleLowerCase());
    })
    .map((node) => ({ id: node.id, label: cardContentForNodeWithPaperState(node, paperState).title || "Untitled card" })))
    .map((result) => {
      const node = layout.nodeById.get(result.id);
      const parent = node?.parentId ? layout.nodeById.get(node.parentId) : undefined;
      const depth = hierarchyDepths.get(result.id);
      const below = descendantCounts.get(result.id) || 0;
      const context = [
        depth === 0 ? "Root" : depth === undefined ? "Outside root" : `Depth ${depth}`,
        below ? `${below} ${below === 1 ? "card" : "cards"} below` : layout.children.get(result.id)?.length ? "Branch" : "Leaf",
        parent ? `under ${cardContentForNodeWithPaperState(parent, paperState).title || "Untitled card"}` : undefined,
      ].filter(Boolean).join(" · ");
      return { ...result, context };
    });
  const visibleSearchResults = searchResults.slice(0, 60);
  const chooseSearchResult = (id: string) => {
    if (moveOpen) moveSelectedTo(id);
    else focusCard(id);
    setSearchOpen(false);
    setMoveOpen(false);
    setMoveQuery("");
  };

  const editorIssues: EditorIssue[] = [
    ...(saveError ? [{ id: "save", severity: saveConflict ? "conflict" as const : "error" as const, title: saveConflict ? "Saved file conflict" : "Saving needs attention", message: saveError }] : []),
    ...(remoteSaveError || remoteOutOfSync || hydrationPending || reviewingRemote ? [{ id: "git", severity: remoteOutOfSync || hydrationPending || remoteSaveState === "blocked" ? "conflict" as const : "error" as const, title: "Git synchronization", message: remoteSaveError || "Git needs review." }] : []),
    ...(accessError || (!sessionWritable && (dirty || editingId)) ? [{ id: "access", severity: "error" as const, title: "Editing access", message: accessMessage }] : []),
    ...(assetError ? [{ id: "asset", severity: "error" as const, title: "Image upload", message: assetError }] : []),
    ...(connectionState === "reconnecting" ? [{ id: "connection", severity: "connection" as const, title: "Connection to OpenBar", message: "Reconnecting…" }] : []),
  ];
  const primaryIssue = selectEditorIssue(editorIssues);
  const relatedIssues = editorIssues.filter(issue => issue.id !== primaryIssue?.id);

  const getMindmapDiagnostics = () => {
    const current = sessionRef.current;
    const draft = recoveryDraftRef.current || captureRecoveryDraft();
    const active = draft.activeCard;
    const lastAcknowledged = lastAcknowledgedMapRef.current;
    const fields = (node?: MindmapNode) => node ? {
      id: node.id, todoId: node.todoId, title: node.title, text: node.text,
      caption: node.caption, caution: node.caution, contentFormat: node.contentFormat,
      parentId: node.parentId, updatedAt: node.updatedAt,
    } : null;
    const changedIds = current.mindmap.nodes.filter(node => {
      const saved = lastAcknowledged.nodes.find(saved => saved.id === node.id);
      return JSON.stringify(fields(node)) !== JSON.stringify(fields(saved));
    }).map(node => node.id);
    const ids = [...new Set([active?.nodeId, current.selectedId, ...changedIds].filter((id): id is string => Boolean(id)))].slice(0, 20);
    return {
      kind: "mindmap", project, mapId: current.mindmap.id || "draft", issues: editorIssues,
      selectedCardId: current.selectedId, editedCardId: editBaselineRef.current?.nodeId || null,
      revision: current.revision, mapRevision: current.mindmap.revision,
      expectedDiskHash: persistedDiskHashRef.current,
      lastLoadedDiskHash: initialMindmap.diskHash, lastAcknowledgedDiskHash: lastAcknowledged.diskHash,
      currentMapDiskHash: current.mindmap.diskHash, paperSourceHash: paperSourceHashRef.current,
      savedSnapshotMeaning: "Last loaded or acknowledged state. Read get_mindmap and current paper files before merging with current hashes.",
      source: {
        mapFile: isPrimaryMindmap(current.mindmap) ? ".OpenBar/mindmap.tex" : `.OpenBar/mindmaps/${current.mindmap.id}.tex`,
        recoveryStorage: "sessionStorage", recoveryKey: mindmapRecoveryKey(project, draft.mapId),
      },
      saving: {
        writable: sessionWritableRef.current, readOnly, manualReadOnly,
        dirty: mapSignature(current.mindmap) !== savedSignatureRef.current,
        localState: localSaveState, queuePending: localSaveQueue.pending,
        saveError: saveErrorRef.current, remoteState: remoteSaveState, remoteError: remoteSaveError,
        remoteOutOfSync: remoteOutOfSyncRef.current, applyingRemote: applyingRemoteRef.current,
      },
      recovery: { stored: recoveryStored, savedAt: recoverySavedAtRef.current, capturedAt: draft.savedAt, awaitingReview: Boolean(recoveryDraftRef.current) },
      activeCard: active ? {
        ...active, baseNode: fields(active.baseNode),
        localNode: fields(draft.mindmap.nodes.find(node => node.id === active.nodeId)),
        lastAcknowledgedNode: fields(lastAcknowledged.nodes.find(node => node.id === active.nodeId)),
        lastLoadedPaperTodo: active.baseNode.todoId ? paperState?.paper?.todos.find(todo => todo.id === active.baseNode.todoId) : undefined,
      } : null,
      changedCards: ids.map(id => ({ id, local: fields(current.mindmap.nodes.find(node => node.id === id)), lastAcknowledged: fields(lastAcknowledged.nodes.find(node => node.id === id)) })),
      changedCardCount: changedIds.length,
    };
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
      <div className={styles.toolbar} role="group" aria-label="Mindmap controls">
        <div className={cn("p-glass-sm", paperStyles.toolbar, styles.projectBar)} role="group" aria-label="Map settings">
          {header}
          <div className={styles.fontTools}><MindmapFontSize value={mindmap.fontSize || DEFAULT_MINDMAP_FONT_SIZE} disabled={readOnly}
            onChange={fontSize => dispatch({ type: "set-font-size", fontSize })} /></div>
          <div className={styles.toolbarActions}>
          {selectMultiple && <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.iconButton)} aria-label="Finish selecting cards" aria-pressed="true" onClick={() => { setSelectMultiple(false); setCardMenuOpen(true); }}><CheckSquare size={18} /></button>}
          <Popover.Root open={mapSettingsOpen} onOpenChange={setMapSettingsOpen}>
            <FastTooltip label="Map options"><Popover.Trigger asChild><button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.iconButton)} aria-label="Open map settings"><MoreHorizontal size={18} /></button></Popover.Trigger></FastTooltip>
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
              <MindmapFontSizeSlider value={mindmap.fontSize || DEFAULT_MINDMAP_FONT_SIZE} disabled={readOnly}
                onChange={fontSize => dispatch({ type: "set-font-size", fontSize })} />
              <button type="button" className={styles.optionRow} aria-pressed={selectMultiple} onClick={() => { setSelectMultiple((value) => !value); setMapSettingsOpen(false); setCardMenuOpen(false); }}><CheckSquare size={15} />Select multiple{selectMultiple && <Check size={14} />}</button>
              <button type="button" className={styles.optionRow} onClick={() => { setViewMode("changes"); setMapSettingsOpen(false); }}><GitBranch size={15} />Change history</button>
              <button type="button" className={styles.optionRow} aria-pressed={readOnly} disabled={remoteOutOfSync} onClick={toggleReadOnly}><LockKeyhole size={15} />Read-only mode{readOnly && <Check size={14} />}</button>
              <button type="button" className={styles.optionRow} aria-pressed={centerOnEdit} onClick={() => setCenterOnEditPreference(!centerOnEdit)}><Crosshair size={15} />Center card while editing{centerOnEdit && <Check size={14} />}</button>
              <div className={styles.activityFilter}>
                <label className="mindmap-field">
                  <span>Highlight changes</span>
                  <Select label="Highlight changes" value={activityMode} onValueChange={(value) => {
                    const mode = value as "off" | "week" | "custom";
                    setActivityMode(mode);
                    setActivitySince(mode === "week" ? daysAgoDate(LAST_WEEK_DAYS) : mode === "custom" ? customActivityDate || null : null);
                  }} options={[{ value: "off", label: "Off" }, { value: "week", label: "Last 7 days" }, { value: "custom", label: "From a date" }]} />
                </label>
                {activityMode === "custom" && <label className="mindmap-field">
                  <span>From date</span>
                  <input type="date" aria-label="Highlight changes from date" value={customActivityDate} max={calendarDate(new Date())} onChange={(event) => {
                    setCustomActivityDate(event.target.value);
                    setActivitySince(event.target.value || null);
                  }} />
                </label>}
              </div>
              <button type="button" className={styles.optionRow} aria-expanded={showShortcuts} onClick={() => setShowShortcuts((open) => !open)}><Keyboard size={15} />Keyboard shortcuts</button>
              {showShortcuts && <dl className={styles.shortcutList}>
                <div><dt>Pan canvas</dt><dd>Drag background</dd></div><div><dt>Nest card</dt><dd>Drop on card</dd></div><div><dt>Reorder card</dt><dd>Drop on edge</dd></div><div><dt>Add child</dt><dd>Tab</dd></div><div><dt>Add sibling</dt><dd>Enter</dd></div><div><dt>Edit card</dt><dd>E / double-click</dd></div><div><dt>Reorder</dt><dd>Alt + ↑ / ↓</dd></div><div><dt>Indent / outdent</dt><dd>Alt + → / ←</dd></div><div><dt>Find card</dt><dd>/</dd></div><div><dt>Undo</dt><dd>⌘ / Ctrl + Z</dd></div>
              </dl>}
            </Popover.Content></Popover.Portal>
          </Popover.Root>
          </div>
        </div>
      </div>
      <div ref={controlDockRef} className={cn(styles.toolbar, styles.controlDock)} role="group" aria-label="Mindmap dock">
        <div className={styles.dockUtility}>
          <MapNavigationDock>
          <div data-map-history role="group" aria-label="Map history">
            <ToolbarButton title="Undo (⌘Z / Ctrl+Z)" onClick={undo} disabled={readOnly || !history.length}><Undo2 size={15} /></ToolbarButton>
            <ToolbarButton title="Redo (⌘⇧Z / Ctrl+Y)" onClick={redo} disabled={readOnly || !future.length}><Redo2 size={15} /></ToolbarButton>
            <span title={`${mindmap.nodes.length} cards`}>{mindmap.nodes.length} cards</span>
          </div>
          </MapNavigationDock>
      <div className={styles.resumeDock}>
        <BackendStatusNotice project={project} issues={editorIssues} diagnosticContext={getMindmapDiagnostics} openRequest={connectionDetailsOpenRequest} />
        <ResumeEditControl suppressError={primaryIssue?.id !== "access"} />
      </div>
        </div>
        <div className={cn("p-glass-sm", paperStyles.toolbar, styles.canvasTools)} role="group" aria-label="Map view controls">
          <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.unplacedToggle)} aria-label={`Unplaced paper TODOs, ${unplacedCount} ready to place on the map`} aria-expanded={unplacedOpen && unplacedCount > 0} title={`${unplacedCount} paper TODOs are ready to place on your mindmap`} onClick={() => { setUnplacedOpen((open) => !open); setViewMode("map"); }}><ListTodo size={15} aria-hidden="true" /><span className={styles.unplacedLabel}>Unplaced</span>{unplacedCount > 0 && <sup className={styles.unplacedBadge} aria-hidden="true">{unplacedCount}</sup>}</button>
          <div className={styles.canvasToolActions}>
          {viewMode === "changes" && <button type="button" className="p-button p-button-glass ob-glass-button" onClick={() => setViewMode("map")}>Back to map</button>}
          <div className={styles.depthControls}>
          <FastTooltip label={expandAllFromToolbar ? "Expand all cards" : `Collapse cards at depth ${collapseDepth} and deeper`}>
            <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.depthCollapse)} aria-label={expandAllFromToolbar ? "Expand all cards" : `Collapse all cards at depth ${collapseDepth} and deeper`}
              data-collapsed={depthCollapsed} aria-pressed={depthCollapsed} disabled={collapseTargetIds.length === 0 && collapsedIds.size === 0}
              onClick={() => void toggleDepthCollapse()}>
              {expandAllFromToolbar ? <ChevronsUpDown size={15} aria-hidden="true" /> : <ChevronsDownUp size={15} aria-hidden="true" />}
            </button>
          </FastTooltip>
          <Select label="Collapse depth" value={String(collapseDepth)} onValueChange={value => setCollapseDepth(Number(value))}
            className={cn("p-button p-button-glass ob-glass-button", styles.depthSelect)}
            options={Array.from({ length: maxCollapseDepth - 1 }, (_, index) => ({ value: String(index + 2), label: `${index + 2}+` }))} />
          </div>
          <Popover.Root open={searchOpen || moveOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setMoveOpen(false); }}>
            <Popover.Trigger asChild>
              <button ref={searchTriggerRef} type="button" className={cn("p-button p-button-glass ob-glass-button", styles.searchTrigger)} aria-label="Find a card" onClick={() => { setMoveQuery(""); setSearchIndex(0); }}>
                <Search size={15} /><span>Find a card</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content ref={searchPanelRef} className={styles.searchPanel} side="top" sideOffset={10} align="end" collisionPadding={12} aria-label={moveOpen ? "Move card" : "Find a card"}
                onCloseAutoFocus={(event) => { if (searchDismissedOutsideRef.current) event.preventDefault(); }}>
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
                  {visibleSearchResults.map((result, index) => <button key={result.id} id={`mindmap-search-result-${index}`} type="button" role="option" aria-selected={index === searchIndex} onMouseEnter={() => setSearchIndex(index)} onClick={() => chooseSearchResult(result.id)}>
                    <span className={styles.searchResultContent}>
                      <span className={styles.searchResultTitle} title={result.label}>{result.label}</span>
                      <small className={styles.searchResultContext} title={result.context}>{result.context}</small>
                    </span>
                    <span aria-hidden="true">↵</span>
                  </button>)}
                  {visibleSearchResults.length === 0 && <p>No matching cards.</p>}
                </div>
                <div className={styles.searchFooter}>{searchResults.length} cards · ↑ ↓ to choose · Enter to {moveOpen ? "move" : "jump"} · / to search</div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <FastTooltip label="Add a child to the selected card (Tab)"><button type="button" aria-label="Add card" className={cn("p-button p-button-glass ob-glass-button", styles.primaryButton)} disabled={readOnly} onClick={() => addChild()}><Plus size={16} /><span>Add card</span></button></FastTooltip>
          <div
            className={styles.saveStatus}
            role="status"
            aria-live="polite"
            data-local-save-state={localSaveState}
            data-remote-save-state={remoteSaveState}
          >
            <SaveSyncStatus iconOnly className={cn("p-button p-button-glass ob-glass-button", paperStyles.unifiedStatus)} saved={!dirty && localSaveState === "saved"} saving={localSaveState === "saving"}
              conflict={saveConflict || localSaveState === "conflict"} remote={remoteSaveState}
              error={primaryIssue?.message} onConnectionIssue={() => setConnectionDetailsOpenRequest(value => value + 1)} onRetry={sessionWritable ? () => { void pushRemote("OpenBar: retry saved project sync"); } : undefined} />
          </div>
          </div>
        </div>
      </div>
      <div className="mindmap-workspace">

        <div
          className="mindmap-viewport"
          tabIndex={0}
          role="application"
          aria-label={`Mindmap ${viewMode} view. Tab adds a child. Enter adds a sibling. E edits the selected card.`}
        >
          {viewMode === "map" ? (<div className={styles.canvasLayout}>
          {unplacedOpen && unplacedCount > 0 && <MindmapUnplacedTray project={project} paperState={paperState} nodes={mindmap.nodes} selectedParentId={selected?.id || mindmap.rootId} onPlaceTodo={placeUnplacedTodo} />}
          <div className={styles.canvasSurface}>
          <MindmapCanvas
            virtualize={mindmap.nodes.length > 80 && !editingId && flowNodes.every(node => measuredCards.has(node.id))}
            mindmap={mindmap}
            selectMultiple={selectMultiple}
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

        {assetError && primaryIssue?.id === "asset" && <p className="mindmap-save-error" role="alert">{assetError} <button type="button" onClick={() => setAssetError(null)}>Dismiss</button></p>}


        {deletedBranchNotice ? <div className={styles.moveNotice} role="status">
          <span>{deletedBranchNotice.error || (deletedBranchNotice.branch.nodes.length > 1
            ? `${deletedBranchNotice.branch.nodes.length - 1} child card${deletedBranchNotice.branch.nodes.length === 2 ? "" : "s"} also deleted`
            : "Card deleted")}</span>
          <button type="button" aria-label="Revert deletion" disabled={readOnly} onClick={revertDeletedBranch}>Revert↩</button>
        </div> : moveNotice && <div className={styles.moveNotice} role="status"><Check size={14} /><span>{moveNotice}</span><button type="button" onClick={() => { undo(); setMoveNotice(""); }}>Undo</button></div>}

      </div>

      {recoveryDraft && <div className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs" role="status">
        <p>A browser draft from {new Date(recoveryDraft.savedAt).toLocaleString()} is preserved.
          {recoveryDraft.baseHash !== persistedDiskHashRef.current && " The saved map has a newer revision."}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="p-button p-button-primary btn-primary" onClick={restoreBrowserDraft}>Restore draft</button>
          <button type="button" className="p-button p-button-default btn-outline" onClick={downloadBrowserDraft}>Download draft</button>
          <button type="button" className="p-button p-button-borderless btn-ghost" onClick={keepSavedMap}>Keep saved map</button>
        </div>
      </div>}
      {!sessionWritable && (dirty || editingId) && <EditorNotice suppressed={primaryIssue?.id !== "access"} relatedIssues={relatedIssues} project={project} title="Editing access changed" label="Editing paused, draft preserved" message="Your open card text remains available to select and copy. Download the map draft before refreshing." diagnosticContext={getMindmapDiagnostics} paused>
        <button type="button" className="p-button p-button-default btn-outline" onClick={downloadBrowserDraft}>Download map draft</button>
      </EditorNotice>}
      {saveError && <EditorNotice suppressed={primaryIssue?.id !== "save"} relatedIssues={relatedIssues} project={project} title={outdatedSave ? "Refresh OpenBar to continue" : saveConflict ? "Saved file conflict" : "Saving needs attention"} label={outdatedSave ? "OpenBar updated, draft preserved" : saveConflict ? "Editing paused, saved file changed" : "Saving needs attention"}
        message={outdatedSave
          ? recoveryStored ? "OpenBar was updated while this page was open. Your draft is preserved in this tab. Refresh, then restore the draft to finish saving."
            : "OpenBar was updated while this page was open. Keep this tab open or download your draft. Browser recovery storage is currently unavailable."
          : recoveryStored === false ? `${saveError} Keep this tab open or download the draft before refreshing.` : saveError}
        report={outdatedSave ? saveError : undefined} diagnosticContext={getMindmapDiagnostics} paused={saveConflict}>
        <button type="button" className="p-button p-button-default btn-outline" onClick={outdatedSave ? () => void refreshWithDraft() : saveConflict ? reloadSavedMap : retrySave}>{outdatedSave ? "Refresh and retry" : saveConflict ? "Load saved map" : "Retry save"}</button>
        <button type="button" className="p-button p-button-default btn-outline" onClick={downloadBrowserDraft}>Download draft</button>
      </EditorNotice>}
      {(hydrationPending || remoteSaveError || remoteOutOfSync || reviewingRemote) && <OverleafSyncNotice suppressed={primaryIssue?.id !== "git"} relatedIssues={relatedIssues} floating
        project={project} message={remoteSaveError || "Git review is in progress."} editingPaused={remoteOutOfSync || hydrationPending} activeReview={reviewingRemote}
        quickPullAvailable={quickPullAvailable} onQuickPull={() => void quickPull()} pulling={applyingRemote}
        hydrationPending={hydrationPending} onReload={() => void retryHydration()}
        reconciliationPending={reconciliationPending} onPullUncertain={markForcePullUncertain}
        disabled={!sessionWritable || isPending || applyingRemote} checking={checkingRemote || remoteSaveState === "syncing"}
        beforeReview={async () => { reviewingRemoteRef.current = true; remoteQueue.pause(); setReviewingRemote(true); await flushPendingSaves(); return true; }}
        onApplied={async (pending) => { if (pending) forcePullRef.current = pending; forceReconciliationRef.current = null; setReconciliationPending(false); try { await applyPulledMindmap(); } catch (error) { if (!isBackendTransportError(error) && !isBackendUnavailable()) setRemoteSaveError(withPullStorageWarning(error instanceof Error ? error.message : "Could not reload the map. Try again.")); } }}
        onClosed={() => { reviewingRemoteRef.current = false; remoteQueue.resume(); setReviewingRemote(false); void refreshRemoteStatus(false); }}
        onCheck={async () => { await refreshRemoteStatus(); }}
        onPush={() => { void pushRemote("OpenBar: save mindmap"); }}
      />}

      {!cardMenuOpen && viewMode === "map" && selectedCards.length > 0 && (
        <FastTooltip label="Open card inspector"><button
          type="button"
          className={styles.inspectorHandle}
          aria-label={`Open card inspector for ${selectedCards.length === 1 ? "selected card" : `${selectedCards.length} selected cards`}`}
          onClick={() => setCardMenuOpen(true)}
        >
          <PanelRight size={18} />
          {selectedCards.length > 1 && <span>{selectedCards.length}</span>}
        </button></FastTooltip>
      )}

      {(cardMenuOpen || inspectorPresent) && selectedCards.length > 1 && (
        <MultiCardInspector
          open={cardMenuOpen}
          cards={selectedCards}
          rootId={mindmap.rootId}
          projectLabels={projectLabels}
          readOnly={readOnly}
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
            <FastTooltip label="Close card actions"><button
              type="button"
              className="mindmap-icon-button"
              aria-label="Close card actions"
              onClick={() => setCardMenuOpen(false)}
            >
              <X size={16} />
            </button></FastTooltip>
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
                  <label className="mindmap-card-menu-row">
                    <input
                    type="checkbox"
                    checked={Boolean(selectedTodo.completed)}
                    aria-label="TODO completed"
                    className="h-4 w-4 accent-accent"
                    disabled={readOnly || todoProgressBusy}
                    onChange={event => void setTodoCompleted(selected.todoId!, event.target.checked)}
                    />
                    <span>Complete TODO</span>
                  </label>
                  <a className="mindmap-card-menu-row" href={"/p/" + project + "/paper#" + encodeURIComponent(selected.todoId)}>
                    <Link2 size={14} aria-hidden="true" />
                    <span>Jump to paper</span>
                  </a>
                </>
              )}
            </div>

          {selected.id === mindmap.rootId && !selected.todoId && (
            <div className="px-4 pb-4">
              <label className="mindmap-field">
                <span>Root card content</span>
                <textarea
                  aria-label="Root card content"
                  placeholder="Add context below the title…"
                  rows={4}
                  value={selectedCardContent?.body || ""}
                  disabled={readOnly}
                  onChange={event => {
                    setSaveError(null);
                    dispatch({ type: "edit-card", id: selected.id, title: selectedCardContent?.title || "", text: event.target.value });
                  }}
                />
              </label>
            </div>
          )}

          {selectedMissing && (
            <div className="mindmap-card-menu-warning" role="status">
              <div>
                <strong>Paper TODO missing</strong>
                <span>{selected.todoId}</span>
              </div>
              <div className="mindmap-card-menu-actions">
                <button
                  type="button"
                  className="p-button p-button-default btn-outline"
                  onClick={() => {
                    const content = selectedCardContent || { title: "Recovered paper TODO", body: "" };
                    dispatch({ type: "unbind-todo", id: selected.id, title: content.title, text: content.body });
                  }}
                >
                  Convert to ordinary card
                </button>
                <button
                  type="button"
                  className="p-button p-button-default btn-outline text-danger"
                  onClick={() => {
                    setCardMenuOpen(false);
                    void deleteCardBranch(selected.id);
                  }}
                >
                  Delete card
                </button>
              </div>
              {availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).length > 0 && (
                <label className="mindmap-field">
                  <span>Relink to paper TODO</span>
                  <Select label="Relink to paper TODO" placeholder="Choose an available TODO…"
                    options={availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).map(todo => ({ value: todo.id, label: todo.text }))}
                    onValueChange={todoId => dispatch({ type: "bind-todo", id: selected.id, todoId })}
                  />
                </label>
              )}
            </div>
          )}

          <section className={styles.inspectorGroup}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section">
            <div className="mindmap-card-menu-section-body">
              <div className="mindmap-field">
                <span>Labels</span>
                {(selected.tags || []).length > 0 && (
                  <div className="mindmap-chip-list">
                    {(selected.tags || []).map((tag) => (
                      <FastTooltip key={tag} label={"Remove " + tag}><button
                        type="button"
                        className="mindmap-chip"
                        onClick={() => dispatch({
                          type: "patch-node",
                          id: selected.id,
                          patch: { tags: (selected.tags || []).filter((item) => item !== tag) },
                        })}
                      >
                        {tag}
                        <X size={11} aria-hidden="true" />
                      </button></FastTooltip>
                    ))}
                  </div>
                )}
                <input
                  value={labelDraft}
                  list="mindmap-label-suggestions"
                  maxLength={MAX_MINDMAP_LABEL_CHARS}
                  placeholder="Add a label…"
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
                <ChoiceButtons label="Card priority" value={selected.priority || ""} options={["P0", "P1", "P2", "P3"].map(value => ({value,label:value}))} onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { priority: value as MindmapNode["priority"] } })} onClear={() => dispatch({ type: "patch-node", id: selected.id, patch: { priority: undefined } })} />
              </div>
            </div>
          </div>
          </fieldset>
          </section>

          <section className={styles.inspectorGroup}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section">
            <div className="mindmap-card-menu-section-body">
              <div className={"mindmap-field " + styles.progressField}>
                <span>Progress</span>
                <ProgressCircles
                  value={selected.progress}
                  label="Card progress"
                  disabled={todoProgressBusy}
                  onChange={updateSelectedProgress}
                />
                {progressNotice?.id === selected.id && <small role="status">{progressNotice.text}</small>}
              </div>
              <div className="mindmap-field">
                <span>Format</span>
                {selected.todoId ? <span className="mindmap-paper-format-note">TeX shared with the paper</span> : (
                <ChoiceButtons label="Card content format" value={selected.contentFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"MD"},{value:"tex",label:"TeX"}]} onChange={(value) => dispatch({ type: "patch-node", id: selected.id, patch: { contentFormat: value as MindmapNode["contentFormat"] } })} />
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
                <AccentPicker key={selected.id} value={selected.color || ""} label="Card accent" onChange={(color) => dispatch({ type: "patch-node", id: selected.id, patch: { color } })} />
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
                <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2 text-xs text-muted">
                  <span className="mindmap-field-label">Images</span><span className="text-accent">Add image…</span>
                  <input type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="Add card images" onChange={(event) => { addImagesToCard(Array.from(event.target.files || []), selected.id); event.target.value = ""; }} />
                </label>
                <div className="mindmap-card-asset-grid">
                  {selectedRefs.filter((ref) => ref.kind === "figure").map((ref) => {
                    const href = artifactHref(project, ref);
                    return (
                      <div key={ref.kind + ":" + ref.id} className="mindmap-card-asset-item">
                        <FastTooltip label={ref.label || ref.id}><a href={href} target="_blank" rel="noreferrer" className="mindmap-card-asset">
                          {/\.pdf$/i.test(ref.id) ? <span>Open PDF</span> : <img src={href} alt={ref.label || "Card image"} loading="lazy" />}
                        </a></FastTooltip>
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
          </section>

          <InspectorSection id="more" open={Boolean(inspectorSections.more)} onToggle={() => toggleInspectorSection("more")}>
          <fieldset disabled={readOnly || convertingCardId === selected.id} className="mindmap-card-menu-fields">
          <CautionEditor key={selected.id} value={selected.caution} caption={selected.caption}
            onNotesChange={value => updateNodeNote(selected.id, value)}
            onChange={caution => dispatch({ type: "patch-node", id: selected.id, patch: { caution } })} />
          <CardLinks key={`links:${selected.id}`} project={project} refs={selectedRefs} onChange={refs => dispatch({ type: "patch-node", id: selected.id, patch: { refs } })} />
          <CardProperties key={`properties:${selected.id}`} value={selected.metadata} onChange={metadata => dispatch({ type: "patch-node", id: selected.id, patch: { metadata } })} />
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
                  void runPaperMutation(async () => {
                    const result = await removePaperTodoAction(project, selected.todoId!, paperSourceHashRef.current ?? paperSourceHash);
                    if (result.ok) recordPaperSourceHash(result.diskHash);
                    return result;
                  }).then((result) => {
                      if (!result.ok) {
                        setSaveError(result.message);
                        return;
                      }
                      router.refresh();
                      scheduleRemote("OpenBar: remove paper TODO");
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
                  Delete card
                </button>
              </>
            )}
          </div>
          </fieldset>
          </InspectorSection>
        </aside>
      )}
    </section>
  );
}

function commonCardValue<T>(cards: MindmapNode[], read: (card: MindmapNode) => T): T | null {
  const first = read(cards[0]!);
  return cards.every((card) => Object.is(read(card), first)) ? first : null;
}

function MultiCardInspector({ open, cards, rootId, projectLabels, readOnly, onClose, onPatch, onUpdateTag }: {
  open: boolean;
  cards: MindmapNode[];
  rootId: string;
  projectLabels: string[];
  readOnly: boolean;
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
  const mixed = <small className="mindmap-mixed-value">Mixed values. Choose one to apply it to {cards.length} cards</small>;

  return (
    <aside id="mindmap-card-menu" data-state={open ? "open" : "closed"} aria-hidden={!open} inert={!open} className={styles.inspector} aria-label="Card inspector" aria-describedby="mindmap-card-menu-description">
      <div className="mindmap-card-menu-header">
        <div className="mindmap-card-menu-heading min-w-0">
          <div className="min-w-0">
            <span className="mindmap-card-menu-kicker"><span className="mindmap-card-menu-dot" aria-hidden="true" />Multiple selection</span>
            <h2 id="mindmap-card-menu-title" className="mindmap-card-menu-title">{cards.length} cards selected</h2>
          </div>
        </div>
        <FastTooltip label="Close card actions"><button type="button" className="mindmap-icon-button" aria-label="Close card actions" onClick={onClose}><X size={16} /></button></FastTooltip>
      </div>
      <p id="mindmap-card-menu-description" className="sr-only">Shared controls for {cards.length} selected cards.</p>
      <p className={styles.multiSelectionHint}>Shift-click cards to add or remove them from this selection.</p>

      <section className={styles.inspectorGroup}>
        <fieldset disabled={readOnly} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section"><div className="mindmap-card-menu-section-body">
            <div className="mindmap-field">
              <span>Common labels</span>
              {commonTags.length > 0 && <div className="mindmap-chip-list">{commonTags.map((tag) => <FastTooltip key={tag} label={`Remove ${tag} from selected cards`}><button type="button" className="mindmap-chip" onClick={() => onUpdateTag(tag, "remove")}>{tag}<X size={11} aria-hidden="true" /></button></FastTooltip>)}</div>}
              <input
                value={labelDraft}
                list="mindmap-label-suggestions"
                maxLength={MAX_MINDMAP_LABEL_CHARS}
                placeholder="Add a label…"
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
                options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))}
                onChange={(value) => onPatch({ priority: value ? value as MindmapNode["priority"] : undefined })}
                onClear={() => onPatch({ priority: undefined })}
              />
            </div>
          </div></div>
        </fieldset>
      </section>

      <section className={styles.inspectorGroup}>
        <fieldset disabled={readOnly} className="mindmap-card-menu-fields">
          <div className="mindmap-card-menu-section"><div className="mindmap-card-menu-section-body">
            {allOrdinary && (
              <div className={"mindmap-field " + styles.progressField}>
                <span>Progress</span>
                {progress === null && mixed}
                <ProgressCircles value={progress ?? undefined} label="Selected cards progress" onChange={(value) => onPatch({ progress: value })} />
              </div>
            )}
            {allOrdinary && (
              <div className="mindmap-field">
                <span>Format</span>
                {contentFormat === null && mixed}
                <ChoiceButtons<string>
                  label="Selected cards content format"
                  value={contentFormat ?? "__mixed__"}
                  options={[{ value: "plain", label: "Plain" }, { value: "markdown", label: "MD" }, { value: "tex", label: "TeX" }]}
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
              <AccentPicker key={cards.map((card) => card.id).join(" ")} value={color} label="Selected cards accent" onChange={(color) => onPatch({ color })} />
            </div>
          </div></div>
        </fieldset>
      </section>
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

function AccentPicker({ value, label, onChange }: {
  value: string | null;
  label: string;
  onChange: (color: string | undefined) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  function choose(color?: string) {
    setCustomOpen(false);
    onChange(color);
  }
  return <>
    <div className="mindmap-color-palette" role="group" aria-label={`${label} palette`}>
      {CARD_PALETTE.map((option) => <FastTooltip key={option.value} label={option.label}><button type="button" className={cn("mindmap-color-swatch", value === option.value && "mindmap-color-swatch-selected")} style={{ backgroundColor: option.value }} aria-label={option.label + " accent"} aria-pressed={value === option.value} onClick={() => choose(option.value)} /></FastTooltip>)}
      <FastTooltip label="Use default accent"><button type="button" className={cn("mindmap-color-swatch mindmap-color-swatch-auto", value === "" && "mindmap-color-swatch-selected")} aria-label="Use default accent" aria-pressed={value === ""} onClick={() => choose()}>Auto</button></FastTooltip>
      <FastTooltip label="Custom accent"><button type="button" className="mindmap-color-swatch mindmap-color-swatch-auto" aria-label={`Custom ${label.toLowerCase()}`} aria-expanded={customOpen} onClick={() => setCustomOpen((open) => !open)}><Pencil size={13} aria-hidden="true" /></button></FastTooltip>
    </div>
    {customOpen && <input autoFocus value={value ?? ""} onChange={(event) => onChange(event.target.value.trim() || undefined)} placeholder="#785ef0 or CSS color" aria-label={`Custom ${label.toLowerCase()} value`} />}
  </>;
}

function MindmapUnplacedTray({ project, paperState, nodes, selectedParentId, onPlaceTodo }: {
  project: string;
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
        if (event.button !== 0 || target.closest("[data-place-todo], a")) return;
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
      <div className={styles.unplacedTitle}><FastTooltip label="Drag onto a card"><button type="button" data-todo-drag-handle aria-label={`Drag ${todo.title || "paper TODO"}`}>⠿</button></FastTooltip><strong><NodeRichText text={todo.title || "Paper TODO"} format="tex" /></strong><FastTooltip label="Open in editor"><Link className={styles.unplacedOpen} href={`/p/${project}/paper#${encodeURIComponent(todo.id)}`} aria-label="Open TODO in editor"><FileText size={15} aria-hidden="true" /></Link></FastTooltip></div>
      <div className={styles.unplacedCopy}><NodeRichText text={todo.text} format="tex" /></div>
      <FastTooltip label={`Place under ${destinationLabel}`}><button type="button" data-place-todo onClick={() => onPlaceTodo(todo.id, selectedParentId)}>Place under selected card</button></FastTooltip>
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
  childNavigation,
  parentNavigation,
  onJumpToCard,
  completed,
  todoBusy,
  onToggleTodo,
  missing,
  collapsed,
  collapsedDescendantCount,
  shiftExpandHeld,
  coverage,
  activityLabel,
  unreadReply,
  answeredRequest,
  onRead,
  dimensions,
  onMeasure,
  onResizePreview,
  onResizeCommit,
  orphan,
  selected,
  editing,
  restoredDraft,
  editSessionRef,
  dropPreviewKind,
  dropPreviewLabel,
  onToggleCollapse,
  onDropTodo,
  onDraftActivity,
  onTextChange,
  onNoteChange,
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
  childNavigation: CardNavigationItem[];
  parentNavigation?: CardNavigationItem;
  onJumpToCard: (id: string) => void;
  completed: boolean;
  todoBusy: boolean;
  onToggleTodo?: (completed: boolean) => Promise<boolean>;
  missing: boolean;
  collapsed: boolean;
  collapsedDescendantCount: number;
  shiftExpandHeld: boolean;
  coverage?: { complete: number; total: number };
  activityLabel?: string | null;
  unreadReply: boolean;
  answeredRequest: boolean;
  onRead: () => void;
  dimensions: Dimensions;
  fontSize: number;
  onMeasure: (id: string, size: Dimensions) => void;
  onResizePreview: (width: number | undefined) => void;
  onResizeCommit: (width: number | undefined) => void;
  orphan: boolean;
  selected: boolean;
  editing: boolean;
  restoredDraft?: MindmapCardRecoveryDraft;
  editSessionRef: RefObject<InlineCardSession | null>;
  dropPreviewKind: MindmapDrop["kind"] | null;
  dropPreviewLabel?: string;
  onToggleCollapse: (immediateChildrenOnly?: boolean) => void;
  onDropTodo: (todoId: string) => void;
  onDraftActivity: () => void;
  onTextChange: (text: string, contentFormat?: MindmapNode["contentFormat"]) => void;
  onNoteChange: (value: string) => void;
  onTextFocus: () => void;
  onSaveDraft: () => Promise<void>;
  onDeleteDraft: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onTodoCommit?: (title: string, text: string) => Promise<boolean>;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const collapsedChildCount = shiftExpandHeld ? childNavigation.length : collapsedDescendantCount;
  const expandChildLabel = `Expand ${collapsedChildCount} ${shiftExpandHeld ? "immediate " : ""}child card${collapsedChildCount === 1 ? "" : "s"}`;
  const activityDescription = activityLabel
    ? activityLabel === "recent activity in this branch" ? "Recent activity in this branch" : `Recent activity: ${activityLabel}`
    : undefined;
  const [imageDropActive, setImageDropActive] = useState(false);
  const tableFitKey = node.cardWidth === undefined && node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0
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
  const displayTitle = answeredRequest ? cleanAgentReplyDisplay(title) : title;
  const displayBody = answeredRequest ? cleanAgentReplyDisplay(body) : body;
  const tags = node.tags || [];
  const initial = node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node);
  const [draft, setDraft] = useState(initial);
  const [commitError, setCommitError] = useState<string | null>(null);
  const commitInFlightRef = useRef<Promise<boolean> | null>(null);
  const finishedRef = useRef(false);
  const [draftFormat, setDraftFormat] = useState<MindmapNode["contentFormat"]>(node.contentFormat || "plain");
  const draftFormatRef = useRef(draftFormat);
  draftFormatRef.current = draftFormat;
  const [formatHint, setFormatHint] = useState("");
  const editingNodeRef = useRef<string | null>(null);
  const editorRef = useRef<TexCodeMirrorHandle>(null);
  const commit = useCallback((): Promise<boolean> => {
    if (finishedRef.current) return Promise.resolve(true);
    if (commitInFlightRef.current) return commitInFlightRef.current;
    if (readOnly) return Promise.resolve(false);
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
  }, [draft, draftFormat, initial, node.todoId, onTextChange, onCommit, onTodoCommit, readOnly]);

  const getDraft = useCallback((): InlineCardDraft | null => {
    if (finishedRef.current) return null;
    return {
      text: editorRef.current?.getLiveSource() ?? draft,
      contentFormat: draftFormatRef.current || "plain",
      selection: editorRef.current?.getSelection() ?? undefined,
    };
  }, [draft]);

  const cancel = () => {
    if (commitInFlightRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  useEffect(() => {
    if (!editing) return;
    const session = { nodeId: node.id, commit, getDraft };
    editSessionRef.current = session;
    const finishOutside = (event: Event) => {
      const belongsToEditor = event.composedPath().some((target) => target instanceof Element && (
        target.getAttribute("data-mind-editor") === node.id
        || target.matches('[role="toolbar"][aria-label="Card formatting"]')
        || target.matches("[data-editor-notice]")
      ));
      if (belongsToEditor) return;
      void commit();
    };
    document.addEventListener("pointerdown", finishOutside, true);
    return () => {
      if (editSessionRef.current === session) editSessionRef.current = null;
      document.removeEventListener("pointerdown", finishOutside, true);
    };
  }, [editing, node.id, commit, getDraft, editSessionRef]);

  function formatSelection(kind: "bold" | "italic") {
    const syntax = node.todoId || draftFormat === "tex" ? "tex" : "markdown";
    const applied = editorRef.current?.format(syntax, kind);
    if (applied && !node.todoId && draftFormat === "plain") {
      draftFormatRef.current = "markdown";
      setDraftFormat("markdown");
      onDraftActivity();
    }
    setFormatHint(applied ? "" : "Select a word or phrase to format.");
  }
  useEffect(() => {
    if (editing && editingNodeRef.current !== node.id) {
      finishedRef.current = false;
      draftFormatRef.current = restoredDraft?.contentFormat || node.contentFormat || "plain";
      setDraftFormat(draftFormatRef.current);
      setFormatHint("");
      setDraft(restoredDraft?.text ?? (node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node)));
      setCommitError(null);
      editingNodeRef.current = node.id;
    } else if (!editing) {
      editingNodeRef.current = null;
      setCommitError(null);
    }
  }, [editing, node.id, title, body, restoredDraft]);
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
      requestAnimationFrame(() => {
        if (restoredDraft?.selection) editorRef.current?.setSelection(restoredDraft.selection.from, restoredDraft.selection.to);
        else editorRef.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, restoredDraft]);
  return (
    <>
    <NodeToolbar
      isVisible={editing && !readOnly}
      position={Position.Top}
      align="start"
      offset={8}
      className={cn(styles.editToolbar, "p-glass-sm nodrag nopan")}
      data-mind-editor={node.id}
      role="toolbar"
      aria-label="Card formatting"
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}
    >
      <FastTooltip label="Bold (⌘B / Ctrl+B)"><button type="button" className={styles.editToolbarButton} aria-label="Bold selection" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("bold")}><Bold size={15} /></button></FastTooltip>
      <FastTooltip label="Italic (⌘I / Ctrl+I)"><button type="button" className={styles.editToolbarButton} aria-label="Italic selection" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("italic")}><Italic size={15} /></button></FastTooltip>
      {node.todoId ? <span className="mindmap-inline-editor-hint" title="Paper TODO formatting is saved in TeX">TeX</span> : (
        <ChoiceButtons label="Editing card content format" value={draftFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"Markdown"},{value:"tex",label:"TeX"}]} onChange={(value) => { draftFormatRef.current = value as MindmapNode["contentFormat"]; setDraftFormat(draftFormatRef.current); onDraftActivity(); }} />
      )}
      <span className="mindmap-inline-editor-divider" />
      <FastTooltip label="Done (⌘Enter / Ctrl+Enter)"><button type="button" className={styles.editToolbarButton} aria-label="Finish editing card" onClick={() => void commit()}><Check size={15} /><span>{node.agentDraft ? "Keep draft" : "Done"}</span></button></FastTooltip>
      {formatHint && <span className="mindmap-format-hint" role="status">{formatHint}</span>}
    </NodeToolbar>
    <article
      ref={cardRef}
      data-drop-kind={dropPreviewKind || undefined}
      data-mind-node={node.id}
      data-child-navigation={childNavigation.length > 0 || undefined}
      data-mind-editor={editing ? node.id : undefined}
      role="treeitem"
      aria-selected={selected}
      aria-label={displayTitle || mindmapNodeLabel(node)}
      aria-description={activityDescription}
      onClickCapture={onRead}
      className={cn(
        "mindmap-node-card",
        node.todoId && "mindmap-node-todo",
        node.parentId === null && "mindmap-node-root",
        node.agentDraft && styles.agentDraft,
        node.shape === "callout" && "mindmap-node-callout",
        orphan && "mindmap-node-orphan",
        selected && "mindmap-node-selected",
        imageDropActive && "mindmap-image-drop-active",
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
      {unreadReply && <span className={styles.unreadReply} role="img" aria-label="Unread agent reply" title="Unread agent reply" />}
      {activityDescription && <FastTooltip label={activityDescription}><span className={styles.activityBadge} role="img" tabIndex={0} aria-label={activityDescription} /></FastTooltip>}
      {node.todoId && (
        <div className={styles.todoHeading}>
          <label className={cn(styles.todoKind, styles.todoTick, "nodrag nopan")} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
            <input type="checkbox" checked={completed} disabled={readOnly || missing || todoBusy || editing}
              aria-label={`TODO completed: ${title || body}`}
              onChange={event => void onToggleTodo?.(event.target.checked)} />
            Paper TODO
          </label>
          {missing
            ? <span className={cn(styles.todoStatus, styles.todoMissing)}><AlertCircle size={12} aria-hidden="true" />Missing in paper</span>
            : <ProgressCircles value={node.progress === "ditched" ? "ditched" : completed ? 6 : node.progress ?? 0} compact label="TODO status" />}
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
            texHighlighting={Boolean(node.todoId) || draftFormat === "tex"}
            inlineFormatting={node.todoId || draftFormat === "tex" ? "tex" : draftFormat === "markdown" ? "markdown" : undefined}
            value={editingNodeRef.current !== node.id ? restoredDraft?.text ?? draft : draft}
            onChange={(value) => {
              onDraftActivity();
              setDraft(value);
              setFormatHint("");
              if (commitError) setCommitError(null);
            }}
            onFocus={onTextFocus}
            onCommit={() => void commit()}
            onCancel={cancel}
            placeholder="Card text"
            className="overflow-hidden"
          />
          {commitError && <small className="mt-1 block text-danger" role="alert">{commitError}</small>}
        </div>
      ) : (
        <>
          {node.todoId ? (
            <div className="mindmap-node-todo-text">
              {displayTitle.trim() && <div className="mindmap-node-todo-title"><NodeRichText text={displayTitle} format="tex" /></div>}
              {displayBody.trim() && <div className="mindmap-node-detail"><NodeRichText text={displayBody} format="tex" /></div>}
            </div>
          ) : (
            <>
              {!displayTitle.trim() && !displayBody.trim() && <div className={styles.cardPlaceholder}>New card</div>}
              {displayTitle.trim() && <div className={cn("mindmap-node-title", node.parentId === null && styles.rootTitle)}>{node.parentId === null ? <><span className={styles.rootAccent} aria-hidden="true" /><div className={styles.rootSubject}><NodeRichText text={displayTitle} format={node.contentFormat} tableLayout={node.tableLayout} /></div></> : <NodeRichText text={displayTitle} format={node.contentFormat} tableLayout={node.tableLayout} />}</div>}
              {displayBody.trim() && <div className="mindmap-node-detail"><NodeRichText text={displayBody} format={node.contentFormat} tableLayout={node.tableLayout} /></div>}
            </>
          )}
        </>
      )}
          <CardCaution caution={node.caution} />
          {(uploading > 0 || node.refs?.some(ref => ref.kind === "figure")) && (
            <CardImages project={project} refs={node.refs || []} readOnly={readOnly} uploading={uploading}
              onChange={onImageChange} />
          )}
          {node.agentDraft && !readOnly && <div className={cn(styles.draftActions, "nodrag nopan")} data-mind-editor={node.id} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <FastTooltip label="Save card"><button type="button" aria-label="Save card" onClick={() => void onSaveDraft()}><Check size={13} /></button></FastTooltip>
            <FastTooltip label="Delete draft"><button type="button" aria-label="Delete draft" onClick={onDeleteDraft}><X size={13} /></button></FastTooltip>
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
            {node.priority && <span className="mindmap-node-priority" data-priority={node.priority} aria-label={`Priority ${node.priority}`}>{node.priority}</span>}
            {tags.slice(0, 2).map((tag) => <span className="mindmap-node-tag" key={tag}>{tag}</span>)}
            {tags.length > 2 && <span className="mindmap-node-tag">+{tags.length - 2}</span>}
          </div>
          <CardScratchpad text={node.caption} background={node.caution?.background} editing={editing} readOnly={readOnly}
            onChange={onNoteChange} onCommit={() => void commit()} onCancel={cancel}
            footer={hasCardLinks(node.refs) ? <CardLinkIndicator project={project} refs={node.refs || []} /> : undefined} />
      {!editing && <ParentNavigation cardTitle={title || "Untitled card"} item={parentNavigation} onJump={onJumpToCard} />}
      {!editing && <ChildNavigation parentTitle={title || "Untitled card"} items={childNavigation} onJump={onJumpToCard} />}
      {!readOnly && <CardResizeGrip width={dimensions.width} onPreview={onResizePreview} onCommit={onResizeCommit} />}
      {collapsedDescendantCount > 0 && (
        <TooltipProvider delayDuration={650} skipDelayDuration={0}>
        <FastTooltip label={collapsed ? shiftExpandHeld ? `${expandChildLabel}. Keep deeper branches collapsed.` : "Expand child cards. Shift-click to expand immediate children." : "Collapse all child cards"}><button
          type="button"
          className={cn("mindmap-collapse-toggle", collapsed && "mindmap-collapse-toggle-visible")}
          aria-label={collapsed ? expandChildLabel : `Collapse ${collapsedDescendantCount} child cards`}
          aria-expanded={!collapsed}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleCollapse(event.shiftKey);
          }}
          onKeyDown={(event) => {
            if (event.shiftKey && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              event.stopPropagation();
              onToggleCollapse(true);
            }
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {collapsed ? (
            <span className={cn(styles.collapseCount, "tabular-nums")} aria-hidden="true">+{collapsedChildCount}</span>
          ) : (
            <Minus size={12} strokeWidth={2.75} aria-hidden="true" />
          )}
        </button></FastTooltip>
        </TooltipProvider>
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
  return progressLabel(progress);
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
    <FastTooltip label={title}><button
      type="button"
      ref={buttonRef}
      aria-label={ariaLabel || title}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      onClick={onClick}
      className={cn("mindmap-toolbar-button", danger && "mindmap-toolbar-button-danger")}
    >
      {children}
    </button></FastTooltip>
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
  const { nodeById, childrenByParent: children } = indexMindmap(mindmap);
  const displayTextById = new Map(visibleNodes.map((node) => [node.id, paperTodoText(node, paperState)]));
  const dimensions = new Map<string, Dimensions>();
  for (const node of visibleNodes) {
    const size = nodeDimensions(node, displayTextById.get(node.id));
    const extra = extraHeight?.get(node.id) || 0;
    const measured = measuredCards?.get(node.id);
    const fittedTable = node.cardWidth === undefined && node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0;
    const widthMatches = measured && (fittedTable
      ? measured.width <= size.width && measured.width >= Math.min(NODE_WIDTH, size.width)
      : Math.abs(measured.width - size.width) < 1);
    dimensions.set(node.id, measured && widthMatches
      ? { width: measured.width, height: measured.height }
      : { ...size, height: size.height + extra });
  }
  const { positions, reachable, connected } = layoutMindmapTree(mindmap, dimensions, collapsedIds);
  const recoveryAnchorId = positions.has(mindmap.rootId)
    ? mindmap.rootId
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

function ProgressGlyph({ value, size = 24 }: { value: NonNullable<MindmapNode["progress"]>; size?: number }) {
  if (value === "ditched") return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path d="m5.3 5.3 13.4 13.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>;
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
  if (compact) return <span role="img" className={styles.progressCompact} aria-label={`${label}: ${progressLabel(value)}`} title={`${label}: ${progressLabel(value)}`}><ProgressGlyph value={value ?? 0} size={16} /></span>;
  return <div className={styles.progressChoices} role="group" aria-label={label}>
    {MINDMAP_PROGRESS_STATES.map((state) => <FastTooltip key={state} label={state === "ditched" ? "Ditched" : state === 6 ? "Finished" : state === 0 ? "Ready to start" : `${Math.round(state / 6 * 100)}%`}><button type="button" aria-label={state === "ditched" ? `Mark ${label.toLowerCase()} ditched` : state === 6 ? `Finish ${label.toLowerCase()}` : `${label}: ${state} of 6`} aria-pressed={state === value} disabled={disabled} onClick={() => onChange?.(state === value ? undefined : state)}><ProgressGlyph value={state} /></button></FastTooltip>)}
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
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select, .cm-editor")));
}
