"use client";

import { bundleSections } from "@/lib/tex-project/section-ranges";

import "katex/dist/katex.min.css";
import { useGitAutoSync } from "@/components/use-git-auto-sync";
import { OverleafSyncNotice } from "@/components/overleaf-sync-notice";
import { EditorNotice } from "@/components/editor-notice";
import { SaveSyncStatus } from "@/components/save-sync-status";
import { FastTooltip } from "@/components/fast-tooltip";
import paperStyles from "./paper-outline-rail.module.css";
import { CommentKindPicker } from "./comment-kind-picker";
import { handlePaperAddShortcut, paperAddShortcut } from "./paper-add-shortcuts";
import { PaperOutlineRail } from "./paper-outline-rail";
import { usePaperReadingMode } from "./paper-reading-shell";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import { Group, Panel, Separator, useGroupRef, usePanelRef } from "react-resizable-panels";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  FileText,
  GripHorizontal,
  GripVertical,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListChecks,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  PanelTop,
  Quote,
  RefreshCw,
  Sigma,
  Table2,
  X,
} from "lucide-react";

import {
  placeTodoOnMindmapAction,
  removePaperTodoAction,
  synctexViewAction,
  uploadPaperFigureAction,
} from "@/app/actions";
import { getBrowserGitStatus, pushBrowserProject } from "@/lib/research/browser-git-sync";
import type { ClientSourceBundle } from "@/lib/tex-project/source-bundle-format";
import { inlineBundleIncludes, splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";
import type { BibEntry } from "@/lib/bibtex";
import type { PaperCompileStatus } from "@/lib/tex-project/compile";
import { getBrowserPaperCompileStatus, requestBrowserPaperCompile } from "./browser-compile";
import { getBrowserEditablePaper, saveBrowserPaperSource } from "./browser-source";
import { parseTexFileLines } from "@/lib/tex-project/tex-diagnostics";

import { headingKeyForElement } from "./heading-keys";
import { NestedBundleEditor } from "./nested-bundle-editor";
import { type TexCodeMirrorHandle, type TexDocChange } from "./tex-codemirror";
import { TexPreview } from "./tex-preview";
import { usePreviewWorker } from "./use-preview-worker";
import type { PdfSourceTarget } from "./pdf-viewer";
import {
  lintLivePaper,
  liveSnapshotFromSource,
  sectionBodyRange,
  usePaperWebMcp,
} from "./use-paper-webmcp";
import { AnchoredPop, MenuSurface } from "@/components/pop";
import { commentKindAppearance } from "@/lib/comment-kinds";
import { composeObcomment } from "@/lib/research/paper-analysis";
import { previewTodoAtSection, relocateTodoInBundle } from "@/lib/research/paper-todo-placement";
import { assignMissingTodoIds, composeObtodo, rewriteObtodo, type TodoAttrPatch } from "@/lib/todo-meta";
import { applyTexLintFix, lintProsePercentages } from "@/lib/tex-project/tex-lint";
import { PaperMetrics } from "./paper-metrics";
import { PaperAppearance, type PaperEditorWidth, type PaperReaderFont } from "./paper-appearance";
import { TodoPanel, type TodoUndoSnapshot } from "./todo-panel";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { remoteSyncResult } from "@/lib/research/project-sync";
import {
  getMindmapRemoteSyncQueue,
  type MindmapRemoteQueueEvent,
} from "@/lib/research/mindmap-remote-sync-queue";
import type { RemoteSyncOutcome } from "@/lib/research/operation-result";
import { decodePaperSectionFragment, resolvePaperSectionRef } from "@/lib/research/artifact-link";
import {
  COMPILE_POLL_MS,
  compilePollDecision,
  markCompileObservationDelayed,
  recordCompileObservationError,
  resumeCompilePolling,
  transitionCompileStatus,
  type PaperCompileViewState,
} from "./compile-state";
import {
  hasLiveEditorChanged,
  removeSourceRange,
  requireAppliedRemovalSource,
} from "@/lib/research/editor-operation-races";
import {
  collectEditorComments,
  collectEditorTodos,
  findEditorTodo,
  listBookmarks,
  locatePreviewSnippet,
  offsetForBookmarkLine,
  offsetForHeadingKey,
  offsetForSourceFileLine,
  sectionReplacementBody,
  TEX_BLANK_TABLE_TPL,
  TEX_PLANNED_FIGURE_TPL,
  TEX_PLANNED_PLOT_TPL,
  TEX_RESULT_GRID_TPL,
  type EditorTodo,
  type PaperEditorSection,
} from "./tex-source";

export type { PaperEditorSection };
const PdfJsViewer = dynamic(() => import("./pdf-viewer").then((module) => module.PdfJsViewer), { ssr: false });

type LayoutMode = "document" | "pdf";
type RemoteSaveState = "checking" | "local" | "saving" | "saved" | "changed" | "blocked" | "unconfigured" | "unavailable" | "error";
type PaperRemotePushResult = Awaited<ReturnType<typeof pushBrowserProject>>;

const AUTOSAVE_IDLE_MS = 500;
const AUTOSAVE_MAX_MS = 2_000;
const PAGE_BUDGET_REFRESH_MS = 3 * 60_000;
const TODO_PANEL_DEFAULT = 360;
const TODO_PANEL_MIN = 220;
const SPLIT_MIN = 22;
const SPLIT_MAX = 78;
const HEADING_ALIGN = 0.2;

function sourceHeaderInset(scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  let inset = 0;
  for (const label of scroller.querySelectorAll<HTMLElement>(".ob-nested-tex-card-label")) {
    const box = label.getBoundingClientRect();
    if (box.top <= top + 1 && box.bottom > top) inset = Math.max(inset, box.bottom - top);
  }
  return inset;
}
const DEFAULT_PREVIEW_FONT_SCALE = 0.9;
const DEFAULT_EDITOR_FONT_SCALE = 1;
const DEFAULT_PREVIEW_LINE_HEIGHT = 1.75;
const DEFAULT_PREVIEW_FONT: PaperReaderFont = "serif";

function locateUndoOffset(source: string, _hint: number, snapshot: TodoUndoSnapshot): number | null {
  const candidates: number[] = [];
  const before = snapshot.before.slice(-192);
  const after = snapshot.after.slice(0, 192);
  const addCandidate = (candidate: number) => {
    if (candidate < 0 || candidate > source.length || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  // Prefer an intact two-sided anchor. Looking for the snippets separately
  // can pair a prefix from one repeated passage with a suffix from another.
  if (before && after) {
    let cursor = 0;
    while (cursor <= source.length) {
      const index = source.indexOf(after, cursor);
      if (index < 0) break;
      if (source.slice(Math.max(0, index - before.length), index) === before) addCandidate(index);
      cursor = index + 1;
    }
  }
  if (!candidates.length && before) {
    let cursor = 0;
    while (cursor <= source.length) {
      const index = source.indexOf(before, cursor);
      if (index < 0) break;
      addCandidate(index + before.length);
      cursor = index + 1;
    }
  }
  if (!candidates.length && after) {
    let cursor = 0;
    while (cursor <= source.length) {
      const index = source.indexOf(after, cursor);
      if (index < 0) break;
      addCandidate(index);
      cursor = index + 1;
    }
  }
  // A numeric hint is useful for diagnostics but must never disambiguate
  // repeated source context. Requiring one candidate turns an uncertain undo
  // into an explicit conflict instead of inserting the TODO into the wrong
  // paragraph.
  return candidates.length === 1 ? candidates[0]! : null;
}

type HydratedPaper = {
  title: string;
  sections: PaperEditorSection[];
  bundle: ClientSourceBundle;
  sourceContext: {
    sections: PaperSourceContextSection[];
    diagnostics: SourceDiagnostic[];
  };
};

type SourceDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  filePath?: string;
  repair?: { kind: "missing-edit-end"; sectionId: string; filePath?: string };
};

type PaperSourceContextSection = {
  id: string;
  title: string;
  level: number;
  order: number;
  label: string;
  file: string;
  bodyHash: string;
  sourceHash: string;
  sourceRange: { from: number; to: number };
  writeTargetId?: string;
  excerpt: string;
  headingPath: string[];
  parseStatus: "ok" | "error";
  diagnostic?: SourceDiagnostic;
  diagnostics: SourceDiagnostic[];
};

type EditorPrefs = {
  layout?: LayoutMode;
  editorWidth?: PaperEditorWidth;
  splitLeftPct?: number;
  splitTopPct?: number;
  todoOpen?: boolean;
  todoPanelHeight?: number;
  lastSection?: string;
  previewFontScale?: number;
  editorFontScale?: number;
  previewLineHeight?: number;
  previewFont?: PaperReaderFont;
};

function prefsKey(project: string) {
  return `ob:paper-prefs:${project}`;
}

function recoveryKey(project: string) {
  return `ob:paper-recovery:${project}:paper`;
}

type RecoveryDraft = { source: string; baseHash: string; savedAt: string };

export function PaperEditor({
  project,
  title,
  initialSections,
  initialBundle,
  sourceContext,
  bibliography,
  bibliographyRaw,
  placementTargets = [],
  boundTodoIds = [],
}: {
  project: string;
  title: string;
  initialSections: PaperEditorSection[];
  initialBundle: ClientSourceBundle;
  sourceContext: HydratedPaper["sourceContext"];
  bibliography?: BibEntry[];
  bibliographyRaw?: string;
  placementTargets?: { id: string; label: string }[];
  boundTodoIds?: string[];
}) {
  const { reading: projectHeaderHidden, setReading: setReadingMode } = usePaperReadingMode();
  const router = useRouter();
  const remoteQueue = useMemo(
    () => getMindmapRemoteSyncQueue<PaperRemotePushResult>(project, result => result.ok),
    [project],
  );
  const initialSource = initialBundle.source;
  const [source, setSource] = useState(initialSource);
  const [savedSource, setSavedSource] = useState(initialSource);
  const [bundleHash, setBundleHash] = useState(initialBundle.bundleHash);
  const [bundleDiagnostics, setBundleDiagnostics] = useState(initialBundle.diagnostics);
  const [sourceContextState, setSourceContextState] = useState(sourceContext);
  const [saving, setSaving] = useState(false);
  const [localDirty, setLocalDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [todoRemovalError, setTodoRemovalError] = useState<{ todo: EditorTodo; message: string; retry: "remove" | "save"; report: Record<string, unknown> } | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [remoteOutOfSync, setRemoteOutOfSync] = useState(false);
  const [applyingRemote, setApplyingRemote] = useState(false);
  const applyingRemoteRef = useRef(false);
  const remoteOutOfSyncRef = useRef(false);
  remoteOutOfSyncRef.current = remoteOutOfSync || applyingRemoteRef.current;
  const [remoteSaveState, setRemoteSaveState] = useState<RemoteSaveState>("checking");
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const [expectedSections, setExpectedSections] = useState(initialSections);
  const [prefsReady, setPrefsReady] = useState(false);

  const [layout, setLayout] = useState<LayoutMode>("document");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [activeBookmark, setActiveBookmark] = useState<string>("");
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeQuery, setCiteQuery] = useState("");
  const [citeHighlight, setCiteHighlight] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(50);
  const [formatHeight, setFormatHeight] = useState(44);
  const [todoOpen, setTodoOpen] = useState(false);
  const [editorWidth, setEditorWidth] = useState<PaperEditorWidth>("wide");
  const [todoPanelHeight, setTodoPanelHeight] = useState(TODO_PANEL_DEFAULT);
  const [splitLeftPct, setSplitLeftPct] = useState(50);
  const [splitTopPct, setSplitTopPct] = useState(50);
  const [previewFontScale, setPreviewFontScale] = useState(DEFAULT_PREVIEW_FONT_SCALE);
  const [editorFontScale, setEditorFontScale] = useState(DEFAULT_EDITOR_FONT_SCALE);
  const [previewLineHeight, setPreviewLineHeight] = useState(DEFAULT_PREVIEW_LINE_HEIGHT);
  const [previewFont, setPreviewFont] = useState<PaperReaderFont>(DEFAULT_PREVIEW_FONT);
  const [compile, setCompile] = useState<PaperCompileViewState>({ state: "idle" });
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const recoveryDraftRef = useRef<RecoveryDraft | null>(null);
  recoveryDraftRef.current = recoveryDraft;
  const [pdfSourceTarget, setPdfSourceTarget] = useState<PdfSourceTarget | null>(null);
  const pdfNavigationRequest = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewAnnotate, setPreviewAnnotate] = useState<{
    from: number;
    to: number;
    text: string;
    revision: number;
    x: number;
    y: number;
  } | null>(null);
  const [commentKindDraft, setCommentKindDraft] = useState("claim");
  const [macShortcuts, setMacShortcuts] = useState(false);
  useEffect(() => { setMacShortcuts(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  const commentShortcut = paperAddShortcut("comment", macShortcuts, commentKindDraft);
  const todoShortcut = paperAddShortcut("todo", macShortcuts);

  const editorRef = useRef<TexCodeMirrorHandle>(null);
  const sourceRef = useRef(initialSource);
  const { result: previewResult, reset: resetPreview, applyChanges: applyPreviewChanges, workerError } = usePreviewWorker({
    bibliography,
    assetBaseUrl: `/api/p/${project}/asset`,
    getLiveSource: () => editorRef.current?.getLiveSource() ?? sourceRef.current,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const controlsDockRef = useRef<HTMLDivElement>(null);
  const formatPanelRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controls = controlsDockRef.current;
    const format = formatPanelRef.current;
    const measure = () => {
      if (controls) setControlsHeight(controls.getBoundingClientRect().height);
      if (format) setFormatHeight(format.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (controls) observer.observe(controls);
    if (format) observer.observe(format);
    return () => observer.disconnect();
  }, []);
  const readingMotionRef = useRef({ direction: 0, distance: 0 });
  const readingTouchYRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const citeBtnRef = useRef<HTMLDivElement>(null);
  const splitGroupRef = useGroupRef();
  const todoPanelRef = usePanelRef();
  const activeScrollSourceRef = useRef<"editor" | "preview" | "jump" | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const headingRafRef = useRef<number | null>(null);
  const lastHeadingKeyRef = useRef("");
  // Keep source and rendered positions linked across pane switches.
  const syncPanesRef = useRef(true);
  const claimScrollSource = (source: "editor" | "preview") => {
    activeScrollSourceRef.current = source;
    if (scrollSettleTimerRef.current) {
      window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
  };
  const observeReadingMotion = (delta: number) => {
    if (Math.abs(delta) < 2) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && (document.getElementById("paper-reading-controls")?.contains(focused) || document.getElementById("paper-project-header")?.contains(focused)) && focused.matches(":focus-visible")) return;
    const direction = Math.sign(delta);
    const motion = readingMotionRef.current;
    motion.distance = motion.direction === direction ? motion.distance + Math.abs(delta) : Math.abs(delta);
    motion.direction = direction;
    if (motion.distance >= (direction > 0 ? 48 : 72)) {
      setControlsCollapsed(direction > 0);
      setReadingMode(direction > 0);
      motion.distance = 0;
    }
  };
  const startReadingTouch = (touches: React.TouchList) => {
    readingTouchYRef.current = touches[0]?.clientY ?? null;
  };
  const moveReadingTouch = (touches: React.TouchList) => {
    const next = touches[0]?.clientY;
    if (next === undefined || readingTouchYRef.current === null) return;
    observeReadingMotion(readingTouchYRef.current - next);
    readingTouchYRef.current = next;
  };
  const observeReadingKey = (key: string) => {
    if (key === "PageDown") observeReadingMotion(60);
    if (key === "PageUp") observeReadingMotion(-80);
  };
  const saveTimerRef = useRef<number | null>(null);
  const burstStartRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ text: string; requestId: number } | null>(null);
  const saveRequestIdRef = useRef(0);
  const saveBusyRef = useRef(false);
  const revisionRef = useRef(0);
  const savedSourceRef = useRef(initialSource);
  const expectedSectionsRef = useRef(expectedSections);
  expectedSectionsRef.current = expectedSections;
  const compileRef = useRef(compile);
  compileRef.current = compile;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;
  const saveConflictRef = useRef(saveConflict);
  saveConflictRef.current = saveConflict;
  const saveFailureRef = useRef<{ code: string; message: string; stack?: string; currentHash?: string } | null>(null);
  const sectionHashesRef = useRef(new Map(initialSections.map((section) => [section.id, section.hash])));
  const bundleHashRef = useRef(initialBundle.bundleHash);
  bundleHashRef.current = bundleHash;
  const sourceSegmentsRef = useRef(initialBundle.segments.map(({ filePath, editable }) => ({ filePath, editable })));
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remoteSavePendingRef = useRef(false);
  const remoteStatusRequestRef = useRef(0);
  const remoteSyncRef = useRef<RemoteSyncOutcome | undefined>(undefined);
  const navigationPendingRef = useRef(false);

  const writeRecoveryDraft = useCallback(() => {
    const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
    if (recoveryDraftRef.current) return;
    if (live === savedSourceRef.current) {
      try { window.sessionStorage.removeItem(recoveryKey(project)); } catch { /* quota or storage policy */ }
      return;
    }
    try {
      window.sessionStorage.setItem(recoveryKey(project), JSON.stringify({
        source: live,
        baseHash: bundleHashRef.current,
        savedAt: new Date().toISOString(),
      } satisfies RecoveryDraft));
    } catch {
      // Recovery is best-effort browser state. The editor still keeps the live draft.
    }
  }, [project]);

  const clearRecoveryDraft = useCallback(() => {
    try { window.sessionStorage.removeItem(recoveryKey(project)); } catch { /* storage may be disabled */ }
    setRecoveryDraft(null);
    recoveryDraftRef.current = null;
  }, [project]);

  const reviewingRemoteRef = useRef(false);
  useEffect(() => {
    let initial = true;
    const applyQueueEvent = (event: MindmapRemoteQueueEvent<PaperRemotePushResult>) => {
      const initialSettled = initial && (event.phase === "synced" || event.phase === "failed");
      initial = false;
      if (event.sequence === 0 || initialSettled) return;
      setCheckingRemote(false);
      if (event.phase === "pending" || event.phase === "syncing") {
        remoteSavePendingRef.current = true;
        setRemoteSaveState(event.phase === "syncing" ? "saving" : "local");
        setRemoteSaveError(null);
        remoteSyncRef.current = {
          status: "pending",
          code: event.phase === "syncing" ? "push_in_progress" : "remote_sync_queued",
          message: event.phase === "syncing" ? "Local save complete. Pushing to Git…" : "Local save complete. Waiting to push the latest checkpoint.",
          retryable: true,
        };
        return;
      }
      const result = event.result;
      if (event.phase === "synced" && result?.ok) {
        remoteSyncRef.current = remoteSyncResult(result);
        remoteSavePendingRef.current = false;
        setRemoteSaveState("saved");
        setRemoteOutOfSync(false);
        setRemoteSaveError(null);
        return;
      }
      const failure = result && !result.ok ? result : {
        ok: false as const,
        code: "remote_save_failed",
        message: event.error instanceof Error ? event.error.message : "Could not save to the remote.",
      };
      remoteSyncRef.current = remoteSyncResult(failure);
      remoteSavePendingRef.current = true;
      if (failure.code === "remote_ahead" || failure.code === "remote_conflict") setRemoteOutOfSync(true);
      setRemoteSaveState(
        failure.code === "remote_ahead" || failure.code === "remote_conflict"
          ? "changed"
          : failure.code === "pre_staged_work" ? "blocked"
          : failure.code === "remote_unconfigured" || failure.code === "remote_not_overleaf" || failure.code === "not_git_repo"
            ? "unconfigured"
            : "error",
      );
      setRemoteSaveError(remoteSyncRef.current.status === "unconfigured" ? null : failure.message);
    };
    return remoteQueue.subscribe(applyQueueEvent);
  }, [remoteQueue]);

  const pushRemote = useCallback(async (message: string): Promise<PaperRemotePushResult> => {
    if (reviewingRemoteRef.current) return { ok: false, code: "review_in_progress", message: "Local changes saved for pull review." };
    ++remoteStatusRequestRef.current;
    return remoteQueue.enqueue(bundleHashRef.current, async () => {
      try {
        return await pushBrowserProject(project, message);
      } catch (error) {
        return { ok: false, code: "remote_save_failed", message: error instanceof Error ? error.message : "Could not save to the remote." };
      }
    });
  }, [project, remoteQueue]);

  const refreshRemoteStatus = useCallback(async (refreshRemote = true, announce = true) => {
    const requestId = ++remoteStatusRequestRef.current;
    const queueSequence = remoteQueue.getSnapshot().sequence;
    const queueWasBusy = remoteQueue.isBusy;
    setCheckingRemote(true);
    if (announce && !queueWasBusy) setRemoteSaveState(current => current === "changed" || current === "blocked" || current === "error" || current === "unavailable" ? current : "checking");
    let timeoutId: number | undefined;
    try {
      const timeout = announce ? new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("Remote status check timed out. Retry to refresh synchronization status.")), 5_000);
      }) : null;
      const request = getBrowserGitStatus(project, refreshRemote);
      const status = timeout ? await Promise.race([request, timeout]) : await request;
      if (requestId !== remoteStatusRequestRef.current) return;
      if (queueWasBusy || remoteQueue.isBusy || remoteQueue.getSnapshot().sequence !== queueSequence) return;
      if (!status.isGitRepo) {
        setRemoteSaveState("unconfigured");
        setRemoteSaveError(null);
        return status;
      }
      if (!status.isOverleafRemote) {
        setRemoteSaveState("unconfigured");
        setRemoteSaveError(null);
        return status;
      }
      if (status.error) {
        setRemoteSaveState("unavailable");
        setRemoteSaveError(`Git status unavailable: ${status.error}`);
        return status;
      }
      if (typeof status.isClean !== "boolean" || !Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind)
        || status.ahead! < 0 || status.behind! < 0) {
        const error = "Git status unavailable: the local and remote comparison is incomplete.";
        setRemoteSaveState("unavailable");
        setRemoteSaveError(error);
        return { ...status, error };
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
      if ((status.ahead || 0) > 0 || !status.isClean) {
        remoteSavePendingRef.current = true;
        setRemoteSaveState("local");
      } else if (refreshRemote) {
        remoteSavePendingRef.current = false;
        setRemoteSaveState("saved");
      } else {
        setRemoteSaveState(current => current === "saved" ? current : "checking");
      }
      return status;
    } catch (error) {
      if (requestId !== remoteStatusRequestRef.current) return;
      if (queueWasBusy || remoteQueue.isBusy || remoteQueue.getSnapshot().sequence !== queueSequence) return;
      setRemoteSaveState("unavailable");
      setRemoteSaveError(`Git status unavailable: ${error instanceof Error ? error.message : "Could not check Git."}`);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (requestId === remoteStatusRequestRef.current) setCheckingRemote(false);
    }
  }, [project, remoteQueue]);

  useEffect(() => {
    // Start with cached Git state. Background checks fetch after first paint.
    void refreshRemoteStatus(false);
  }, [refreshRemoteStatus]);

  const bookmarks = useMemo(() => listBookmarks(inlineBundleIncludes(source)), [source]);
  const commentKinds = useMemo(() => collectEditorComments(source).flatMap((comment) => comment.kind ? [comment.kind] : []), [source]);
  const todos = useMemo(() => collectEditorTodos(source), [source]);
  const wordCount = previewResult?.wordCount ?? 0;
  const percentFixes = useMemo(() => lintProsePercentages(source), [source]);
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const activeBookmarkRef = useRef(activeBookmark);
  activeBookmarkRef.current = activeBookmark;
  const bibliographyRef = useRef(bibliography);
  bibliographyRef.current = bibliography;

  const getScrollAnchors = useCallback(() => {
    const scroller = editorRef.current?.getScroller();
    const preview = previewRef.current;
    if (!scroller || !preview) return null;

    const anchors: { editorTop: number; previewTop: number }[] = [{ editorTop: 0, previewTop: 0 }];
    const edCounts = new Map<string, number>();
    const pvCounts = new Map<string, number>();
    const editorRect = scroller.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const alignTop = Math.max(editorRect.top, previewRect.top);
    const editorVisibleTop = narrow ? sourceHeaderInset(scroller) : alignTop - editorRect.top;
    const previewVisibleTop = narrow ? 0 : alignTop - previewRect.top;
    // Stacked panes meet at the source's first line and preview's last line.
    const previewSeamOffset = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
      return Math.max(0, preview.clientHeight - lineHeight);
    };
    const pvByKey = new Map(
      (Array.from(preview.querySelectorAll(".ob-pv-heading")) as HTMLElement[]).map((heading) => [headingKeyForElement(heading, pvCounts), heading]),
    );
    const firstSection = bookmarksRef.current[0]?.slug;
    const sectionKeys = new Set(bookmarksRef.current.map((bookmark) => bookmark.slug));
    const desktop = syncPanesRef.current && !narrow;
    for (const ed of Array.from(scroller.querySelectorAll(".ob-ed-heading")) as HTMLElement[]) {
      const key = headingKeyForElement(ed, edCounts);
      const pv = pvByKey.get(key);
      if (!pv || !sectionKeys.has(key)) continue;
      const editorContentTop = ed.getBoundingClientRect().top - editorRect.top + scroller.scrollTop;
      const previewContentTop = pv.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
      const pad = desktop && key !== firstSection ? HEADING_ALIGN : 0;
      anchors.push({
        editorTop: Math.max(0, editorContentTop - editorVisibleTop - pad * scroller.clientHeight),
        previewTop: previewContentTop - (narrow ? previewSeamOffset(pv) : previewVisibleTop + pad * preview.clientHeight),
      });
    }

    const maxEditor = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxPreview = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const parts = splitBundleSource(sourceRef.current);
    const chunks = Array.from(scroller.querySelectorAll<HTMLElement>(".ob-nested-tex-slice[data-ob-file]")).flatMap((host) => {
      const matching = parts.filter((part) => part.filePath === host.dataset.obFile);
      const dom = host.querySelector<HTMLElement>(".cm-editor");
      const view = dom && EditorView.findFromDOM(dom);
      if (matching.length !== 1 || !view) return [];
      const part = matching[0]!;
      const lineFrom = offsetForBookmarkLine(part.body, Number(host.dataset.obLineStart || 1) - 1);
      const localFrom = part.body.indexOf(view.state.doc.toString(), lineFrom);
      const lineEnd = part.body.indexOf("\n", lineFrom);
      if (localFrom < lineFrom || (lineEnd >= 0 && localFrom > lineEnd)) return [];
      return [{ view, from: part.bodyFrom + localFrom, to: part.bodyFrom + localFrom + view.state.doc.length }];
    });
    // Use the same literal source lookup as preview navigation. Paragraphs
    // keep long sections aligned when TeX tables and prose wrap differently.
    for (const paragraph of preview.querySelectorAll<HTMLElement>("p, li")) {
      const block = paragraph.closest<HTMLElement>("[data-preview-from]");
      if (!block || paragraph.closest(".katex, .ob-references")) continue;
      const range = { from: Number(block.dataset.previewFrom), to: Number(block.dataset.previewTo) };
      if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) continue;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let found: { from: number; to: number } | null = null;
      for (let node = walker.nextNode(); node && !found; node = walker.nextNode()) {
        if (node.parentElement?.closest(".katex, button, [aria-hidden=true]")) continue;
        const text = node.textContent?.trim() || "";
        for (const length of [80, 40, 20]) {
          if (text.length < 12) break;
          found = locatePreviewSnippet(sourceRef.current, text.slice(0, length), range.from, range);
          if (found) break;
        }
      }
      const chunk = found && chunks.find((item) => found.from >= item.from && found.from < item.to);
      if (!found || !chunk) continue;
      anchors.push({
        editorTop: chunk.view.documentTop + chunk.view.lineBlockAt(found.from - chunk.from).top - editorRect.top + scroller.scrollTop - editorVisibleTop - (narrow ? 0 : HEADING_ALIGN * scroller.clientHeight),
        previewTop: paragraph.getBoundingClientRect().top - previewRect.top + preview.scrollTop - (narrow ? previewSeamOffset(paragraph) : previewVisibleTop + HEADING_ALIGN * preview.clientHeight),
      });
    }
    anchors.sort((a, b) => a.editorTop - b.editorTop);
    const ordered = [{ editorTop: 0, previewTop: 0 }];
    for (const anchor of anchors) {
      const previous = ordered[ordered.length - 1]!;
      if (anchor.editorTop > previous.editorTop && anchor.previewTop > previous.previewTop
        && anchor.editorTop < maxEditor && anchor.previewTop < maxPreview) ordered.push(anchor);
    }
    ordered.push({ editorTop: maxEditor, previewTop: maxPreview });
    return ordered;
  }, [narrow]);

  const updateActiveHeading = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    if (headingRafRef.current != null) return;
    headingRafRef.current = window.requestAnimationFrame(() => {
      headingRafRef.current = null;
      const headings = root.querySelectorAll<HTMLElement>("[data-ob-heading-key]");
      if (!headings.length) return;
      const box = root.getBoundingClientRect();
      const visibleAnchor = narrow
        ? root === previewRef.current ? root.clientHeight - 1 : sourceHeaderInset(root)
        : syncPanesRef.current ? box.height * HEADING_ALIGN : 36;
      const top = box.top + visibleAnchor + 1;
      let key = headings[0]!.getAttribute("data-ob-heading-key") || "";
      for (let i = 0; i < headings.length; i += 1) {
        if (headings[i]!.getBoundingClientRect().top <= top) {
          key = headings[i]!.getAttribute("data-ob-heading-key") || key;
        } else {
          break;
        }
      }
      if (!key || key === lastHeadingKeyRef.current) return;
      if (!bookmarksRef.current.some((bookmark) => bookmark.slug === key)) return;
      lastHeadingKeyRef.current = key;
      setActiveBookmark(key);
    });
  }, [narrow]);

  useEffect(() => {
    if (activeBookmark || !bookmarks[0]) return;
    lastHeadingKeyRef.current = bookmarks[0].slug;
    setActiveBookmark(bookmarks[0].slug);
  }, [activeBookmark, bookmarks]);

  useEffect(() => () => {
    if (headingRafRef.current != null) window.cancelAnimationFrame(headingRafRef.current);
    if (scrollSyncFrameRef.current != null) window.cancelAnimationFrame(scrollSyncFrameRef.current);
    if (scrollSettleTimerRef.current != null) window.clearTimeout(scrollSettleTimerRef.current);
  }, []);

  const jumpToSection = useCallback((b: { title: string; slug: string; line: number }) => {
    lastHeadingKeyRef.current = b.slug;
    setActiveBookmark(b.slug);
    const from = offsetForHeadingKey(sourceRef.current, b.slug);
    if (from != null) editorRef.current?.setSelection(from, from);

    const align = () => {
      const scroller = editorRef.current?.getScroller();
      const preview = previewRef.current;
      if (!scroller || !preview) return;
      const edHeading = scroller.querySelector(`[data-ob-heading-key="${CSS.escape(b.slug)}"]`) as HTMLElement | null;
      const pvHeading = preview.querySelector(`[data-ob-heading-key="${CSS.escape(b.slug)}"]`) as HTMLElement | null;
      activeScrollSourceRef.current = "jump";
      const editorRect = scroller.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const alignTop = Math.max(editorRect.top, previewRect.top);
      const first = bookmarksRef.current[0]?.slug === b.slug;
      const pad = (pane: HTMLElement) => (syncPanesRef.current && !narrow && !first ? pane.clientHeight * HEADING_ALIGN : 0);
      if (pvHeading) {
        const contentTop = pvHeading.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
        const style = window.getComputedStyle(pvHeading);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
        const visibleAnchor = narrow ? preview.clientHeight - lineHeight : alignTop - previewRect.top + pad(preview);
        preview.scrollTop = Math.max(0, contentTop - visibleAnchor);
      }
      if (edHeading) {
        const contentTop = edHeading.getBoundingClientRect().top - editorRect.top + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, contentTop - (narrow ? sourceHeaderInset(scroller) : alignTop - editorRect.top) - pad(scroller));
      }
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 200);
    };
    requestAnimationFrame(() => requestAnimationFrame(align));
  }, [narrow]);

  const jumpToExpectedSection = useCallback((id: string) => {
    const expected = expectedSectionsRef.current;
    const targetIndex = expected.findIndex((section) => section.id === id);
    if (targetIndex < 0) return;
    const headings = listBookmarks(inlineBundleIncludes(sourceRef.current));
    let cursor = 0;
    for (let index = 0; index <= targetIndex; index += 1) {
      const section = expected[index]!;
      const title = section.title.trim().toLocaleLowerCase();
      let hit = headings.findIndex((bookmark, headingIndex) => (
        headingIndex >= cursor
        && bookmark.level === section.level
        && bookmark.title.trim().toLocaleLowerCase() === title
      ));
      if (hit < 0) {
        hit = headings.findIndex((bookmark, headingIndex) => (
          headingIndex >= cursor && bookmark.title.trim().toLocaleLowerCase() === title
        ));
      }
      if (hit < 0) return;
      if (index === targetIndex) {
        jumpToSection(headings[hit]!);
        return;
      }
      cursor = hit + 1;
    }
  }, [jumpToSection]);

  const syncScroll = useCallback((source: "editor" | "preview") => {
    const scroller = editorRef.current?.getScroller();
    const preview = previewRef.current;
    updateActiveHeading(source === "editor" ? scroller ?? null : preview);
    if (layout !== "document" || !syncPanesRef.current) return;
    if (!scroller || !preview) return;
    if (activeScrollSourceRef.current && activeScrollSourceRef.current !== source) return;

    activeScrollSourceRef.current = source;
    if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 120);
    if (scrollSyncFrameRef.current != null) return;
    const alignPanes = (measurementsLeft: number) => {
      scrollSyncFrameRef.current = null;
      const leader = activeScrollSourceRef.current;
      if (leader !== "editor" && leader !== "preview") return;
      const anchors = getScrollAnchors();
      if (!anchors || anchors.length < 2) return;
      const from = leader === "editor" ? "editorTop" : "previewTop";
      const to = leader === "editor" ? "previewTop" : "editorTop";
      const leadingPane = leader === "editor" ? scroller : preview;
      const followingPane = leader === "editor" ? preview : scroller;
      const current = leadingPane.scrollTop;
      let index = 0;
      while (index < anchors.length - 2 && current >= anchors[index + 1]![from]) index++;
      const a0 = anchors[index]!, a1 = anchors[index + 1]!;
      const fraction = Math.max(0, Math.min(1, (current - a0[from]) / (a1[from] - a0[from] || 1)));
      followingPane.scrollTop = a0[to] + fraction * (a1[to] - a0[to]);
      // CodeMirror measures newly revealed wrapped lines after scrolling.
      // Reapply the same leader's position once those heights are available.
      if (measurementsLeft > 0) {
        scrollSyncFrameRef.current = window.requestAnimationFrame(() => alignPanes(measurementsLeft - 1));
      }
    };
    scrollSyncFrameRef.current = window.requestAnimationFrame(() => alignPanes(2));
  }, [getScrollAnchors, layout, updateActiveHeading]);
  const handleEditorScroll = useCallback(() => syncScroll("editor"), [syncScroll]);
  const handlePreviewScroll = useCallback(() => syncScroll("preview"), [syncScroll]);

  const applyHydrated = useCallback((paper: HydratedPaper) => {
    const next = paper.bundle.source;
    setExpectedSections(paper.sections);
    expectedSectionsRef.current = paper.sections;
    sectionHashesRef.current = new Map(paper.sections.map((section) => [section.id, section.hash]));
    bundleHashRef.current = paper.bundle.bundleHash;
    sourceSegmentsRef.current = paper.bundle.segments.map(({ filePath, editable }) => ({ filePath, editable }));
    sourceRef.current = next;
    savedSourceRef.current = next;
    revisionRef.current += 1;
    setSource(next);
    setSavedSource(next);
    setLocalDirty(false);
    setBundleHash(paper.bundle.bundleHash);
    setBundleDiagnostics(paper.bundle.diagnostics);
    setSourceContextState(paper.sourceContext);
    setSaveError(null);
    setTodoRemovalError(null);
    setSaveConflict(false);
    clearRecoveryDraft();
    setCompile((current) => transitionCompileStatus(current, {
      state: "idle",
      message: "Source changed. Compile to refresh the PDF.",
    }));
    resetPreview(next);
  }, [clearRecoveryDraft, resetPreview]);

  const persistOne = useCallback(async (text: string, signal?: AbortSignal) => {
    saveFailureRef.current = null;
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    const baseline = savedSourceRef.current;
    if (text === baseline) {
      setLocalDirty((editorRef.current?.getLiveSource() ?? sourceRef.current) !== baseline);
      if (remoteSavePendingRef.current) void pushRemote("OpenBar: save paper");
      return;
    }
    saveBusyRef.current = true;
    setSaving(true);
    setLocalDirty(true);
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    const result = await saveBrowserPaperSource(project, text, bundleHashRef.current, { signal });
    if (!result.ok) {
      saveFailureRef.current = {
        code: result.code,
        message: result.message,
        ...(result.currentHash ? { currentHash: result.currentHash } : {}),
      };
      setSaveConflict(result.code === "stale_disk_state");
      throw new Error(result.message);
    }
    saveFailureRef.current = null;
    bundleHashRef.current = result.value.bundleHash;
    setBundleHash(result.value.bundleHash);
    savedSourceRef.current = text;
    setSavedSource(text);
    // A newer edit may have arrived while this snapshot was being written.
    // The CodeMirror document is the live source of truth; never feed an
    // older completed snapshot back into it. `setSource` is only needed when
    // the editor is still exactly at the snapshot that just became durable.
    const live = editorRef.current?.getLiveSource();
    setLocalDirty(live !== undefined && live !== text);
    if (live === undefined || live === text) {
      sourceRef.current = text;
      setSource(text);
    } else {
      sourceRef.current = live;
      writeRecoveryDraft();
    }
    setCompile((current) => transitionCompileStatus(current, {
      state: "idle",
      message: "Source changed. Compile to refresh the PDF.",
    }));
    setSaveError(null);
    setSaveConflict(false);
    remoteSavePendingRef.current = true;
    saveBusyRef.current = false;
    setSaving(false);
    if (live === text) {
      try { window.sessionStorage.removeItem(recoveryKey(project)); } catch { /* best-effort */ }
    }
    void pushRemote("OpenBar: save paper");
  }, [project, pushRemote, writeRecoveryDraft]);

  const doSave = useCallback(async (text: string, signal?: AbortSignal) => {
    const requestId = ++saveRequestIdRef.current;
    pendingSaveRef.current = { text, requestId };
    const job = saveQueueRef.current.then(async () => {
      while (pendingSaveRef.current !== null) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        // A caller's abort signal belongs only to its own target. If a newer
        // caller has replaced the pending snapshot, that newer write must not
        // be cancelled when the older caller goes away.
        await persistOne(pending.text, pending.requestId === requestId ? signal : undefined);
      }
    });
    saveQueueRef.current = job.then(() => undefined, () => undefined);
    try {
      await job;
      if (signal?.aborted) return false;
      return true;
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
      const failureCode = errorCode || saveFailureRef.current?.code || "save_failed";
      const failureMessage = error instanceof Error ? error.message : "Network error during save.";
      saveFailureRef.current = {
        code: failureCode,
        message: failureMessage,
        ...(error instanceof Error ? { stack: error.stack } : {}),
        ...(saveFailureRef.current?.currentHash ? { currentHash: saveFailureRef.current.currentHash } : {}),
      };
      saveBusyRef.current = false;
      setSaving(false);
      if (failureCode === "remote_save_failed") {
        setSaveError(null);
        // The source bundle is already durable locally. Keep the operation
        // successful while exposing the actionable Git outcome for retry.
        return true;
      }
      if (failureCode !== "cancelled") setSaveError(failureMessage);
      return false;
    }
  }, [persistOne]);

  const reloadLatest = useCallback(async () => {
    const paper = await getBrowserEditablePaper(project);
    if (!paper) {
      setSaveError("Could not reload the paper.");
      return;
    }
    applyHydrated(paper);
  }, [applyHydrated, project]);

  const liveSource = useCallback(() => editorRef.current?.getLiveSource() ?? sourceRef.current, []);

  const canAutoPull = () => !saving && !saveBusyRef.current && !pendingSaveRef.current
    && !uploading && !saveErrorRef.current && !saveConflictRef.current && !recoveryDraft
    && !reviewingRemoteRef.current && !remoteQueue.isBusy && liveSource() === savedSourceRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]");
  const canAutoPush = () => !saving && !saveBusyRef.current && !pendingSaveRef.current
    && !uploading && !saveErrorRef.current && !saveConflictRef.current && !recoveryDraft
    && !reviewingRemoteRef.current && !applyingRemoteRef.current && !remoteOutOfSyncRef.current
    && !remoteQueue.isBusy && liveSource() === savedSourceRef.current;
  useGitAutoSync({
    project,
    isBusy: () => checkingRemote || remoteQueue.isBusy || saving || uploading || reviewingRemoteRef.current,
    canPull: canAutoPull,
    canPush: canAutoPush,
    push: () => pushRemote("OpenBar: resume paper synchronization"),
    check: () => refreshRemoteStatus(true, false),
    onApplying: (applying) => {
      applyingRemoteRef.current = applying;
      if (applying) remoteOutOfSyncRef.current = true;
      setApplyingRemote(applying);
    },
    onApplied: async () => {
      const paper = await getBrowserEditablePaper(project);
      if (!canAutoPull()) throw new Error("Git updates arrived while this editor changed. Preserve your draft and reload the latest paper.");
      if (!paper) throw new Error("Git updates were pulled. Reload the paper to display the latest source.");
      applyHydrated(paper);
      await refreshRemoteStatus(false, false);
      router.refresh();
    },
    onError: (message) => { setRemoteSaveState("error"); setRemoteSaveError(message); },
  });

  const scheduleSave = useCallback((immediate = false) => {
    if (saveConflictRef.current && !immediate) return;
    const flush = () => {
      burstStartRef.current = null;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const text = liveSource();
      sourceRef.current = text;
      setSource(text);
      writeRecoveryDraft();
      void doSave(text);
    };
    if (immediate) {
      flush();
      return;
    }
    if (burstStartRef.current == null) burstStartRef.current = Date.now();
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const maxWait = Math.max(0, AUTOSAVE_MAX_MS - (Date.now() - burstStartRef.current));
    saveTimerRef.current = window.setTimeout(flush, Math.min(AUTOSAVE_IDLE_MS, maxWait));
  }, [doSave, liveSource, writeRecoveryDraft]);

  const saveNow = useCallback(async (nextSource: string, signal?: AbortSignal) => {
    burstStartRef.current = null;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return doSave(nextSource, signal);
  }, [doSave]);

  const onDocChanges = useCallback((changes: TexDocChange[], length: number) => {
    revisionRef.current += 1;
    setPreviewAnnotate(null);
    const live = editorRef.current?.getLiveSource();
    setLocalDirty(live === undefined || live !== savedSourceRef.current);
    applyPreviewChanges(changes, length);
    scheduleSave();
  }, [applyPreviewChanges, scheduleSave]);

  useEffect(() => {
    resetPreview(initialSource);
  }, [initialSource, resetPreview]);

  useEffect(() => {
    let active = true;
    const refreshCompileStatus = async () => {
      try {
        const status = await getBrowserPaperCompileStatus(project);
        if (active) setCompile((current) => transitionCompileStatus(current, status));
      } catch {
        // The editor remains available when compilation status cannot be read.
      }
    };
    void refreshCompileStatus();
    const timer = window.setInterval(() => { void refreshCompileStatus(); }, PAGE_BUDGET_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [project]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      const live = liveSource();
      writeRecoveryDraft();
      // Client-side route changes unmount this editor without firing
      // beforeunload. Start the same serialized save queue during cleanup so
      // a just-typed snapshot is durable before the user leaves the page.
      if (live !== savedSourceRef.current) {
        sourceRef.current = live;
        void doSave(live);
      }
    };
  }, [doSave, liveSource, writeRecoveryDraft]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
      if (live !== savedSourceRef.current) {
        writeRecoveryDraft();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const handlePageHide = () => writeRecoveryDraft();
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        scheduleSave(true);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("keydown", handleKey);
    };
  }, [scheduleSave, writeRecoveryDraft]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(recoveryKey(project));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<RecoveryDraft>;
      if (typeof parsed.source === "string" && typeof parsed.baseHash === "string" && typeof parsed.savedAt === "string") {
        if (parsed.source !== initialSource) {
          const draft = { source: parsed.source, baseHash: parsed.baseHash, savedAt: parsed.savedAt };
          recoveryDraftRef.current = draft;
          setRecoveryDraft(draft);
        }
        else window.sessionStorage.removeItem(recoveryKey(project));
      }
    } catch {
      // Ignore malformed or unavailable recovery storage.
    }
  }, [initialSource, project]);

  useEffect(() => {
    const onCaptureNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(target.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
      if (live === savedSourceRef.current || navigationPendingRef.current) return;
      event.preventDefault();
      navigationPendingRef.current = true;
      void saveNow(live).then((ok) => {
        if (ok) router.push(`${url.pathname}${url.search}${url.hash}`);
      }).finally(() => { navigationPendingRef.current = false; });
    };
    window.addEventListener("click", onCaptureNavigation, true);
    return () => window.removeEventListener("click", onCaptureNavigation, true);
  }, [router, saveNow]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(prefsKey(project));
      if (raw) {
        const prefs = JSON.parse(raw) as EditorPrefs;
        if (prefs.layout === "document" || prefs.layout === "pdf") {
          setLayout(prefs.layout);
        }
        if (prefs.editorWidth === "compact" || prefs.editorWidth === "wide" || prefs.editorWidth === "full") {
          setEditorWidth(prefs.editorWidth);
        }
        if (typeof prefs.splitLeftPct === "number") {
          setSplitLeftPct(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, prefs.splitLeftPct)));
        }
        if (typeof prefs.splitTopPct === "number" && Number.isFinite(prefs.splitTopPct)) {
          setSplitTopPct(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, prefs.splitTopPct)));
        }
        if (typeof prefs.todoOpen === "boolean") setTodoOpen(prefs.todoOpen);
        if (typeof prefs.todoPanelHeight === "number") {
          setTodoPanelHeight(Math.max(TODO_PANEL_MIN, prefs.todoPanelHeight));
        }
        if (typeof prefs.previewFontScale === "number" && Number.isFinite(prefs.previewFontScale)) {
          setPreviewFontScale(Math.max(10 / 17, Math.min(24 / 17, prefs.previewFontScale)));
        }
        if (typeof prefs.editorFontScale === "number" && Number.isFinite(prefs.editorFontScale)) {
          setEditorFontScale(Math.max(10 / 14, Math.min(24 / 14, prefs.editorFontScale)));
        }
        if (typeof prefs.previewLineHeight === "number" && Number.isFinite(prefs.previewLineHeight)) {
          setPreviewLineHeight(Math.max(1.45, Math.min(1.85, prefs.previewLineHeight)));
        }
        if (prefs.previewFont === "serif" || prefs.previewFont === "sans") setPreviewFont(prefs.previewFont);
        if (typeof prefs.lastSection === "string") lastHeadingKeyRef.current = prefs.lastSection;
      }
    } catch {
      // ignore corrupt prefs
    }
    setPrefsReady(true);
  }, [project]);

  useEffect(() => {
    if (!prefsReady) return;
    const reader = narrow ? splitTopPct : splitLeftPct;
    splitGroupRef.current?.setLayout({ reader, source: 100 - reader });
  }, [prefsReady, narrow]);
  useEffect(() => {
    if (prefsReady) todoPanelRef.current?.resize(todoPanelHeight - 32);
  }, [prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    try { window.localStorage.setItem(prefsKey(project), JSON.stringify({
      layout,
      editorWidth,
      splitLeftPct,
      splitTopPct,
      todoOpen,
      todoPanelHeight,
      previewFontScale,
      editorFontScale,
      previewLineHeight,
      previewFont,
      lastSection: activeBookmark || lastHeadingKeyRef.current,
    })); } catch { /* Appearance remains usable with restricted browser storage. */ }
  }, [activeBookmark, editorFontScale, editorWidth, layout, prefsReady, previewFont, previewFontScale, previewLineHeight, project, splitLeftPct, splitTopPct, todoOpen, todoPanelHeight]);

  const requestCompile = useCallback(async (signal?: AbortSignal) => {
    try {
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
      const saved = await doSave(live, signal);
      if (!saved) {
        if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
        return null;
      }
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      const status = await requestBrowserPaperCompile(project, signal);
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      setCompile((current) => transitionCompileStatus(current, status));
      return status;
    } catch (error) {
      const cancelled = signal?.aborted || (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "cancelled");
      if (cancelled) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      const status: PaperCompileStatus = { state: "error", message: error instanceof Error ? error.message : "Could not compile PDF." };
      setCompile((current) => transitionCompileStatus(current, status));
      return status;
    }
  }, [doSave, project]);

  useEffect(() => {
    if (compile.state !== "running" || compile.observationDelayed) return;
    let cancelled = false;
    let delay = COMPILE_POLL_MS;
    let timer = 0;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      const decision = compilePollDecision(Date.now() - started, delay);
      if (decision.kind === "observation-delayed") {
        setCompile((current) => markCompileObservationDelayed(current, decision.message));
        return;
      }
      try {
        const status = await getBrowserPaperCompileStatus(project);
        if (cancelled) return;
        setCompile((current) => transitionCompileStatus(current, status));
        if (status.state === "running") {
          delay = decision.delayMs;
          timer = window.setTimeout(tick, delay);
        }
      } catch {
        if (cancelled) return;
        setCompile((current) => recordCompileObservationError(current, "Could not check the compile job. Retrying…"));
        const retry = compilePollDecision(Date.now() - started, delay);
        if (retry.kind === "observation-delayed") {
          setCompile((current) => markCompileObservationDelayed(current, retry.message));
          return;
        }
        delay = retry.delayMs;
        timer = window.setTimeout(tick, delay);
      }
    };
    timer = window.setTimeout(tick, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [compile.observationDelayed, compile.state, project]);

  const surround = useCallback((open: string, close: string, placeholder = "") => {
    editorRef.current?.surround(open, close, placeholder);
  }, []);

  const insertBlock = useCallback((block: string) => {
    editorRef.current?.insertAtCursor(block, true);
  }, []);

  const insertInline = useCallback((text: string) => {
    editorRef.current?.insertAtCursor(text, false);
  }, []);

  const insertAtSelection = useCallback((builder: (selected: string) => string, fallback: string) => {
    const sel = editorRef.current?.getSelection();
    const view = editorRef.current?.getView();
    if (view?.state.readOnly) return;
    if (sel && sel.from !== sel.to && view) {
      const selected = view.state.doc.sliceString(sel.from, sel.to);
      const insert = builder(selected);
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
    insertBlock(fallback);
  }, [insertBlock]);

  const composeHumanComment = useCallback(
    (text: string) => composeObcomment({ text, kind: commentKindDraft }),
    [commentKindDraft],
  );

  const addComment = (kind = commentKindDraft) => {
    if (editorRef.current?.getView()?.state.readOnly) return;
    const compose = (text: string) => composeObcomment({ text, kind });
    insertAtSelection(compose, compose("Add a comment for collaborators"));
    setCommentKindDraft(kind);
  };
  const addTodo = () => insertAtSelection((selected) => composeObtodo({ text: selected || "Next actionable experiment or writing item" }), composeObtodo({ text: "Next actionable experiment or writing item" }));

  const currentTodo = useCallback((todo: EditorTodo, current: string) => {
    return findEditorTodo(current, todo);
  }, []);

  const jumpToTodo = useCallback((todo: EditorTodo) => {
    const current = editorRef.current?.getLiveSource() ?? sourceRef.current;
    const live = currentTodo(todo, current);
    if (live) editorRef.current?.setSelection(live.from, live.to);
  }, [currentTodo]);

  const jumpToSourceLine = useCallback((file: string, line: number) => {
    const from = offsetForSourceFileLine(liveSource(), file, line);
    if (from == null) return;
    editorRef.current?.setSelection(from, from);
  }, [liveSource]);

  const jumpToPdf = useCallback(async () => {
    const request = ++pdfNavigationRequest.current;
    const current = liveSource();
    const selection = editorRef.current?.getVirtualSelection();
    const part = splitBundleSource(current).find((item) => selection && selection.from >= item.bodyFrom && selection.from <= item.bodyTo);
    const artifact = compileRef.current.lastSuccessfulArtifact?.artifactId || compileRef.current.artifactId;
    if (!selection || !part) { setAgentNotice("Select a position in the source to locate it in the PDF."); return; }
    if (!artifact) { setAgentNotice("Compile the paper to locate source positions in its PDF."); return; }
    const prefix = current.slice(part.bodyFrom, selection.from);
    const line = prefix.split("\n").length;
    const column = prefix.length - prefix.lastIndexOf("\n") - 1;
    try {
      const result = await synctexViewAction(project, part.filePath, line, column, artifact);
      if (request !== pdfNavigationRequest.current) return;
      if (!result.ok) { setAgentNotice(result.message); return; }
      setPdfSourceTarget(result.view);
      setLayout("pdf");
    } catch (error) {
      if (request === pdfNavigationRequest.current) setAgentNotice(error instanceof Error ? error.message : "Could not locate this source in the PDF.");
    }
  }, [liveSource, project]);

  const applyPaperHash = useCallback((rawHash?: string) => {
    const encodedHash = (rawHash ?? window.location.hash).replace(/^#/, "").trim();
    const hash = decodeURIComponent(encodedHash).trim();
    if (!hash) return false;
    const durable = decodePaperSectionFragment(encodedHash);
    if (durable) {
      const resolved = resolvePaperSectionRef(durable, sourceContextState.sections);
      if (resolved.status !== "resolved") return false;
      jumpToExpectedSection(resolved.section.id);
      return true;
    }
    if (expectedSectionsRef.current.some((section) => section.id === hash)) {
      jumpToExpectedSection(hash);
      return true;
    }
    const labeled = bundleSections(sourceRef.current).filter(section => section.label === hash);
    if (labeled.length === 1) {
      editorRef.current?.setSelection(labeled[0]!.from, labeled[0]!.from);
      return true;
    }
    const todo = collectEditorTodos(sourceRef.current).find((item) => item.id === hash);
    if (todo) {
      jumpToTodo(todo);
      return true;
    }
    const comment = collectEditorComments(sourceRef.current).find((item) => item.id === hash);
    if (comment) {
      editorRef.current?.setSelection(comment.from, comment.to);
      return true;
    }
    const bookmark = bookmarksRef.current.find((item) => item.slug === hash);
    if (bookmark) {
      jumpToSection(bookmark);
      return true;
    }
    return false;
  }, [jumpToExpectedSection, jumpToSection, jumpToTodo, sourceContextState.sections]);

  useEffect(() => {
    const onHash = () => { applyPaperHash(); };
    const timer = window.setTimeout(() => {
      if (applyPaperHash()) return;
      const bookmark = bookmarksRef.current.find((item) => item.slug === lastHeadingKeyRef.current);
      if (bookmark) jumpToSection(bookmark);
    }, 0);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", onHash);
    };
  }, [applyPaperHash, jumpToSection]);

  const removeTodoEverywhere = useCallback(async (todoId: string, signal?: AbortSignal) => {
    if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    let current = liveSource();
    let live = collectEditorTodos(current).find((item) => item.id === todoId);
    if (!live) {
      throw Object.assign(new Error(`stale_selection: TODO "${todoId}" is not in the live source.`), { code: "stale_selection" });
    }
    if (current !== savedSourceRef.current) {
      const saved = await saveNow(current, signal);
      if (!saved) {
        throw Object.assign(new Error(saveFailureRef.current?.message || "Could not save the live paper."), {
          code: saveFailureRef.current?.code || "save_failed",
        });
      }
      current = liveSource();
      live = collectEditorTodos(current).find((item) => item.id === todoId);
      if (!live) throw Object.assign(new Error(`stale_selection: TODO "${todoId}" moved during save.`), { code: "stale_selection" });
    }
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    const operationSource = current;
    const operationRevision = revisionRef.current;
    const operationTodo = live;
    const result = await removePaperTodoAction(project, todoId, bundleHashRef.current);
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    const removedBundleHash = result.value.bundleHash;
    bundleHashRef.current = removedBundleHash;
    setBundleHash(removedBundleHash);

    // The server has removed the TODO from operationSource. Apply that same
    // deletion to the current editor buffer before Git sync can reload it.
    // This keeps edits typed during the server request attached to the live
    // source and gives the ordinary save queue the new bundle hash.
    const sourceAfterRemoval = removeSourceRange(operationSource, operationTodo.from, operationTodo.to);
    const liveBeforeRemoval = liveSource();
    const liveTodo = collectEditorTodos(liveBeforeRemoval).find((item) => item.id === todoId);
    let liveAfterRemoval = liveBeforeRemoval;
    let editorRemovalApplied = false;
    if (liveTodo) {
      const applied = editorRef.current?.applyVirtualChange(liveTodo.from, liveTodo.to, "");
      liveAfterRemoval = requireAppliedRemovalSource(
        applied,
        editorRef.current?.getLiveSource(),
        todoId,
        (source, id) => collectEditorTodos(source).some((item) => item.id === id),
      );
      editorRemovalApplied = true;
    }
    sourceRef.current = liveAfterRemoval;
    setSource(liveAfterRemoval);
    if (!editorRemovalApplied) resetPreview(liveAfterRemoval);
    savedSourceRef.current = sourceAfterRemoval;
    setSavedSource(sourceAfterRemoval);
    setLocalDirty(liveAfterRemoval !== sourceAfterRemoval);
    const editsDuringRemoval = hasLiveEditorChanged(
      { source: operationSource, revision: operationRevision },
      { source: liveBeforeRemoval, revision: revisionRef.current },
    ) || liveAfterRemoval !== sourceAfterRemoval;
    const removalSnapshot = {
      source: liveAfterRemoval,
      revision: revisionRef.current,
    };
    remoteSavePendingRef.current = true;
    await pushRemote("OpenBar: remove paper TODO");

    // Fetching the latest paper is safe only while the live editor still
    // matches the post-removal snapshot. New typing takes the normal save
    // path, preserving the editor buffer instead of applying stale server
    // state over it.
    const liveAfterRemote = liveSource();
    if (editsDuringRemoval || hasLiveEditorChanged(removalSnapshot, { source: liveAfterRemote, revision: revisionRef.current })) {
      const saved = await saveNow(liveAfterRemote, signal);
      if (!saved) {
        throw Object.assign(new Error(saveFailureRef.current?.message || "Could not save edits made during TODO removal."), {
          code: saveFailureRef.current?.code || "save_failed",
        });
      }
      return;
    }

    const latestPaper = await getBrowserEditablePaper(project);
    if (!latestPaper) {
      setSaveError("Could not reload the paper.");
      return;
    }
    const liveBeforeReload = liveSource();
    if (editsDuringRemoval || hasLiveEditorChanged(removalSnapshot, { source: liveBeforeReload, revision: revisionRef.current })) {
      const saved = await saveNow(liveBeforeReload, signal);
      if (!saved) {
        throw Object.assign(new Error(saveFailureRef.current?.message || "Could not save edits made during TODO removal."), {
          code: saveFailureRef.current?.code || "save_failed",
        });
      }
      return;
    }
    applyHydrated(latestPaper);
  }, [applyHydrated, project, pushRemote, resetPreview, saveNow]);

  const resolveTodo = useCallback(async (todo: EditorTodo) => {
    setTodoRemovalError(null);
    let retry: "remove" | "save" = "remove";
    try {
      if (todo.id) await removeTodoEverywhere(todo.id);
      else {
        if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
        const current = liveSource();
        const live = currentTodo(todo, current);
        if (!live) throw Object.assign(new Error("The selected TODO changed. Select it again in the current list."), { code: "stale_selection" });
        const applied = editorRef.current?.applyVirtualChange(live.from, live.to, "");
        if (!applied) throw Object.assign(new Error("The selected TODO needs to be revealed in the source before removal."), { code: "stale_selection" });
        retry = "save";
        const saved = await saveNow(liveSource());
        if (!saved) throw Object.assign(new Error(saveFailureRef.current?.message || "Saving the TODO removal needs attention."), { code: saveFailureRef.current?.code || "save_failed" });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Removing the paper TODO needs attention.";
      if (saveFailureRef.current?.message === message) retry = "save";
      setTodoRemovalError({
        todo,
        message,
        retry,
        report: {
          operation: "remove_paper_todo",
          retry,
          todo: { id: todo.id ?? null, section: todo.section, from: todo.from, to: todo.to },
          error: error instanceof Error ? { name: error.name, message, code: "code" in error ? error.code : undefined, stack: error.stack } : { message },
        },
      });
      return false;
    }
  }, [currentTodo, removeTodoEverywhere, saveNow]);

  const patchTodo = useCallback(async (todo: EditorTodo, patch: TodoAttrPatch): Promise<boolean> => {
    const current = editorRef.current?.getLiveSource() ?? sourceRef.current;
    if (todo.kind !== "obtodo") return false;
    const live = currentTodo(todo, current);
    if (!live) {
      setSaveError(`TODO "${todo.id || todo.text.slice(0, 40)}" is no longer in the live source.`);
      return false;
    }
    const nextMacro = rewriteObtodo(current.slice(live.from, live.to), patch);
    const applied = editorRef.current?.applyVirtualChange(live.from, live.to, nextMacro);
    const next = editorRef.current?.getLiveSource() ?? current;
    if (!applied || next === current) {
      setSaveError("The TODO could not be changed in the live editor.");
      return false;
    }
    const saved = await saveNow(next);
    if (!saved) {
      const failure = saveFailureRef.current;
      setSaveError(failure?.message || "Could not save the TODO.");
      return false;
    }
    return true;
  }, [currentTodo, saveNow]);

  const applyAndSave = useCallback(async (from: number, to: number, insert: string, signal?: AbortSignal) => {
    if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    const before = editorRef.current?.getLiveSource() ?? sourceRef.current;
    if (from < 0 || to < from || to > before.length) {
      throw Object.assign(new Error("stale_selection: source range is not in the live buffer."), {
        code: "stale_selection",
      });
    }
    const applied = editorRef.current?.applyVirtualChange(from, to, insert);
    if (!applied) {
      throw Object.assign(new Error("stale_selection: source range is not attached to the live editor."), {
        code: "stale_selection",
      });
    }
    const next = editorRef.current?.getLiveSource() ?? before;
    if (next === before) return;
    const section = expectedSectionsRef.current.find((item) => {
      const span = sectionBodyRange(before, expectedSectionsRef.current, item.id);
      return Boolean(span && from >= span.from && from <= span.to);
    });
    setAgentNotice(`Agent updated ${section?.title ? `§ ${section.title}` : "the paper"}`);
    window.setTimeout(() => setAgentNotice(null), 4000);
    const saved = await saveNow(next, signal);
    if (saved) return;
    const failure = saveFailureRef.current;
    throw Object.assign(new Error(failure?.message || "Could not save the live paper."), {
      code: failure?.code || "save_failed",
      ...(failure?.currentHash ? { currentHash: failure.currentHash } : {}),
    });
  }, [saveNow]);

  usePaperWebMcp({
    sharedActions: sharedWebMcpActions,
    getSnapshot: () => liveSnapshotFromSource({
      project,
      title,
      source: liveSource(),
      revision: revisionRef.current,
      dirty: liveSource() !== savedSourceRef.current,
      persistedHash: bundleHashRef.current,
      pendingSave: saving || liveSource() !== savedSourceRef.current,
      remoteSync: remoteSyncRef.current,
      sourceSegments: sourceSegmentsRef.current,
      sourceContext: sourceContextState,
      activeHeadingKey: activeBookmarkRef.current || lastHeadingKeyRef.current,
      compileState: {
        state: compileRef.current.state,
        compiler: compileRef.current.compiler,
        jobId: compileRef.current.jobId,
        pdfAvailable: compileRef.current.pdfAvailable,
        sourceHash: compileRef.current.sourceHash,
        buildInputHash: compileRef.current.buildInputHash,
        artifactId: compileRef.current.artifactId,
        artifactSourceHash: compileRef.current.artifactSourceHash,
        artifactBuildInputHash: compileRef.current.artifactBuildInputHash,
        ...(compileRef.current.lastSuccessfulArtifact
          ? { lastSuccessfulArtifact: compileRef.current.lastSuccessfulArtifact }
          : {}),
        observationDelayed: compileRef.current.observationDelayed,
        stale: compileRef.current.stale,
        message: compileRef.current.message,
        diagnostics: compileRef.current.diagnostics,
        parsedDiagnostics: compileRef.current.parsedDiagnostics,
        rawLog: compileRef.current.rawLog,
        completedAt: compileRef.current.completedAt,
      },
      bibliographyKeys: (bibliographyRef.current || []).map((entry) => entry.key),
      bibliographyRaw,
      expected: expectedSectionsRef.current.map((section) => ({
        ...section,
        hash: sectionHashesRef.current.get(section.id) || section.hash,
      })),
    }),
    navigateSection: (sectionId) => {
      const snapshot = liveSnapshotFromSource({
        project,
        title,
        source: liveSource(),
        revision: revisionRef.current,
        dirty: false,
        expected: expectedSectionsRef.current,
        bibliographyKeys: [],
      });
      const section = snapshot.sections.find((item) => item.id === sectionId);
      const bookmark = bookmarksRef.current.find((item) => item.slug === section?.headingKey)
        || bookmarksRef.current.find((item) => item.title.toLowerCase() === (section?.title || "").toLowerCase());
      if (bookmark) jumpToSection(bookmark);
    },
    setReaderMode: (mode) => {
      setLayout(mode);
    },
    addTodoAtSection: async (sectionId, text, todoTitle, todoId, signal) => {
      const before = liveSource();
      const existing = todoId ? collectEditorTodos(before).find((todo) => todo.id === todoId) : undefined;
      if (existing) {
        return {
          todoId: todoId!,
          sectionId: existing.section,
          filePath: "live-editor",
          from: existing.from,
          to: existing.to,
          before: before.slice(Math.max(0, existing.from - 320), existing.from),
          after: before.slice(existing.to, Math.min(before.length, existing.to + 320)),
          proposedText: before.slice(existing.from, existing.to),
        };
      }
      const preview = previewTodoAtSection(before, sectionId, text, todoTitle, todoId);
      if (!preview.sectionFound || preview.error) {
        throw Object.assign(new Error(preview.error || `Unknown paper section "${sectionId}".`), {
          code: preview.sectionFound ? "invalid_tex" : "unknown_section",
        });
      }
      const proposedText = preview.nextSource.slice(preview.from, preview.to);
      const nextChar = preview.nextSource[preview.to] || "";
      await applyAndSave(preview.from, preview.from, `${proposedText}${nextChar === "\n" ? "" : "\n"}`, signal);
      return {
        todoId: preview.id,
        // The live paper operation always receives a concrete section id.
        // Keep the host contract concrete while the shared placement helper
        // also supports neutral root placement for card conversion.
        sectionId: preview.sectionId || sectionId,
        filePath: preview.filePath,
        from: preview.from,
        to: preview.to,
        before: preview.before,
        after: preview.after,
        proposedText,
      };
    },
    relocateTodo: async (todoId, sectionId, signal) => {
      if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
      const before = liveSource();
      const moved = relocateTodoInBundle(before, todoId, sectionId);
      if (!moved.todoFound || moved.error || !moved.targetFound) {
        throw Object.assign(new Error(moved.error || `Could not relocate TODO "${todoId}".`), {
          code: !moved.todoFound ? "unknown_todo" : !moved.targetFound ? "unknown_section" : "invalid_tex",
        });
      }
      sourceRef.current = moved.source;
      revisionRef.current += 1;
      setSource(moved.source);
      resetPreview(moved.source);
      const saved = await saveNow(moved.source, signal);
      if (!saved) {
        const failure = saveFailureRef.current;
        throw Object.assign(new Error(failure?.message || "Could not save the relocated TODO."), {
          code: failure?.code || "save_failed",
          ...(failure?.currentHash ? { currentHash: failure.currentHash } : {}),
        });
      }
      return {
        todoId: moved.id,
        sectionId,
        filePath: moved.filePath,
        from: moved.from,
        to: moved.to,
        before: moved.before,
        after: moved.after,
        proposedText: moved.source.slice(moved.from, moved.to),
      };
    },
    replaceSection: async (sectionId, tex, signal) => {
      const source = liveSource();
      const span = sectionBodyRange(source, expectedSectionsRef.current, sectionId);
      if (!span) {
        throw Object.assign(new Error(`stale_selection: section "${sectionId}" is not in the live source.`), {
          code: "stale_selection",
        });
      }
      const insert = sectionReplacementBody(tex);
      await applyAndSave(span.from, span.to, insert, signal);
    },
    removeTodo: async (todoId, signal) => {
      await removeTodoEverywhere(todoId, signal);
    },
    replaceRange: (from, to, text, signal) => applyAndSave(from, to, text, signal),
    compile: async (signal) => {
      const status = await requestCompile(signal);
      if (!status) {
        throw new Error(saveErrorRef.current || "Save failed before compile.");
      }
      if (status.state === "error") {
        throw Object.assign(new Error(status.message || "Compilation failed."), {
          code: "compile_failed",
          diagnostics: status.diagnostics || [],
        });
      }
      return { status: status.state, jobId: status.jobId, sourceHash: status.sourceHash };
    },
    lint: () => lintLivePaper(liveSource()),
    navigate: (href) => {
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname) {
          applyPaperHash(url.hash);
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
          return;
        }
      } catch {
        // Fall through to a full navigation when the href is not a same-origin URL.
      }
      router.push(href);
    },
    current: () => ({
      kind: "paper" as const,
      href: `/p/${project}/paper`,
      sectionId: expectedSectionsRef.current.find((section) => {
        const bookmark = bookmarksRef.current.find((item) => item.slug === (activeBookmarkRef.current || lastHeadingKeyRef.current));
        return bookmark && bookmark.title.toLowerCase() === section.title.toLowerCase();
      })?.id,
    }),
  });

  const onUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (remoteOutOfSyncRef.current) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const data = new FormData();
      data.append("file", file);
      const figure = await uploadPaperFigureAction(project, data);
      insertBlock(figure.tex);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload figure.");
    } finally {
      setUploading(false);
    }
  }, [insertBlock, project]);

  const citeEntries = useMemo(() => {
    const needle = citeQuery.trim().toLowerCase();
    const entries = bibliography || [];
    if (!needle) return entries;
    return entries.filter((entry) => {
      const title = entry.fields.title || "";
      return entry.key.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
    });
  }, [bibliography, citeQuery]);
  const isSaved = !localDirty && source === savedSource && !saving;
  useEffect(() => {
    if (source !== savedSource && remoteSaveState === "saved") setRemoteSaveState("local");
  }, [remoteSaveState, savedSource, source]);
  const sourceRepairSections = useMemo(
    () => sourceContextState.sections.filter((section) =>
      Boolean(section.diagnostic?.repair) || section.diagnostics.some((item) => item.severity === "error"),
    ),
    [sourceContextState.sections],
  );
  const pdfCurrent = isSaved && compile.state === "success" && compile.stale !== true;
  const pdfVisible = layout === "pdf";
  const widthClass = editorWidth === "compact" ? paperStyles.widthCompact : editorWidth === "wide" ? paperStyles.widthWide : paperStyles.widthFull;
  const previewStyle = {
    "--paper-preview-font-scale": previewFontScale,
    "--paper-preview-line-height": previewLineHeight,
    "--font-serif": previewFont === "sans" ? "var(--font-sans)" : "var(--font-paper)",
  } as CSSProperties;
  const editorStyle = {
    "--paper-editor-font-scale": editorFontScale,
  } as CSSProperties;
  const readingFrameStyle = {
    "--paper-controls-space": controlsCollapsed ? "0px" : `${controlsHeight + 12}px`,
    "--paper-format-height": `${formatHeight}px`,
  } as CSSProperties;

  return (
    <div className={cn("relative flex h-full w-full flex-col gap-2", widthClass)}>
      {agentNotice && (
        <div className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1 text-[11px] text-muted">
          {agentNotice}
        </div>
      )}
      {recoveryDraft && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs" role="status">
          <p className="min-w-0 text-ink">
            A browser recovery draft from {new Date(recoveryDraft.savedAt).toLocaleString()} is available.
            {recoveryDraft.baseHash !== bundleHash && <span className="text-warn"> It was based on an older source revision.</span>}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="p-button p-button-primary btn-primary px-2 py-0.5 text-[11px]"
              onClick={() => {
                const current = liveSource();
                const draft = recoveryDraft;
                flushSync(() => setRecoveryDraft(null));
                if (editorRef.current?.applyVirtualChange(0, current.length, draft.source)) clearRecoveryDraft();
                else { recoveryDraftRef.current = draft; setRecoveryDraft(draft); }
              }}
            >
              Restore draft
            </button>
            <button type="button" className="p-button p-button-borderless btn-ghost px-2 py-0.5 text-[11px]" onClick={clearRecoveryDraft}>Keep saved source</button>
          </div>
        </div>
      )}
      {(saveConflict || saveError || todoRemovalError) && <EditorNotice project={project} title={saveConflict ? "Saved file conflict" : todoRemovalError ? todoRemovalError.retry === "save" ? "Saving TODO removal needs attention" : "TODO removal needs attention" : "Saving needs attention"} label={saveConflict ? "Editing paused, saved file changed" : todoRemovalError?.retry === "remove" ? "TODO removal needs attention" : "Save needs attention"} message={todoRemovalError?.message || saveError || "The manuscript changed on disk. Your unsaved text remains in the editor."} paused={saveConflict}
        report={JSON.stringify({
          operation: todoRemovalError ? "remove_paper_todo" : "save_paper_source",
          bundleHash,
          revision: revisionRef.current,
          sourceLength: liveSource().length,
          savedSourceLength: savedSourceRef.current.length,
          dirty: liveSource() !== savedSourceRef.current,
          saving,
          saveConflict,
          remoteOutOfSync,
          applyingRemote,
          saveFailure: saveFailureRef.current,
          operationFailure: todoRemovalError?.report,
        }, null, 2)}>
        <button type="button" className="p-button p-button-default btn-outline" onClick={() => {
          if (saveConflict) void reloadLatest();
          else if (todoRemovalError?.retry === "remove") void resolveTodo(todoRemovalError.todo);
          else void doSave(liveSource()).then(saved => { if (saved) setTodoRemovalError(null); });
        }}>{saveConflict ? "Reload latest (discards local edits)" : todoRemovalError?.retry === "remove" ? "Retry removal" : "Retry save"}</button>
        {todoRemovalError && <button type="button" className="p-button p-button-borderless btn-ghost" onClick={() => setTodoRemovalError(null)}>Dismiss</button>}
      </EditorNotice>}
      {!saveError && !todoRemovalError && remoteSaveError && <OverleafSyncNotice project={project} message={remoteSaveError} editingPaused={remoteOutOfSync}
        disabled={saving || uploading || saveConflict || applyingRemote} checking={checkingRemote || remoteSaveState === "saving"}
        beforeReview={async () => {
          reviewingRemoteRef.current = true;
          await saveQueueRef.current;
          return doSave(liveSource());
        }}
        onApplied={async () => { await reloadLatest(); await refreshRemoteStatus(false); router.refresh(); }}
        onClosed={() => { reviewingRemoteRef.current = false; void refreshRemoteStatus(false); }}
        onCheck={async () => { await refreshRemoteStatus(); }}
        onPush={() => { void (async () => { if (await doSave(liveSource())) await pushRemote("OpenBar: save paper"); })(); }}
      />}
      {bundleDiagnostics.length > 0 && (
        <div className="shrink-0 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink">
          Include graph: {bundleDiagnostics.map((item) => item.message).join(", ")}
        </div>
      )}
      {workerError && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink" role="status">
          <span>{workerError}</span>
          <button type="button" className="p-button p-button-default btn-outline px-2 py-0.5 text-[11px]" onClick={() => resetPreview(liveSource())}>Retry preview</button>
        </div>
      )}
      {sourceRepairSections.length > 0 && (
        <details
          className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs"
          open={sourceRepairSections.some((section) => section.diagnostic?.severity === "error")}
        >
          <summary className="cursor-pointer font-medium text-ink">
            Source issues ({sourceRepairSections.length})
          </summary>
          <div className="mt-2 grid gap-1.5">
            {sourceRepairSections.map((section) => {
                  const diagnostic = section.diagnostic;
                  const messages = section.diagnostics.length ? section.diagnostics.map((item) => item.message).join(", ") : section.excerpt;
                  return (
                    <div key={`${section.file}:${section.id}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line/70 bg-surface-2/40 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", diagnostic ? "bg-danger" : "bg-ok")} />
                          {section.title} <span className="font-normal text-muted">({section.file})</span>
                        </p>
                        <p className="mt-0.5 text-muted">{messages}</p>
                      </div>
                    </div>
                  );
            })}
          </div>
        </details>
      )}
      {percentFixes.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink">
          <p>{percentFixes.length} prose percentage{percentFixes.length === 1 ? "" : "s"} should use \\%.</p>
          <button
            type="button"
            className="p-button p-button-default btn-outline px-2 py-0.5 text-[11px]"
            onClick={() => {
              let next = liveSource();
              for (const fix of lintProsePercentages(next).reverse()) next = applyTexLintFix(next, fix);
              const current = liveSource();
              editorRef.current?.applyVirtualChange(0, current.length, next);
            }}
          >
            Fix percentages
          </button>
        </div>
      )}

      <div className={paperStyles.readingFrame} style={readingFrameStyle}>
      <div ref={controlsDockRef} className={paperStyles.toolbarDock} data-collapsed={controlsCollapsed}>
      <div id="paper-reading-controls" hidden={controlsCollapsed} className={cn("p-glass", paperStyles.toolbar)}>
        <div className="flex h-9 min-w-0 items-center overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [grid-area:switch]">
          <ToolbarSeg active={layout === "document"} onClick={() => setLayout("document")}>
            <Eye size={12} /> Document
          </ToolbarSeg>
          <ToolbarSeg
            active={layout === "pdf"}
            onClick={() => {
              setLayout("pdf");
                      if (compile.state === "idle") void requestCompile();
            }}
          >
            <FileText size={12} /> PDF
          </ToolbarSeg>
        </div>

        <div className="flex min-w-0 items-center gap-3 overflow-hidden [grid-area:title]">
          <PaperMetrics wordCount={wordCount} pageBudget={compile.pageBudget} compiling={compile.state === "running"} stale={compile.stale} compileError={compile.state === "error" ? compile.message : undefined} onMeasure={() => { void requestCompile(); }} />

        </div>

        <div
          className={`flex h-8 min-w-0 items-center overflow-hidden ${paperStyles.saveStatus}`}
        >
          <SaveSyncStatus saved={isSaved} saving={saving || uploading} conflict={saveConflict}
            remote={remoteSaveState === "saved" ? "synced" : remoteSaveState === "local" ? "pending" : remoteSaveState === "saving" ? "syncing" : remoteSaveState === "error" ? "failed" : remoteSaveState}
            error={saveError || remoteSaveError} compact
            onRetry={() => { void pushRemote("OpenBar: retry saved project sync"); }} />
        </div>

        <div className={paperStyles.toolbarActions}>
          <FastTooltip label={projectHeaderHidden ? "Show project header" : "Hide project header"}>
            <button type="button" className="p-button p-button-borderless btn-ghost px-2 text-xs" aria-label={projectHeaderHidden ? "Show project header" : "Hide project header"} aria-controls="paper-project-header" aria-expanded={!projectHeaderHidden} onClick={() => setReadingMode(!projectHeaderHidden)}>
              <PanelTop size={13} aria-hidden="true" />
            </button>
          </FastTooltip>

          <PaperAppearance
            readerFontScale={previewFontScale}
            editorFontScale={editorFontScale}
            lineHeight={previewLineHeight}
            font={previewFont}
            width={editorWidth}
            onReaderFontScaleChange={setPreviewFontScale}
            onEditorFontScaleChange={setEditorFontScale}
            onLineHeightChange={setPreviewLineHeight}
            onFontChange={setPreviewFont}
            onWidthChange={setEditorWidth}
            onReset={() => {
              setPreviewFontScale(DEFAULT_PREVIEW_FONT_SCALE);
              setEditorFontScale(DEFAULT_EDITOR_FONT_SCALE);
              setPreviewLineHeight(DEFAULT_PREVIEW_LINE_HEIGHT);
              setPreviewFont(DEFAULT_PREVIEW_FONT);
              setEditorWidth("wide");
            }}
          />

          <button
            type="button"
            onClick={() => setTodoOpen((open) => !open)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] transition",
              todoOpen ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-surface-2/70 text-muted hover:border-accent/40 hover:text-ink",
            )}
            title={todoOpen ? "Hide Open items" : "Show Open items"}
            aria-expanded={todoOpen}
          >
            <ListChecks size={11} />
            <span className="font-medium">Todos</span>
            <span className="font-medium">{todos.filter((todo) => !todo.completed).length}</span>
          </button>

          {compile.state === "error" && (
            <button
              type="button"
              onClick={() => {
                const first = parseTexFileLines(compile.diagnostics || [])[0];
                if (first) jumpToSourceLine(first.file, first.line);
                else setLayout("pdf");
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 text-[11px] font-medium text-danger"
              title={compile.diagnostics?.[0] || compile.message || "Compile failed"}
            >
              Compile failed
            </button>
          )}

          {compile.state === "running" && compile.observationDelayed && (
            <button
              type="button"
              onClick={() => setCompile((current) => resumeCompilePolling(current))}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-warn/40 bg-warn/10 px-1.5 text-[11px] font-medium text-warn"
              title={compile.message || "Resume polling for the running compile job"}
            >
              Resume polling
            </button>
          )}

          {compile.pdfAvailable && (compile.stale || (pdfVisible && !pdfCurrent)) && (
            <span
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-warn/40 bg-warn/10 px-1.5 text-[11px] font-medium text-warn"
              title="The PDF was built from an older manuscript source revision. Recompile to refresh it."
            >
              PDF stale
            </span>
          )}

          <button
            type="button"
            onClick={() => { void requestCompile(); }}
            disabled={compile.state === "running"}
            className="p-button p-button-default btn-outline inline-flex h-7 shrink-0 items-center gap-1 px-2 text-[11px]"
            title="Recompile PDF"
          >
            {compile.state === "running" ? <LoaderCircle size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Recompile
          </button>

        </div>
      </div>
      <button
        type="button"
        className={cn(paperStyles.toolbarToggle, controlsCollapsed && "p-glass")}
        aria-controls="paper-reading-controls"
        aria-expanded={!controlsCollapsed}
        aria-label={controlsCollapsed ? "Show paper controls" : "Hide paper controls"}
        title={controlsCollapsed ? "Show paper controls" : "Hide paper controls"}
        onClick={() => { const next = !controlsCollapsed; readingMotionRef.current.distance = 0; setControlsCollapsed(next); setReadingMode(next); }}
      >
        {controlsCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      </div>

        <Group
          groupRef={splitGroupRef}
          orientation={narrow ? "vertical" : "horizontal"}
          resizeTargetMinimumSize={{ coarse: 28, fine: 10 }}
          defaultLayout={{ reader: narrow ? splitTopPct : splitLeftPct, source: 100 - (narrow ? splitTopPct : splitLeftPct) }}
          onLayoutChanged={(next, meta) => { if (meta.isUserInteraction) (narrow ? setSplitTopPct : setSplitLeftPct)(next.reader!); }}
          className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-transparent bg-surface shadow-card"
        >
          <Panel id="reader" minSize={`${SPLIT_MIN}%`} maxSize={`${SPLIT_MAX}%`} className="relative min-h-0 min-w-0 overflow-hidden bg-surface"
            onWheelCapture={(event) => { if (layout === "pdf") observeReadingMotion(event.deltaY); }}
            onTouchStartCapture={(event) => { if (layout === "pdf") startReadingTouch(event.touches); }}
            onTouchMoveCapture={(event) => { if (layout === "pdf") moveReadingTouch(event.touches); }}
            onKeyDownCapture={(event) => { if (layout === "pdf") observeReadingKey(event.key); }}>
            {layout === "document" && (
              <div className={paperStyles.documentLayout}>
              <PaperOutlineRail bookmarks={bookmarks} activeSlug={activeBookmark} onJump={jumpToSection} previewRef={previewRef} />
              <div
                ref={previewRef}
                data-ob-scroll="paper-preview"
                onWheelCapture={(event) => { claimScrollSource("preview"); observeReadingMotion(event.deltaY); }}
                onTouchStartCapture={(event) => { claimScrollSource("preview"); startReadingTouch(event.touches); }}
                onTouchMoveCapture={(event) => moveReadingTouch(event.touches)}
                onPointerDownCapture={() => claimScrollSource("preview")}
                onKeyDownCapture={(event) => { claimScrollSource("preview"); observeReadingKey(event.key); }}
                onScroll={handlePreviewScroll}
                onClick={(event) => {
                  if (window.getSelection()?.toString()) return;
                  const target = event.target as HTMLElement;
                  if (target.closest("a, button, input, textarea, select, [data-ob-annotation]")) return;
                  const heading = target.closest(".ob-pv-heading");
                  if (heading && previewRef.current?.contains(heading)) {
                    const key = heading.getAttribute("data-ob-heading-key");
                    const bookmark = bookmarksRef.current.find((item) => item.slug === key);
                    if (bookmark) jumpToSection(bookmark);
                    return;
                  }
                  const paragraph = target.closest("p");
                  if (!paragraph || !previewRef.current?.contains(paragraph) || !paragraph.textContent) return;
                  const block = paragraph.closest<HTMLElement>("[data-preview-from]");
                  const blockFrom = block ? Number(block.dataset.previewFrom) : NaN;
                  const blockTo = block ? Number(block.dataset.previewTo) : NaN;
                  const range = Number.isFinite(blockFrom) && Number.isFinite(blockTo)
                    ? { from: blockFrom, to: blockTo }
                    : undefined;
                  const located = locatePreviewSnippet(liveSource(), paragraph.textContent.slice(0, 160), range?.from || 0, range);
                  if (located) editorRef.current?.setSelection(located.from, located.from);
                }}
                onMouseUp={() => {
                  const pane = previewRef.current;
                  const sel = window.getSelection();
                  if (!pane || !sel || sel.isCollapsed || !sel.rangeCount) {
                    setPreviewAnnotate(null);
                    return;
                  }
                  if (!pane.contains(sel.anchorNode)) return;
                  const snippet = sel.toString();
                  const current = liveSource();
                  const hintBookmark = listBookmarks(current).find((item) => item.slug === activeBookmark);
                  const hint = hintBookmark ? offsetForBookmarkLine(current, hintBookmark.line) : 0;
                  const blockHost = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
                  const block = blockHost?.closest<HTMLElement>("[data-preview-from]");
                  const blockFrom = block ? Number(block.dataset.previewFrom) : NaN;
                  const blockTo = block ? Number(block.dataset.previewTo) : NaN;
                  const range = Number.isFinite(blockFrom) && Number.isFinite(blockTo)
                    ? { from: blockFrom, to: blockTo }
                    : undefined;
                  const located = locatePreviewSnippet(current, snippet, hint, range);
                  if (!located) {
                    setPreviewAnnotate(null);
                    return;
                  }
                  const rect = sel.getRangeAt(0).getBoundingClientRect();
                  const paneRect = pane.getBoundingClientRect();
                  setPreviewAnnotate({
                    ...located,
                    text: snippet.trim(),
                    revision: revisionRef.current,
                    x: rect.left - paneRect.left + pane.scrollLeft,
                    y: rect.bottom - paneRect.top + pane.scrollTop + 8,
                  });
                }}
                className={cn("paper-view", paperStyles.documentScroller)}
                style={previewStyle}
              >
                <div className="prose-ob max-w-full relative">
                  <TexPreview project={project} blocks={previewResult?.blocks || []} bibliography={bibliography} onNavigate={() => claimScrollSource("preview")}
                    todos={todos} todoDisabled={remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft)}
                    onToggleTodo={async (todoId, completed) => {
                      const todo = collectEditorTodos(liveSource()).find(item => item.id === todoId);
                      if (!todo) { setSaveError("This TODO changed. Refresh the paper to continue."); return false; }
                      try { return await patchTodo(todo, { completed }); }
                      catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save the TODO."); return false; }
                    }}
                    onShowSource={(tex, from, to) => {
                      const range = from !== undefined && to !== undefined ? { from, to } : undefined;
                      const found = locatePreviewSnippet(liveSource(), tex, from || 0, range);
                      const target = found?.from ?? from;
                      if (target === undefined) return;
                      requestAnimationFrame(() => editorRef.current?.setSelection(target, found?.to ?? target));
                    }} />
                  {previewAnnotate && (
                    <div
                      className="absolute z-20 flex gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] shadow-lg"
                      style={{ left: previewAnnotate.x, top: previewAnnotate.y }}
                    >
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => {
                          const insert = composeHumanComment(previewAnnotate.text);
                          if (previewAnnotate.revision === revisionRef.current) editorRef.current?.applyVirtualChange(previewAnnotate.from, previewAnnotate.to, insert);
                          setPreviewAnnotate(null);
                          window.getSelection()?.removeAllRanges();
                        }}
                      >
                        Comment
                      </button>
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => {
                          const insert = composeObtodo({ text: previewAnnotate.text });
                          if (previewAnnotate.revision === revisionRef.current) editorRef.current?.applyVirtualChange(previewAnnotate.from, previewAnnotate.to, insert);
                          setPreviewAnnotate(null);
                          window.getSelection()?.removeAllRanges();
                        }}
                      >
                        TODO
                      </button>
                      <button type="button" className="text-faint hover:underline" onClick={() => setPreviewAnnotate(null)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </div>
            )}
            {layout === "pdf" && (
              <div className="ob-split-pane overflow-hidden">
                <PdfPreview
                  project={project}
                  compile={{ ...compile, stale: compile.stale || !isSaved }}
                  sourceTarget={pdfSourceTarget}
                  onJumpToSource={jumpToSourceLine}
                />
              </div>
            )}
          </Panel>

          <Separator
            aria-label="Resize split panes"
            title="Drag to resize"
            className={cn("flex min-h-0 shrink-0 touch-none items-center justify-center bg-line/70 hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", narrow ? "h-3 w-full cursor-row-resize" : "w-2 cursor-col-resize")}
            disableDoubleClick
            onDoubleClick={() => { splitGroupRef.current?.setLayout({ reader: 50, source: 50 }); (narrow ? setSplitTopPct : setSplitLeftPct)(50); }}
          >
            {narrow ? <GripHorizontal size={16} className="text-faint" /> : <GripVertical size={12} className="text-faint" />}
          </Separator>

          <Panel id="source" minSize={`${SPLIT_MIN}%`} maxSize={`${SPLIT_MAX}%`} className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1">
            <div
              className={cn("ob-editor-container overflow-hidden", paperStyles.sourceStack)}
              style={{ position: "absolute", inset: 0, ...editorStyle }}
              onWheelCapture={(event) => { claimScrollSource("editor"); observeReadingMotion(event.deltaY); }}
              onTouchStartCapture={(event) => { claimScrollSource("editor"); startReadingTouch(event.touches); }}
              onTouchMoveCapture={(event) => moveReadingTouch(event.touches)}
              onPointerDownCapture={() => claimScrollSource("editor")}
              onKeyDownCapture={(event) => {
                claimScrollSource("editor");
                observeReadingKey(event.key);
                if (remoteOutOfSync || applyingRemote || saveConflict) return;
                if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
                handlePaperAddShortcut(event.nativeEvent, { comment: addComment, todo: addTodo });
              }}
            >
            <NestedBundleEditor
              readOnly={remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft)}
              ref={editorRef}
              value={source}
              citationKeys={(bibliography || []).map(entry => entry.key)}
              onDocChanges={onDocChanges}
              onScroll={handleEditorScroll}
              placeholder="Write TeX…"
              className="h-full"
            />

            <details ref={formatPanelRef} open={!narrow || formatOpen} className={cn("p-glass", paperStyles.formatPanel)}>
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-muted lg:hidden"
                onClick={(event) => { event.preventDefault(); setFormatOpen((open) => !open); }}>
                <Bold size={13} /> Format <ChevronDown size={12} className={formatOpen ? "rotate-180" : undefined} />
              </summary>
            <div role="toolbar" aria-label="Paper editing" className={`ob-format-bar ${paperStyles.editingToolbar}`}>
              <Tool title="Show source position in PDF" onClick={() => { void jumpToPdf(); }}><FileText size={12} /></Tool>
              <Tool title="Bold (⌘B)" onClick={() => surround("\\textbf{", "}", "bold")}><Bold size={12} /></Tool>
              <Tool title="Italic (⌘I)" onClick={() => surround("\\emph{", "}", "italic")}><Italic size={12} /></Tool>
              <Tool title="Inline Code" onClick={() => surround("\\texttt{", "}", "code")}><Code2 size={12} /></Tool>
              <div className="h-3.5 w-px bg-line mx-0.5" />
              <Tool title="Subsection" onClick={() => insertBlock("\\subsection{New Subsection}\n\n") }><Heading2 size={12} /></Tool>
              <Tool title="Subsubsection" onClick={() => insertBlock("\\subsubsection{New Subsubsection}\n\n")}><Heading3 size={12} /></Tool>
              <Tool title="Bullet List" onClick={() => insertBlock("\\begin{itemize}\n\\item \n\\item \n\\end{itemize}")}><List size={12} /></Tool>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Tool title="Table">
                  <Table2 size={12} /><ChevronDown size={9} />
                </Tool></DropdownMenu.Trigger>
                <MenuSurface side="top" align="end" className="ob-menu">
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_RESULT_GRID_TPL)}>Result grid</DropdownMenu.Item>
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_BLANK_TABLE_TPL)}>Blank table</DropdownMenu.Item>
                </MenuSurface>
              </DropdownMenu.Root>
              <Tool title="Math Formula" onClick={() => surround("\\[\n", "\n\\]")}><Sigma size={12} /></Tool>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Tool title="Figure">
                  <ImagePlus size={12} /><ChevronDown size={9} />
                </Tool></DropdownMenu.Trigger>
                <MenuSurface side="top" align="end" className="ob-menu">
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_PLANNED_FIGURE_TPL)}>Planned figure</DropdownMenu.Item>
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_PLANNED_PLOT_TPL)}>Planned plot</DropdownMenu.Item>
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => fileRef.current?.click()}>Upload image…</DropdownMenu.Item>
                </MenuSurface>
              </DropdownMenu.Root>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />
              <div className="h-3.5 w-px bg-line mx-0.5" />
              <div className="ob-comment-add-group inline-flex items-center gap-1">
                <Tool className="ob-comment-add-action" title={`Add [${commentKindAppearance(commentKindDraft).label}] (${commentShortcut.label})`} shortcut={commentShortcut.aria} accent onClick={() => addComment()}><MessageSquareText size={12} /><span className="text-[10px]">Add</span></Tool>
                <CommentKindPicker value={commentKindDraft} onChange={setCommentKindDraft} kinds={commentKinds} />
              </div>
              <Tool
                title={`Add TODO (${todoShortcut.label})`}
                shortcut={todoShortcut.aria}
                accent
                onClick={addTodo}
              >
                <ListTodo size={11} />
                <span className="text-[10px] font-medium">+ TODO</span>
              </Tool>
              <div ref={citeBtnRef} className="relative">
                <Tool title="Insert Citation" accent onClick={() => setCiteOpen((o) => !o)}>
                  <Quote size={12} /><ChevronDown size={9} />
                </Tool>
                <AnchoredPop open={citeOpen} anchorRef={citeBtnRef} origin="br" onDismiss={() => { setCiteOpen(false); setCiteQuery(""); }} className="ob-menu ob-menu-wide">
                  {bibliography?.length ? (
                    <>
                      <input
                        value={citeQuery}
                        onChange={(event) => {
                          setCiteQuery(event.target.value);
                          setCiteHighlight(0);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setCiteHighlight((value) => Math.min(citeEntries.length - 1, value + 1));
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setCiteHighlight((value) => Math.max(0, value - 1));
                          } else if (event.key === "Enter") {
                            event.preventDefault();
                            const entry = citeEntries[citeHighlight];
                            if (entry) {
                              insertInline(`\\cite{${entry.key}}`);
                              setCiteOpen(false);
                              setCiteQuery("");
                            }
                          }
                        }}
                        placeholder="Filter citations…"
                        className="mb-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-none"
                      />
                      {citeEntries.map((entry, index) => (
                        <button
                          key={entry.key}
                          type="button"
                          className={cn("ob-menu-item text-xs", index === citeHighlight && "bg-accent-soft text-accent")}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { insertInline(`\\cite{${entry.key}}`); setCiteOpen(false); setCiteQuery(""); }}
                        >
                          <span className="font-mono text-[11px] font-semibold text-accent">\{entry.key}</span>
                          <span className="ml-2 truncate text-[11px] text-muted">{entry.fields.title || ""}</span>
                        </button>
                      ))}
                      {citeEntries.length === 0 && <div className="p-2 text-xs text-faint">No matching entries.</div>}
                    </>
                  ) : <div className="p-2 text-xs text-faint">No entries in bibliography yet.</div>}
                </AnchoredPop>
              </div>
            </div>
            </details>
            </div>
            </div>
          </Panel>
        </Group>
      <div
        className={paperStyles.todoDrawer}
        data-open={todoOpen}
        aria-label="Paper TODOs"
        role="region"
        aria-hidden={!todoOpen}
        inert={!todoOpen}
      >
        <Group
          orientation="vertical"
          className="pointer-events-none"
          onLayoutChanged={(_, meta) => { if (meta.isUserInteraction) setTodoPanelHeight((todoPanelRef.current?.getSize().inPixels ?? todoPanelHeight - 32) + 32); }}
        >
          <Panel id="todo-space" minSize={0} />
          <Separator
              aria-label="Resize TODO drawer"
              title="Drag to resize TODO drawer"
              className={`relative flex h-8 items-center justify-center text-faint hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${paperStyles.todoResizeHandle}`}
          >
              <GripHorizontal size={12} />
            <button
              type="button"
              title="Hide"
              aria-label="Close TODO drawer"
              className="ob-press absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTodoOpen(false);
              }}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </Separator>
          <Panel id="todo-content" panelRef={todoPanelRef} defaultSize={todoPanelHeight - 32} minSize={TODO_PANEL_MIN - 32} maxSize={568} groupResizeBehavior="preserve-pixel-size" className={paperStyles.todoSurface}>
          <TodoPanel
            todos={todos}
            placementTargets={placementTargets}
            boundTodoIds={boundTodoIds}
            onJump={jumpToTodo}
            onResolve={resolveTodo}
            onPatch={patchTodo}
            onInsert={insertBlock}
            getTodoSource={(todo): TodoUndoSnapshot => {
              const current = liveSource();
              return {
                tex: current.slice(todo.from, todo.to),
                before: current.slice(Math.max(0, todo.from - 192), todo.from),
                after: current.slice(todo.to, Math.min(current.length, todo.to + 192)),
                baseHash: bundleHashRef.current,
                ...(todo.id ? { todoId: todo.id } : {}),
                from: todo.from,
                to: todo.to,
              };
            }}
            onRestore={async (todo, snapshot) => {
              if (!snapshot.tex) return false;
              const current = liveSource();
              if (todo.id && collectEditorTodos(current).some((entry) => entry.id === todo.id)) {
                setSaveError("This TODO already exists in the current manuscript; undo was not applied.");
                return false;
              }
              const offset = locateUndoOffset(current, todo.from, snapshot);
              if (offset === null) {
                setSaveError("The TODO's surrounding source changed; reload the paper before using Undo.");
                return false;
              }
              const applied = editorRef.current?.applyVirtualChange(offset, offset, snapshot.tex);
              const next = liveSource();
              if (!applied || next === current) {
                setSaveError("The TODO could not be restored in the live editor.");
                return false;
              }
              const saved = await saveNow(next);
              if (!saved) {
                const failure = saveFailureRef.current;
                setSaveError(failure?.message || "Could not save the restored TODO.");
                return false;
              }
              return true;
            }}
            onPlace={(todoId, parentId) => {
              void placeTodoOnMindmapAction(project, todoId, parentId)
                .then(() => pushRemote("OpenBar: place paper TODO on mindmap"))
                .catch((error) => {
                  setSaveError(error instanceof Error ? error.message : "Could not place the TODO on the primary mindmap.");
                });
            }}
          />
          {todos.some((todo) => !todo.id) && (
            <div className="border-t border-line px-3 py-2 text-xs">
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  const next = assignMissingTodoIds(liveSource());
                  const current = liveSource();
                  editorRef.current?.applyVirtualChange(0, current.length, next.source);
                }}
              >
                Assign stable IDs to {todos.filter((todo) => !todo.id).length} TODOs
              </button>
            </div>
          )}
          </Panel>
        </Group>
      </div>
      </div>

    </div>
  );
}

function PdfPreview({
  project,
  compile,
  sourceTarget,
  onJumpToSource,
}: {
  project: string;
  compile: PaperCompileViewState;
  sourceTarget?: { page: number; x: number; y: number; width?: number; height?: number } | null;
  onJumpToSource?: (file: string, line: number) => void;
}) {
  const artifactId = compile.lastSuccessfulArtifact?.artifactId || compile.artifactId;
  const pdfAvailable = compile.lastSuccessfulArtifact ? compile.pdfAvailable !== false : compile.pdfAvailable;
  const pdfSrc = pdfAvailable && artifactId
    ? `/api/p/${project}/paper/pdf?artifact=${encodeURIComponent(artifactId)}`
    : null;
  const stale = Boolean(compile.stale || (pdfAvailable && compile.state !== "success"));

  if (compile.state === "unavailable" && !pdfSrc) {
    return <div className="p-12 text-center text-sm text-muted">LaTeX compilation is not available on this server.</div>;
  }
  if (compile.state === "error") {
    const fileHits = parseTexFileLines(compile.diagnostics || []);
    const first = fileHits[0];
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-6 text-xs text-danger">
        <div>
          <p className="font-semibold mb-2">Compile failed</p>
          {first && (
            <button
              type="button"
              className="mb-2 text-left font-medium text-ink underline-offset-2 hover:underline"
              onClick={() => onJumpToSource?.(first.file, first.line)}
            >
              {first.file}:{first.line} — {first.message}
            </button>
          )}
          <div className="max-h-48 overflow-auto rounded bg-surface-2 p-3 font-mono leading-relaxed">
            {(compile.diagnostics || []).map((line, index) => {
              const hit = parseTexFileLines([line])[0];
              if (!hit || !onJumpToSource) {
                return <div key={`${index}-${line}`}>{line}</div>;
              }
              return (
                <button
                  key={`${index}-${line}`}
                  type="button"
                  className="block w-full text-left hover:underline"
                  onClick={() => onJumpToSource(hit.file, hit.line)}
                >
                  {line}
                </button>
              );
            })}
          </div>
        </div>
        {pdfSrc && (
          <div className="min-h-0 flex-1">
            <PdfJsViewer
              project={project}
              src={pdfSrc}
              artifactId={artifactId}
              stale
              observationMessage={compile.observationDelayed ? compile.message : undefined}
              sourceTarget={sourceTarget}
              onJumpToSource={onJumpToSource}
            />
          </div>
        )}
      </div>
    );
  }
  if (compile.state === "running" && !pdfSrc) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-sm text-muted">
        {compile.observationDelayed ? (
          <div className="font-medium text-warn" role="status">
            {compile.message || "The compile is still running. Resume polling to check the same job."}
          </div>
        ) : (
          <div className="flex items-center gap-2 font-medium text-ink">
            <LoaderCircle size={15} className="animate-spin text-accent" />
            Compiling TeX with {compile.compiler || "latexmk"}…
          </div>
        )}
        {compile.lastLines && compile.lastLines.length > 0 && (
          <div className="w-full max-w-xl rounded-lg border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed shadow-xs">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted mb-1.5 flex items-center justify-between">
              <span>Compiler Output</span>
              <span className="animate-pulse text-accent flex items-center gap-1">● live stream</span>
            </div>
            <div className="space-y-0.5 text-ink/80 overflow-hidden">
              {compile.lastLines.map((line, idx) => (
                <div key={idx} className="truncate font-mono">{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (!pdfSrc) {
    return (
      <div className="p-12 text-center text-sm text-muted">
        {compile.message || "Compile to generate a PDF."}
      </div>
    );
  }
  return (
    <PdfJsViewer
      project={project}
      src={pdfSrc}
      artifactId={artifactId}
      stale={stale}
      observationMessage={compile.observationDelayed ? compile.message : undefined}
      sourceTarget={sourceTarget}
      onJumpToSource={onJumpToSource}
    />
  );
}

function ToolbarSeg({
  active,
  onClick,
  children,
  title,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "ob-press inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-medium",
        active ? "bg-accent text-accent-ink shadow-xs" : "text-muted hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Tool({
  title,
  shortcut,
  children,
  accent,
  className,
  ...props
}: ComponentProps<"button"> & {
  title: string;
  shortcut?: string;
  accent?: boolean;
}) {
  return (
    <FastTooltip label={title}>
    <button
      type="button"
      aria-label={title}
      aria-keyshortcuts={shortcut}
      onMouseDown={(event) => event.preventDefault()}
      {...props}
      className={cn(
        "ob-press inline-flex h-7 items-center justify-center gap-1 rounded px-2 text-xs",
        accent ? "text-accent hover:bg-accent/10 font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
    </FastTooltip>
  );
}
