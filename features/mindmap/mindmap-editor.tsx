"use client";

import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { BackendStatusNotice } from "@/components/backend-status-notice";
import { isBackendTransportError } from "@/lib/backend-connection";
import { selectEditorIssue, type EditorIssue } from "@/lib/editor-issue-priority";
import { registerProjectFileEditor } from "@/features/project-files-bridge";

import "katex/dist/katex.min.css";
import { Select } from "@/components/select";
import { getBrowserEditablePaper } from "@/features/paper/browser-source";
import { FastTooltip } from "@/components/fast-tooltip";
import { PopoverSurface } from "@/components/pop";
import paperStyles from "@/features/paper/paper-outline-rail.module.css";
import styles from "./mindmap-editor.module.css";
import { HtmlCardTools } from "./html-card-tools";
import { cardFormatPatch } from "./html-card-editing";
import { htmlCardValidationError } from "@/lib/mindmap/html-card";
import { RichText as NodeRichText } from "@/components/rich-text";
import { CardLinkNavigation } from "./linked-card";
import { connectCardLinkHistory, sameMapCardId } from "./card-link-history";
import { ChildNavigation, type CardNavigationItem } from "./child-navigation";
import { ParentNavigation } from "./parent-navigation";
import { MapNavigationDock } from "./map-navigation-dock";
import { CardResizeGrip } from "./card-resize-grip";
import { RequestRevision } from "./request-revision";
import { PaperTodoPicker } from "./paper-todo-picker";
import { CardLinkButton } from "./card-link-button";
import { useAgentReplies } from "./use-agent-replies";
import { agentReplyContentHash, visibleAgentAnswer, visibleAgentTitle } from "@/lib/research/agent-reply-state";
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
  FileText,
  Bold,
  Italic,
  Keyboard,
  ListFilter,
  ListPlus,
  ListTodo,
  Link2,
  LockKeyhole,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Search,
  Sparkles,
  PanelRight,
  GitBranch,
  Undo2,
  X,
} from "lucide-react";

import { markAgentDraft, withAgentTableFormat } from "@/lib/mindmap/agent-draft";
import { diffChangedWordSpans, draftChangesByNode, type DraftChangeInfo } from "@/lib/mindmap/draft-diff";
import { isLockedMindmapEditIntent } from "@/lib/mindmap/locked-edit-intent";
import { focusedMindmapCardId } from "@/lib/mindmap/focused-card";
import { markdownTableColumns, startsWithMarkdownTable } from "@/lib/mindmap/markdown-table";
import { ChoiceButtons } from "@/components/choice-buttons";
import { countMindmapDescendants } from "@/lib/mindmap-index";
import { CARD_NOTE_FIELDS, restoreCardNotes, type CardNoteField } from "@/lib/mindmap/caution";
import { readTodoCardRecovery, todoCardRecoveryKey, writeTodoCardRecovery, type TodoCardRecovery } from "@/lib/mindmap/todo-card-recovery";
import { analyzePaper } from "@/lib/research/paper-analysis";
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
  MAX_AUTO_TABLE_WIDTH,
  VERTICAL_GAP,
  layoutMindmapTree,
  nodeDimensions,
} from "@/lib/mindmap/layout";
import { indentMindmapNode, outdentMindmapNode, type MindmapDrop } from "@/lib/mindmap/drop-targets";
import { DEFAULT_MINDMAP_FONT_SIZE, mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { createMindmapSaveQueue } from "@/lib/mindmap/save-queue";
import { mergeSavedMindmap, rebaseSavedMindmap } from "@/lib/mindmap/merge-saved";
import { captureDeletedMindmapBranch, restoreDeletedMindmapBranch, type DeletedMindmapBranch } from "@/lib/mindmap/deleted-branch";
import { isOutdatedMindmapPage, loadBrowserMindmap, saveBrowserMindmap } from "@/lib/mindmap/browser-save";
import { editedCardBaselines, hasMindmapCardRecoveryChanges, mindmapRecoveryKey, readMindmapRecovery, recoverableMindmapDraft, recoveryBaseContentHash, writeMindmapRecovery, type MindmapCardRecoveryDraft, type MindmapRecoveryDraft } from "@/lib/mindmap/browser-recovery";
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
  mindmapWriteAccess,
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
import { CardScratchpad } from "./card-scratchpad";
import { RecoveryCardReview } from "./recovery-card-review";
import { CautionEditor } from "./caution-editor";
import { MindmapCanvas, type MindmapFocusRequest } from "./mindmap-canvas";
import { MindmapChangesView } from "./mindmap-changes";
import { CardLinkIndicator, CardLinks, CardMetadataPills, CardProperties, hasCardLinks, type LinkPickerOptions } from "./card-details";
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
  const focusCardRef = useRef<(id: string) => void>(() => {});
  const { writable: sessionWritable, setPendingWork, connectionState, isBackendUnavailable, accessMessage, accessError, inboxRevision } = useProjectWriteSession();
  const [connectionDetailsOpenRequest, setConnectionDetailsOpenRequest] = useState(0);
  const [saveConflictAttention, setSaveConflictAttention] = useState(0);
  const [resumeEditAttentionRequest, setResumeEditAttentionRequest] = useState(0);
  const lastBlockedSignalAtRef = useRef(0);
  const manualReadOnlyRef = useRef(false);
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
    const allowed = ["select", "select-many", "clear-selection", "replace", "hydrate", "ack-save", "begin-card-history", "record-history", "edit-card", "edit-text"];
    if (remoteOutOfSyncRef.current && !allowed.includes(action.type) && !(action.type === "patch-node" && action.transient)) return;
    if (!["select", "select-many", "clear-selection", "replace", "hydrate", "ack-save", "begin-card-history", "record-history"].includes(action.type)) remoteQueue.noteEdit();
    rawDispatch(action);
  }, [remoteQueue]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const { mindmap, selectedId, selectedIds, past: history, future, revision } = session;
  const persistedDiskHashRef = useRef(initialMindmap.diskHash || mindmapDiskHash(initialMindmap));
  const lastAcknowledgedMapRef = useRef(initialMindmap);
  const [recoveryReviewOpen, setRecoveryReviewOpen] = useState(false);
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
  const editBaselineRef = useRef<{ baseNode: MindmapNode; nodeId: string; noteFields: Set<CardNoteField>; text: string; paperSourceHash?: string } | null>(null);
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
  const { replies: agentReplies, unreadNodeIds, answeredRequests, markRead: markReplyRead } = useAgentReplies(project, collapseMapId, inboxRevision, persistedDiskHashRef.current);
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
    const key = (event: globalThis.KeyboardEvent) => update(event.shiftKey || event.altKey);
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
      const hasUnpushed = (status.ahead || 0) > 0 || !status.isClean;
      if (!hasUnpushed) setRemoteSaveError(null);
      setRemoteSaveState(current => hasUnpushed ? (current === "failed" || current === "blocked" ? current : "pending") : refreshRemote || current === "synced" ? "synced" : "local");
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
    const baseNode = baseline?.baseNode;
    const activeCard = baseline && baseNode && live ? {
      nodeId: baseline.nodeId,
      ...live,
      baseNode: cloneMindmap(baseNode),
      baseText: baseline.text,
      paperSourceHash: baseline.paperSourceHash,
      noteFields: [...baseline.noteFields],
    } : baseline && !inlineEditorSessionRef.current ? activeCardDraftRef.current || undefined : undefined;
    activeCardDraftRef.current = activeCard || null;
    const local = sessionRef.current.mindmap;
    const saved = lastAcknowledgedMapRef.current;
    const hasBaseline = (saved.diskHash || recoveryBaseContentHash(saved)) === persistedDiskHashRef.current;
    return {
      version: 1,
      project,
      mapId: sessionRef.current.mindmap.id || "draft",
      baseHash: persistedDiskHashRef.current,
      savedAt: new Date().toISOString(),
      mindmap: cloneMindmap(local),
      ...(hasBaseline ? { baseCards: editedCardBaselines(saved, local), baseContentHash: recoveryBaseContentHash(saved) } : {}),
      ...(activeCard ? { activeCard } : {}),
    };
  }, [project]);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveBrowserDraft = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    const draft = recoveryDraftRef.current || captureRecoveryDraft();
    let stored = false;
    try { stored = writeMindmapRecovery(window.sessionStorage, draft); }
    catch { /* Browser storage can be disabled. Keep the live editor open. */ }
    if (stored) recoverySavedAtRef.current = draft.savedAt;
    setRecoveryStored(stored);
    return stored;
  }, [captureRecoveryDraft]);
  const schedulePreserveBrowserDraft = useCallback(() => {
    if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      preserveBrowserDraft();
    }, 400);
  }, [preserveBrowserDraft]);
  useEffect(() => {
    const flush = () => {
      if (recoveryTimerRef.current !== null) preserveBrowserDraft();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (recoveryTimerRef.current !== null) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [preserveBrowserDraft]);
  const clearBrowserDraft = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
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
      const saved = await saveBrowserMindmap(project, snapshot, persistedDiskHashRef.current, actor, lastAcknowledgedMapRef.current);
      lastAcknowledgedMapRef.current = saved;
      persistedDiskHashRef.current = saved.diskHash ?? mindmapDiskHash(saved);
      const savedMapSignature = mapSignature(saved);
      savedSignatureRef.current = savedMapSignature;
      setSavedSignature(savedMapSignature);
      if (!rebaseSavedMindmap(snapshot, saved, sessionRef.current.mindmap)) {
        throw new Error("conflict: This card changed while saving. Your edits are preserved. Load the saved map to review both versions.");
      }
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

  const currentWebMcpWriteAccess = useCallback(() => mindmapWriteAccess({
    sessionWritable: sessionWritableRef.current,
    backendUnavailable: isBackendUnavailable(),
    viewOnly: manualReadOnlyRef.current,
    recoveredDraft: Boolean(recoveryDraftRef.current),
    applyingUpdates: applyingRemoteRef.current || hydrationPendingRef.current,
    remoteConflict: remoteOutOfSyncRef.current,
    reviewingRemote: reviewingRemoteRef.current,
    savedFileConflict: Boolean(saveErrorRef.current && /conflict|changed.*reload|stale/i.test(saveErrorRef.current)),
  }), [isBackendUnavailable]);
  const persistWebMcpMutation = useCallback(async (
    action: MindmapTreeAction | ((current: MindmapSession) => MindmapTreeAction | null),
    expectedRevision?: number,
    actor: "human" | "webmcp" = "webmcp",
  ): Promise<Mindmap> => {
    webMcpSaveCountRef.current += 1;
    try {
      return await localSaveQueue.enqueue(async () => {
        const assertWriteAccess = () => {
          const access = currentWebMcpWriteAccess();
          if (!access.writable) throw Object.assign(new Error(access.reason), { code: access.code });
        };
        assertWriteAccess();
        // Flush pending human edits before attributing an agent operation.
        await persistCurrentSnapshot("human");
        assertWriteAccess();
        const current = sessionRef.current;
        if (expectedRevision !== undefined && current.revision !== expectedRevision) {
          throw Object.assign(
            new Error(`Live mindmap revision is ${current.revision}, not ${String(expectedRevision)}.`),
            { code: "stale_live_state" },
          );
        }
        const nextAction = typeof action === "function" ? action(current) : action;
        if (!nextAction) return current.mindmap;
        let nextSession = mindmapReducer(current, nextAction);
        if (nextSession.mindmap === current.mindmap) return current.mindmap;
        const keepSelection = actor === "webmcp" && focusedMindmapCardId(current.selectedId) && nextSession.selectedId !== current.selectedId
          ? { type: "select-many" as const, ids: [...current.selectedIds.filter(id => id !== current.selectedId), current.selectedId] } : undefined;
        if (keepSelection) nextSession = mindmapReducer(nextSession, keepSelection);
        sessionRef.current = nextSession;
        dispatch(nextAction);
        if (keepSelection) dispatch(keepSelection);
        return persistCurrentSnapshot(actor);
      });
    } finally {
      webMcpSaveCountRef.current -= 1;
    }
  }, [currentWebMcpWriteAccess, localSaveQueue, persistCurrentSnapshot]);

  useMindmapWebMcp({
    sharedActions: sharedWebMcpActions,
    getSnapshot: () => {
      const current = sessionRef.current.mindmap;
      const activeCardId = focusedMindmapCardId(sessionRef.current.selectedId)
        || (inlineEditorSessionRef.current?.getDraft() ? inlineEditorSessionRef.current.nodeId : undefined);
      return {
        project,
        mapId: current.id || "draft",
        title: current.title,
        fontSize: current.fontSize || DEFAULT_MINDMAP_FONT_SIZE,
        cardWidthMode: current.cardWidthMode ?? "individual",
        role: current.role,
        isPrimary: isPrimaryMindmap(current),
        revision: sessionRef.current.revision,
        diskHash: persistedDiskHashRef.current,
        remoteSync: remoteSyncRef.current,
        writeAccess: {
          ...currentWebMcpWriteAccess(),
          ...(activeCardId ? { activeCardId } : {}),
        },
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
    focusNode: (id) => focusCardRef.current(id),
    setViewPreferences: ({ centerOnEdit }) => setCenterOnEditPreference(centerOnEdit),
    hasTodo: (todoId) => Boolean(paperState?.paper?.todos.some((todo) => todo.id === todoId)),
    addNode: async (parentId, text, expectedRevision, title, caution, caption, presentation) => {
      const id = newNodeId();
      const appearance = presentation ? { ...presentation, progress: presentation.progress ?? undefined, cardWidth: presentation.cardWidth ?? undefined } : undefined;
      await persistWebMcpMutation({ type: "add-node", parentId, id, text, title: title ?? (presentation?.contentFormat === "html" ? "" : undefined), caution, caption, agentDraft: true, presentation: appearance }, expectedRevision);
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
      const assertCardAvailable = () => {
        const active = inlineEditorSessionRef.current;
        if (focusedMindmapCardId(sessionRef.current.selectedId) === id || (active?.nodeId === id && active.getDraft())) {
          throw Object.assign(new Error("The human is editing this card. Add an Agent draft child or contribute to another card while the input stays open."), { code: "active_card_edit" });
        }
      };
      assertCardAvailable();
      if (convertingCardIdRef.current === id) {
        throw Object.assign(
          new Error(`Mindmap card "${id}" is being converted to a paper TODO. Retry after the conversion finishes.`),
          { code: "stale_live_state" },
        );
      }
      const nodePatch: MindmapNodePatch = {};
      if (patch.agentDraft === true) nodePatch.agentDraft = true;
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
        assertCardAvailable();
        const node = indexMindmap(current.mindmap).nodeById.get(id);
        if (!node) return null;
        const updated = markAgentDraft({ ...node, ...nodePatch }, node);
        return { type: "patch-node", id, patch: { ...nodePatch, ...(updated.agentDraft ? { agentDraft: true } : {}) } };
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
    linkTodo: (id, todoId, expectedRevision) => linkCardToExistingTodo(id, todoId, expectedRevision, "webmcp"),
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
        return convertCardToTodo(id, sectionId, expectedRevision, requestId, "webmcp");
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
    setCardWidthMode: async (cardWidthMode, revision) => {
      await persistWebMcpMutation({ type: "set-card-width-mode", cardWidthMode }, revision);
    },
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
          if (hash) focusCardRef.current(hash);
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
    if (window.matchMedia("(max-width: 1279px)").matches) {
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
  const [convertingTodoCard, setConvertingTodoCard] = useState(false);
  const todoCardRecoveryRef = useRef(new Map<string, TodoCardRecovery>());
  convertingCardIdRef.current = convertingCardId;
  const [todoProgressBusy, setTodoProgressBusy] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [cardFilter, setCardFilter] = useState<"all" | "todos" | "drafts" | "active">("all");
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchDismissedOutsideRef = useRef(false);
  useEffect(() => {
    if (!searchOpen) return;
    searchDismissedOutsideRef.current = false;
    // Canvas gestures intercept bubbling events used by the popover's dismissal.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchTriggerRef.current?.contains(target) || searchPanelRef.current?.contains(target)) return;
      searchDismissedOutsideRef.current = true;
      setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchOpen]);
  useEffect(() => {
    if (!searchOpen) return;
    document.getElementById(`mindmap-search-result-${searchIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [searchIndex, searchOpen]);
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
  const savedSignatureRef = useRef(savedSignature);
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
  manualReadOnlyRef.current = manualReadOnly;
  const saveConflict = Boolean(saveError && /conflict|changed.*reload|stale/i.test(saveError));
  const outdatedSave = Boolean(saveError && isOutdatedMindmapPage(saveError));
  const readOnly = !sessionWritable || manualReadOnly || remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft);
  useEffect(() => {
    if (!readOnly) setResumeEditAttentionRequest(0);
  }, [readOnly]);

  const notifyBlockedEdit = useCallback(() => {
    const now = Date.now();
    if (now - lastBlockedSignalAtRef.current < 120) return;
    lastBlockedSignalAtRef.current = now;
    if (recoveryDraftRef.current) {
      setRecoveryReviewOpen(true);
      return;
    }
    if (saveConflict) setSaveConflictAttention(current => current + 1);
    else setResumeEditAttentionRequest(current => current + 1);
  }, [saveConflict]);
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
  const unplacedCount = useMemo(
    () => availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes).length,
    [paperState?.paper?.todos, mindmap.nodes],
  );
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
  const [previewFontSize, setPreviewFontSize] = useState<number | null>(null);
  const effectiveFontSize = previewFontSize ?? (mindmap.fontSize || DEFAULT_MINDMAP_FONT_SIZE);
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
  useEffect(() => { setMeasuredCards(new Map()); }, [effectiveFontSize]);
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
    actor: "human" | "webmcp" = "human",
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
        actor,
      );
      if (!result.ok) {
        setSaveError(result.message);
        return result;
      }
      const saved = result.value.mindmap;
      lastAcknowledgedMapRef.current = saved;
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

  async function makeSelectedCardTodo(sectionId?: string) {
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
      if (sectionId && paperState?.paper?.sourceHash !== paperSourceHashRef.current && paperSourceHashRef.current) {
        throw new Error("The manuscript changed. Review the refreshed section before creating the TODO.");
      }
      const result = await convertCardToTodo(id, sectionId);
      if (!result.ok) throw new Error(result.message);
    } finally {
      if (conversionStartingCardIdRef.current === id) conversionStartingCardIdRef.current = null;
      // The ref may be populated by the refresh effect while the conversion
      // request is suspended. Keep the post-await read widened for TypeScript.
      const pending = pendingConversionRefreshRef.current as { cardId: string; todoId: string } | null;
      if (convertingCardIdRef.current === id && pending?.cardId !== id) convertingCardIdRef.current = null;
      setConvertingCardId((current) => current === id && pending?.cardId !== id ? null : current);
    }
  }

  function rememberedTodoCard(todoId: string): TodoCardRecovery | null {
    const key = todoCardRecoveryKey(project, todoId);
    const cached = todoCardRecoveryRef.current.get(key);
    if (cached) return cached;
    try { return readTodoCardRecovery(window.sessionStorage, project, todoId); }
    catch { return null; }
  }

  async function captureCurrentTodoCard(todoId: string) {
    const paper = await getBrowserEditablePaper(project);
    if (!paper) throw new Error("The saved paper is unavailable. Retry after it loads.");
    const expectedHash = paperSourceHashRef.current ?? paperState?.paper?.sourceHash;
    if (expectedHash && paper.bundle.bundleHash !== expectedHash) {
      router.refresh();
      throw new Error("The paper changed. Review the refreshed TODO before converting or deleting it.");
    }
    const matches = analyzePaper(paper.bundle.source).todos.filter(item => item.id === todoId);
    if (matches.length > 1) throw new Error("This TODO ID occurs more than once in the paper. Resolve its identity before continuing.");
    const todo = matches[0];
    const content: TodoCardRecovery | null = todo ? { todoId, title: todo.title || "", body: todo.text, sourceHash: paper.bundle.bundleHash } : null;
    if (content) {
      todoCardRecoveryRef.current.set(todoCardRecoveryKey(project, todoId), content);
      try { writeTodoCardRecovery(window.sessionStorage, project, content); }
      catch { /* The mounted map retains its content snapshot. */ }
    }
    return { content, sourceHash: paper.bundle.bundleHash };
  }

  async function linkCardToExistingTodo(
    id: string, todoId: string, expectedRevision?: number, actor: "human" | "webmcp" = "human", asChild = false,
  ) {
    if (actor === "human" && inlineEditorSessionRef.current && !await inlineEditorSessionRef.current.commit()) {
      throw new Error("Finish the active card edit before linking a paper TODO.");
    }
    const before = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    const shown = paperState?.paper?.todos.find(todo => todo.id === todoId);
    const { content, sourceHash } = await captureCurrentTodoCard(todoId);
    if (!content) throw new Error("This TODO is missing from the current paper.");
    if (!shown || content.title !== (shown.title || "") || content.body !== shown.text) {
      router.refresh();
      throw new Error("The paper TODO changed. Review the refreshed wording before linking.");
    }
    await persistWebMcpMutation(current => {
      if (actor === "webmcp" && (focusedMindmapCardId(current.selectedId) === id || inlineEditorSessionRef.current?.nodeId === id)) {
        throw Object.assign(new Error("The human is editing this card. Link it after they finish."), { code: "active_card_edit" });
      }
      const node = indexMindmap(current.mindmap).nodeById.get(id);
      if (!node || !before || node.todoId !== before.todoId || node.title !== before.title
          || node.text !== before.text || node.contentFormat !== before.contentFormat) {
        throw new Error("The selected card changed. Review it before linking.");
      }
      if (paperSourceHashRef.current && paperSourceHashRef.current !== sourceHash) {
        throw new Error("The paper changed. Review the current TODO and retry.");
      }
      if (asChild) {
        if (current.mindmap.nodes.some(other => other.todoId === todoId)) {
          throw new Error("This TODO already has a card on this map.");
        }
        return { type: "add-node", parentId: id, id: newNodeId(), todoId };
      }
      return {
        type: "link-existing-todo", id, todoId, todoTitle: content.title, todoText: content.body,
        ...(actor === "webmcp" ? { agentDraft: true as const } : {}),
      };
    }, expectedRevision, actor);
    if (asChild) setLocalCollapsed(id, false);
  }

  async function convertTodoCardToOrdinary(id: string) {
    if (readOnly || convertingTodoCard) return;
    const todoId = indexMindmap(sessionRef.current.mindmap).nodeById.get(id)?.todoId;
    if (!todoId) return;
    setConvertingTodoCard(true);
    setSaveError(null);
    try {
      await flushPendingSaves();
      const captured = await captureCurrentTodoCard(todoId);
      const content = captured.content || rememberedTodoCard(todoId);
      if (!content) throw new Error("The original TODO text is unavailable. Restore it from history before converting this card.");
      await persistWebMcpMutation(current => {
        if (indexMindmap(current.mindmap).nodeById.get(id)?.todoId !== todoId) throw new Error("The card's TODO binding changed. Review it before converting.");
        if (paperSourceHashRef.current && paperSourceHashRef.current !== captured.sourceHash) throw new Error("The paper changed during conversion. Review the refreshed TODO and retry.");
        return { type: "unbind-todo", id, todoId, title: content.title, text: content.body };
      }, undefined, "human");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not convert this TODO to an ordinary card.");
    } finally {
      setConvertingTodoCard(false);
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
    if (!node || node.contentFormat === "html") return;
    const content = cardContentForNodeWithPaperState(node, paperState);
    dispatch({ type: "begin-card-history" });
    editBaselineRef.current = {
      baseNode: cloneMindmap(node), nodeId, noteFields: new Set(),
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
      const baselineNode = before.baseNode;
      const currentNode = indexMindmap(sessionRef.current.mindmap).nodeById.get(before.nodeId);
      // Cancel only this card's active fields. Other cards may have changed
      // while the editor was open and must remain in the live map.
      if (baselineNode && currentNode && !currentNode.todoId) {
        const action = { type: "edit-card" as const, id: before.nodeId, title: baselineNode.title, text: baselineNode.text, contentFormat: baselineNode.contentFormat };
        sessionRef.current = mindmapReducer(sessionRef.current, action);
        dispatch(action);
      }
      if (baselineNode && currentNode && before.noteFields.size) {
        const action = { type: "patch-node" as const, id: before.nodeId, transient: true,
          patch: restoreCardNotes(currentNode, baselineNode, before.noteFields) };
        sessionRef.current = mindmapReducer(sessionRef.current, action);
        dispatch(action);
      }
      dispatch({ type: "record-history", baseNode: before.baseNode, noteFields: before.noteFields, cancelled: true });
      if (mapSignature(sessionRef.current.mindmap) === savedSignatureRef.current) clearBrowserDraft();
      else preserveBrowserDraft();
      return;
    }
    dispatch({ type: "record-history", baseNode: before.baseNode, noteFields: before.noteFields });
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
    if (node.contentFormat === "html") setCardMenuOpen(false);
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
    if (!layout.nodeById.has(id)) return;
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
  focusCardRef.current = focusCard;
  const linkedCardPreview = useCallback((id: string): CardNavigationItem | undefined => {
    const node = layout.nodeById.get(id);
    return node && { id, ...cardContentForNodeWithPaperState(node, paperState), format: node.todoId ? "tex" : node.contentFormat };
  }, [layout.nodeById, paperState]);

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

  async function setCardContentFormat(id: string, contentFormat: MindmapNode["contentFormat"], source?: string) {
    if (source === undefined && inlineEditorSessionRef.current?.nodeId === id && !await inlineEditorSessionRef.current.commit()) return;
    await persistWebMcpMutation(current => {
      const card = indexMindmap(current.mindmap).nodeById.get(id);
      if (!card || card.todoId) throw new Error("Open an ordinary card to change its format.");
      const content = source === undefined ? undefined : card.contentFormat === "markdown" && startsWithMarkdownTable(source) ? { title: "", body: source } : splitCardText(source);
      const patch = content ? { contentFormat, title: content.title, text: content.body } : cardFormatPatch(card, contentFormat);
      const error = htmlCardValidationError({ ...card, ...patch });
      if (error) throw new Error(error);
      return { type: "patch-node", id, patch };
    }, undefined, "human");
    if (contentFormat === "html") {
      inlineEditorSessionRef.current = null;
      finishTextTransaction(true);
      setCardMenuOpen(false);
      setEditingId(id);
    }
  }

  async function pasteHtmlCard(id: string, text: string) {
    await persistWebMcpMutation(current => {
      const card = indexMindmap(current.mindmap).nodeById.get(id);
      if (!card || card.todoId || card.contentFormat !== "html") throw new Error("Open an HTML card to paste its drawing.");
      const error = htmlCardValidationError({ ...card, text });
      if (error) throw new Error(error);
      return { type: "patch-node", id, patch: { text } };
    }, undefined, "human");
  }

  const noteEditBurstRef = useRef<{ id: string; at: number } | null>(null);

  function updateNodeNote(id: string, value: string) {
    if (readOnly) return;
    const before = editBaselineRef.current;
    const node = indexMindmap(sessionRef.current.mindmap).nodeById.get(id);
    if (!node) return;
    const now = Date.now();
    const inCardEdit = before?.nodeId === id;
    const inNoteBurst = Boolean(noteEditBurstRef.current && noteEditBurstRef.current.id === id && now - noteEditBurstRef.current.at < 1500);
    const transient = inCardEdit || inNoteBurst;
    if (inCardEdit) {
      for (const field of CARD_NOTE_FIELDS) before.noteFields.add(field);
    } else {
      noteEditBurstRef.current = { id, at: now };
    }
    const action: MindmapTreeAction = { type: "patch-node", id, transient,
      patch: { caption: value, caution: undefined } };
    sessionRef.current = mindmapReducer(sessionRef.current, action);
    dispatch(action);
    schedulePreserveBrowserDraft();
  }

  async function requestDraftRevision(id: string, note: string) {
    const editor = inlineEditorSessionRef.current;
    if (editor?.nodeId === id && !await editor.commit()) throw new Error("Finish saving the open card, then retry.");
    await persistWebMcpMutation(current => {
      const card = indexMindmap(current.mindmap).nodeById.get(id);
      if (!card) throw new Error("Card not found.");
      // Paper and HTML source stay intact while comments live in map Notes.
      if (card.todoId || card.contentFormat === "html") {
        if (card.caption === note || card.caption?.startsWith(note + "\n\n")) return null;
        const caption = card.caption ? note + "\n\n" + card.caption : note;
        return { type: "patch-node", id, patch: { caption } };
      }
      if (card.text === note || card.text.endsWith("\n\n" + note)) return null;
      const text = card.text ? card.text + "\n\n" + note : note;
      return { type: "patch-node", id, patch: { text } };
    }, undefined, "human");
  }

  async function saveAgentDraft(id: string) {
    if (readOnly) return;
    if (inlineEditorSessionRef.current?.nodeId === id && !await inlineEditorSessionRef.current.commit()) return;
    try {
      await persistWebMcpMutation(current => {
        const saved = indexMindmap(current.mindmap).nodeById.get(id);
        if (!saved) return null;
        const rendered = withAgentTableFormat(saved);
        return { type: "patch-node", id, patch: {
          agentDraft: undefined,
          ...(rendered !== saved ? { contentFormat: rendered.contentFormat, title: rendered.title, text: rendered.text } : {}),
        } };
      }, undefined, "human");
    } catch (error) {
      const restore: MindmapTreeAction = { type: "patch-node", id, patch: { agentDraft: true } };
      sessionRef.current = mindmapReducer(sessionRef.current, restore);
      dispatch(restore);
      setSaveError(error instanceof Error ? error.message : "Could not save the card.");
    }
  }

  const agentDraftNodes = useMemo(
    () => mindmap.nodes.filter((node) => node.agentDraft),
    [mindmap.nodes],
  );
  const draftChangesMap = useMemo(
    () => draftChangesByNode(paperState?.recent, new Set(agentDraftNodes.map((node) => node.id))),
    [paperState?.recent, agentDraftNodes],
  );
  const draftCursorRef = useRef(0);

  function focusNextAgentDraft() {
    if (!agentDraftNodes.length) return;
    const currentIdx = agentDraftNodes.findIndex((node) => node.id === selected?.id);
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % agentDraftNodes.length : draftCursorRef.current % agentDraftNodes.length;
    draftCursorRef.current = nextIdx + 1;
    const target = agentDraftNodes[nextIdx];
    if (target) focusCard(target.id);
  }

  useEffect(() => {
    if (cardFilter === "drafts" && agentDraftNodes.length === 0) setCardFilter("all");
  }, [cardFilter, agentDraftNodes.length]);

  const linkPickerOptions = useMemo<LinkPickerOptions>(() => ({
    sections: (paperState?.paper?.outline || []).map((s) => ({ id: s.id, label: s.title || s.id })),
    todos: (paperState?.paper?.todos || []).map((t) => ({ id: t.id, label: (t.title || t.text).slice(0, 60) })),
    nodes: mindmap.nodes.map((n) => ({ id: n.id, label: cardContentForNodeWithPaperState(n, paperState).title || n.id })),
    wiki: (paperState?.wiki || []).map((w) => ({ id: w.slug, label: w.title || w.slug })),
  }), [mindmap.nodes, paperState]);

  function addChild(parentId?: string, initialTitle = "") {
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
    dispatch({ type: "add-node", parentId: nextParentId, id, title: initialTitle });
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
    if (readOnly) { notifyBlockedEdit(); return; }
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

  const undo = useCallback(() => {
    if (readOnly) { notifyBlockedEdit(); return; }
    noteEditBurstRef.current = null;
    dispatch({ type: "undo" });
  }, [notifyBlockedEdit, readOnly]);
  const redo = useCallback(() => {
    if (readOnly) { notifyBlockedEdit(); return; }
    noteEditBurstRef.current = null;
    dispatch({ type: "redo" });
  }, [notifyBlockedEdit, readOnly]);

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
      let url: URL;
      try { url = new URL(link.href, window.location.href); }
      catch { return; }
      if (url.origin !== window.location.origin || url.href === window.location.href || navigationPendingRef.current) return;
      if (link.dataset.mapCardLink && sameMapCardId(link.href, new URL(window.location.href))) return;
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
  const hydratedInboxRevisionRef = useRef(inboxRevision);
  useEffect(() => {
    const changedInbox = Boolean(inboxRevision && inboxRevision !== hydratedInboxRevisionRef.current);
    const changedSavedMap = Boolean(initialMindmap.diskHash && initialMindmap.diskHash !== persistedDiskHashRef.current);
    const changedReply = agentReplies.some(reply => {
      const node = mindmap.nodes.find(item => item.id === reply.nodeId);
      return unreadNodeIds.has(reply.nodeId) && (!node
        || agentReplyContentHash(node, paperTodoFor(node, paperState)) !== reply.contentHash);
    });
    if ((!changedReply && !changedInbox && !changedSavedMap) || !replyHydrationAllowed.current()) return;
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
      hydratedInboxRevisionRef.current = inboxRevision;
      router.refresh();
    }).catch(error => {
      if (!cancelled && !isBackendTransportError(error) && !isBackendUnavailable()) console.warn("OpenBar could not refresh the agent reply", error);
    });
    return () => { cancelled = true; };
  }, [agentReplies, unreadNodeIds, replyReadRequest, inboxRevision, initialMindmap.diskHash, mindmap, paperState, connectionState, dirty, editingId, isPending, recoveryDraft,
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
        const reviewPaper = Boolean(draft.activeCard?.baseNode.todoId);
        const [saved, paper] = await Promise.all([
          loadBrowserMindmap(project, mapId),
          reviewPaper ? getBrowserEditablePaper(project) : null,
        ]);
        if (!saved) throw new Error("The saved mindmap is unavailable.");
        if (reviewPaper && paperSourceHashRef.current !== paper?.bundle.bundleHash) {
          paperMutationGenerationRef.current += 1;
          paperSourceHashRef.current = paper?.bundle.bundleHash;
          router.refresh();
        }
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
  }, [captureRecoveryDraft, initialMindmap.id, isPending, project, hydrateSavedMap, preserveBrowserDraft, router]);

  const recoverySavedMap = lastAcknowledgedMapRef.current;
  const recoverySavedHash = persistedDiskHashRef.current;
  const recoveryPaperHash = paperSourceHashRef.current;
  const restorableDraft = useMemo(() => recoveryDraft
    ? recoverableMindmapDraft(recoveryDraft, recoverySavedMap, recoverySavedHash, recoveryPaperHash)
    : null, [recoveryDraft, recoverySavedMap, recoverySavedHash, recoveryPaperHash]);
  const restoreBrowserDraft = useCallback(() => {
    const draft = restorableDraft;
    if (!draft || recoveryDraftRef.current !== recoveryDraft || persistedDiskHashRef.current !== draft.baseHash
      || paperSourceHashRef.current !== recoveryPaperHash) return;
    const active = draft.activeCard;
    if (active) {
      editBaselineRef.current = {
        baseNode: active.baseNode, nodeId: active.nodeId, text: active.baseText,
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
    if (active) dispatch({ type: "begin-card-history" });
    recoveryDraftRef.current = null;
    setRecoveryReviewOpen(false);
    setRecoveryDraft(null);
    saveErrorRef.current = null;
    setSaveError(null);
    setLocalSaveState("dirty");
  }, [dispatch, recoveryDraft, recoveryPaperHash, restorableDraft, setLocalCollapsed]);

  const keepSavedMap = useCallback(() => {
    recoveryDraftRef.current = null;
    editBaselineRef.current = null;
    activeCardDraftRef.current = null;
    inlineEditorSessionRef.current = null;
    setRestoredCardDraft(null);
    setEditingId(null);
    setRecoveryReviewOpen(false);
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
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (document.querySelector("[data-ob-modal]")) return;

      if (event.key === "/") {
        event.preventDefault();
        setMoveQuery("");
        setSearchIndex(0);
        setSearchOpen(true);
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (readOnly) {
        const targetEl = event.target instanceof Element ? event.target : null;
        const onInteractive = Boolean(targetEl?.closest("button, a, input, textarea, select, summary, nav"));
        if (mod && !event.altKey && ["s", "z", "y"].includes(key)) {
          event.preventDefault();
          notifyBlockedEdit();
          return;
        }
        if (!mod && !onInteractive && (
          ["backspace", "delete", "e", "tab", "enter"].includes(key)
          || (event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
        )) {
          if (recoveryDraftRef.current && event.key === "Tab") return;
          if (event.key !== "Tab") event.preventDefault();
          notifyBlockedEdit();
          return;
        }
        return;
      }
      if (!mod) return;

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
  }, [dirty, isPending, notifyBlockedEdit, readOnly, redo, save, undo]);

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
    if (target.closest("#mindmap-card-menu, button, a, input, textarea, select, summary, .cm-editor, [data-radix-popper-content-wrapper]")) return;
    if (viewMode !== "map") return;
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

  useEffect(() => connectCardLinkHistory(id => {
    if (!indexMindmap(sessionRef.current.mindmap).nodeById.has(id)) return false;
    focusCardRef.current(id);
    return true;
  }, () => sessionRef.current.selectedId), []);

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
        renderVersion: `${editingId || ""}:${effectiveFontSize}:${shiftExpandHeld}`,
      }];
    })
  ), [editingId, layout, selectedIdSet, effectiveFontSize, shiftExpandHeld]);

  const renderCard = useCallback((id: string) => {
    const node = layout.nodeById.get(id);
    const dimensions = layout.dimensions.get(id);
    if (!node || !dimensions) return null;
    const activityAt = nodeActivityAt(node, reconciliation);
    const parent = node.parentId ? layout.nodeById.get(node.parentId) : undefined;
    return (
      <CanvasNode
        project={project}
        fontSize={effectiveFontSize}
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
        answeredRequest={answeredRequests.get(node.id)}
        draftChanges={node.agentDraft ? draftChangesMap.get(node.id) : undefined}
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
        onDraftActivity={() => { remoteQueue.noteEdit(); schedulePreserveBrowserDraft(); }}
        onTextChange={(text, contentFormat) => updateNodeText(node.id, text, contentFormat)}
        onUseHtml={text => setCardContentFormat(node.id, "html", text)}
        onPasteHtml={text => pasteHtmlCard(node.id, text)}
        onNoteChange={value => updateNodeNote(node.id, value)}
        onBlockedEdit={notifyBlockedEdit}
        onRequestRevision={note => requestDraftRevision(node.id, note)}
        onSaveDraft={() => saveAgentDraft(node.id)}
        filteredOut={cardFilter !== "all" && node.id !== mindmap.rootId && (
          cardFilter === "todos" ? !(node.todoId && !paperTodoFor(node, paperState)?.completed)
            : cardFilter === "drafts" ? !node.agentDraft
              : node.progress === "ditched" || Boolean(node.todoId && paperTodoFor(node, paperState)?.completed)
        )}
        onDeleteDraft={node.id === mindmap.rootId ? undefined : () => void deleteCardBranch(node.id)}
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
    effectiveFontSize,
    focusCard,
    activityNodeIds,
    activitySince,
    unreadNodeIds,
    answeredRequests,
    draftChangesMap,
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
    schedulePreserveBrowserDraft,
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
    cardFilter,
    mindmap.rootId,
  ]);

  const searchResults = useMemo(() => {
    if (!searchOpen) return [];
    const needle = moveQuery.trim().toLocaleLowerCase();
    const base = mindmap.nodes
      .filter((node) => {
        if (!needle) return true;
        const content = cardContentForNodeWithPaperState(node, paperState);
        const cautionText = node.caution ? [node.caution.critical, node.caution.important, node.caution.background].filter(Boolean).join(" ") : "";
        const metadataText = node.metadata ? Object.entries(node.metadata).map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
        return `${content.title} ${content.body} ${node.caption || ""} ${cautionText} ${(node.tags || []).join(" ")} ${metadataText}`.toLocaleLowerCase().includes(needle);
      })
      .map((node) => ({ id: node.id, label: cardContentForNodeWithPaperState(node, paperState).title || (node.contentFormat === "html" ? "HTML card" : "Untitled card") }));
    return base.map((result) => {
      const node = layout.nodeById.get(result.id);
      const parent = node?.parentId ? layout.nodeById.get(node.parentId) : undefined;
      const depth = hierarchyDepths.get(result.id);
      const below = descendantCounts.get(result.id) || 0;
      const context = [
        depth === 0 ? "Root" : depth === undefined ? "Outside root" : `Depth ${depth}`,
        below ? `${below} ${below === 1 ? "card" : "cards"} below` : layout.children.get(result.id)?.length ? "Branch" : "Leaf",
        parent ? `under ${cardContentForNodeWithPaperState(parent, paperState).title || (parent.contentFormat === "html" ? "HTML card" : "Untitled card")}` : undefined,
      ].filter(Boolean).join(", ");
      return { ...result, context };
    });
  }, [searchOpen, mindmap.nodes, moveQuery, paperState, layout, hierarchyDepths, descendantCounts]);
  const visibleSearchResults = searchResults.slice(0, 60);
  const chooseSearchResult = (id: string) => {
    focusCard(id);
    setSearchOpen(false);
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

  function signalBlockedEdit(event: Parameters<typeof isLockedMindmapEditIntent>[0]) {
    if (!readOnly || !isLockedMindmapEditIntent(event)) return false;
    if (recoveryDraft && event.key === "Tab") return false;
    notifyBlockedEdit();
    return true;
  }

  return (
    <CardLinkNavigation mapPath={artifactHref(project, { kind: "mindmap-node", mapId: mindmap.id, id: mindmap.rootId })} lookup={linkedCardPreview}>
    <section
      className={styles.editor}
      data-mindmap-editor
      onPointerDownCapture={signalBlockedEdit}
      onDoubleClickCapture={signalBlockedEdit}
      onDropCapture={event => {
        if (signalBlockedEdit(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={event => {
        if (signalBlockedEdit(event) && event.key !== "Tab") {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPasteCapture={(event) => {
        if (signalBlockedEdit(event)) return;
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
          <div className={styles.fontTools}><MindmapFontSize value={effectiveFontSize} disabled={readOnly}
            onPreview={setPreviewFontSize}
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
              <MindmapFontSizeSlider value={effectiveFontSize} disabled={readOnly}
                onPreview={setPreviewFontSize}
                onChange={fontSize => dispatch({ type: "set-font-size", fontSize })} />
              <button type="button" className={styles.optionRow} aria-pressed={selectMultiple} onClick={() => { setSelectMultiple((value) => !value); setMapSettingsOpen(false); setCardMenuOpen(false); }}><CheckSquare size={15} />Select multiple{selectMultiple && <Check size={14} />}</button>
              <button type="button" className={styles.optionRow} onClick={() => { setViewMode("changes"); setMapSettingsOpen(false); }}><GitBranch size={15} />Change history</button>
              <button type="button" className={styles.optionRow} aria-pressed={manualReadOnly}
                disabled={!manualReadOnly && (!sessionWritable || remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft))}
                onClick={toggleReadOnly}><LockKeyhole size={15} />Read-only mode{manualReadOnly && <Check size={14} />}</button>
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
          <MapNavigationDock>
          <div data-map-history role="group" aria-label="Map history">
            <ToolbarButton title="Undo (⌘Z / Ctrl+Z)" onClick={undo} disabled={readOnly || !history.length}><Undo2 size={15} /></ToolbarButton>
            <ToolbarButton title="Redo (⌘⇧Z / Ctrl+Y)" onClick={redo} disabled={readOnly || !future.length}><Redo2 size={15} /></ToolbarButton>
            <span title={`${mindmap.nodes.length} cards`}>{mindmap.nodes.length} cards</span>
          </div>
          </MapNavigationDock>
      <div ref={controlDockRef} className={cn(styles.toolbar, styles.controlDock)} role="group" aria-label="Mindmap dock">
        <div className={styles.dockUtility}>

      <div className={styles.resumeDock}>
        <BackendStatusNotice project={project} issues={editorIssues} diagnosticContext={getMindmapDiagnostics} openRequest={connectionDetailsOpenRequest} />
      </div>
        </div>
        <div className={cn("p-glass-sm", paperStyles.toolbar, styles.canvasTools)} role="group" aria-label="Map view controls">
          <FastTooltip label={`${unplacedCount} paper ${unplacedCount === 1 ? "TODO" : "TODOs"} ready to place on the map`}>
            <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.dockQueueButton)} aria-label={`Unplaced paper TODOs, ${unplacedCount} ready to place on the map`} aria-expanded={unplacedOpen && unplacedCount > 0} onClick={() => { setUnplacedOpen((open) => !open); setViewMode("map"); }}>
              <ListTodo size={15} aria-hidden="true" />
              <span className={styles.dockQueueLabel}>Unplaced</span>
              {unplacedCount > 0 && <span className={styles.unplacedBadge} aria-hidden="true">{unplacedCount}</span>}
            </button>
          </FastTooltip>
          {agentDraftNodes.length > 0 && (
            <FastTooltip label={`${agentDraftNodes.length} AI ${agentDraftNodes.length === 1 ? "draft" : "drafts"} awaiting review\nClick for next, ⌥-click to filter`}>
              <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.dockQueueButton)} aria-label={`Review next AI draft (${agentDraftNodes.length} remaining)`} aria-pressed={cardFilter === "drafts"} onClick={(event) => {
                if (event.altKey) {
                  setCardFilter((current) => current === "drafts" ? "all" : "drafts");
                  return;
                }
                focusNextAgentDraft();
              }}>
                <span className="ob-mod-swap" aria-hidden="true">
                  <span className="ob-mod-primary"><Sparkles size={15} /></span>
                  <span className="ob-mod-alt"><ListFilter size={15} /></span>
                </span>
                <span className={styles.dockQueueLabel}>Review</span>
                <span className={cn(styles.unplacedBadge, styles.draftBadge)} aria-hidden="true">{agentDraftNodes.length}</span>
              </button>
            </FastTooltip>
          )}
          <span className={styles.dockDivider} aria-hidden="true" />
          <div className={styles.canvasToolActions}>
          {viewMode === "changes" && <button type="button" className="p-button p-button-glass ob-glass-button" onClick={() => setViewMode("map")}>Back to map</button>}
          <FastTooltip label={"Add child card (Tab)\n⌥-click adds sibling (Enter)"}><button type="button" aria-label="Add card" className={cn("p-button p-button-glass ob-glass-button", styles.iconButton)} disabled={readOnly} onClick={(event) => {
            if (event.altKey && selected && selected.parentId) addChild(selected.parentId);
            else addChild();
          }}><span className="ob-mod-swap" aria-hidden="true"><span className="ob-mod-primary"><Plus size={16} /></span>{!readOnly && <span className="ob-mod-alt"><ListPlus size={16} /></span>}</span></button></FastTooltip>
          <Popover.Root open={searchOpen} onOpenChange={setSearchOpen}>
              <FastTooltip label={cardFilter === "all" ? "Find or filter cards (/)" : `Filtered: ${cardFilter === "todos" ? "Open TODOs" : cardFilter === "drafts" ? "Drafts" : "Active only"} — click to change (/)`}>
                <Popover.Trigger asChild>
                  <button ref={searchTriggerRef} type="button" className={cn("p-button p-button-glass ob-glass-button", styles.iconButton, cardFilter !== "all" && styles.searchFiltered)} aria-label="Find or filter cards" onClick={() => { setMoveQuery(""); setSearchIndex(0); }}>
                    <Search size={15} aria-hidden="true" />
                    {cardFilter !== "all" && <span className={styles.filterDot} aria-hidden="true" />}
                  </button>
                </Popover.Trigger>
              </FastTooltip>
            <Popover.Portal>
              <Popover.Content ref={searchPanelRef} className={styles.searchPanel} side="top" sideOffset={10} align="end" collisionPadding={12} aria-label="Find a card"
                onCloseAutoFocus={(event) => { if (searchDismissedOutsideRef.current) event.preventDefault(); }}>
                <div className={styles.searchField}>
                  <Search size={17} />
                  <input autoFocus value={moveQuery} placeholder="Search titles, text, and labels…" aria-label="Search cards" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="mindmap-search-results" aria-activedescendant={visibleSearchResults[searchIndex] ? `mindmap-search-result-${searchIndex}` : undefined}
                    onChange={(event) => { setMoveQuery(event.target.value); setSearchIndex(0); }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setSearchIndex((index) => Math.max(0, Math.min(visibleSearchResults.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                      }
                      if (event.key === "Enter" && visibleSearchResults[searchIndex]) { event.preventDefault(); chooseSearchResult(visibleSearchResults[searchIndex].id); }
                    }} />
                </div>
                <div className={styles.filterRow}>
                  <ChoiceButtons
                    label="Filter canvas"
                    value={cardFilter}
                    options={[
                      { value: "all", label: "All" },
                      { value: "todos", label: "Open TODOs" },
                      { value: "drafts", label: "Drafts" },
                      { value: "active", label: "Hide ditched" },
                    ]}
                    onChange={(value) => setCardFilter(value as "all" | "todos" | "drafts" | "active")}
                  />
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
                <div className={styles.searchFooter}>{searchResults.length} cards, ↑ ↓ to choose, Enter to jump, / to search</div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div className={styles.depthControls}>
          <FastTooltip label={expandAllFromToolbar ? "Expand all cards" : `Collapse cards at depth ${collapseDepth} and deeper`}>
            <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.depthCollapse)} aria-label={expandAllFromToolbar ? "Expand all cards" : `Collapse cards at depth ${collapseDepth} and deeper`}
              data-collapsed={depthCollapsed} aria-pressed={depthCollapsed} disabled={collapseTargetIds.length === 0 && collapsedIds.size === 0}
              onClick={() => void toggleDepthCollapse()}>
              {expandAllFromToolbar ? <ChevronsUpDown size={15} aria-hidden="true" /> : <ChevronsDownUp size={15} aria-hidden="true" />}
            </button>
          </FastTooltip>
          <Select label="Collapse depth" tooltip="Choose depth to collapse" value={String(collapseDepth)} onValueChange={value => setCollapseDepth(Number(value))}
            className={cn("p-button p-button-glass ob-glass-button", styles.depthSelect)}
            options={Array.from({ length: maxCollapseDepth - 1 }, (_, index) => ({ value: String(index + 2), label: `${index + 2}+` }))} />
          </div>
          <span className={styles.dockDivider} aria-hidden="true" />
          <div
            className={styles.saveStatus}
            role="status"
            aria-live="polite"
            data-local-save-state={localSaveState}
            data-remote-save-state={remoteSaveState}
          >
            <SaveSyncStatus iconOnly className={cn("p-button p-button-glass ob-glass-button", paperStyles.unifiedStatus)} saved={!dirty && localSaveState === "saved"} saving={localSaveState === "saving"}
              conflict={saveConflict || localSaveState === "conflict"} remote={remoteSaveState}
              hasRecoveryDraft={Boolean(recoveryDraft)}
              onRecoveryDraft={() => setRecoveryReviewOpen(true)}
              attentionRequest={resumeEditAttentionRequest}
              manualReadOnly={manualReadOnly}
              onExitReadOnly={manualReadOnly ? toggleReadOnly : undefined}
              onForceSync={sessionWritable ? () => { void pushRemote("OpenBar: force sync mindmap"); } : undefined}
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
          {unplacedOpen && unplacedCount > 0 && <MindmapUnplacedTray project={project} paperState={paperState} nodes={mindmap.nodes} selectedParentId={selected?.id || mindmap.rootId} readOnly={readOnly} onBlockedEdit={notifyBlockedEdit} onPlaceTodo={placeUnplacedTodo} onClose={() => setUnplacedOpen(false)} />}
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
            onBlockedDrag={notifyBlockedEdit}
            onPaneClick={() => {
              setMapSettingsOpen(false);
              dispatch({ type: "clear-selection" });
              if (inlineEditorSessionRef.current) void inlineEditorSessionRef.current.commit();
              else setEditingId(null);
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
        </div> : moveNotice && <div className={styles.moveNotice} role="status"><Check size={14} /><span>{moveNotice}</span><button type="button" disabled={readOnly} onClick={() => { undo(); setMoveNotice(""); }}>Undo</button></div>}

      </div>

      <div className={styles.noticeRow} hidden={!Boolean(recoveryDraft || primaryIssue?.id === "save" || primaryIssue?.id === "git" || (primaryIssue?.id === "access" && !sessionWritable && (dirty || editingId)))} data-editor-notices>
      {recoveryDraft && <Popover.Root open={recoveryReviewOpen} onOpenChange={setRecoveryReviewOpen}>
        <div className={styles.recoveryNotice} role="status" data-editor-notice data-recovery-notice>
          <span>Editing paused for draft review</span>
          <Popover.Trigger asChild><button type="button" aria-label="Review browser draft">Review<ChevronRight size={12} aria-hidden="true" /></button></Popover.Trigger>
        </div>
        <PopoverSurface className={styles.recoveryPanel} side="bottom" align="center" sideOffset={10} aria-label="Review browser draft" data-editor-notice data-recovery-review>
          <Popover.Arrow className={styles.recoveryArrow} width={14} height={7} />
          <div className={styles.recoveryBody}>
          <header><strong>Review browser draft</strong><Popover.Close aria-label="Close browser draft review"><X size={15} /></Popover.Close></header>
          <p>This tab has a draft from {new Date(recoveryDraft.savedAt).toLocaleString()}.</p>
          {restorableDraft ? recoveryDraft.baseHash !== recoverySavedHash && <p>Your edits can be restored onto the latest saved map.</p> : (
            <p>This draft needs manual review. Compare the differences or download a copy before discarding it.</p>
          )}
          <RecoveryCardReview draft={recoveryDraft} saved={recoverySavedMap} todos={paperState?.paper?.todos} defaultOpen={!restorableDraft} />
          <div className={styles.recoveryActions}>
            {restorableDraft && <button type="button" className="p-button p-button-primary btn-primary" onClick={restoreBrowserDraft}>Restore draft</button>}
            <button type="button" className="p-button p-button-default btn-outline" onClick={downloadBrowserDraft}>Download draft</button>
            <button type="button" className="p-button p-button-borderless btn-ghost" onClick={keepSavedMap}>Keep saved map</button>
          </div>
          </div>
        </PopoverSurface>
      </Popover.Root>}
      {!sessionWritable && (dirty || editingId) && <EditorNotice suppressed={primaryIssue?.id !== "access"} relatedIssues={relatedIssues} project={project} title="Editing access changed" label="Editing paused, draft preserved" message="Your open card text remains available to select and copy. Download the map draft before refreshing." diagnosticContext={getMindmapDiagnostics} paused>
        <button type="button" className="p-button p-button-default btn-outline" onClick={downloadBrowserDraft}>Download map draft</button>
      </EditorNotice>}
      {saveError && <EditorNotice suppressed={primaryIssue?.id !== "save"} relatedIssues={relatedIssues} project={project} title={outdatedSave ? "Refresh OpenBar to continue" : saveConflict ? "Saved file conflict" : "Saving needs attention"} label={outdatedSave ? "OpenBar updated, draft preserved" : saveConflict ? "Editing paused, saved file changed" : "Saving needs attention"}
        message={outdatedSave
          ? recoveryStored ? "OpenBar was updated while this page was open. Your draft is preserved in this tab. Refresh, then restore the draft to finish saving."
            : "OpenBar was updated while this page was open. Keep this tab open or download your draft. Browser recovery storage is currently unavailable."
          : recoveryStored === false ? `${saveError} Keep this tab open or download the draft before refreshing.` : saveError}
        report={outdatedSave ? saveError : undefined} diagnosticContext={getMindmapDiagnostics} paused={saveConflict} attentionRequest={saveConflictAttention}>
        <button type="button" className="p-button p-button-default btn-outline" onClick={outdatedSave ? () => void refreshWithDraft() : saveConflict ? reloadSavedMap : retrySave}>{outdatedSave ? "Refresh and retry" : saveConflict ? "Load saved map" : "Retry save"}</button>
        {saveConflict && !outdatedSave && <button type="button" className="p-button p-button-default btn-outline" onClick={retrySave}>Retry merge and save</button>}
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
      </div>

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
            if (patch.contentFormat) {
              const error = selectedCards.map(card => htmlCardValidationError({ ...card, ...patch, ...cardFormatPatch(card, patch.contentFormat) })).find(Boolean);
              if (error) { setSaveError(error); return; }
            }
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
                <div className={styles.inspectorKickerRow}>
                  <span className="mindmap-card-menu-kicker">
                    <span className="mindmap-card-menu-dot" aria-hidden="true" />
                    {selected.todoId ? "Paper TODO" : "Card"}
                  </span>
                  <CardLinkButton key={`${project}:${collapseMapId}:${selected.id}`} project={project} mapId={collapseMapId} nodeId={selected.id} className={cn("mindmap-icon-button", styles.copyCardLink)} />
                </div>
                <h2 id="mindmap-card-menu-title" className="mindmap-card-menu-title">
                  {selectedCardContent?.title || (selected.contentFormat === "html" ? "HTML card" : "Untitled card")}
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
                disabled={!recoveryDraft && (readOnly || convertingCardId === selected.id)}
                onClick={() => recoveryDraft ? setRecoveryReviewOpen(true) : startEditing(selected.id)}
              >
                {recoveryDraft ? <LockKeyhole size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                <span>{recoveryDraft ? "Review draft to edit" : "Edit"}</span>
                <kbd>E</kbd>
              </button>
              {!selected.todoId && paperState?.paper && (
                <PaperTodoPicker key={`${selected.id}:${selected.contentFormat}`} card={selected}
                  todos={availableTodoCandidates(paperState.paper.todos, mindmap.nodes)}
                  sections={paperState.paper.outline} disabled={readOnly || convertingCardId === selected.id}
                  onLink={(todoId, asChild) => linkCardToExistingTodo(selected.id, todoId, undefined, "human", asChild)}
                  onCreate={makeSelectedCardTodo} />
              )}
              {selected.todoId && selectedTodo && <>
                <button type="button" className="mindmap-card-menu-row" disabled={readOnly || convertingTodoCard}
                  onClick={() => void convertTodoCardToOrdinary(selected.id)}>
                  <FileText size={14} aria-hidden="true" />
                  <span>{convertingTodoCard ? "Converting…" : "Convert to ordinary card"}</span>
                </button>
                <small className="w-full text-muted">{isPrimaryMindmap(mindmap) ? "The paper TODO stays in Unplaced." : "The TODO stays in the paper."}</small>
              </>}
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

          {selected.id === mindmap.rootId && !selected.todoId && selected.contentFormat !== "html" && (
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
                  disabled={readOnly || convertingTodoCard}
                  onClick={() => void convertTodoCardToOrdinary(selected.id)}
                >
                  Convert to ordinary card
                </button>
                {selected.id !== mindmap.rootId && <button
                  type="button"
                  className="p-button p-button-default btn-outline text-danger"
                  disabled={readOnly}
                  onClick={() => {
                    setCardMenuOpen(false);
                    void deleteCardBranch(selected.id);
                  }}
                >
                  Delete card
                </button>}
              </div>
              {availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).length > 0 && (
                <label className="mindmap-field">
                  <span>Relink to paper TODO</span>
                  <Select label="Relink to paper TODO" placeholder="Choose an available TODO…" disabled={readOnly}
                    options={availableTodoCandidates(paperState?.paper?.todos || [], mindmap.nodes, selected.id).map(todo => ({ value: todo.id, label: todo.text }))}
                    onValueChange={todoId => { if (!readOnly) dispatch({ type: "bind-todo", id: selected.id, todoId }); }}
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
                <ChoiceButtons label="Card content format" value={selected.contentFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"MD"},{value:"tex",label:"TeX"},{value:"html",label:"HTML"}]} onChange={(value) => {
                  void setCardContentFormat(selected.id, value as MindmapNode["contentFormat"]).catch(error => setSaveError(error instanceof Error ? error.message : "Could not change card format."));
                }} />
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
          <div className="mindmap-card-menu-fields">
          <CautionEditor key={selected.id} value={selected.caution} caption={selected.caption}
            cardTitle={selected.title || selectedTodo?.text || undefined}
            readOnly={readOnly || convertingCardId === selected.id}
            onNotesChange={value => updateNodeNote(selected.id, value)} />
          <fieldset disabled={readOnly || convertingCardId === selected.id} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <CardLinks key={`links:${selected.id}`} sourceId={selected.id} project={project} refs={selectedRefs} pickerOptions={linkPickerOptions} onChange={refs => dispatch({ type: "patch-node", id: selected.id, patch: { refs } })} />
          <CardProperties key={`properties:${selected.id}`} value={selected.metadata} onChange={metadata => dispatch({ type: "patch-node", id: selected.id, patch: { metadata } })} />
          {selected.todoId && selectedTodo && !selectedMissing && paperSourceHash && (
            <div className="mindmap-card-menu-danger">
              <button
                type="button"
                className="mindmap-text-button text-warn"
                onClick={() => {
                  if (!window.confirm("Delete this TODO from the paper? Its mindmap card and child topics will stay in place so you can repair or convert the card.")) return;
                  setCardMenuOpen(false);
                  void flushPendingSaves().then(() => runPaperMutation(async () => {
                    const captured = await captureCurrentTodoCard(selected.todoId!);
                    if (!captured.content) throw new Error("The paper TODO changed. Review it before deleting.");
                    const result = await removePaperTodoAction(project, selected.todoId!, captured.sourceHash);
                    if (result.ok) recordPaperSourceHash(result.diskHash);
                    return result;
                  })).then((result) => {
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
            </div>
          )}
          </fieldset>
          </div>
          </InspectorSection>
        </aside>
      )}
    </section>
    </CardLinkNavigation>
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
                  options={[{ value: "plain", label: "Plain" }, { value: "markdown", label: "MD" }, { value: "tex", label: "TeX" }, { value: "html", label: "HTML" }]}
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
      {CARD_PALETTE.map((option) => <button key={option.value} type="button" className={cn("mindmap-color-swatch", value === option.value && "mindmap-color-swatch-selected")} style={{ backgroundColor: option.value }} aria-label={option.label + " accent"} aria-pressed={value === option.value} onClick={() => choose(option.value)} />)}
      <button type="button" className={cn("mindmap-color-swatch mindmap-color-swatch-auto", value === "" && "mindmap-color-swatch-selected")} aria-label="Use default accent" aria-pressed={value === ""} onClick={() => choose()}>Auto</button>
      <FastTooltip label="Custom accent"><button type="button" className="mindmap-color-swatch mindmap-color-swatch-auto mindmap-color-swatch-icon" aria-label={`Custom ${label.toLowerCase()}`} aria-expanded={customOpen} onClick={() => setCustomOpen((open) => !open)}><Pencil size={12} aria-hidden="true" /></button></FastTooltip>
    </div>
    {customOpen && <input autoFocus value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} onBlur={(event) => onChange(event.target.value.trim() || undefined)} placeholder="#785ef0 or CSS color" aria-label={`Custom ${label.toLowerCase()} value`} />}
  </>;
}

function MindmapUnplacedTray({ project, paperState, nodes, selectedParentId, readOnly, onBlockedEdit, onPlaceTodo, onClose }: {
  project: string;
  paperState?: ProjectState | null;
  nodes: ReadonlyArray<Pick<MindmapNode, "id" | "todoId" | "title" | "text" | "contentFormat">>;
  selectedParentId: string;
  readOnly: boolean;
  onBlockedEdit: () => void;
  onPlaceTodo: (todoId: string, parentId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const drag = useRef<{ todoId: string; title: string; x: number; y: number; active: boolean } | null>(null);
  const candidates = availableTodoCandidates(paperState?.paper?.todos || [], nodes);
  const visible = candidates.filter((todo) => `${todo.title || ""} ${todo.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const destination = nodes.find((node) => node.id === selectedParentId);
  const destinationLabel = destination?.title || (destination?.contentFormat === "html" ? "HTML card" : destination?.text.split("\n")[0]) || "selected card";
  function clearTarget() { document.querySelectorAll("[data-todo-drop-target]").forEach((element) => element.removeAttribute("data-todo-drop-target")); }
  return <aside className={styles.unplacedTray} aria-label="Unplaced paper TODOs">
    <div className={styles.unplacedTop}>
      <header>
        <div className={styles.unplacedHeaderTitle}><strong>Unplaced TODOs</strong><span>{candidates.length}</span></div>
        <FastTooltip label="Close Unplaced TODOs"><button type="button" className={styles.unplacedClose} aria-label="Close Unplaced TODOs" onClick={onClose}><X size={14} aria-hidden="true" /></button></FastTooltip>
      </header>
      <p>Drag a TODO onto any card.</p>
      <input aria-label="Search unplaced paper TODOs" placeholder="Find a TODO…" value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <ul>{visible.map((todo) => <li key={todo.id} data-unplaced-todo={todo.id}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest("[data-place-todo], a")) return;
        if (event.pointerType === "touch" && !target.closest("[data-todo-drag-handle]")) return;
        if (readOnly) {
          event.preventDefault();
          onBlockedEdit();
          return;
        }
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
  draftChanges,
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
  onUseHtml,
  onPasteHtml,
  onNoteChange,
  onBlockedEdit,
  onTextFocus,
  onRequestRevision,
  onSaveDraft,
  filteredOut = false,
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
  answeredRequest?: string;
  draftChanges?: DraftChangeInfo;
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
  onUseHtml: (source: string) => Promise<void>;
  onPasteHtml: (html: string) => Promise<void>;
  onNoteChange: (value: string) => void;
  onBlockedEdit?: () => void;
  onTextFocus: () => void;
  onRequestRevision: (note: string) => Promise<void>;
  onSaveDraft: () => Promise<void>;
  filteredOut?: boolean;
  onDeleteDraft?: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onTodoCommit?: (title: string, text: string) => Promise<boolean>;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const htmlCard = !node.todoId && (node.contentFormat === "html" || restoredDraft?.contentFormat === "html");
  const [notesOpen, setNotesOpen] = useState(() => Boolean(node.todoId && node.agentDraft && node.caption?.startsWith("@agent ")));
  const [draftDiffHover, setDraftDiffHover] = useState(false);
  const collapsedChildCount = shiftExpandHeld ? childNavigation.length : collapsedDescendantCount;
  const expandChildLabel = `Expand ${collapsedChildCount} ${shiftExpandHeld ? "immediate " : ""}child card${collapsedChildCount === 1 ? "" : "s"}`;
  const activityDescription = activityLabel
    ? activityLabel === "recent activity in this branch" ? "Recent activity in this branch" : `Recent activity: ${activityLabel}`
    : undefined;
  const [imageDropActive, setImageDropActive] = useState(false);
  const fitTable = node.cardWidth === undefined && node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !fitTable || editing) return;
    const tables = card.querySelectorAll<HTMLTableElement>(".mindmap-node-detail table, .mindmap-node-title table");
    if (!tables.length) return;
    card.style.width = `${MAX_AUTO_TABLE_WIDTH}px`;
    let width = NODE_WIDTH;
    for (const table of tables) {
      const wrapper = table.parentElement!;
      width = Math.max(width, table.offsetWidth + card.offsetWidth - wrapper.clientWidth + 1);
    }
    width = Math.min(MAX_AUTO_TABLE_WIDTH, width);
    card.style.width = `${width}px`;
    onMeasure(node.id, { width, height: card.offsetHeight });
  }, [fitTable, editing, node, fontSize, onMeasure]);
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
  const displayTitle = visibleAgentTitle(title, answeredRequest);
  const displayBody = visibleAgentAnswer(body, answeredRequest);
  const tags = node.tags || [];
  const initial = node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node);
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  draftRef.current = draft;
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
    if (htmlCard) { onCommit(); return Promise.resolve(true); }
    const text = draftFormatRef.current === "html" ? draftRef.current : editorRef.current?.getLiveSource() ?? draftRef.current;
    if (!node.todoId) {
      const error = htmlCardValidationError({ text: splitCardText(text).body, contentFormat: draftFormatRef.current });
      if (error) { setCommitError(error); return Promise.resolve(false); }
      onTextChange(text, draftFormatRef.current);
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
  }, [draft, draftFormat, initial, htmlCard, node.todoId, onTextChange, onCommit, onTodoCommit, readOnly]);

  const getDraft = useCallback((): InlineCardDraft | null => {
    if (finishedRef.current || htmlCard) return null;
    return {
      text: draftFormatRef.current === "html" ? draftRef.current : editorRef.current?.getLiveSource() ?? draftRef.current,
      contentFormat: draftFormatRef.current || "plain",
      selection: editorRef.current?.getSelection() ?? undefined,
    };
  }, [draft, htmlCard]);

  const cancel = () => {
    if (commitInFlightRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  useEffect(() => {
    if (!editing || htmlCard) return;
    const session = { nodeId: node.id, commit, getDraft };
    editSessionRef.current = session;
    const finishOutside = (event: Event) => {
      const belongsToEditor = event.composedPath().some((target) => target instanceof Element && (
        target.getAttribute("data-mind-editor") === node.id
        || target.matches('[role="toolbar"][aria-label="Card formatting"]')
        || target.matches("[data-editor-notice]")
        || target.matches("[data-ob-modal]")
      ));
      if (belongsToEditor) return;
      void commit();
    };
    document.addEventListener("pointerdown", finishOutside, true);
    return () => {
      if (editSessionRef.current === session) editSessionRef.current = null;
      document.removeEventListener("pointerdown", finishOutside, true);
    };
  }, [editing, htmlCard, node.id, commit, getDraft, editSessionRef]);

  function changeDraftFormat(value: MindmapNode["contentFormat"]) {
    if (value === "html") {
      const text = editorRef.current?.getLiveSource() ?? draftRef.current;
      const pending = onUseHtml(text).then(() => { finishedRef.current = true; return true; })
        .catch(error => { setCommitError(error instanceof Error ? error.message : "Could not change card format."); return false; })
        .finally(() => { commitInFlightRef.current = null; });
      commitInFlightRef.current = pending;
      return;
    }
    draftFormatRef.current = value;
    setDraftFormat(value);
    onDraftActivity();
  }

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
    if (htmlCard) { editingNodeRef.current = null; return; }
    if (editing && editingNodeRef.current !== node.id) {
      finishedRef.current = false;
      draftFormatRef.current = restoredDraft?.contentFormat || node.contentFormat || "plain";
      setDraftFormat(draftFormatRef.current);
      setFormatHint("");
      const text = restoredDraft?.text ?? (node.todoId ? `${title}${body ? `\n${body}` : ""}`.trim() : editableCardText(node));
      draftRef.current = text;
      setDraft(text);
      setCommitError(null);
      editingNodeRef.current = node.id;
    } else if (!editing) {
      editingNodeRef.current = null;
      setCommitError(null);
    }
  }, [editing, htmlCard, node.id, title, body, restoredDraft]);
  useEffect(() => {
    if (!editing || htmlCard) return;
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
      requestAnimationFrame(() => {
        if (restoredDraft?.selection) editorRef.current?.setSelection(restoredDraft.selection.from, restoredDraft.selection.to);
        else editorRef.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, htmlCard, restoredDraft]);
  const showDraftDiff = Boolean(node.agentDraft && draftDiffHover && draftChanges && !editing);
  const plainCard = !node.todoId && !htmlCard && (!node.contentFormat || node.contentFormat === "plain");
  const titleWordDiff = useMemo(
    () => (showDraftDiff && plainCard && draftChanges?.titleChanged && !draftChanges.isNew
      ? diffChangedWordSpans(draftChanges.beforeTitle, displayTitle)
      : null),
    [showDraftDiff, plainCard, draftChanges, displayTitle],
  );
  const bodyWordDiff = useMemo(
    () => (showDraftDiff && plainCard && draftChanges?.bodyChanged && !draftChanges.isNew
      ? diffChangedWordSpans(draftChanges.beforeText, displayBody)
      : null),
    [showDraftDiff, plainCard, draftChanges, displayBody],
  );
  const underlineWholeTitle = showDraftDiff && Boolean(draftChanges?.titleChanged) && !titleWordDiff;
  const underlineWholeBody = showDraftDiff && Boolean(draftChanges?.bodyChanged) && !bodyWordDiff;
  const underlineNotes = showDraftDiff && Boolean(draftChanges?.notesChanged);
  return (
    <>
    {editing && !readOnly && <NodeToolbar
      isVisible
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
      {htmlCard ? <HtmlCardTools html={node.text} onPaste={onPasteHtml} onDone={onCommit} onComment={async comment => {
        await onRequestRevision(/^@(?:agent|stat)\b/i.test(comment) ? comment : `@agent ${comment}`);
        setNotesOpen(true);
      }} /> : <>
      <FastTooltip label="Bold (⌘B / Ctrl+B)"><button type="button" className={styles.editToolbarButton} aria-label="Bold selection" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("bold")}><Bold size={15} /></button></FastTooltip>
      <FastTooltip label="Italic (⌘I / Ctrl+I)"><button type="button" className={styles.editToolbarButton} aria-label="Italic selection" onPointerDown={(event) => event.preventDefault()} onClick={() => formatSelection("italic")}><Italic size={15} /></button></FastTooltip>
      {node.todoId ? <span className="mindmap-inline-editor-hint" title="Paper TODO formatting is saved in TeX">TeX</span> : (
        <ChoiceButtons label="Editing card content format" value={draftFormat || "plain"} options={[{value:"plain",label:"Plain"},{value:"markdown",label:"Markdown"},{value:"tex",label:"TeX"},{value:"html",label:"HTML"}]} onChange={(value) => changeDraftFormat(value as MindmapNode["contentFormat"])} />
      )}
      <span className="mindmap-inline-editor-divider" />
      <FastTooltip label="Done (⌘Enter / Ctrl+Enter)"><button type="button" className={styles.editToolbarButton} aria-label="Finish editing card" onClick={() => void commit()}><Check size={15} /><span>{node.agentDraft ? "Keep draft" : "Done"}</span></button></FastTooltip>
      {formatHint && <span className="mindmap-format-hint" role="status">{formatHint}</span>}
      </>}
    </NodeToolbar>}
    <article
      ref={cardRef}
      data-drop-kind={dropPreviewKind || undefined}
      data-mind-node={node.id}
      data-progress={node.progress ?? undefined}
      data-filtered-out={filteredOut || undefined}
      data-draft-underline-title={underlineWholeTitle || undefined}
      data-draft-underline-body={underlineWholeBody || undefined}
      data-draft-underline-notes={underlineNotes || undefined}
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
      {node.agentDraft ? (
        <div
          className={cn(styles.draftActions, "nodrag nopan")}
          data-mind-editor={node.id}
          onMouseEnter={() => setDraftDiffHover(true)}
          onMouseLeave={() => setDraftDiffHover(false)}
          onFocus={() => setDraftDiffHover(true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraftDiffHover(false); }}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          {!readOnly && <FastTooltip label="Accept draft"><button type="button" aria-label="Accept draft" onClick={() => void onSaveDraft()}><Check size={13} /></button></FastTooltip>}
          <RequestRevision nodeId={node.id} disabled={readOnly || (editing && htmlCard)} onRequest={async mention => {
            await onRequestRevision(mention);
            if (node.todoId || htmlCard) setNotesOpen(true);
          }} />
          {!readOnly && onDeleteDraft && <FastTooltip label="Discard draft"><button type="button" aria-label="Delete draft" onClick={onDeleteDraft}><X size={13} /></button></FastTooltip>}
        </div>
      ) : !readOnly && !(editing && htmlCard) && (
        <div
          className={cn(styles.cardReviseZone, "nodrag nopan")}
          data-mind-editor={node.id}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <div className={styles.cardRevisePill}>
            <RequestRevision nodeId={node.id} mode="card" onRequest={async mention => {
              await onRequestRevision(mention);
              if (node.todoId || htmlCard) setNotesOpen(true);
            }} />
          </div>
        </div>
      )}
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
      {editing && !htmlCard ? (
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
              draftRef.current = value;
              setDraft(value);
              onDraftActivity();
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
              {displayTitle.trim() && <div className={cn("mindmap-node-title", node.parentId === null && styles.rootTitle)}>
                {node.parentId === null ? (
                  <><span className={styles.rootAccent} aria-hidden="true" /><div className={styles.rootSubject}>{titleWordDiff ? titleWordDiff.map((seg, i) => seg.changed ? <span key={i} className={styles.draftChanged}>{seg.text}</span> : seg.text) : <NodeRichText text={displayTitle} format={htmlCard ? "plain" : node.contentFormat} tableLayout={node.tableLayout} />}</div></>
                ) : titleWordDiff ? titleWordDiff.map((seg, i) => seg.changed ? <span key={i} className={styles.draftChanged}>{seg.text}</span> : seg.text) : <NodeRichText text={displayTitle} format={htmlCard ? "plain" : node.contentFormat} tableLayout={node.tableLayout} />}
              </div>}
              {displayBody.trim() && <div className="mindmap-node-detail">{bodyWordDiff ? bodyWordDiff.map((seg, i) => seg.changed ? <span key={i} className={styles.draftChanged}>{seg.text}</span> : seg.text) : <NodeRichText text={displayBody} format={htmlCard ? "html" : node.contentFormat} tableLayout={node.tableLayout} />}</div>}
            </>
          )}
        </>
      )}
          {(uploading > 0 || node.refs?.some(ref => ref.kind === "figure")) && (
            <CardImages project={project} refs={node.refs || []} readOnly={readOnly} uploading={uploading}
              onChange={onImageChange} />
          )}
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
            <CardMetadataPills metadata={node.metadata} />
          </div>
          <CardScratchpad open={notesOpen} onOpenChange={setNotesOpen} text={node.caption} caution={node.caution} cardTitle={title || undefined} editing={editing} readOnly={readOnly}
            onChange={onNoteChange} onCommit={() => void commit()} onCancel={cancel} onBlockedEdit={onBlockedEdit}
            footer={hasCardLinks(node.refs) ? <CardLinkIndicator sourceId={node.id} project={project} refs={node.refs || []} /> : undefined} />
      {!editing && <ParentNavigation cardTitle={title || "Untitled card"} item={parentNavigation} onJump={onJumpToCard} />}
      {!editing && <ChildNavigation parentTitle={title || "Untitled card"} items={childNavigation} height={dimensions.height} onJump={onJumpToCard} />}
      {!readOnly && <CardResizeGrip width={dimensions.width} onPreview={onResizePreview} onCommit={onResizeCommit} />}
      {collapsedDescendantCount > 0 && (
        <TooltipProvider delayDuration={650} skipDelayDuration={0}>
        <FastTooltip label={collapsed ? shiftExpandHeld ? `${expandChildLabel}. Keep deeper branches collapsed.` : "Expand child cards\nShift or ⌥-click expands immediate children only" : "Collapse all child cards"}><button
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
            onToggleCollapse(event.shiftKey || event.altKey);
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
  const title = node.title !== undefined ? node.title.trim() : node.contentFormat === "html" ? "HTML card" : firstLine(node.text);
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
  const visibleNodes = safeNodes.map(withAgentTableFormat);
  const { nodeById, childrenByParent: children } = indexMindmap({ ...mindmap, nodes: visibleNodes });
  const displayTextById = new Map(visibleNodes.map((node) => [node.id, paperTodoText(node, paperState)]));
  const dimensions = new Map<string, Dimensions>();
  for (const node of visibleNodes) {
    const size = nodeDimensions(node, displayTextById.get(node.id));
    const extra = extraHeight?.get(node.id) || 0;
    const measured = measuredCards?.get(node.id);
    const fittedTable = node.cardWidth === undefined && node.contentFormat === "markdown" && node.tableLayout !== "scroll" && markdownTableColumns(node.text) > 0;
    const widthMatches = measured && (fittedTable
      ? measured.width <= MAX_AUTO_TABLE_WIDTH && measured.width >= NODE_WIDTH
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
  const label = target?.title?.trim() || (target?.contentFormat === "html" ? "HTML card" : target ? firstLine(target.text) : "card");
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
  if (node.contentFormat === "html") return { title: node.title || "", body: node.text };
  if (node.title !== undefined) return { title: node.title, body: node.text };
  return splitCardText(node.text);
}

function editableCardText(node: MindmapNode): string {
  const content = editableCardContent(node);
  return node.contentFormat === "html" ? `${content.title}\n${content.body}` : joinMindmapCardContent(content);
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
