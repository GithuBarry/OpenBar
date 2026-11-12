"use client";

import { bundleSections } from "@/lib/tex-project/section-ranges";

import "katex/dist/katex.min.css";
import { useGitAutoSync } from "@/components/use-git-auto-sync";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { ResumeEditControl } from "@/components/project-session/resume-edit-control";
import { BackendStatusNotice } from "@/components/backend-status-notice";
import { isBackendTransportError } from "@/lib/backend-connection";
import { selectEditorIssue, type EditorIssue } from "@/lib/editor-issue-priority";
import { OverleafSyncNotice } from "@/components/overleaf-sync-notice";
import { EditorNotice } from "@/components/editor-notice";
import { PaperStatusControl } from "./paper-status-control";
import { FastTooltip } from "@/components/fast-tooltip";
import paperStyles from "./paper-outline-rail.module.css";
import { CommentKindPicker } from "./comment-kind-picker";
import { BibtexImport } from "./bibtex-import";
import { BibliographyEditor } from "./bibliography-editor";
import { registerProjectFileEditor, runProjectFileOperation } from "@/features/project-files-bridge";
import { captureCitationSelection, resolveCitationSelection, type CitationSelection } from "./citation-selection";
import { handlePaperAddShortcut, paperAddShortcut } from "./paper-add-shortcuts";
import { PaperOutlineRail } from "./paper-outline-rail";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import { Group, Panel, Separator, useGroupRef, usePanelRef } from "react-resizable-panels";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Bold,
  BookOpen,
  ChevronDown,
  CircleAlert,
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
  Quote,
  RefreshCw,
  Sigma,
  Table2,
  X,
} from "lucide-react";

import {
  finishForceProjectSyncAction,
  importBibtexAction,
  getBibliographyEditorAction,
  readBibliographyFileAction,
  placeTodoOnMindmapAction,
  removePaperTodoAction,
  synctexViewAction,
  uploadPaperFigureAction,
} from "@/app/actions";
import { clearPendingBrowserPull, getBrowserGitStatus, pullBrowserProject, pushBrowserProject, readPendingBrowserPull, requireGitPullBarrier, type PendingBrowserPull } from "@/lib/research/browser-git-sync";
import { clearPendingForcePull, finishForceRequest, readPendingForcePull, requireResolvedForcePull, type ForcePullReconciliation, type PendingForcePull } from "@/lib/research/force-sync-client";
import type { ClientSourceBundle } from "@/lib/tex-project/source-bundle-format";
import { inlineBundleIncludes, rebaseBundleSource, splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/copy-text";
import type { BibEntry, BibliographyImportResult } from "@/lib/bibtex";
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
import { scrollFollowSmoothingMs, smoothScrollStep, type PdfScrollSync } from "./scroll-follow";
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
import { PaperAppearance, type PaperEditorWidth, type PaperReaderFont, type PaperToolbarPosition } from "./paper-appearance";
import { TodoPanel, type TodoUndoSnapshot } from "./todo-panel";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { remoteSyncResult } from "@/lib/research/project-sync";
import {
  getMindmapRemoteSyncQueue,
  type MindmapRemoteQueueEvent,
} from "@/lib/research/mindmap-remote-sync-queue";
import { failResult, type OperationResult, type RemoteSyncOutcome } from "@/lib/research/operation-result";
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
type RemoteSaveState = "checking" | "unverified" | "local" | "saving" | "saved" | "changed" | "blocked" | "unconfigured" | "unavailable" | "error";
type PaperRemotePushResult = Awaited<ReturnType<typeof pushBrowserProject>>;

const AUTOSAVE_IDLE_MS = 500;
const AUTOSAVE_MAX_MS = 2_000;
const PAGE_BUDGET_REFRESH_MS = 3 * 60_000;
const AUTO_COMPILE_IDLE_MS = 10_000;
const AUTO_COMPILE_RETRY_MS = 2 * 60_000;
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

/** Find the live bundle position closest to the visible editor's reading area. */
function visibleEditorOffset(scroller: HTMLElement): number | null {
  const viewport = scroller.getBoundingClientRect();
  const targetY = viewport.top + viewport.height * 0.35;
  let closest: { view: EditorView; from: number; distance: number; box: DOMRect } | null = null;
  for (const host of scroller.querySelectorAll<HTMLElement>(".ob-nested-tex-slice[data-ob-source-from]")) {
    const element = host.querySelector<HTMLElement>(".cm-editor");
    const view = element && EditorView.findFromDOM(element);
    const from = Number(host.dataset.obSourceFrom);
    if (!element || !view || !Number.isInteger(from)) continue;
    const box = element.getBoundingClientRect();
    if (box.bottom <= viewport.top || box.top >= viewport.bottom) continue;
    const distance = targetY < box.top ? box.top - targetY : targetY > box.bottom ? targetY - box.bottom : 0;
    if (!closest || distance < closest.distance) closest = { view, from, distance, box };
  }
  if (!closest) return null;
  const y = Math.max(closest.box.top + 1, Math.min(closest.box.bottom - 1, targetY));
  const x = Math.max(closest.box.left + 1, Math.min(closest.box.right - 1, closest.box.left + 50));
  return closest.from + closest.view.posAtCoords({ x, y }, false);
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
  glass?: number | "soft" | "balanced" | "clear";
  toolbarPosition?: PaperToolbarPosition;
};

type PaperAppearancePrefs = {
  editorWidth: PaperEditorWidth;
  previewFontScale: number;
  editorFontScale: number;
  previewLineHeight: number;
  previewFont: PaperReaderFont;
  glass: number;
  toolbarPosition: PaperToolbarPosition;
};

const PAPER_APPEARANCE_KEY = "ob:paper-appearance";

function normalizePaperAppearance(value: unknown): PaperAppearancePrefs {
  const prefs = value && typeof value === "object" ? value as Partial<EditorPrefs> : {};
  const clamp = (input: unknown, min: number, max: number, fallback: number) =>
    typeof input === "number" && Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : fallback;
  const glass = prefs.glass === "soft" ? 0 : prefs.glass === "balanced" ? 40 : prefs.glass === "clear" ? 100 : prefs.glass;
  return {
    editorWidth: prefs.editorWidth === "compact" || prefs.editorWidth === "full" ? prefs.editorWidth : "wide",
    previewFontScale: clamp(prefs.previewFontScale, 10 / 17, 24 / 17, DEFAULT_PREVIEW_FONT_SCALE),
    editorFontScale: clamp(prefs.editorFontScale, 10 / 14, 24 / 14, DEFAULT_EDITOR_FONT_SCALE),
    previewLineHeight: clamp(prefs.previewLineHeight, 1.45, 1.85, DEFAULT_PREVIEW_LINE_HEIGHT),
    previewFont: prefs.previewFont === "sans" ? "sans" : DEFAULT_PREVIEW_FONT,
    glass: clamp(glass, 0, 100, 40),
    toolbarPosition: prefs.toolbarPosition === "bottom" ? "bottom" : "top",
  };
}

function prefsKey(project: string) {
  return `ob:paper-prefs:${project}`;
}

function recoveryKey(project: string) {
  return `ob:paper-recovery:${project}:paper`;
}

type RecoveryDraft = { source: string; baseHash: string; savedAt: string; queuedSource?: string };
type CompileObservation = { requestId: number; revision: number; bundleHash: string };

export function PaperEditor({
  project,
  title,
  initialSections,
  initialBundle,
  sourceContext,
  bibliography: initialBibliography,
  bibliographyRaw: initialBibliographyRaw,
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
  const router = useRouter();
  const { writable: sessionWritable, setPendingWork, connectionState, isBackendUnavailable, accessMessage, accessError } = useProjectWriteSession();
  const [connectionDetailsOpenRequest, setConnectionDetailsOpenRequest] = useState(0);
  const sessionWritableRef = useRef(sessionWritable);
  sessionWritableRef.current = sessionWritable;
  const [restoreEditingAttention, setRestoreEditingAttention] = useState(false);
  const nudgeRestoreEditing = (target: EventTarget) => {
    if (!sessionWritable && target instanceof Element && target.closest(".cm-content")) setRestoreEditingAttention(true);
  };
  const remoteQueue = useMemo(
    () => getMindmapRemoteSyncQueue<PaperRemotePushResult>(project, result => result.ok),
    [project],
  );
  const initialSource = initialBundle.source;
  const [sourceSnapshot, setSourceSnapshot] = useState({ value: initialSource, revision: 0 });
  const source = sourceSnapshot.value;
  const [savedSource, setSavedSource] = useState(initialSource);
  const [bibliography, setBibliography] = useState(initialBibliography || []);
  const [bibliographyRaw, setBibliographyRaw] = useState(initialBibliographyRaw || "");
  const [bundleHash, setBundleHash] = useState(initialBundle.bundleHash);
  const [bundleDiagnostics, setBundleDiagnostics] = useState(initialBundle.diagnostics);
  const [sourceContextState, setSourceContextState] = useState(sourceContext);
  const [saving, setSaving] = useState(false);
  const [localDirty, setLocalDirty] = useState(false);
  useEffect(() => {
    setPendingWork("paper", localDirty || saving);
    return () => setPendingWork("paper", false);
  }, [localDirty, saving, setPendingWork]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [todoRemovalError, setTodoRemovalError] = useState<{ todo: EditorTodo; message: string; retry: "remove" | "save"; report: Record<string, unknown> } | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [conflictCopyStatus, setConflictCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (!saveConflict) setConflictCopyStatus("idle");
  }, [saveConflict]);
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
  const [remoteSaveState, setRemoteSaveState] = useState<RemoteSaveState>("checking");
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  const [reviewingRemote, setReviewingRemote] = useState(false);
  const [gitAttention, setGitAttention] = useState(false);
  const [gitDetailsOpenRequest, setGitDetailsOpenRequest] = useState(0);
  const [saveDetailsOpenRequest, setSaveDetailsOpenRequest] = useState(0);
  useEffect(() => {
    if (!gitAttention) return;
    const timer = window.setTimeout(() => setGitAttention(false), 800);
    return () => window.clearTimeout(timer);
  }, [gitAttention]);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const [expectedSections, setExpectedSections] = useState(initialSections);
  const [prefsReadyProject, setPrefsReadyProject] = useState<string | null>(null);
  const prefsReady = prefsReadyProject === project;
  const [editorProgress, setEditorProgress] = useState<{ ready: number; total: number; filePath?: string }>({ ready: 0, total: 0 });
  const editorReady = editorProgress.total > 0 && editorProgress.ready >= editorProgress.total;

  const [layout, setLayout] = useState<LayoutMode>("document");
  const previousLayoutRef = useRef<LayoutMode>("document");
  const [narrow, setNarrow] = useState(false);
  const [phone, setPhone] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const phoneMedia = window.matchMedia("(max-width: 640px)");
    const pointerMedia = window.matchMedia("(pointer: coarse)");
    const update = () => { setNarrow(media.matches); setPhone(phoneMedia.matches); setCoarsePointer(pointerMedia.matches); };
    update();
    media.addEventListener("change", update);
    phoneMedia.addEventListener("change", update);
    pointerMedia.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); phoneMedia.removeEventListener("change", update); pointerMedia.removeEventListener("change", update); };
  }, []);
  const [activeBookmark, setActiveBookmark] = useState<string>("");
  const [citeOpen, setCiteOpen] = useState(false);
  const [bibtexOpen, setBibtexOpen] = useState(false);
  const [bibliographyOpen, setBibliographyOpen] = useState(false);
  const [bibliographyFiles, setBibliographyFiles] = useState<string[]>([]);
  const citationSelectionRef = useRef<CitationSelection | null>(null);
  const [citeQuery, setCiteQuery] = useState("");
  const [citeHighlight, setCiteHighlight] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(50);
  const [formatHeight, setFormatHeight] = useState(44);
  const [todoOpen, setTodoOpen] = useState(false);
  const todoTriggerRef = useRef<HTMLButtonElement>(null);
  const todoPhoneBackRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!todoOpen || !phone) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement === document.body) todoPhoneBackRef.current?.focus();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [todoOpen, phone]);
  const [editorWidth, setEditorWidth] = useState<PaperEditorWidth>("wide");
  const [todoPanelHeight, setTodoPanelHeight] = useState(TODO_PANEL_DEFAULT);
  const [splitLeftPct, setSplitLeftPct] = useState(50);
  const [splitTopPct, setSplitTopPct] = useState(50);
  const [previewFontScale, setPreviewFontScale] = useState(DEFAULT_PREVIEW_FONT_SCALE);
  const [editorFontScale, setEditorFontScale] = useState(DEFAULT_EDITOR_FONT_SCALE);
  const [previewLineHeight, setPreviewLineHeight] = useState(DEFAULT_PREVIEW_LINE_HEIGHT);
  const [previewFont, setPreviewFont] = useState<PaperReaderFont>(DEFAULT_PREVIEW_FONT);
  const [glass, setGlass] = useState(40);
  const [toolbarPosition, setToolbarPosition] = useState<PaperToolbarPosition>("top");
  const [compile, setCompile] = useState<PaperCompileViewState>({ state: "idle" });
  const [compileStarting, setCompileStarting] = useState(false);
  const [compileFinished, setCompileFinished] = useState(false);
  const compileStartingRef = useRef(false);
  const compileObservationRequestRef = useRef(0);
  const compileFeedbackTimerRef = useRef<number | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const recoveryDraftRef = useRef<RecoveryDraft | null>(null);
  recoveryDraftRef.current = recoveryDraft;
  const [pdfSourceTarget, setPdfSourceTarget] = useState<PdfSourceTarget | null>(null);
  const pdfScrollSyncRef = useRef<PdfScrollSync>({ progress: null, follow: null });
  const pdfNavigationRequest = useRef(0);
  const pendingPdfNavigationRef = useRef<{ request: number; source: string; offset: number } | null>(null);
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
  const { result: previewResult, reset: resetPreview, applyChanges: applyPreviewChanges, workerError, progress: previewProgress } = usePreviewWorker({
    bibliography,
    assetBaseUrl: `/api/p/${project}/asset`,
    getLiveSource: () => editorRef.current?.getLiveSource() ?? sourceRef.current,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollAnchorsCacheRef = useRef<{
    preview: HTMLElement;
    scroller: HTMLElement;
    source: string;
    result: typeof previewResult;
    geometry: string;
    anchors: { editorTop: number; previewTop: number }[];
  } | null>(null);
  const controlsDockRef = useRef<HTMLDivElement>(null);
  const formatPanelRef = useRef<HTMLDivElement>(null);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const citeBtnRef = useRef<HTMLDivElement>(null);
  const splitGroupRef = useGroupRef();
  const todoPanelRef = usePanelRef();
  const activeScrollSourceRef = useRef<"editor" | "preview" | "pdf" | "jump" | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const sourceRevealFrameRef = useRef<number | null>(null);
  const sourceRevealGenerationRef = useRef(0);
  const sourceRevealInProgressRef = useRef(false);
  const sourceRevealAwaitingMeasureRef = useRef(false);
  const pdfFollowFrameRef = useRef<number | null>(null);
  const pdfFollowProgressRef = useRef(0);
  const headingRafRef = useRef<number | null>(null);
  const lastHeadingKeyRef = useRef("");
  // Keep source and rendered positions linked across pane switches.
  const syncPanesRef = useRef(true);
  const settleSourceReveal = useCallback(() => {
    if (scrollSettleTimerRef.current != null) window.clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = window.setTimeout(() => {
      sourceRevealInProgressRef.current = false;
      if (activeScrollSourceRef.current === "jump") activeScrollSourceRef.current = null;
      scrollSettleTimerRef.current = null;
    }, 200);
  }, []);
  const claimScrollSource = (source: "editor" | "preview" | "pdf") => {
    sourceRevealGenerationRef.current += 1;
    sourceRevealInProgressRef.current = false;
    sourceRevealAwaitingMeasureRef.current = false;
    if (sourceRevealFrameRef.current != null) window.cancelAnimationFrame(sourceRevealFrameRef.current);
    sourceRevealFrameRef.current = null;
    pdfNavigationRequest.current += 1;
    pendingPdfNavigationRef.current = null;
    if (source === "pdf" && pdfSourceTarget) setPdfSourceTarget(null);
    if (activeScrollSourceRef.current !== source) {
      if (scrollSyncFrameRef.current != null) window.cancelAnimationFrame(scrollSyncFrameRef.current);
      if (pdfFollowFrameRef.current != null) window.cancelAnimationFrame(pdfFollowFrameRef.current);
      scrollSyncFrameRef.current = null;
      pdfFollowFrameRef.current = null;
    }
    activeScrollSourceRef.current = source;
    if (scrollSettleTimerRef.current) {
      window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
  };
  const saveTimerRef = useRef<number | null>(null);
  const burstStartRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ text: string; requestId: number } | null>(null);
  const saveRequestIdRef = useRef(0);
  const saveBusyRef = useRef(false);
  const todoRemovalBusyRef = useRef(0);
  const revisionRef = useRef(0);
  const updateSource = useCallback((value: string) => setSourceSnapshot({ value, revision: revisionRef.current }), []);
  const currentSourceRevision = useCallback(() => revisionRef.current, []);
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
  const activeRemoteStatusRequestRef = useRef<number | null>(null);
  const remoteSyncRef = useRef<RemoteSyncOutcome | undefined>(undefined);
  const navigationPendingRef = useRef(false);

  const captureCompileObservation = useCallback((requestId = ++compileObservationRequestRef.current): CompileObservation => ({
    requestId,
    revision: revisionRef.current,
    bundleHash: bundleHashRef.current,
  }), []);
  const applyObservedCompileStatus = useCallback((observation: CompileObservation, status: PaperCompileStatus): PaperCompileStatus | null => {
    if (observation.requestId !== compileObservationRequestRef.current) return null;
    const guardedStatus = (): PaperCompileStatus => {
      const sourceChanged = observation.revision !== revisionRef.current || observation.bundleHash !== bundleHashRef.current;
      const sourcePending = saveBusyRef.current || Boolean(pendingSaveRef.current) || todoRemovalBusyRef.current > 0
        || hydrationPendingRef.current || applyingRemoteRef.current
        || (editorRef.current?.getLiveSource() ?? sourceRef.current) !== savedSourceRef.current;
      return sourceChanged || sourcePending ? { ...status, stale: true } : status;
    };
    const observed = guardedStatus();
    setCompile((current) => observation.requestId === compileObservationRequestRef.current
      ? transitionCompileStatus(current, guardedStatus()) : current);
    return observed;
  }, []);

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

  const previouslyWritable = useRef(sessionWritable);
  useEffect(() => {
    if (previouslyWritable.current && !sessionWritable) writeRecoveryDraft();
    previouslyWritable.current = sessionWritable;
  }, [sessionWritable, writeRecoveryDraft]);

  const reviewingRemoteRef = useRef(false);
  useEffect(() => () => { if (reviewingRemoteRef.current) remoteQueue.resume(); }, [remoteQueue]);
  useEffect(() => {
    let initial = true;
    const applyQueueEvent = (event: MindmapRemoteQueueEvent<PaperRemotePushResult>) => {
      const initialSettled = initial && (event.phase === "synced" || event.phase === "failed");
      initial = false;
      if (event.sequence === 0 || initialSettled) return;
      if (hydrationPendingRef.current) return;
      if (isBackendTransportError(event.error) || isBackendUnavailable()) return;
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
  }, [isBackendUnavailable, remoteQueue]);

  const pushRemote = useCallback(async (message: string, deferred = false): Promise<PaperRemotePushResult> => {
    if (reviewingRemoteRef.current) return { ok: false, code: "review_in_progress", message: "Local changes saved for pull review." };
    ++remoteStatusRequestRef.current;
    return remoteQueue.enqueue(bundleHashRef.current, async () => {
      try {
        return await pushBrowserProject(project, message);
      } catch (error) {
        if (isBackendTransportError(error) || isBackendUnavailable()) throw error;
        return { ok: false, code: "remote_save_failed", message: error instanceof Error ? error.message : "Could not save to the remote." };
      }
    }, deferred, () => !saveBusyRef.current && !todoRemovalBusyRef.current && !pendingSaveRef.current
      && (editorRef.current?.getLiveSource() ?? sourceRef.current) === savedSourceRef.current);
  }, [isBackendUnavailable, project, remoteQueue]);

  const refreshRemoteStatus = useCallback(async (refreshRemote = true, announce = true) => {
    const requestId = ++remoteStatusRequestRef.current;
    activeRemoteStatusRequestRef.current = requestId;
    const queueSequence = remoteQueue.getSnapshot().sequence;
    const activityGeneration = remoteQueue.activityGeneration;
    const queueWasBusy = remoteQueue.isBusy;
    setCheckingRemote(true);
    if (announce && !queueWasBusy) setRemoteSaveState(current => current === "changed" || current === "blocked" || current === "error" || current === "unavailable" ? current : "checking");
    try {
      const status = await getBrowserGitStatus(project, refreshRemote);
      if (requestId !== remoteStatusRequestRef.current || activityGeneration !== remoteQueue.activityGeneration) return;
      if (queueWasBusy || remoteQueue.isBusy || remoteQueue.getSnapshot().sequence !== queueSequence) return status;
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
      if (typeof status.isClean !== "boolean" || !Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind)
        || status.ahead! < 0 || status.behind! < 0) {
        const error = "Git status unavailable: the local and remote comparison is incomplete.";
        setRemoteSaveState("unavailable");
        setRemoteSaveError(error);
        return { ...status, error };
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
      if ((status.ahead || 0) > 0 || !status.isClean) {
        remoteSavePendingRef.current = true;
        setRemoteSaveState("local");
      } else if (refreshRemote) {
        remoteSavePendingRef.current = false;
        setRemoteSaveState("saved");
      } else {
        setRemoteSaveState(current => current === "saved" ? current : "unverified");
      }
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
          ? remoteQueue.isRunning ? "saving" : remoteQueue.isBusy ? "local" : "unverified"
          : current);
      }
    }
  }, [isBackendUnavailable, project, remoteQueue]);

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
    const currentSource = editorRef.current?.getLiveSource() ?? sourceRef.current;

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
      if (!ed.getClientRects().length) continue;
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
    const chunks = Array.from(scroller.querySelectorAll<HTMLElement>(".ob-nested-tex-slice[data-ob-file]")).flatMap((host) => {
      if (!host.getClientRects().length) return [];
      const dom = host.querySelector<HTMLElement>(".cm-editor");
      const view = dom && EditorView.findFromDOM(dom);
      const from = Number(host.dataset.obSourceFrom);
      const to = Number(host.dataset.obSourceTo);
      if (!view || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > currentSource.length || to - from !== view.state.doc.length) return [];
      return [{ view, from, to }];
    });
    // Use the same literal source lookup as preview navigation. Paragraphs
    // keep long sections aligned when TeX tables and prose wrap differently.
    const paragraphCursors = new WeakMap<HTMLElement, number>();
    for (const paragraph of preview.querySelectorAll<HTMLElement>("p, li")) {
      const block = paragraph.closest<HTMLElement>("[data-preview-from]");
      if (!block || paragraph.closest(".katex, .ob-references")) continue;
      const range = { from: Number(block.dataset.previewFrom), to: Number(block.dataset.previewTo) };
      if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) continue;
      const cursor = Math.max(range.from, paragraphCursors.get(block) ?? range.from);
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let found: { from: number; to: number } | null = null;
      for (let node = walker.nextNode(); node && !found; node = walker.nextNode()) {
        if (node.parentElement?.closest(".katex, button, [aria-hidden=true]")) continue;
        const text = node.textContent?.trim() || "";
        for (const length of [80, 40, 20]) {
          if (text.length < 12) break;
          found = locatePreviewSnippet(currentSource, text.slice(0, length), cursor, { from: cursor, to: range.to });
          if (!found && cursor > range.from) found = locatePreviewSnippet(currentSource, text.slice(0, length), range.from, range);
          if (found) break;
        }
      }
      const chunk = found && chunks.find((item) => found.from >= item.from && found.from < item.to);
      if (!found || !chunk) continue;
      paragraphCursors.set(block, Math.max(cursor, found.to));
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
    sourceRevealGenerationRef.current += 1;
    if (sourceRevealFrameRef.current != null) window.cancelAnimationFrame(sourceRevealFrameRef.current);
    if (pdfFollowFrameRef.current != null) window.cancelAnimationFrame(pdfFollowFrameRef.current);
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
    if (!syncPanesRef.current || !scroller) return;
    if (sourceRevealInProgressRef.current && activeScrollSourceRef.current === "jump") {
      if (!sourceRevealAwaitingMeasureRef.current) settleSourceReveal();
      return;
    }
    if (layout === "pdf") {
      if (source !== "editor" || (activeScrollSourceRef.current && activeScrollSourceRef.current !== "editor")) return;
      activeScrollSourceRef.current = "editor";
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 120);
      const range = scroller.scrollHeight - scroller.clientHeight;
      if (range > 0) {
        pdfScrollSyncRef.current.progress = Math.max(0, Math.min(1, scroller.scrollTop / range));
        pdfScrollSyncRef.current.follow?.();
      }
      return;
    }
    if (!preview) return;
    if (activeScrollSourceRef.current && activeScrollSourceRef.current !== source) return;

    activeScrollSourceRef.current = source;
    if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    if (scrollSyncFrameRef.current != null) return;
    let settledFrames = 0;
    let lastFrame: number | null = null;
    let followingPosition: number | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smoothingMs = scrollFollowSmoothingMs();
    const alignPanes = (time: number) => {
      scrollSyncFrameRef.current = null;
      const leader = activeScrollSourceRef.current;
      if (leader !== source) return;
      const geometry = [scroller.clientWidth, scroller.clientHeight, scroller.scrollHeight, preview.clientWidth, preview.clientHeight, preview.scrollHeight].join(":");
      const currentSource = editorRef.current?.getLiveSource() ?? sourceRef.current;
      let cached = scrollAnchorsCacheRef.current;
      if (!cached || cached.scroller !== scroller || cached.preview !== preview || cached.source !== currentSource || cached.result !== previewResult || cached.geometry !== geometry) {
        const anchors = getScrollAnchors();
        cached = anchors ? { scroller, preview, source: currentSource, result: previewResult, geometry, anchors } : null;
        scrollAnchorsCacheRef.current = cached;
      }
      const anchors = cached?.anchors;
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
      const target = Math.max(0, Math.min(followingPane.scrollHeight - followingPane.clientHeight, a0[to] + fraction * (a1[to] - a0[to])));
      const elapsed = lastFrame === null ? 1000 / 60 : time - lastFrame;
      lastFrame = time;
      followingPosition = smoothScrollStep(followingPosition ?? followingPane.scrollTop, target, elapsed, reducedMotion, smoothingMs);
      followingPane.scrollTop = followingPosition;
      settledFrames = Math.abs(target - followingPosition) < 0.75 ? settledFrames + 1 : 0;
      if (settledFrames < 2) scrollSyncFrameRef.current = window.requestAnimationFrame(alignPanes);
      else scrollSettleTimerRef.current = window.setTimeout(() => { if (activeScrollSourceRef.current === source) activeScrollSourceRef.current = null; }, 120);
    };
    scrollSyncFrameRef.current = window.requestAnimationFrame(alignPanes);
  }, [getScrollAnchors, layout, previewResult, settleSourceReveal, updateActiveHeading]);
  useEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = layout;
    if (layout !== "document" || previous !== "pdf") return;
    const frame = window.requestAnimationFrame(() => syncScroll("editor"));
    return () => window.cancelAnimationFrame(frame);
  }, [layout, syncScroll]);
  const handleEditorScroll = useCallback(() => syncScroll("editor"), [syncScroll]);
  const handlePreviewScroll = useCallback(() => syncScroll("preview"), [syncScroll]);
  const handlePdfScroll = useCallback((progress: number) => {
    const scroller = editorRef.current?.getScroller();
    if (layout !== "pdf" || !syncPanesRef.current || !scroller) return;
    if (activeScrollSourceRef.current && activeScrollSourceRef.current !== "pdf") return;
    activeScrollSourceRef.current = "pdf";
    pdfScrollSyncRef.current.progress = null;
    pdfFollowProgressRef.current = progress;
    if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    if (pdfFollowFrameRef.current != null) return;
    let settledFrames = 0;
    let lastFrame: number | null = null;
    let followingPosition = scroller.scrollTop;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smoothingMs = scrollFollowSmoothingMs();
    const followPdf = (time: number) => {
      pdfFollowFrameRef.current = null;
      if (activeScrollSourceRef.current !== "pdf") return;
      const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight) * pdfFollowProgressRef.current;
      const elapsed = lastFrame === null ? 1000 / 60 : time - lastFrame;
      lastFrame = time;
      followingPosition = smoothScrollStep(followingPosition, target, elapsed, reducedMotion, smoothingMs);
      scroller.scrollTop = followingPosition;
      updateActiveHeading(scroller);
      settledFrames = Math.abs(target - followingPosition) < 0.75 ? settledFrames + 1 : 0;
      if (settledFrames < 2) pdfFollowFrameRef.current = window.requestAnimationFrame(followPdf);
      else scrollSettleTimerRef.current = window.setTimeout(() => { if (activeScrollSourceRef.current === "pdf") activeScrollSourceRef.current = null; }, 120);
    };
    pdfFollowFrameRef.current = window.requestAnimationFrame(followPdf);
  }, [layout, updateActiveHeading]);

  const applyHydrated = useCallback((paper: HydratedPaper, draft = paper.bundle.source) => {
    const next = draft;
    setExpectedSections(paper.sections);
    expectedSectionsRef.current = paper.sections;
    sectionHashesRef.current = new Map(paper.sections.map((section) => [section.id, section.hash]));
    bundleHashRef.current = paper.bundle.bundleHash;
    sourceSegmentsRef.current = paper.bundle.segments.map(({ filePath, editable }) => ({ filePath, editable }));
    sourceRef.current = next;
    savedSourceRef.current = paper.bundle.source;
    revisionRef.current += 1;
    updateSource(next);
    setSavedSource(paper.bundle.source);
    setLocalDirty(next !== paper.bundle.source);
    setBundleHash(paper.bundle.bundleHash);
    setBundleDiagnostics(paper.bundle.diagnostics);
    setSourceContextState(paper.sourceContext);
    setSaveError(null);
    setTodoRemovalError(null);
    setSaveConflict(false);
    if (next === paper.bundle.source) clearRecoveryDraft();
    setCompile((current) => transitionCompileStatus(current, {
      state: current.state === "running" ? "running" : "idle",
      stale: true,
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
      if (remoteSavePendingRef.current) void pushRemote("OpenBar: save paper", true);
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
    const bundle = result.value.bundle;
    const canonical = bundle?.source ?? text;
    if (bundle) {
      sourceSegmentsRef.current = bundle.segments.map(({ filePath, editable }) => ({ filePath, editable }));
      setBundleDiagnostics(bundle.diagnostics);
    }
    const refreshedPaper = "paper" in result.value ? result.value.paper : undefined;
    if (refreshedPaper) {
      const paper = refreshedPaper;
      setExpectedSections(paper.sections);
      expectedSectionsRef.current = paper.sections;
      sectionHashesRef.current = new Map(paper.sections.map((section) => [section.id, section.hash]));
      setSourceContextState(paper.sourceContext);
    } else if (result.value.graphChanged) {
      expectedSectionsRef.current = [];
      sectionHashesRef.current = new Map();
      setExpectedSections([]);
      setSourceContextState({ sections: [], diagnostics: bundle?.diagnostics ?? [] });
    }
    savedSourceRef.current = canonical;
    setSavedSource(canonical);
    const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
    const rebased = rebaseBundleSource(text, live, canonical);
    const pending = pendingSaveRef.current;
    const rebasedPending = pending ? rebaseBundleSource(text, pending.text, canonical) : undefined;
    const preserveConflict = (message: string): never => {
      pendingSaveRef.current = null;
      saveConflictRef.current = true;
      setSaveConflict(true);
      setLocalDirty(true);
      saveFailureRef.current = { code: "stale_disk_state", message };
      if (pending && pending.text !== live) {
        // Keep both versions available when a queued snapshot differs from
        // the editor. Each can contain work the other does not have.
        const draft: RecoveryDraft = { source: live, queuedSource: pending.text, baseHash: bundleHashRef.current, savedAt: new Date().toISOString() };
        try { window.sessionStorage.setItem(recoveryKey(project), JSON.stringify(draft)); } catch { /* best-effort */ }
        recoveryDraftRef.current = draft;
        setRecoveryDraft(draft);
      } else writeRecoveryDraft();
      throw new Error(message);
    };
    if (result.value.graphChanged && !refreshedPaper) {
      preserveConflict("The paper was saved, but its updated section information could not be refreshed. Reload the saved paper after copying any newer edits.");
    }
    if (!rebased.ok || (rebasedPending && !rebasedPending.ok)) {
      const files = [...new Set([...(rebased.ok ? [] : rebased.files), ...(rebasedPending && !rebasedPending.ok ? rebasedPending.files : [])])];
      const detail = files.length ? ` Changed files: ${files.join(", ")}.` : "";
      return preserveConflict(`The saved include graph changed while newer edits were made. Your newer edits remain in this editor and recovery draft.${detail} Copy those edits before reloading the saved paper.`);
    }
    if (pending && rebasedPending?.ok) pendingSaveRef.current = { ...pending, text: rebasedPending.source };
    if (rebased.source !== live) {
      const editor = editorRef.current;
      let applied = true;
      // Commit the new graph to React and the editor in the same turn so a
      // subsequent keystroke cannot be replaced by an older render.
      flushSync(() => {
        if (editor) applied = editor.applyVirtualChange(0, live.length, rebased.source);
        if (applied) updateSource(rebased.source);
      });
      if (!applied) {
        preserveConflict("The saved include graph changed while the editor could not be refreshed. Your newer edits remain in this editor and recovery draft.");
      }
      resetPreview(rebased.source);
    } else if (live === text) updateSource(rebased.source);
    sourceRef.current = rebased.source;
    setLocalDirty(rebased.source !== canonical);
    if (rebased.source !== canonical) writeRecoveryDraft();
    setCompile((current) => transitionCompileStatus(current, {
      state: current.state === "running" ? "running" : "idle",
      stale: true,
      message: "Source changed. Compile to refresh the PDF.",
    }));
    setSaveError(null);
    setSaveConflict(false);
    remoteSavePendingRef.current = true;
    saveBusyRef.current = false;
    setSaving(false);
    if (rebased.source === canonical) {
      try { window.sessionStorage.removeItem(recoveryKey(project)); } catch { /* best-effort */ }
    }
    void pushRemote("OpenBar: save paper", true);
  }, [project, pushRemote, resetPreview, writeRecoveryDraft]);

  const doSave = useCallback(async (text: string, signal?: AbortSignal) => {
    if (!sessionWritableRef.current) return false;
    if (isBackendUnavailable()) { writeRecoveryDraft(); return false; }
    const previousFailure = saveFailureRef.current;
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
      if (isBackendTransportError(error) || isBackendUnavailable()) {
        saveFailureRef.current = previousFailure;
        saveBusyRef.current = false;
        setSaving(false);
        writeRecoveryDraft();
        return false;
      }
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
  }, [isBackendUnavailable, persistOne, writeRecoveryDraft]);

  const reloadLatest = useCallback(async () => {
    const paper = await getBrowserEditablePaper(project);
    if (!paper) {
      setSaveError("Could not reload the paper.");
      return;
    }
    applyHydrated(paper);
  }, [applyHydrated, project]);

  const liveSource = useCallback(() => editorRef.current?.getLiveSource() ?? sourceRef.current, []);

  const canHydratePaper = () => !saving && !saveBusyRef.current && !todoRemovalBusyRef.current && !pendingSaveRef.current
    && !uploading && !saveErrorRef.current && !saveConflictRef.current && !recoveryDraft
    && (!remoteQueue.isBusy || (reviewingRemoteRef.current && !remoteQueue.isRunning))
    && liveSource() === savedSourceRef.current;
  const canAutoPull = () => sessionWritableRef.current && canHydratePaper() && !reviewingRemoteRef.current && !hydrationPendingRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]");
  const canAutoPush = () => sessionWritableRef.current && !saving && !saveBusyRef.current && !todoRemovalBusyRef.current && !pendingSaveRef.current
    && !uploading && !saveErrorRef.current && !saveConflictRef.current && !recoveryDraft
    && !reviewingRemoteRef.current && !applyingRemoteRef.current && !remoteOutOfSyncRef.current
    && !remoteQueue.isBusy && liveSource() === savedSourceRef.current;
  const setRemoteApplying = (applying: boolean) => {
    applyingRemoteRef.current = applying;
    if (applying) remoteOutOfSyncRef.current = true;
    setApplyingRemote(applying);
  };
  const requirePaperHydration = (message: string) => {
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
    requirePaperHydration(withPullStorageWarning("Git may have updated the project. Check the Git update before continuing."));
  };
  useEffect(() => {
    const operationId = readPendingBrowserPull(project);
    if (operationId) markPullUncertain({ operationId, persisted: true });
  }, [project]);
  const markForcePullUncertain = (reconcile: ForcePullReconciliation, pending: PendingForcePull) => {
    forceReconciliationRef.current = reconcile;
    forcePullRef.current = pending;
    setReconciliationPending(true);
    requirePaperHydration(withPullStorageWarning("Git may have updated the project. Check the Git update before continuing."));
  };
  useEffect(() => {
    const token = readPendingForcePull(project);
    if (token) markForcePullUncertain(() => finishForceRequest("pull", () => finishForceProjectSyncAction(project, token, "", "", true)), { token, persisted: true });
  }, [project]);
  const applyPulledPaper = async (pending?: PendingBrowserPull) => {
    if (pending) { directPullBarrierRef.current = pending.operationId; directPullPersistedRef.current = pending.persisted; }
    requirePaperHydration(withPullStorageWarning("Git updates were applied. Reload the editor to continue."));
    const paper = await getBrowserEditablePaper(project);
    if (!canHydratePaper()) throw new Error("Git updates arrived while this editor changed. Preserve your draft and reload the latest paper.");
    if (!paper) throw new Error("Git updates were pulled. Reload the paper to display the latest source.");
    applyHydrated(paper);
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
      await applyPulledPaper();
    }
    catch (error) { if (!isBackendTransportError(error) && !isBackendUnavailable()) setRemoteSaveError(withPullStorageWarning(error instanceof Error ? error.message : "Could not reload the paper. Try again.")); }
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
      await applyPulledPaper(result);
    } catch (error) {
      if (isBackendTransportError(error) || isBackendUnavailable()) return;
      setRemoteSaveState("error");
      const message = error instanceof Error ? error.message : "Could not pull Git updates.";
      quickPullErrorRef.current = pulled ? `Git updates were pulled, but the editor could not reload. ${message}`
        : hydrationPendingRef.current ? `Git may have updated the project. Reload the editor to check. ${message}` : message;
      setRemoteSaveError(withPullStorageWarning(quickPullErrorRef.current));
    } finally { setRemoteApplying(false); }
  };
  useGitAutoSync({
    project,
    isBusy: () => isBackendUnavailable() || !sessionWritable || checkingRemote || remoteQueue.isBusy || remoteQueue.editingRecently || saving || Boolean(todoRemovalBusyRef.current) || uploading || reviewingRemoteRef.current || applyingRemoteRef.current,
    canPull: canAutoPull,
    canPush: canAutoPush,
    push: () => pushRemote("OpenBar: resume paper synchronization"),
    check: () => refreshRemoteStatus(true, false),
    onApplying: setRemoteApplying,
    onApplied: applyPulledPaper,
    onPullUncertain: markPullUncertain,
    onError: (message) => { if (isBackendUnavailable()) return; setRemoteSaveState("error"); setRemoteSaveError(withPullStorageWarning(hydrationPendingRef.current ? `Reload the editor to confirm the saved project state. ${message}` : message)); },
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
      updateSource(text);
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
    remoteQueue.noteEdit();
    revisionRef.current += 1;
    setPreviewAnnotate(null);
    const live = editorRef.current?.getLiveSource();
    setLocalDirty(live === undefined || live !== savedSourceRef.current);
    applyPreviewChanges(changes, length);
    scheduleSave();
  }, [applyPreviewChanges, remoteQueue, scheduleSave]);

  useEffect(() => {
    if (sessionWritable && connectionState === "connected" && localDirty) scheduleSave();
  }, [connectionState, sessionWritable, localDirty, scheduleSave]);

  useEffect(() => {
    resetPreview(initialSource);
  }, [initialSource, resetPreview]);

  useEffect(() => {
    let active = true;
    const refreshCompileStatus = async () => {
      if (isBackendUnavailable()) return;
      if (compileStartingRef.current || (compileRef.current.state === "running" && !compileRef.current.observationDelayed)) return;
      const observation = captureCompileObservation();
      try {
        const status = await getBrowserPaperCompileStatus(project);
        if (active) applyObservedCompileStatus(observation, status);
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
  }, [applyObservedCompileStatus, captureCompileObservation, isBackendUnavailable, project]);

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
        if (parsed.source !== initialSource || (typeof parsed.queuedSource === "string" && parsed.queuedSource !== initialSource)) {
          const draft: RecoveryDraft = { source: parsed.source, baseHash: parsed.baseHash, savedAt: parsed.savedAt, ...(typeof parsed.queuedSource === "string" ? { queuedSource: parsed.queuedSource } : {}) };
          recoveryDraftRef.current = draft;
          setRecoveryDraft(draft);
        }
        else window.sessionStorage.removeItem(recoveryKey(project));
      }
    } catch {
      // Ignore malformed or unavailable recovery storage.
    }
  // Recovery is checked when opening a project. A router refresh can update
  // initialSource while the user is typing and their live draft is in storage.
  }, [project]);

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

  const applyPaperAppearance = useCallback((prefs: PaperAppearancePrefs) => {
    setEditorWidth(prefs.editorWidth);
    setPreviewFontScale(prefs.previewFontScale);
    setEditorFontScale(prefs.editorFontScale);
    setPreviewLineHeight(prefs.previewLineHeight);
    setPreviewFont(prefs.previewFont);
    setGlass(prefs.glass);
    setToolbarPosition(prefs.toolbarPosition);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(prefsKey(project));
      let prefs: EditorPrefs = {};
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prefs = parsed as EditorPrefs;
        } catch { /* Ignore malformed project preferences. */ }
        if (prefs.layout === "document" || prefs.layout === "pdf") {
          setLayout(prefs.layout);
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
        if (typeof prefs.lastSection === "string") lastHeadingKeyRef.current = prefs.lastSection;
      }
      const global = window.localStorage.getItem(PAPER_APPEARANCE_KEY);
      let appearance: PaperAppearancePrefs;
      try { appearance = normalizePaperAppearance(global ? JSON.parse(global) : prefs); }
      catch { appearance = normalizePaperAppearance(prefs); }
      applyPaperAppearance(appearance);
      if (!global) window.localStorage.setItem(PAPER_APPEARANCE_KEY, JSON.stringify(appearance));
    } catch {
      // ignore corrupt prefs
    }
    setPrefsReadyProject(project);
  }, [applyPaperAppearance, project]);

  useEffect(() => {
    const receiveAppearance = (event: StorageEvent) => {
      if (event.key !== PAPER_APPEARANCE_KEY || !event.newValue) return;
      try { applyPaperAppearance(normalizePaperAppearance(JSON.parse(event.newValue))); } catch { /* Ignore malformed preferences. */ }
    };
    window.addEventListener("storage", receiveAppearance);
    return () => window.removeEventListener("storage", receiveAppearance);
  }, [applyPaperAppearance]);

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
      splitLeftPct,
      splitTopPct,
      todoOpen,
      todoPanelHeight,
      lastSection: activeBookmark || lastHeadingKeyRef.current,
    })); } catch { /* Appearance remains usable with restricted browser storage. */ }
  }, [activeBookmark, layout, prefsReady, project, splitLeftPct, splitTopPct, todoOpen, todoPanelHeight]);

  useEffect(() => {
    if (!prefsReady) return;
    try { window.localStorage.setItem(PAPER_APPEARANCE_KEY, JSON.stringify({
      editorWidth, previewFontScale, editorFontScale, previewLineHeight, previewFont, glass, toolbarPosition,
    } satisfies PaperAppearancePrefs)); } catch { /* Appearance remains usable with restricted browser storage. */ }
  }, [editorFontScale, editorWidth, glass, prefsReady, previewFont, previewFontScale, previewLineHeight, toolbarPosition]);

  useEffect(() => () => {
    if (compileFeedbackTimerRef.current) window.clearTimeout(compileFeedbackTimerRef.current);
  }, []);
  const showCompileFinished = useCallback(() => {
    if (compileFeedbackTimerRef.current) window.clearTimeout(compileFeedbackTimerRef.current);
    setCompileFinished(true);
    compileFeedbackTimerRef.current = window.setTimeout(() => setCompileFinished(false), 2_500);
  }, []);
  const requestCompile = useCallback(async (signal?: AbortSignal) => {
    if (compileStartingRef.current) return null;
    compileStartingRef.current = true;
    const requestId = ++compileObservationRequestRef.current;
    let observation: CompileObservation | undefined;
    setCompileStarting(true);
    setCompileFinished(false);
    if (compileFeedbackTimerRef.current) window.clearTimeout(compileFeedbackTimerRef.current);
    try {
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      const live = editorRef.current?.getLiveSource() ?? sourceRef.current;
      const saved = await doSave(live, signal);
      if (!saved) {
        if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
        return null;
      }
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      observation = captureCompileObservation(requestId);
      const status = await requestBrowserPaperCompile(project, signal);
      if (signal?.aborted) throw new Error("Compilation cancelled.");
      const observed = applyObservedCompileStatus(observation, status);
      if (observed?.state === "success" && observed.stale !== true) showCompileFinished();
      return observed || { ...status, stale: true };
    } catch (error) {
      const cancelled = signal?.aborted || (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "cancelled");
      if (cancelled) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      if (isBackendTransportError(error) || isBackendUnavailable()) return null;
      const status: PaperCompileStatus = { state: "error", message: error instanceof Error ? error.message : "Could not compile PDF." };
      return applyObservedCompileStatus(observation || captureCompileObservation(requestId), status) || status;
    } finally {
      compileStartingRef.current = false;
      setCompileStarting(false);
    }
  }, [applyObservedCompileStatus, captureCompileObservation, doSave, isBackendUnavailable, project, showCompileFinished]);

  useEffect(() => {
    if (compile.state !== "running" || compile.observationDelayed) return;
    let cancelled = false;
    let delay = COMPILE_POLL_MS;
    let timer = 0;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (isBackendUnavailable()) { timer = window.setTimeout(tick, 4_000); return; }
      if (compileStartingRef.current) {
        timer = window.setTimeout(tick, delay);
        return;
      }
      const decision = compilePollDecision(Date.now() - started, delay);
      if (decision.kind === "observation-delayed") {
        setCompile((current) => markCompileObservationDelayed(current, decision.message));
        return;
      }
      const observation = captureCompileObservation();
      try {
        const status = await getBrowserPaperCompileStatus(project);
        if (cancelled) return;
        const observed = applyObservedCompileStatus(observation, status);
        if (observed?.state === "success" && observed.stale !== true) showCompileFinished();
        if (!observed || observed.state === "running") {
          delay = decision.delayMs;
          timer = window.setTimeout(tick, delay);
        }
      } catch {
        if (cancelled) return;
        if (observation.requestId !== compileObservationRequestRef.current) {
          timer = window.setTimeout(tick, delay);
          return;
        }
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
  }, [applyObservedCompileStatus, captureCompileObservation, compile.observationDelayed, compile.state, isBackendUnavailable, project, showCompileFinished]);

  useEffect(() => {
    if (connectionState === "reconnecting" || compileStarting || compile.state === "running" || saving || localDirty || source !== savedSource
      || saveError || saveConflict || recoveryDraft || hydrationPending || reconciliationPending || uploading
      || applyingRemote || reviewingRemote) return;
    if (compile.state === "success" && !compile.stale && compile.pdfAvailable !== false) return;

    // Wait until the saved paper has settled. Failed and unavailable builds
    // retry slowly, while a later edit starts a fresh quiet-period timer.
    const delay = compile.state === "error" || compile.state === "unavailable"
      ? AUTO_COMPILE_RETRY_MS
      : AUTO_COMPILE_IDLE_MS;
    let timer: number;
    const attempt = () => {
      if (isBackendUnavailable() || compileStartingRef.current || compileRef.current.state === "running"
        || saveBusyRef.current || pendingSaveRef.current || todoRemovalBusyRef.current
        || saveConflictRef.current || recoveryDraftRef.current || hydrationPendingRef.current
        || applyingRemoteRef.current || reviewingRemoteRef.current
        || (editorRef.current?.getLiveSource() ?? sourceRef.current) !== savedSourceRef.current) {
        timer = window.setTimeout(attempt, AUTO_COMPILE_IDLE_MS);
        return;
      }
      void requestCompile();
    };
    timer = window.setTimeout(attempt, delay);
    return () => window.clearTimeout(timer);
  }, [applyingRemote, compile.state, compile.stale, compile.pdfAvailable, compileStarting, connectionState, hydrationPending, isBackendUnavailable, localDirty,
    reconciliationPending, recoveryDraft, requestCompile, reviewingRemote, saveConflict, saveError, savedSource, saving, source, uploading]);

  const surround = useCallback((open: string, close: string, placeholder = "") => {
    editorRef.current?.surround(open, close, placeholder);
  }, []);

  const insertBlock = useCallback((block: string) => {
    editorRef.current?.insertAtCursor(block, true);
  }, []);

  const insertInline = useCallback((text: string) => {
    editorRef.current?.insertAtCursor(text, false);
  }, []);

  const restoreCitationCursor = useCallback((selection: CitationSelection | null, keys?: string[]) => {
    const deadline = performance.now() + 2_000;
    const restore = () => {
      const editor = editorRef.current;
      const range = selection && resolveCitationSelection(liveSource(), selection);
      if (!editor || !range || !sessionWritableRef.current) {
        setAgentNotice("Reference added. Select its position in the source, then choose the citation.");
        return;
      }
      const citation = keys?.length ? `\\cite{${keys.join(",")}}` : "";
      // Address the captured range directly. Focus and layout measurements can
      // settle after a modal closes and a saved include graph mounts.
      if (citation && editor.applyVirtualChange(range.from, range.to, citation)) {
        editor.setSelection(range.from + citation.length, range.from + citation.length);
        return;
      }
      if (!citation) {
        editor.setSelection(range.from, range.to);
        const current = editor.getVirtualSelection();
        if (current?.from === range.from && current.to === range.to) return;
      }
      if (performance.now() < deadline) window.requestAnimationFrame(restore);
      else setAgentNotice("Reference added. Select its position in the source, then choose the citation.");
    };
    window.requestAnimationFrame(restore);
  }, [liveSource]);

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

  const alignPdfToEditor = useCallback((request: number, current: string, offset: number, artifact: string) => {
    void (async () => {
      const sections = bundleSections(current);
      const section = sections.find((item) => offset >= item.from && offset < item.to);
      const candidates = [...new Set([offset, section?.from].filter((value): value is number => value !== undefined))];
      const parts = splitBundleSource(current);
      for (const candidate of candidates) {
        if (request !== pdfNavigationRequest.current) return;
        const part = parts.find((item) => candidate >= item.bodyFrom && candidate <= item.bodyTo);
        if (!part) continue;
        const prefix = current.slice(part.bodyFrom, candidate);
        const line = prefix.split("\n").length;
        const column = prefix.length - prefix.lastIndexOf("\n") - 1;
        try {
          const result = await synctexViewAction(project, part.filePath, line, column, artifact);
          if (request !== pdfNavigationRequest.current) return;
          if (result.ok) { setPdfSourceTarget(result.view); return; }
        } catch {
          return;
        }
      }
    })();
  }, [project]);

  const openPdfAtEditor = useCallback(() => {
    const request = ++pdfNavigationRequest.current;
    const scroller = editorRef.current?.getScroller();
    const current = liveSource();
    const offset = scroller ? visibleEditorOffset(scroller) : null;
    const range = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    pdfScrollSyncRef.current.progress = scroller && range > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / range)) : 0;
    pdfScrollSyncRef.current.follow?.();
    pendingPdfNavigationRef.current = null;
    setPdfSourceTarget(null);
    setLayout("pdf");
    if (offset == null) return;
    const artifact = compileRef.current.lastSuccessfulArtifact?.artifactId || compileRef.current.artifactId;
    if (artifact) alignPdfToEditor(request, current, offset, artifact);
    else pendingPdfNavigationRef.current = { request, source: current, offset };
  }, [alignPdfToEditor, liveSource]);

  useEffect(() => {
    const pending = pendingPdfNavigationRef.current;
    const artifact = compile.lastSuccessfulArtifact?.artifactId || compile.artifactId;
    if (layout !== "pdf" || !pending || !artifact || pending.request !== pdfNavigationRequest.current) return;
    pendingPdfNavigationRef.current = null;
    alignPdfToEditor(pending.request, pending.source, pending.offset, artifact);
  }, [alignPdfToEditor, compile.artifactId, compile.lastSuccessfulArtifact?.artifactId, layout]);

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
    if (!sessionWritableRef.current) throw Object.assign(new Error("This tab is viewing. Start editing here to change the paper."), { code: "write_session_required" });
    if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    remoteQueue.noteEdit();
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

    // The server-side removal writes the same bundle as autosave. Hold the
    // save queue until the removal and its new hash reach the live editor.
    const priorSaves = saveQueueRef.current;
    todoRemovalBusyRef.current += 1;
    let releaseRemoval!: () => void;
    const removalBarrier = new Promise<void>((resolve) => { releaseRemoval = resolve; });
    saveQueueRef.current = priorSaves.then(() => removalBarrier);
    let editsDuringRemoval = false;
    let removalSnapshot: { source: string; revision: number };
    try {
      await priorSaves;
      if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      current = liveSource();
      if (current !== savedSourceRef.current) {
        try {
          await persistOne(current, signal);
        } catch (error) {
          saveBusyRef.current = false;
          setSaving(false);
          const failure = saveFailureRef.current;
          const code = failure?.code || (error && typeof error === "object" && "code" in error ? String(error.code) : "save_failed");
          const message = failure?.message || (error instanceof Error ? error.message : "Could not save the live paper.");
          if (code === "stale_disk_state") saveConflictRef.current = true;
          if (code !== "cancelled") setSaveError(message);
          throw Object.assign(new Error(message), { code });
        }
      }
      // Persist may have run while the user continued typing. The action must
      // address the saved version and keep later typing in the live buffer.
      const operationSource = savedSourceRef.current;
      const operationRevision = revisionRef.current;
      const operationTodo = collectEditorTodos(operationSource).find((item) => item.id === todoId);
      if (!operationTodo) throw Object.assign(new Error(`stale_selection: TODO "${todoId}" moved during save.`), { code: "stale_selection" });
      const result = await removePaperTodoAction(project, todoId, bundleHashRef.current);
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
      bundleHashRef.current = result.value.bundleHash;
      setBundleHash(result.value.bundleHash);

      const sourceAfterRemoval = removeSourceRange(operationSource, operationTodo.from, operationTodo.to);
      savedSourceRef.current = sourceAfterRemoval;
      setSavedSource(sourceAfterRemoval);
      // Autosaves queued while the action was in flight must carry the same
      // deletion, or they would restore the just-removed TODO on disk.
      const pending = pendingSaveRef.current;
      if (pending) {
        const pendingTodo = collectEditorTodos(pending.text).find((item) => item.id === todoId);
        if (pendingTodo) pendingSaveRef.current = { ...pending, text: removeSourceRange(pending.text, pendingTodo.from, pendingTodo.to) };
      }
      const liveBeforeRemoval = liveSource();
      const liveTodo = collectEditorTodos(liveBeforeRemoval).find((item) => item.id === todoId);
      let liveAfterRemoval = liveBeforeRemoval;
      let editorRemovalApplied = false;
      if (liveTodo) {
        try {
          const applied = editorRef.current?.applyVirtualChange(liveTodo.from, liveTodo.to, "");
          liveAfterRemoval = requireAppliedRemovalSource(
            applied,
            editorRef.current?.getLiveSource(),
            todoId,
            (source, id) => collectEditorTodos(source).some((item) => item.id === id),
          );
        } catch (error) {
          // The server already removed the TODO. Preserve the live draft and
          // pause autosave until the user reconciles that saved change.
          pendingSaveRef.current = null;
          saveConflictRef.current = true;
          setSaveConflict(true);
          setLocalDirty(true);
          writeRecoveryDraft();
          throw error;
        }
        editorRemovalApplied = true;
      }
      sourceRef.current = liveAfterRemoval;
      updateSource(liveAfterRemoval);
      if (!editorRemovalApplied) resetPreview(liveAfterRemoval);
      setLocalDirty(liveAfterRemoval !== sourceAfterRemoval);
      editsDuringRemoval = hasLiveEditorChanged(
        { source: operationSource, revision: operationRevision },
        { source: liveBeforeRemoval, revision: revisionRef.current },
      ) || liveAfterRemoval !== sourceAfterRemoval;
      removalSnapshot = { source: liveAfterRemoval, revision: revisionRef.current };
    } finally {
      todoRemovalBusyRef.current -= 1;
      releaseRemoval();
    }
    remoteSavePendingRef.current = true;
    void pushRemote("OpenBar: remove paper TODO", true);

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
  }, [applyHydrated, liveSource, persistOne, project, pushRemote, remoteQueue, resetPreview, saveNow, writeRecoveryDraft]);

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
    if (!sessionWritableRef.current) return false;
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
    if (!sessionWritableRef.current) throw Object.assign(new Error("This tab is viewing. Start editing here to change the paper."), { code: "write_session_required" });
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

  const reconcilePaperFiles = useCallback((paper: HydratedPaper | null, baseline: string) => {
    if (!paper || paper.bundle.bundleHash === bundleHashRef.current) return;
    const rebased = rebaseBundleSource(baseline, liveSource(), paper.bundle.source);
    const pending = pendingSaveRef.current;
    const queued = pending ? rebaseBundleSource(baseline, pending.text, paper.bundle.source) : null;
    if (rebased.ok && (!queued || queued.ok)) {
      if (pending && queued?.ok) pendingSaveRef.current = { ...pending, text: queued.source };
      flushSync(() => applyHydrated(paper, rebased.source));
    } else {
      pendingSaveRef.current = null;
      saveConflictRef.current = true;
      setSaveConflict(true);
      setSaveError("Files changed while this draft was being edited. Copy the draft before loading the saved paper.");
      writeRecoveryDraft();
    }
  }, [applyHydrated, liveSource, writeRecoveryDraft]);

  useEffect(() => registerProjectFileEditor(project, async (operation, writing) => {
    if (liveSource() !== savedSourceRef.current && !await saveNow(liveSource())) return failResult("save_failed", "Save the open paper draft before accessing project files.");
    const job = saveQueueRef.current.then(async () => {
      const baseline = savedSourceRef.current;
      const result = await operation();
      if (result.ok && writing) {
        try {
        const [paper, references] = await Promise.all([getBrowserEditablePaper(project), getBibliographyEditorAction(project)]);
        if (!paper) throw new Error("The saved paper is unavailable.");
        reconcilePaperFiles(paper, baseline);
        flushSync(() => {
          setBibliography(references.entries);
          setBibliographyRaw(references.raw);
          setBibliographyFiles(references.paths);
        });
        resetPreview(liveSource());
        setCompile(current => transitionCompileStatus(current, { state: current.state === "running" ? "running" : "idle", stale: true }));
        remoteQueue.noteEdit();
        remoteSavePendingRef.current = true;
        void pushRemote("OpenBar: edit project files", true);
        } catch (error) {
          const message = `Files saved. Reload the editor to refresh them. ${error instanceof Error ? error.message : String(error)}`;
          writeRecoveryDraft();
          pendingSaveRef.current = null;
          requirePaperHydration(message);
          return { ...result, warnings: [...(result.warnings || []), { severity: "warning" as const, code: "editor_refresh_pending", message }] };
        }
      }
      return result;
    });
    saveQueueRef.current = job.then(() => undefined, () => undefined);
    return job;
  }), [liveSource, project, pushRemote, reconcilePaperFiles, remoteQueue, resetPreview, saveNow, writeRecoveryDraft]);

  const openBibliography = useCallback(async () => {
    try {
      const references = await getBibliographyEditorAction(project);
      setBibliographyFiles(references.paths);
      setBibliographyOpen(true);
    } catch (error) { setAgentNotice(error instanceof Error ? error.message : "References are unavailable."); }
  }, [project]);

  const importReference = useCallback(async (bibtex: string, expectedHash: string, signal?: AbortSignal): Promise<OperationResult<BibliographyImportResult>> => {
    if (!sessionWritableRef.current) return failResult("write_session_required", "Resume editing in this tab to add a reference.");
    if (remoteOutOfSyncRef.current) return failResult("remote_conflict", "Synchronize Git to resume editing.");
    if (liveSource() !== savedSourceRef.current && !await saveNow(liveSource(), signal)) {
      return failResult(saveFailureRef.current?.code || "save_failed", saveFailureRef.current?.message || "Save this paper before adding a reference.");
    }
    // Serialize with paper saves because a first import can repair the managed
    // bibliography include. Rebase that saved change into the mounted draft.
    const job = saveQueueRef.current.then(async () => {
      if (signal?.aborted) return failResult("cancelled", "Operation cancelled.");
      const baseline = savedSourceRef.current;
      const result = await importBibtexAction(project, bibtex, expectedHash);
      if (!result.ok) return result;
      const paper = result.value.paper;
      flushSync(() => {
        setBibliography(result.value.entries);
        setBibliographyRaw(result.value.raw);
      });
      reconcilePaperFiles(paper, baseline);
      resetPreview(liveSource());
      setCompile(current => transitionCompileStatus(current, {
        state: current.state === "running" ? "running" : "idle",
        stale: true,
        message: "References changed. Compile to refresh the PDF.",
      }));
      remoteQueue.noteEdit();
      remoteSavePendingRef.current = true;
      void pushRemote("OpenBar: add bibliography reference", true);
      return result;
    });
    saveQueueRef.current = job.then(() => undefined, () => undefined);
    return job;
  }, [liveSource, project, pushRemote, reconcilePaperFiles, remoteQueue, resetPreview, saveNow]);

  usePaperWebMcp({
    sharedActions: sharedWebMcpActions,
    importBibtex: importReference,
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
      if (!sessionWritableRef.current) throw Object.assign(new Error("This tab is viewing. Start editing here to change the paper."), { code: "write_session_required" });
      if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      if (remoteOutOfSyncRef.current) throw Object.assign(new Error("Synchronize Git to resume editing."), { code: "remote_conflict" });
      const before = liveSource();
      const moved = relocateTodoInBundle(before, todoId, sectionId);
      if (!moved.todoFound || moved.error || !moved.targetFound) {
        throw Object.assign(new Error(moved.error || `Could not relocate TODO "${todoId}".`), {
          code: !moved.todoFound ? "unknown_todo" : !moved.targetFound ? "unknown_section" : "invalid_tex",
        });
      }
      const editor = editorRef.current;
      if (editor && !editor.applyVirtualChange(0, before.length, moved.source)) {
        throw Object.assign(new Error("The live editor could not apply the relocated TODO."), { code: "stale_live_state" });
      }
      sourceRef.current = moved.source;
      if (!editor) revisionRef.current += 1;
      flushSync(() => updateSource(moved.source));
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
  const pageCountArtifact = compile.lastSuccessfulArtifact?.artifactId || compile.artifactId;
  const pageCountPdfSrc = compile.pdfAvailable !== false && pageCountArtifact
    ? `/api/p/${encodeURIComponent(project)}/paper/pdf?artifact=${encodeURIComponent(pageCountArtifact)}` : undefined;
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
    "--paper-controls-space": `${!narrow && toolbarPosition === "bottom" ? 0 : controlsHeight + 12}px`,
    "--paper-bottom-controls-space": `${!narrow && toolbarPosition === "bottom" ? controlsHeight + 12 : 0}px`,
    "--paper-format-height": `${formatHeight}px`,
    "--p-glass-sm": `rgb(var(--surface) / ${0.92 - glass * 0.0037})`,
    "--p-glass-md": `rgb(var(--surface) / ${0.92 - glass * 0.0037})`,
    "--p-glass-surface": `rgb(var(--surface) / ${0.92 - glass * 0.0037})`,
  } as CSSProperties;

  const compileIssue = compile.state === "error" || compile.state === "unavailable"
    ? compile.diagnostics?.[0] || compile.message || "PDF compilation is unavailable." : null;
  const editorIssues: EditorIssue[] = [
    ...(saveConflict || saveError || todoRemovalError ? [{ id: "save", severity: saveConflict ? "conflict" as const : "error" as const, title: saveConflict ? "Saved file conflict" : "Saving needs attention", message: todoRemovalError?.message || saveError || "The saved file changed." }] : []),
    ...(remoteSaveError || hydrationPending || reviewingRemote || remoteOutOfSync ? [{ id: "git", severity: remoteOutOfSync || hydrationPending || remoteSaveState === "blocked" ? "conflict" as const : "error" as const, title: "Git synchronization", message: remoteSaveError || "Git review is in progress." }] : []),
    ...(compileIssue ? [{ id: "compile", severity: "compile" as const, title: "PDF compilation", message: compileIssue }] : []),
    ...(accessError || (!sessionWritable && localDirty) ? [{ id: "access", severity: "error" as const, title: "Editing access", message: accessMessage }] : []),
    ...(uploadError ? [{ id: "upload", severity: "error" as const, title: "Figure upload", message: uploadError }] : []),
    ...(connectionState === "reconnecting" ? [{ id: "connection", severity: "connection" as const, title: "Connection to OpenBar", message: "Reconnecting…" }] : []),
  ];
  const primaryIssue = selectEditorIssue(editorIssues);
  const relatedIssues = editorIssues.filter(issue => issue.id !== primaryIssue?.id);
  const showCompileStatus = !primaryIssue || primaryIssue.id === "compile";
  const getPaperDiagnostics = () => ({
    kind: "paper", project, issues: editorIssues, bundleHash: bundleHashRef.current,
    revision: revisionRef.current, sourceLength: liveSource().length, savedSourceLength: savedSourceRef.current.length,
    manuscript: { localSource: liveSource(), lastAcknowledgedSource: savedSourceRef.current, files: sourceSegmentsRef.current, sectionHashes: Object.fromEntries(sectionHashesRef.current) },
    dirty: liveSource() !== savedSourceRef.current, saving, saveConflict,
    saveFailure: saveFailureRef.current, remoteOutOfSync, remoteSaveState, remoteSaveError,
    compile: compileRef.current,
  });

  return (
    <div className={cn("relative flex h-full w-full flex-col gap-2", paperStyles.workspace, widthClass)} data-toolbar-position={toolbarPosition}>
      <div className={paperStyles.notices}>
      {agentNotice && (
        <div className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1 text-[11px] text-muted">
          {agentNotice}
        </div>
      )}
      {recoveryDraft && (
        <div className={cn("shrink-0 rounded-lg border border-accent/40 px-3 py-2 text-xs", paperStyles.recoveryNotice)} role="status">
          <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-ink">
            A browser recovery draft from {new Date(recoveryDraft.savedAt).toLocaleString()} is available.
            {recoveryDraft.baseHash !== bundleHash && <span className="text-warn"> It was based on an older source revision.</span>}
            {recoveryDraft.queuedSource !== undefined && <span> Two versions are available to view and copy before reloading.</span>}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {recoveryDraft.queuedSource === undefined && <button
              type="button"
              className="p-button p-button-primary btn-primary px-2 py-0.5 text-[11px]"
              onClick={() => {
                const current = liveSource();
                const draft = recoveryDraft;
                flushSync(() => setRecoveryDraft(null));
                if (editorRef.current?.applyVirtualChange(0, current.length, draft.source)) {
                  clearRecoveryDraft();
                } else { recoveryDraftRef.current = draft; setRecoveryDraft(draft); }
              }}
            >
              Restore draft
            </button>}
            <button type="button" className="p-button p-button-borderless btn-ghost px-2 py-0.5 text-[11px]" onClick={clearRecoveryDraft}>Keep saved source</button>
          </div>
          </div>
          {recoveryDraft.queuedSource !== undefined && <div className="mt-2 grid gap-2">
            <details><summary>View editor draft</summary><textarea aria-label="Editor recovery draft" readOnly value={recoveryDraft.source} rows={8} className="w-full font-mono" /></details>
            <details><summary>View queued draft</summary><textarea aria-label="Queued recovery draft" readOnly value={recoveryDraft.queuedSource} rows={8} className="w-full font-mono" /></details>
          </div>}
        </div>
      )}
      {bundleDiagnostics.length > 0 && (
        <div className={cn("shrink-0 rounded-lg border border-warn/30 px-3 py-1.5 text-xs text-ink", paperStyles.warningNotice)}>
          Include graph: {bundleDiagnostics.map((item) => item.message).join(", ")}
        </div>
      )}
      {workerError && (
        <div className={cn("flex shrink-0 items-center justify-between gap-3 rounded-lg border border-warn/30 px-3 py-1.5 text-xs text-ink", paperStyles.warningNotice)} role="status">
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
        <div className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 px-3 py-1.5 text-xs text-ink", paperStyles.warningNotice)}>
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

      </div>
      <div className={paperStyles.readingFrame} style={readingFrameStyle} data-toolbar-position={toolbarPosition}>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" inert={phone && todoOpen}>
        <Group
          groupRef={splitGroupRef}
          orientation={narrow ? "vertical" : "horizontal"}
          resizeTargetMinimumSize={{ coarse: 28, fine: 10 }}
          defaultLayout={{ reader: narrow ? splitTopPct : splitLeftPct, source: 100 - (narrow ? splitTopPct : splitLeftPct) }}
          onLayoutChanged={(next, meta) => { if (meta.isUserInteraction) (narrow ? setSplitTopPct : setSplitLeftPct)(next.reader!); }}
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-surface"
        >
          <Panel id="reader" minSize={`${SPLIT_MIN}%`} maxSize={`${SPLIT_MAX}%`} className={cn("relative min-h-0 min-w-0 overflow-hidden bg-surface", layout === "pdf" && paperStyles.pdfReaderPane)}>
            <div ref={controlsDockRef} className={paperStyles.toolbarDock}>
              <div id="paper-reading-controls" className={cn("p-glass-sm", paperStyles.toolbar)}>
                <div className={paperStyles.toolbarSwitch}>
                  <ToolbarSeg title="Document" active={layout === "document"} onClick={() => { claimScrollSource("editor"); setLayout("document"); }}>
                    <Eye size={15} /><span className={paperStyles.viewLabel}>Document</span>
                  </ToolbarSeg>
                  <ToolbarSeg
                    title="PDF"
                    active={layout === "pdf"}
                    onClick={() => {
                      openPdfAtEditor();
                      if (compile.state === "idle") void requestCompile();
                    }}
                  >
                    <FileText size={15} /><span className={paperStyles.viewLabel}>PDF</span>
                  </ToolbarSeg>
                </div>

                <PaperStatusControl
                  primaryIssue={primaryIssue}
                  saved={isSaved} saving={saving || uploading}
                  conflict={saveConflict}
                  remote={remoteSaveState === "saved" ? "synced" : remoteSaveState === "saving" ? "syncing" : remoteSaveState === "local" ? "pending" : remoteSaveState === "unverified" ? "local" : remoteSaveState === "error" ? "failed" : remoteSaveState}
                  gitDescription={remoteSaveState === "saved" ? "Pushed to Git" : remoteSaveState === "unconfigured" ? "Git is not connected" : remoteSaveState === "saving" ? "Syncing to Git" : remoteSaveState === "checking" ? "Checking Git status" : remoteSaveState === "unverified" ? "Check Git to confirm remote synchronization" : "Git sync pending"}
                  gitIssue={primaryIssue?.id === "git" ? primaryIssue.message : null}
                  localIssue={primaryIssue?.id === "save" ? primaryIssue.message : null}
                  pdfCurrent={pdfCurrent} compiling={showCompileStatus && (compileStarting || compile.state === "running")}
                  compileError={primaryIssue?.id === "compile" ? compileIssue : null}
                  compileDelayed={showCompileStatus && compile.state === "running" && Boolean(compile.observationDelayed)}
                  onResumeCompile={() => setCompile((current) => resumeCompilePolling(current))}
                  onCompile={() => { void requestCompile(); }}
                  onGitIssue={() => setGitDetailsOpenRequest((current) => current + 1)}
                  onLocalIssue={() => setSaveDetailsOpenRequest((current) => current + 1)}
                  onConnectionIssue={() => setConnectionDetailsOpenRequest(value => value + 1)}
                />
                <span className="sr-only" role="status">{showCompileStatus ? compileStarting || compile.state === "running" ? "Compiling PDF" : compileFinished ? "PDF compiled" : "" : ""}</span>
                <div className={paperStyles.metricsGroup}>
                  <div className={paperStyles.pageCountSlot}>
                    <PaperMetrics wordCount={wordCount} pageBudget={compile.pageBudget} pdfSrc={pageCountPdfSrc} compiling={showCompileStatus && (compileStarting || compile.state === "running")} stale={compile.stale || !isSaved || (pdfVisible && !pdfCurrent)} compileError={primaryIssue?.id === "compile" ? compile.message : undefined} onMeasure={connectionState === "connected" ? () => { void requestCompile(); } : undefined} />
                  </div>
                </div>

                <div className={paperStyles.toolbarActions}>
                  <div className={paperStyles.appearanceAction}>
                  <PaperAppearance
                    readerFontScale={previewFontScale}
                    editorFontScale={editorFontScale}
                    lineHeight={previewLineHeight}
                    font={previewFont}
                    width={editorWidth}
                    glass={glass}
                    toolbarPosition={toolbarPosition}
                    onReaderFontScaleChange={setPreviewFontScale}
                    onEditorFontScaleChange={setEditorFontScale}
                    onLineHeightChange={setPreviewLineHeight}
                    onFontChange={setPreviewFont}
                    onWidthChange={setEditorWidth}
                    onGlassChange={setGlass}
                    onToolbarPositionChange={setToolbarPosition}
                    onReset={() => {
                      setPreviewFontScale(DEFAULT_PREVIEW_FONT_SCALE);
                      setEditorFontScale(DEFAULT_EDITOR_FONT_SCALE);
                      setPreviewLineHeight(DEFAULT_PREVIEW_LINE_HEIGHT);
                      setPreviewFont(DEFAULT_PREVIEW_FONT);
                      setGlass(40);
                      setToolbarPosition("top");
                      setEditorWidth("wide");
                    }}
                  />
                  </div>

                  <FastTooltip label={todoOpen ? "Hide Open items" : "Show Open items"}>
                  <button
                    type="button"
                    ref={todoTriggerRef}
                    onClick={() => setTodoOpen((open) => !open)}
                    className="p-button p-button-glass ob-glass-button"
                    aria-label={`Todos ${todos.filter((todo) => !todo.completed).length}`}
                    aria-pressed={todoOpen}
                    aria-expanded={todoOpen}
                    aria-controls="paper-todos"
                  >
                    <ListChecks size={15} />
                    <span className="font-medium">{todos.filter((todo) => !todo.completed).length}</span>
                  </button>
                  </FastTooltip>
                </div>
              </div>
            </div>

            {layout === "document" && (
              <div className={paperStyles.documentLayout}>
              <PaperOutlineRail bookmarks={bookmarks} activeSlug={activeBookmark} onJump={jumpToSection} previewRef={previewRef} />
              <div
                ref={previewRef}
                data-ob-scroll="paper-preview"
                onWheelCapture={() => claimScrollSource("preview")}
                onTouchStartCapture={() => claimScrollSource("preview")}
                onPointerDownCapture={() => claimScrollSource("preview")}
                onKeyDownCapture={() => claimScrollSource("preview")}
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
                  {!previewResult && <div role="status" className={paperStyles.loading}>
                    <span>{workerError ? "Preview unavailable" : previewProgress}</span>
                    {!workerError && <span role="progressbar" aria-label="Preparing document" className={paperStyles.loadingTrack} />}
                  </div>}
                  <TexPreview project={project} blocks={previewResult?.blocks || []} bibliography={bibliography} onNavigate={() => claimScrollSource("preview")}
                    todos={todos} todoDisabled={!sessionWritable || remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft)}
                    onToggleTodo={async (todoId, completed) => {
                      const todo = collectEditorTodos(liveSource()).find(item => item.id === todoId);
                      if (!todo) { setSaveError("This TODO changed. Refresh the paper to continue."); return false; }
                      try { return await patchTodo(todo, { completed }); }
                      catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save the TODO."); return false; }
                    }}
                    onShowSource={(tex, from, to) => {
                      const current = liveSource();
                      const range = from !== undefined && to !== undefined ? { from, to } : undefined;
                      const found = locatePreviewSnippet(current, tex, from || 0, range);
                      const target = found?.from ?? from;
                      if (target === undefined) return;
                      const lineEnd = current.indexOf("\n", target);
                      const highlightEnd = found?.to ?? (lineEnd > target ? lineEnd : Math.min(target + 1, current.length));
                      if (scrollSyncFrameRef.current != null) window.cancelAnimationFrame(scrollSyncFrameRef.current);
                      scrollSyncFrameRef.current = null;
                      if (sourceRevealFrameRef.current != null) window.cancelAnimationFrame(sourceRevealFrameRef.current);
                      if (scrollSettleTimerRef.current != null) window.clearTimeout(scrollSettleTimerRef.current);
                      const generation = ++sourceRevealGenerationRef.current;
                      sourceRevealInProgressRef.current = true;
                      sourceRevealAwaitingMeasureRef.current = true;
                      activeScrollSourceRef.current = "jump";
                      sourceRevealFrameRef.current = requestAnimationFrame(() => {
                        sourceRevealFrameRef.current = null;
                        if (sourceRevealGenerationRef.current !== generation) return;
                        const editor = editorRef.current;
                        if (!editor) { sourceRevealAwaitingMeasureRef.current = false; settleSourceReveal(); return; }
                        scrollSettleTimerRef.current = window.setTimeout(() => {
                          if (sourceRevealGenerationRef.current !== generation) return;
                          sourceRevealGenerationRef.current += 1;
                          sourceRevealAwaitingMeasureRef.current = false;
                          sourceRevealInProgressRef.current = false;
                          if (activeScrollSourceRef.current === "jump") activeScrollSourceRef.current = null;
                          scrollSettleTimerRef.current = null;
                        }, 2000);
                        editor.revealRange(target, highlightEnd, {
                          isCurrent: () => sourceRevealGenerationRef.current === generation,
                          onDone: () => {
                            if (sourceRevealGenerationRef.current !== generation) return;
                            sourceRevealAwaitingMeasureRef.current = false;
                            settleSourceReveal();
                          },
                        });
                      });
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
              <div
                className={paperStyles.pdfPane}
                style={layout === "pdf" ? undefined : { visibility: "hidden" }}
                aria-hidden={layout !== "pdf"}
                inert={layout !== "pdf"}
              >
                <PdfPreview
                  project={project}
                  compile={{ ...compile, stale: compile.stale || !isSaved }}
                  suppressStatus={!showCompileStatus}
                  sourceTarget={layout === "pdf" ? pdfSourceTarget : null}
                  scrollSync={layout === "pdf" ? pdfScrollSyncRef.current : undefined}
                  onScrollProgress={handlePdfScroll}
                  onScrollStart={() => claimScrollSource("pdf")}
                  onJumpToSource={jumpToSourceLine}
                />
              </div>
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
            <div className={cn("relative min-h-0 flex-1", paperStyles.sourcePane)}>
            {!sessionWritable && localDirty && <EditorNotice suppressed={primaryIssue?.id !== "access"} relatedIssues={relatedIssues} diagnosticContext={getPaperDiagnostics} project={project} title="Editing access changed" label="Editing paused, draft preserved" message="Your unsaved manuscript remains in this tab. Copy it before refreshing." paused>
              <button type="button" className="p-button p-button-default btn-outline" onClick={() => { void copyText(liveSource()).then(() => setConflictCopyStatus("copied"), () => setConflictCopyStatus("failed")); }}>Copy local edits</button>
              <span role="status">{conflictCopyStatus === "copied" ? "Local manuscript copied." : conflictCopyStatus === "failed" ? "Select and copy the manuscript below." : ""}</span>
              {conflictCopyStatus === "failed" && <textarea aria-label="Local manuscript for copying" className="w-full font-mono" readOnly value={liveSource()} rows={5} onFocus={event => event.currentTarget.select()} />}
            </EditorNotice>}
            {(saveConflict || saveError || todoRemovalError) && <EditorNotice suppressed={primaryIssue?.id !== "save"} relatedIssues={relatedIssues} diagnosticContext={getPaperDiagnostics} project={project} title={saveConflict ? "Saved file conflict" : todoRemovalError ? todoRemovalError.retry === "save" ? "Saving TODO removal needs attention" : "TODO removal needs attention" : "Saving needs attention"} label={saveConflict ? "Editing paused, saved file changed" : todoRemovalError?.retry === "remove" ? "TODO removal needs attention" : "Save needs attention"} message={saveConflict ? "Your edits remain in the editor. Copy them for safekeeping. Retry save checks the saved file again. Reload replaces the editor text with the saved file." : todoRemovalError?.message || saveError || "Saving needs attention."} paused={saveConflict} openRequest={saveDetailsOpenRequest}
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
              {saveConflict && <>
                <button type="button" className="p-button p-button-default btn-outline" onClick={() => {
                  void copyText(liveSource()).then(() => setConflictCopyStatus("copied"), () => setConflictCopyStatus("failed"));
                }}>Copy local edits</button>
                {liveSource() !== savedSourceRef.current && saveFailureRef.current?.code === "stale_disk_state" && Boolean(saveFailureRef.current.currentHash) &&
                  <button type="button" className="p-button p-button-default btn-outline" disabled={saving} onClick={() => { void saveNow(liveSource()); }}>Retry save</button>}
                <span role="status">{conflictCopyStatus === "copied" ? "Local manuscript copied." : conflictCopyStatus === "failed" ? "Clipboard unavailable. Select and copy the manuscript below." : ""}</span>
                {conflictCopyStatus === "failed" && <textarea aria-label="Local manuscript for copying" className="w-full font-mono" readOnly value={liveSource()} rows={5} onFocus={event => event.currentTarget.select()} />}
              </>}
              <button type="button" className="p-button p-button-default btn-outline" onClick={() => {
                if (saveConflict) void reloadLatest();
                else if (todoRemovalError?.retry === "remove") void resolveTodo(todoRemovalError.todo);
                else void doSave(liveSource()).then(saved => { if (saved) setTodoRemovalError(null); });
              }}>{saveConflict ? "Reload saved file" : todoRemovalError?.retry === "remove" ? "Retry removal" : "Retry save"}</button>
              {todoRemovalError && <button type="button" className="p-button p-button-borderless btn-ghost" onClick={() => setTodoRemovalError(null)}>Dismiss</button>}
            </EditorNotice>}
            {uploadError && <EditorNotice project={project} title="Figure upload" label="Figure upload needs attention" message={uploadError} suppressed={primaryIssue?.id !== "upload"} relatedIssues={relatedIssues} diagnosticContext={getPaperDiagnostics}>
              <button type="button" onClick={() => setUploadError(null)}>Dismiss</button>
            </EditorNotice>}
            <div
              className={cn("ob-editor-container overflow-hidden", paperStyles.sourceStack)}
              style={{ position: "absolute", inset: 0, ...editorStyle }}
              onWheelCapture={() => claimScrollSource("editor")}
              onTouchStartCapture={() => claimScrollSource("editor")}
              onPointerDownCapture={() => { claimScrollSource("editor"); if (remoteOutOfSync) setGitAttention(true); }}
              onDoubleClickCapture={(event) => nudgeRestoreEditing(event.target)}
              onKeyDownCapture={(event) => {
                claimScrollSource("editor");
                if (!event.metaKey && !event.ctrlKey && (event.key.length === 1 || ["Backspace", "Delete", "Enter", "Process"].includes(event.key))) nudgeRestoreEditing(event.target);
                if (!sessionWritable || remoteOutOfSync || applyingRemote || saveConflict) return;
                if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
                handlePaperAddShortcut(event.nativeEvent, { comment: addComment, todo: addTodo });
              }}
            >
            <NestedBundleEditor
              project={project}
              rootFile={initialBundle.rootFile}
              segments={sourceSegmentsRef.current}
              manualScrollMeasurement={narrow || coarsePointer}
              readOnly={!sessionWritable || remoteOutOfSync || applyingRemote || saveConflict || Boolean(recoveryDraft)}
              ref={editorRef}
              value={source}
              valueRevision={sourceSnapshot.revision}
              currentRevision={currentSourceRevision}
              citationKeys={(bibliography || []).map(entry => entry.key)}
              onDocChanges={onDocChanges}
              onScroll={handleEditorScroll}
              onReadyProgress={(ready, total, filePath) => setEditorProgress((current) => current.total > 0 && current.ready >= current.total ? current : { ready, total, filePath })}
              placeholder="Write TeX…"
              className="h-full"
            />
            {!editorReady && <div className={paperStyles.editorLoading}>
              <div role="status" className={paperStyles.loading}>
                <span>Opening source sections…</span>
                {editorProgress.total > 0
                  ? <span role="progressbar" aria-label="Opening source sections" aria-valuemin={0} aria-valuemax={editorProgress.total} aria-valuenow={editorProgress.ready} className={cn(paperStyles.loadingTrack, paperStyles.loadingTrackDeterminate)}><span style={{ width: `${100 * editorProgress.ready / editorProgress.total}%` }} /></span>
                  : <span role="progressbar" aria-label="Opening source sections" className={paperStyles.loadingTrack} />}
                {editorProgress.total > 0 && <span className={paperStyles.loadingDetail}>
                  {editorProgress.filePath ? `Opened ${editorProgress.filePath} · ` : ""}{editorProgress.ready} of {editorProgress.total} sections ready
                </span>}
              </div>
            </div>}

            <div ref={formatPanelRef} className={cn("p-glass-sm", paperStyles.formatPanel)}>
            {restoreEditingAttention && <span aria-hidden="true" className={paperStyles.editingGlassTint} onAnimationEnd={() => setRestoreEditingAttention(false)} />}
            <div role="toolbar" aria-label="Paper editing" className={cn("ob-format-bar", paperStyles.editingToolbar, !sessionWritable && paperStyles.editingToolbarCompact)}>
              <BackendStatusNotice project={project} issues={editorIssues} diagnosticContext={getPaperDiagnostics} embedded openRequest={connectionDetailsOpenRequest} />
              {!sessionWritable && <ResumeEditControl embedded className={paperStyles.editingAccess} suppressError={primaryIssue?.id !== "access"} />}
              <Tool title="Open bibliography files" onClick={() => { void openBibliography(); }}><BookOpen size={15} /></Tool>
              <fieldset key={sessionWritable ? "editing" : "viewing"} className={paperStyles.editingTools} disabled={!sessionWritable} inert={!sessionWritable} aria-label="Formatting tools">
              {layout === "pdf" && <Tool title="Show source position in PDF" onClick={() => { void jumpToPdf(); }}><FileText size={15} /></Tool>}
              <Tool title="Bold (⌘B)" onClick={() => surround("\\textbf{", "}", "bold")}><Bold size={15} /></Tool>
              <Tool title="Italic (⌘I)" onClick={() => surround("\\emph{", "}", "italic")}><Italic size={15} /></Tool>
              <Tool title="Inline Code" onClick={() => surround("\\texttt{", "}", "code")}><Code2 size={15} /></Tool>
              <div className="h-3.5 w-px bg-line mx-0.5" />
              <Tool title="Subsection" onClick={() => insertBlock("\\subsection{New Subsection}\n\n") }><Heading2 size={15} /></Tool>
              <Tool title="Subsubsection" onClick={() => insertBlock("\\subsubsection{New Subsubsection}\n\n")}><Heading3 size={15} /></Tool>
              <Tool title="Bullet List" onClick={() => insertBlock("\\begin{itemize}\n\\item \n\\item \n\\end{itemize}")}><List size={15} /></Tool>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Tool title="Table">
                  <Table2 size={15} /><ChevronDown size={10} />
                </Tool></DropdownMenu.Trigger>
                <MenuSurface side="top" align="end" className="ob-menu">
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_RESULT_GRID_TPL)}>Result grid</DropdownMenu.Item>
                  <DropdownMenu.Item className="ob-menu-item" onSelect={() => insertBlock(TEX_BLANK_TABLE_TPL)}>Blank table</DropdownMenu.Item>
                </MenuSurface>
              </DropdownMenu.Root>
              <Tool title="Math Formula" onClick={() => surround("\\[\n", "\n\\]")}><Sigma size={15} /></Tool>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Tool title="Figure">
                  <ImagePlus size={15} /><ChevronDown size={10} />
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
                <Tool className="ob-comment-add-action" title={`Add [${commentKindAppearance(commentKindDraft).label}] (${commentShortcut.label})`} shortcut={commentShortcut.aria} accent onClick={() => addComment()}><MessageSquareText size={15} /><span>Add</span></Tool>
                <CommentKindPicker value={commentKindDraft} onChange={setCommentKindDraft} kinds={commentKinds} />
              </div>
              <Tool
                title={`Add TODO (${todoShortcut.label})`}
                shortcut={todoShortcut.aria}
                accent
                onClick={addTodo}
              >
                <ListTodo size={15} />
                <span className="font-medium">+ TODO</span>
              </Tool>
              <div ref={citeBtnRef} className="relative">
                <Tool title="Insert Citation" accent onClick={() => {
                  if (!citeOpen) citationSelectionRef.current = captureCitationSelection(liveSource(), editorRef.current?.getVirtualSelection() || null);
                  setCiteOpen((o) => !o);
                }}>
                  <Quote size={15} /><ChevronDown size={10} />
                </Tool>
                <AnchoredPop open={sessionWritable && citeOpen} anchorRef={citeBtnRef} origin="br" onDismiss={() => { setCiteOpen(false); setCiteQuery(""); }} className="ob-menu ob-menu-wide">
                  <button type="button" className="ob-menu-item text-xs text-accent" onMouseDown={event => event.preventDefault()}
                    onClick={() => { setCiteOpen(false); setCiteQuery(""); setBibtexOpen(true); }}>Paste BibTeX…</button>
                  <button type="button" className="ob-menu-item text-xs" onClick={() => { setCiteOpen(false); void openBibliography(); }}>Open .bib file…</button>
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
                              restoreCitationCursor(citationSelectionRef.current, [entry.key]);
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
                          className={cn("ob-menu-item text-xs", index === citeHighlight && "bg-accent-soft text-ink")}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { restoreCitationCursor(citationSelectionRef.current, [entry.key]); setCiteOpen(false); setCiteQuery(""); }}
                        >
                          <span className={cn("font-mono text-xs font-semibold", index === citeHighlight ? "text-ink" : "text-accent")}>\{entry.key}</span>
                          <span className="ml-2 truncate text-[11px] text-muted">{entry.fields.title || ""}</span>
                        </button>
                      ))}
                      {citeEntries.length === 0 && <div className="p-2 text-xs text-faint">No matching entries.</div>}
                    </>
                  ) : <div className="p-2 text-xs text-faint">No entries in bibliography yet.</div>}
                </AnchoredPop>
              </div>
              </fieldset>
            </div>
            </div>
            </div>
            </div>
          </Panel>
        </Group>
        </div>
      <BibliographyEditor open={bibliographyOpen} onClose={() => setBibliographyOpen(false)} paths={bibliographyFiles} readOnly={!sessionWritable}
        readFile={file => runProjectFileOperation(project, false, () => readBibliographyFileAction(project, file))}
        saveFile={async (file, content, expectedHash) => {
          const result = await sharedWebMcpActions.applyProjectEdits(project, { edits: [{ path: file, content, expectedHash }] });
          return result.ok ? readBibliographyFileAction(project, file) : result;
        }} />
      {bibtexOpen && <BibtexImport project={project} onClose={() => setBibtexOpen(false)} onImport={async (bibtex, hash, cite) => {
        const selection = citationSelectionRef.current;
        const result = await importReference(bibtex, hash);
        if (result.ok) restoreCitationCursor(selection, cite ? result.value.addedKeys : undefined);
        return result;
      }} />}
      {(hydrationPending || reviewingRemote || remoteSaveError || remoteOutOfSync) && <OverleafSyncNotice suppressed={primaryIssue?.id !== "git"} relatedIssues={relatedIssues} project={project} message={remoteSaveError || "Git review is in progress."} editingPaused={remoteOutOfSync || hydrationPending} floating attention={gitAttention} openRequest={gitDetailsOpenRequest}
        activeReview={reviewingRemote} quickPullAvailable={quickPullAvailable} onQuickPull={() => void quickPull()} pulling={applyingRemote}
        hydrationPending={hydrationPending} onReload={() => void retryHydration()}
        reconciliationPending={reconciliationPending} onPullUncertain={markForcePullUncertain}
        disabled={!sessionWritable || saving || uploading || saveConflict || applyingRemote} checking={checkingRemote || remoteSaveState === "saving"}
        beforeReview={async () => {
          reviewingRemoteRef.current = true;
          remoteQueue.pause();
          setReviewingRemote(true);
          await saveQueueRef.current;
          return doSave(liveSource());
        }}
        onApplied={async (pending) => { if (pending) forcePullRef.current = pending; forceReconciliationRef.current = null; setReconciliationPending(false); try { await applyPulledPaper(); } catch (error) { if (!isBackendTransportError(error) && !isBackendUnavailable()) setRemoteSaveError(withPullStorageWarning(error instanceof Error ? error.message : "Could not reload the paper. Try again.")); } }}
        onClosed={() => { reviewingRemoteRef.current = false; remoteQueue.resume(); setReviewingRemote(false); void refreshRemoteStatus(false); }}
        onCheck={async () => { await refreshRemoteStatus(); }}
        onPush={() => { void (async () => { if (await doSave(liveSource())) await pushRemote("OpenBar: save paper"); })(); }}
      />}
      <div
        id="paper-todos"
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
          <Panel id="todo-space" minSize={0} className={paperStyles.todoSpace} />
          <div className={paperStyles.todoPhoneHeader}>
            <h2>Paper TODOs</h2>
            <button
              ref={todoPhoneBackRef}
              type="button"
              className="p-button p-button-default btn-outline text-xs"
              onClick={() => {
                setTodoOpen(false);
                window.requestAnimationFrame(() => todoTriggerRef.current?.focus());
              }}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Back to paper
            </button>
          </div>
          <Separator
              aria-label="Resize TODO drawer"
              title="Drag to resize TODO drawer"
              className={`relative flex h-8 items-center justify-center text-faint hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${paperStyles.todoResizeHandle}`}
          >
              <GripHorizontal size={12} />
          </Separator>
          <Panel id="todo-content" panelRef={todoPanelRef} defaultSize={todoPanelHeight - 32} minSize={TODO_PANEL_MIN - 32} maxSize={568} groupResizeBehavior="preserve-pixel-size" className={paperStyles.todoSurface}>
          <TodoPanel
            todos={todos}
            onClose={() => {
              setTodoOpen(false);
              window.requestAnimationFrame(() => todoTriggerRef.current?.focus());
            }}
            placementTargets={placementTargets}
            boundTodoIds={boundTodoIds}
            onJump={(todo) => {
              if (phone) {
                setTodoOpen(false);
                window.requestAnimationFrame(() => jumpToTodo(todo));
              } else jumpToTodo(todo);
            }}
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
              remoteQueue.noteEdit();
              void placeTodoOnMindmapAction(project, todoId, parentId)
                .then(() => pushRemote("OpenBar: place paper TODO on mindmap", true))
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
  scrollSync,
  onScrollProgress,
  onScrollStart,
  onJumpToSource,
  suppressStatus = false,
}: {
  project: string;
  compile: PaperCompileViewState;
  sourceTarget?: { page: number; x: number; y: number; width?: number; height?: number } | null;
  scrollSync?: PdfScrollSync;
  onScrollProgress?: (progress: number) => void;
  onScrollStart?: () => void;
  onJumpToSource?: (file: string, line: number) => void;
  suppressStatus?: boolean;
}) {
  const artifactId = compile.lastSuccessfulArtifact?.artifactId || compile.artifactId;
  const pdfAvailable = compile.lastSuccessfulArtifact ? compile.pdfAvailable !== false : compile.pdfAvailable;
  const pdfSrc = pdfAvailable && artifactId
    ? `/api/p/${project}/paper/pdf?artifact=${encodeURIComponent(artifactId)}`
    : null;
  const stale = Boolean(compile.stale || (pdfAvailable && compile.state !== "success"));

  if (suppressStatus && !pdfSrc) return <div className="h-full" />;
  if (compile.state === "unavailable" && !pdfSrc) {
    return <div className="p-12 text-center text-sm text-muted">LaTeX compilation is not available on this server.</div>;
  }
  if (compile.state === "error") {
    const fileHits = parseTexFileLines(compile.diagnostics || []);
    const first = fileHits[0];
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-6 text-xs text-danger" style={suppressStatus ? { padding: 0, gap: 0 } : undefined}>
        <div hidden={suppressStatus}>
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
              suppressStatus={suppressStatus}
              observationMessage={compile.observationDelayed ? compile.message : undefined}
              sourceTarget={sourceTarget}
              scrollSync={scrollSync}
              onScrollProgress={onScrollProgress}
              onScrollStart={onScrollStart}
              onJumpToSource={onJumpToSource}
            />
          </div>
        )}
      </div>
    );
  }
  if (!suppressStatus && compile.state === "running" && !pdfSrc) {
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
      suppressStatus={suppressStatus}
      observationMessage={compile.observationDelayed ? compile.message : undefined}
      sourceTarget={sourceTarget}
      scrollSync={scrollSync}
      onScrollProgress={onScrollProgress}
      onScrollStart={onScrollStart}
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
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "p-button p-button-glass ob-glass-button",
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
        "ob-press inline-flex h-[34px] min-w-[34px] items-center justify-center gap-1 rounded px-2 text-xs",
        accent ? "text-accent hover:bg-accent/10 hover:text-ink font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
    </FastTooltip>
  );
}
