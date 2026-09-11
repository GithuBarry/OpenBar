"use client";

import { bundleSections } from "@/lib/tex-project/section-ranges";

import "katex/dist/katex.min.css";
import { useGitAutoSync } from "@/components/use-git-auto-sync";
import { OverleafSyncNotice } from "@/components/overleaf-sync-notice";
import { EditorNotice } from "@/components/editor-notice";
import paperStyles from "./paper-outline-rail.module.css";
import { PaperOutlineRail } from "./paper-outline-rail";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Bold,
  Check,
  ChevronDown,
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
  addPaperSectionAction,
  commitAndPushProjectAction,
  getEditablePaperAction,
  getPaperCompileStatusAction,
  getProjectGitStatusAction,
  persistSourceBundleAction,
  placeTodoOnMindmapAction,
  removePaperTodoAction,
  removePaperSectionAction,
  renamePaperSectionAction,
  requestPaperCompileAction,
  setPaperSectionHeadingAction,
  uploadPaperFigureAction,
} from "@/app/actions";
import type { ClientSourceBundle } from "@/lib/tex-project/source-bundle-format";
import { inlineBundleIncludes } from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";
import type { BibEntry } from "@/lib/bibtex";
import type { PaperCompileStatus } from "@/lib/tex-project/compile";
import { parseTexFileLines } from "@/lib/tex-project/tex-diagnostics";

import { headingKeyForElement } from "./heading-keys";
import { NestedBundleEditor } from "./nested-bundle-editor";
import { type TexCodeMirrorHandle, type TexDocChange } from "./tex-codemirror";
import { TexPreview } from "./tex-preview";
import { usePreviewWorker } from "./use-preview-worker";
import { PdfJsViewer } from "./pdf-viewer";
import {
  lintLivePaper,
  liveSnapshotFromSource,
  sectionBodyRange,
  usePaperWebMcp,
} from "./use-paper-webmcp";
import { AnchoredPop } from "@/components/pop";
import { composeObcomment } from "@/lib/research/paper-analysis";
import { previewTodoAtSection, relocateTodoInBundle } from "@/lib/research/paper-todo-placement";
import { assignMissingTodoIds, composeObtodo, rewriteObtodo, type TodoAttrPatch } from "@/lib/todo-meta";
import { applyTexLintFix, lintProsePercentages } from "@/lib/tex-project/tex-lint";
import { PaperMetrics } from "./paper-metrics";
import { PaperAppearance, type PaperEditorWidth, type PaperReaderFont } from "./paper-appearance";
import { countPaperWords } from "./paper-stats";
import { TodoPanel, type TodoUndoSnapshot } from "./todo-panel";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { remoteSyncResult } from "@/lib/research/project-sync";
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
  listBookmarks,
  locatePreviewSnippet,
  offsetForBookmarkLine,
  offsetForHeadingKey,
  offsetForSourceFileLine,
  TEX_BLANK_TABLE_TPL,
  TEX_PLANNED_FIGURE_TPL,
  TEX_PLANNED_PLOT_TPL,
  TEX_RESULT_GRID_TPL,
  type EditorTodo,
  type PaperEditorSection,
} from "./tex-source";

export type { PaperEditorSection };

type LayoutMode = "document" | "pdf" | "pdf-only";
type RemoteSaveState = "checking" | "local" | "saving" | "saved" | "changed" | "unavailable" | "error";

const AUTOSAVE_IDLE_MS = 500;
const AUTOSAVE_MAX_MS = 2_000;
const PAGE_BUDGET_REFRESH_MS = 3 * 60_000;
const TODO_PANEL_DEFAULT = 360;
const TODO_PANEL_MIN = 220;
const SPLIT_MIN = 22;
const SPLIT_MAX = 78;
const HEADING_ALIGN = 0.2;
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
  const router = useRouter();
  const initialSource = initialBundle.source;
  const [source, setSource] = useState(initialSource);
  const [savedSource, setSavedSource] = useState(initialSource);
  const [bundleHash, setBundleHash] = useState(initialBundle.bundleHash);
  const [bundleDiagnostics, setBundleDiagnostics] = useState(initialBundle.diagnostics);
  const [sourceContextState, setSourceContextState] = useState(sourceContext);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [remoteOutOfSync, setRemoteOutOfSync] = useState(false);
  const [applyingRemote, setApplyingRemote] = useState(false);
  const applyingRemoteRef = useRef(false);
  const remoteOutOfSyncRef = useRef(false);
  remoteOutOfSyncRef.current = remoteOutOfSync || applyingRemoteRef.current;
  const [remoteSaveState, setRemoteSaveState] = useState<RemoteSaveState>("local");
  const [checkingRemote, setCheckingRemote] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const [expectedSections, setExpectedSections] = useState(initialSections);
  const [prefsReady, setPrefsReady] = useState(false);

  const [layout, setLayout] = useState<LayoutMode>("document");
  const [activeBookmark, setActiveBookmark] = useState<string>("");
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeQuery, setCiteQuery] = useState("");
  const [citeHighlight, setCiteHighlight] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const [figureOpen, setFigureOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [todoDragging, setTodoDragging] = useState(false);
  const [editorWidth, setEditorWidth] = useState<PaperEditorWidth>("wide");
  const [todoPanelHeight, setTodoPanelHeight] = useState(TODO_PANEL_DEFAULT);
  const [splitLeftPct, setSplitLeftPct] = useState(50);
  const [previewFontScale, setPreviewFontScale] = useState(DEFAULT_PREVIEW_FONT_SCALE);
  const [editorFontScale, setEditorFontScale] = useState(DEFAULT_EDITOR_FONT_SCALE);
  const [previewLineHeight, setPreviewLineHeight] = useState(DEFAULT_PREVIEW_LINE_HEIGHT);
  const [previewFont, setPreviewFont] = useState<PaperReaderFont>(DEFAULT_PREVIEW_FONT);
  const [compile, setCompile] = useState<PaperCompileViewState>({ state: "idle" });
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewAnnotate, setPreviewAnnotate] = useState<{
    from: number;
    to: number;
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [commentKindDraft, setCommentKindDraft] = useState("");

  const editorRef = useRef<TexCodeMirrorHandle>(null);
  const sourceRef = useRef(initialSource);
  const { result: previewResult, reset: resetPreview, applyChanges: applyPreviewChanges, workerError } = usePreviewWorker({
    bibliography,
    assetBaseUrl: `/api/p/${project}/asset`,
    getLiveSource: () => editorRef.current?.getLiveSource() ?? sourceRef.current,
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const citeBtnRef = useRef<HTMLDivElement>(null);
  const tableBtnRef = useRef<HTMLDivElement>(null);
  const figureBtnRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const activeScrollSourceRef = useRef<"editor" | "preview" | "jump" | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const headingRafRef = useRef<number | null>(null);
  const lastHeadingKeyRef = useRef("");
  // Both panes remain linked when the responsive layout stacks them. This
  // keeps the source and rendered views together on narrow browser windows.
  const syncPanesRef = useRef(true);
  const claimScrollSource = (source: "editor" | "preview") => {
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
  const saveFailureRef = useRef<{ code: string; message: string; currentHash?: string } | null>(null);
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
  }, [project]);

  const reviewingRemoteRef = useRef(false);
  const pushRemote = useCallback(async (message: string) => {
    if (reviewingRemoteRef.current) return { ok: false as const, code: "review_in_progress", message: "Local changes saved for pull review." };
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
        setRemoteSaveState(
          result.code === "remote_ahead" || result.code === "remote_conflict"
            ? "changed"
            : result.code === "remote_unconfigured" || result.code === "remote_not_overleaf" || result.code === "not_git_repo"
              ? "unavailable"
              : "error",
        );
        setRemoteSaveError(result.message);
      } else {
        remoteSavePendingRef.current = false;
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
    void refreshRemoteStatus(false);
  }, [refreshRemoteStatus]);

  const bookmarks = useMemo(() => listBookmarks(inlineBundleIncludes(source)), [source]);
  const todos = useMemo(() => collectEditorTodos(source), [source]);
  const wordCount = useMemo(() => countPaperWords(inlineBundleIncludes(source)), [source]);
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
    const editorVisibleTop = alignTop - editorRect.top;
    const previewVisibleTop = alignTop - previewRect.top;
    const pvByKey = new Map(
      (Array.from(preview.querySelectorAll(".ob-pv-heading")) as HTMLElement[]).map((heading) => [headingKeyForElement(heading, pvCounts), heading]),
    );
    const firstSection = bookmarksRef.current[0]?.slug;
    const sectionKeys = new Set(bookmarksRef.current.map((bookmark) => bookmark.slug));
    const desktop = syncPanesRef.current;
    for (const ed of Array.from(scroller.querySelectorAll(".ob-ed-heading")) as HTMLElement[]) {
      const key = headingKeyForElement(ed, edCounts);
      const pv = pvByKey.get(key);
      if (!pv || !sectionKeys.has(key)) continue;
      const editorContentTop = ed.getBoundingClientRect().top - editorRect.top + scroller.scrollTop;
      const previewContentTop = pv.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
      const pad = desktop && key !== firstSection ? HEADING_ALIGN : 0;
      anchors.push({
        editorTop: Math.max(0, editorContentTop - editorVisibleTop - pad * scroller.clientHeight),
        previewTop: Math.max(0, previewContentTop - previewVisibleTop - pad * preview.clientHeight),
      });
    }

    const maxEditor = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxPreview = Math.max(0, preview.scrollHeight - preview.clientHeight);
    anchors.push({ editorTop: maxEditor, previewTop: maxPreview });
    anchors.sort((a, b) => a.editorTop - b.editorTop);
    return anchors;
  }, []);

  const updateActiveHeading = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    if (headingRafRef.current != null) return;
    headingRafRef.current = window.requestAnimationFrame(() => {
      headingRafRef.current = null;
      const headings = root.querySelectorAll<HTMLElement>("[data-ob-heading-key]");
      if (!headings.length) return;
      const box = root.getBoundingClientRect();
      const top = box.top + (syncPanesRef.current ? box.height * HEADING_ALIGN : 36) + 1;
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
  }, []);

  useEffect(() => {
    if (activeBookmark || !bookmarks[0]) return;
    lastHeadingKeyRef.current = bookmarks[0].slug;
    setActiveBookmark(bookmarks[0].slug);
  }, [activeBookmark, bookmarks]);

  useEffect(() => () => {
    if (headingRafRef.current != null) window.cancelAnimationFrame(headingRafRef.current);
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
      const pad = (pane: HTMLElement) => (syncPanesRef.current && !first ? pane.clientHeight * HEADING_ALIGN : 0);
      if (pvHeading) {
        const contentTop = pvHeading.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
        preview.scrollTop = Math.max(0, contentTop - (alignTop - previewRect.top) - pad(preview));
      }
      if (edHeading) {
        const contentTop = edHeading.getBoundingClientRect().top - editorRect.top + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, contentTop - (alignTop - editorRect.top) - pad(scroller));
      }
      if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 200);
    };
    requestAnimationFrame(() => requestAnimationFrame(align));
  }, []);

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

  const handleEditorScroll = useCallback(() => {
    const scroller = editorRef.current?.getScroller();
    updateActiveHeading(scroller ?? null);
    if (layout !== "document" || !syncPanesRef.current) return;
    const preview = previewRef.current;
    if (!scroller || !preview) return;
    if (activeScrollSourceRef.current && activeScrollSourceRef.current !== "editor") return;

    activeScrollSourceRef.current = "editor";
    if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 120);

    const anchors = getScrollAnchors();
    if (!anchors || anchors.length < 2) return;

    const currentEditor = scroller.scrollTop;
    let k = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (currentEditor >= anchors[i]!.editorTop) k = i;
      else break;
    }
    const a0 = anchors[k]!;
    const a1 = anchors[k + 1] || a0;
    const spanEditor = a1.editorTop - a0.editorTop || 1;
    const t = Math.max(0, Math.min(1, (currentEditor - a0.editorTop) / spanEditor));
    preview.scrollTop = a0.previewTop + t * (a1.previewTop - a0.previewTop);
  }, [getScrollAnchors, layout, updateActiveHeading]);

  const handlePreviewScroll = useCallback(() => {
    const preview = previewRef.current;
    updateActiveHeading(preview);
    if (layout !== "document" || !syncPanesRef.current) return;
    const scroller = editorRef.current?.getScroller();
    if (!scroller || !preview) return;
    if (activeScrollSourceRef.current && activeScrollSourceRef.current !== "preview") return;

    activeScrollSourceRef.current = "preview";
    if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = window.setTimeout(() => { activeScrollSourceRef.current = null; }, 120);

    const anchors = getScrollAnchors();
    if (!anchors || anchors.length < 2) return;

    const currentPreview = preview.scrollTop;
    let k = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (currentPreview >= anchors[i]!.previewTop) k = i;
      else break;
    }
    const a0 = anchors[k]!;
    const a1 = anchors[k + 1] || a0;
    const spanPreview = a1.previewTop - a0.previewTop || 1;
    const t = Math.max(0, Math.min(1, (currentPreview - a0.previewTop) / spanPreview));
    scroller.scrollTop = a0.editorTop + t * (a1.editorTop - a0.editorTop);
  }, [getScrollAnchors, layout, updateActiveHeading]);

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
    setBundleHash(paper.bundle.bundleHash);
    setBundleDiagnostics(paper.bundle.diagnostics);
    setSourceContextState(paper.sourceContext);
    setSaveError(null);
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
    if (text === baseline && !remoteSavePendingRef.current) return;
    if (text === baseline && remoteSavePendingRef.current) {
      void pushRemote("OpenBar: save paper").then((remote) => {
        if (remote.ok) remoteSavePendingRef.current = false;
      });
      return;
    }
    setSaving(true);
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    const result = await persistSourceBundleAction(project, text, bundleHashRef.current);
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
    setSaving(false);
    if (live === text) {
      try { window.sessionStorage.removeItem(recoveryKey(project)); } catch { /* best-effort */ }
    }
    void pushRemote("OpenBar: save paper").then((remote) => {
      if (remote.ok) remoteSavePendingRef.current = false;
    });
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
        ...(saveFailureRef.current?.currentHash ? { currentHash: saveFailureRef.current.currentHash } : {}),
      };
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
    const paper = await getEditablePaperAction(project);
    if (!paper) {
      setSaveError("Could not reload the paper.");
      return;
    }
    applyHydrated(paper);
  }, [applyHydrated, project]);

  const liveSource = useCallback(() => editorRef.current?.getLiveSource() ?? sourceRef.current, []);

  const canAutoPull = () => !saving && !saveBusyRef.current && !pendingSaveRef.current
    && !uploading && !saveErrorRef.current && !saveConflictRef.current && !recoveryDraft
    && !reviewingRemoteRef.current && liveSource() === savedSourceRef.current
    && !document.activeElement?.closest("input, textarea, [contenteditable=true]");
  useGitAutoSync({
    project,
    isBusy: () => checkingRemote || remoteSaveState === "saving" || saving || uploading || reviewingRemoteRef.current,
    canPull: canAutoPull,
    check: () => refreshRemoteStatus(true, false),
    onApplying: (applying) => {
      applyingRemoteRef.current = applying;
      if (applying) remoteOutOfSyncRef.current = true;
      setApplyingRemote(applying);
    },
    onApplied: async () => {
      const paper = await getEditablePaperAction(project);
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
        const status = await getPaperCompileStatusAction(project);
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
        if (parsed.source !== initialSource) setRecoveryDraft({ source: parsed.source, baseHash: parsed.baseHash, savedAt: parsed.savedAt });
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
        if (prefs.layout === "document" || prefs.layout === "pdf" || prefs.layout === "pdf-only") setLayout(prefs.layout);
        if (prefs.editorWidth === "compact" || prefs.editorWidth === "wide" || prefs.editorWidth === "full") {
          setEditorWidth(prefs.editorWidth);
        }
        if (typeof prefs.splitLeftPct === "number") {
          setSplitLeftPct(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, prefs.splitLeftPct)));
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
    window.localStorage.setItem(prefsKey(project), JSON.stringify({
      layout,
      editorWidth,
      splitLeftPct,
      todoOpen,
      todoPanelHeight,
      previewFontScale,
      editorFontScale,
      previewLineHeight,
      previewFont,
      lastSection: activeBookmark || lastHeadingKeyRef.current,
    }));
  }, [activeBookmark, editorFontScale, editorWidth, layout, prefsReady, previewFont, previewFontScale, previewLineHeight, project, splitLeftPct, todoOpen, todoPanelHeight]);

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
      const status = await requestPaperCompileAction(project);
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
        const status = await getPaperCompileStatusAction(project);
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

  const currentTodo = useCallback((todo: EditorTodo, current: string) => {
    const live = collectEditorTodos(current);
    return (todo.id ? live.find((candidate) => candidate.kind === todo.kind && candidate.id === todo.id) : undefined)
      || live.find((candidate) => candidate.kind === todo.kind && candidate.section === todo.section && candidate.text === todo.text);
  }, []);

  const jumpToTodo = useCallback((todo: EditorTodo) => {
    const current = editorRef.current?.getLiveSource() ?? sourceRef.current;
    const live = currentTodo(todo, current);
    if (live) editorRef.current?.setSelection(live.from, live.to);
  }, [currentTodo]);

  const jumpToSourceLine = useCallback((file: string, line: number) => {
    const from = offsetForSourceFileLine(sourceRef.current, file, line);
    if (from == null) return;
    editorRef.current?.setSelection(from, from);
  }, []);

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
    const editsDuringRemoval = hasLiveEditorChanged(
      { source: operationSource, revision: operationRevision },
      { source: liveBeforeRemoval, revision: revisionRef.current },
    ) || liveAfterRemoval !== sourceAfterRemoval;
    const removalSnapshot = {
      source: liveAfterRemoval,
      revision: revisionRef.current,
    };
    remoteSavePendingRef.current = true;
    const remote = await pushRemote("OpenBar: remove paper TODO");
    if (!remote.ok) setSaveError(`Saved locally. ${remote.message}`);

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

    const latestPaper = await getEditablePaperAction(project);
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
    try {
      await removeTodoEverywhere(todo.id || "");
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not remove the paper TODO.");
      return false;
    }
  }, [removeTodoEverywhere]);

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
      const insert = tex.replace(/\n+$/, "");
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
  const isSaved = source === savedSource && !saving;
  useEffect(() => {
    if (source !== savedSource && remoteSaveState === "saved") setRemoteSaveState("local");
  }, [remoteSaveState, savedSource, source]);
  const remoteStatusLabel = saving
    ? "Saving…"
    : uploading
      ? "Uploading…"
      : saveConflict
          ? "Conflict"
          : remoteSaveState === "checking"
            ? "Checking Git…"
            : remoteSaveState === "saving"
              ? "Pushing to Git…"
              : remoteSaveState === "changed"
                ? "Git changed"
                : remoteSaveState === "unavailable"
                  ? "Git unavailable"
                : remoteSaveState === "error"
                  ? "Git push failed"
                : isSaved && remoteSaveState === "saved"
                  ? "Git pushed"
                    : isSaved
                      ? "Local saved"
                      : "Unsaved";
  const sourceRepairSections = useMemo(
    () => sourceContextState.sections.filter((section) =>
      Boolean(section.diagnostic?.repair) || section.diagnostics.some((item) => item.severity === "error"),
    ),
    [sourceContextState.sections],
  );
  const pdfCurrent = isSaved && compile.state === "success" && compile.stale !== true;
  const pdfVisible = layout === "pdf" || layout === "pdf-only";
  const widthClass = editorWidth === "compact" ? paperStyles.widthCompact : editorWidth === "wide" ? paperStyles.widthWide : paperStyles.widthFull;
  const previewStyle = {
    "--paper-preview-font-scale": previewFontScale,
    "--paper-preview-line-height": previewLineHeight,
    "--font-serif": previewFont === "sans" ? "var(--font-sans)" : "var(--font-paper)",
  } as CSSProperties;
  const editorStyle = {
    "--paper-editor-font-scale": editorFontScale,
  } as CSSProperties;

  return (
    <div className={cn("relative flex h-[calc(100vh-85px)] w-full flex-col gap-2", widthClass)}>
      <div className={paperStyles.toolbar}>
        <div className="flex h-8 min-w-0 items-center overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [grid-area:switch]">
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
          <ToolbarSeg
            active={layout === "pdf-only"}
            onClick={() => {
              setLayout("pdf-only");
              if (compile.state === "idle") void requestCompile();
            }}
          >
            PDF Only
          </ToolbarSeg>
        </div>

        <div className="flex min-w-0 items-center gap-3 overflow-hidden [grid-area:title]">
          <PaperMetrics wordCount={wordCount} pageBudget={compile.pageBudget} />

        </div>

        <div
          className="hidden h-8 min-w-0 items-center overflow-hidden [grid-area:status] md:flex"
          title={remoteSaveError || remoteStatusLabel}
        >
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-faint">
            {saving || uploading ? (
              <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
            ) : saveConflict || remoteSaveState === "changed" || remoteSaveState === "unavailable" || remoteSaveState === "error" ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            ) : isSaved ? (
              <Check size={12} className="shrink-0 text-ok" />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            )}
            <span className="hidden min-w-0 truncate font-medium tabular-nums xl:inline">
              {remoteStatusLabel}
            </span>
          </span>
        </div>

        <div className={paperStyles.toolbarActions}>


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
            className="btn-outline inline-flex h-7 shrink-0 items-center gap-1 px-2 text-[11px]"
            title="Recompile PDF"
          >
            {compile.state === "running" ? <LoaderCircle size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Recompile
          </button>

        </div>
      </div>

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
              className="btn-primary px-2 py-0.5 text-[11px]"
              onClick={() => {
                const current = liveSource();
                editorRef.current?.applyVirtualChange(0, current.length, recoveryDraft.source);
                clearRecoveryDraft();
              }}
            >
              Restore draft
            </button>
            <button type="button" className="btn-ghost px-2 py-0.5 text-[11px]" onClick={clearRecoveryDraft}>Keep saved source</button>
          </div>
        </div>
      )}
      {(saveConflict || saveError) && <EditorNotice project={project} title={saveConflict ? "Saved file conflict" : "Saving needs attention"} label={saveConflict ? "Editing paused · saved file changed" : "Saving needs attention"} message={saveError || "The manuscript changed on disk. Your unsaved text remains in the editor."} paused={saveConflict}>
        <button type="button" className="btn-outline" onClick={() => { if (saveConflict) void reloadLatest(); else void doSave(liveSource()); }}>{saveConflict ? "Reload latest (discards local edits)" : "Retry save"}</button>
      </EditorNotice>}
      {!saveError && remoteSaveError && <OverleafSyncNotice project={project} message={remoteSaveError} editingPaused={remoteOutOfSync}
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
          Include graph: {bundleDiagnostics.map((item) => item.message).join(" · ")}
        </div>
      )}
      {workerError && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink" role="status">
          <span>{workerError}</span>
          <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" onClick={() => resetPreview(liveSource())}>Retry preview</button>
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
                  const messages = section.diagnostics.length ? section.diagnostics.map((item) => item.message).join(" · ") : section.excerpt;
                  return (
                    <div key={`${section.file}:${section.id}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line/70 bg-surface-2/40 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", diagnostic ? "bg-danger" : "bg-ok")} />
                          {section.title} <span className="font-normal text-muted">· {section.file}</span>
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
            className="btn-outline px-2 py-0.5 text-[11px]"
            onClick={() => {
              let next = liveSource();
              for (const fix of [...percentFixes].reverse()) next = applyTexLintFix(next, fix);
              const current = liveSource();
              editorRef.current?.applyVirtualChange(0, current.length, next);
            }}
          >
            Fix percentages
          </button>
        </div>
      )}

      {layout !== "pdf-only" && (
        <div
          ref={splitRef}
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-transparent bg-surface shadow-card max-lg:grid-cols-1 max-lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-columns:minmax(0,var(--split-left))_8px_minmax(0,1fr)]"
          style={{ ["--split-left" as string]: `${splitLeftPct}%` }}
        >
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface">
            {layout === "document" && (
              <div className={paperStyles.documentLayout}>
              <PaperOutlineRail bookmarks={bookmarks} activeSlug={activeBookmark} onJump={jumpToSection} previewRef={previewRef} />
              <div
                ref={previewRef}
                data-ob-scroll="paper-preview"
                onWheelCapture={() => claimScrollSource("preview")}
                onScroll={handlePreviewScroll}
                onClick={(event) => {
                  if (window.getSelection()?.toString()) return;
                  const target = event.target as HTMLElement;
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
                    x: rect.left - paneRect.left + pane.scrollLeft,
                    y: rect.bottom - paneRect.top + pane.scrollTop + 8,
                  });
                }}
                className={cn("paper-view", paperStyles.documentScroller)}
                style={previewStyle}
              >
                <div className="prose-ob max-w-full relative">
                  <TexPreview project={project} blocks={previewResult?.blocks || []} />
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
                          editorRef.current?.applyVirtualChange(previewAnnotate.from, previewAnnotate.to, insert);
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
                          editorRef.current?.applyVirtualChange(previewAnnotate.from, previewAnnotate.to, insert);
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
                  compile={compile}
                  sourceTarget={null}
                  onJumpToSource={jumpToSourceLine}
                />
              </div>
            )}
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize split panes"
            title="Drag to resize"
            className="hidden min-h-0 cursor-col-resize items-stretch justify-center bg-line/70 hover:bg-accent/50 lg:flex"
            onDoubleClick={() => setSplitLeftPct(50)}
            onMouseDown={(event) => {
              event.preventDefault();
              const frame = splitRef.current;
              if (!frame) return;
              bindPointerDrag((move) => {
                const rect = frame.getBoundingClientRect();
                if (rect.width <= 0) return;
                const pct = ((move.clientX - rect.left) / rect.width) * 100;
                setSplitLeftPct(Math.round(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct)) * 10) / 10);
              }, "col-resize");
            }}
          >
            <GripVertical size={12} className="self-center text-faint" />
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1">
            <div
              className={cn("ob-editor-container overflow-hidden", paperStyles.sourceStack)}
              style={{ position: "absolute", inset: 0, ...editorStyle }}
              onWheelCapture={() => claimScrollSource("editor")}
            >
            <NestedBundleEditor
              readOnly={remoteOutOfSync || applyingRemote || saveConflict}
              ref={editorRef}
              value={source}
              onDocChanges={onDocChanges}
              onScroll={handleEditorScroll}
              placeholder="Write TeX…"
              className="h-full"
            />

            <div role="toolbar" aria-label="Paper editing" className={paperStyles.editingToolbar}>
              <Tool title="Bold (⌘B)" onClick={() => surround("\\textbf{", "}", "bold")}><Bold size={12} /></Tool>
              <Tool title="Italic (⌘I)" onClick={() => surround("\\emph{", "}", "italic")}><Italic size={12} /></Tool>
              <Tool title="Inline Code" onClick={() => surround("\\texttt{", "}", "code")}><Code2 size={12} /></Tool>
              <div className="h-3.5 w-px bg-line mx-0.5" />
              <Tool title="Subsection" onClick={() => insertBlock("\\subsection{New Subsection}\n\n") }><Heading2 size={12} /></Tool>
              <Tool title="Subsubsection" onClick={() => insertBlock("\\subsubsection{New Subsubsection}\n\n")}><Heading3 size={12} /></Tool>
              <Tool title="Bullet List" onClick={() => insertBlock("\\begin{itemize}\n\\item \n\\item \n\\end{itemize}")}><List size={12} /></Tool>
              <div ref={tableBtnRef} className="relative">
                <Tool title="Table" onClick={() => setTableOpen((open) => !open)}>
                  <Table2 size={12} /><ChevronDown size={9} />
                </Tool>
                <AnchoredPop open={tableOpen} anchorRef={tableBtnRef} origin="br" onDismiss={() => setTableOpen(false)} className="ob-menu">
                  <button type="button" className="ob-menu-item" onClick={() => { insertBlock(TEX_RESULT_GRID_TPL); setTableOpen(false); }}>Result grid</button>
                  <button type="button" className="ob-menu-item" onClick={() => { insertBlock(TEX_BLANK_TABLE_TPL); setTableOpen(false); }}>Blank table</button>
                </AnchoredPop>
              </div>
              <Tool title="Math Formula" onClick={() => insertBlock("\\[\nE = mc^2\n\\]")}><Sigma size={12} /></Tool>
              <div ref={figureBtnRef} className="relative">
                <Tool title="Figure" onClick={() => setFigureOpen((open) => !open)}>
                  <ImagePlus size={12} /><ChevronDown size={9} />
                </Tool>
                <AnchoredPop open={figureOpen} anchorRef={figureBtnRef} origin="br" onDismiss={() => setFigureOpen(false)} className="ob-menu">
                  <button type="button" className="ob-menu-item" onClick={() => { insertBlock(TEX_PLANNED_FIGURE_TPL); setFigureOpen(false); }}>Planned figure</button>
                  <button type="button" className="ob-menu-item" onClick={() => { insertBlock(TEX_PLANNED_PLOT_TPL); setFigureOpen(false); }}>Planned plot</button>
                  <button type="button" className="ob-menu-item" onClick={() => { fileRef.current?.click(); setFigureOpen(false); }}>Upload image…</button>
                </AnchoredPop>
              </div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />
              <div className="h-3.5 w-px bg-line mx-0.5" />
              <input
                value={commentKindDraft}
                onChange={(event) => setCommentKindDraft(event.target.value)}
                maxLength={80}
                aria-label="Comment kind"
                placeholder="kind"
                title="Optional comment kind"
                className="h-6 w-16 rounded-full border border-line bg-surface px-2 text-[10px] text-ink outline-none placeholder:text-faint focus:border-accent"
              />
              <Tool title="Comment" accent onClick={() => insertAtSelection(composeHumanComment, composeHumanComment("Add a comment for collaborators"))}><MessageSquareText size={12} /></Tool>
              <Tool
                title="+ TODO"
                accent
                className="ob-new-todo-tool"
                onClick={() => insertAtSelection((selected) => composeObtodo({ text: selected || "Next actionable experiment or writing item" }), composeObtodo({ text: "Next actionable experiment or writing item" }))}
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
            </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={paperStyles.todoDrawer}
        data-open={todoOpen}
        data-dragging={todoDragging}
        aria-label="Paper TODOs"
        role="region"
        aria-hidden={!todoOpen}
        inert={!todoOpen}
      >
        <div className={paperStyles.todoClip}>
        <div
          className={paperStyles.todoSurface}
          style={{ height: todoPanelHeight }}
        >
          <div className="relative flex h-8 shrink-0 items-center">
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize TODO drawer"
              title="Drag to resize TODO drawer"
              className="flex h-full flex-1 cursor-ns-resize items-center justify-center text-faint hover:bg-surface-2 hover:text-muted"
              onMouseDown={(event) => {
                event.preventDefault();
                setTodoDragging(true);
                const startY = event.clientY;
                const startH = todoPanelHeight;
                bindPointerDrag((move) => {
                  const next = startH + (startY - move.clientY);
                  setTodoPanelHeight(Math.round(Math.max(TODO_PANEL_MIN, Math.min(window.innerHeight * 0.7, next))));
                }, "ns-resize", () => setTodoDragging(false));
              }}
            >
              <GripHorizontal size={12} />
            </div>
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
          </div>
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
        </div>
        </div>
      </div>

      {layout === "pdf-only" && (
        <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-transparent bg-surface shadow-card">
          <PdfPreview
            project={project}
            compile={compile}
            sourceTarget={null}
            onJumpToSource={jumpToSourceLine}
          />
        </div>
      )}
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

function bindPointerDrag(onMove: (move: MouseEvent) => void, cursor: string, onDone?: () => void) {
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onDone?.();
  };
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function Tool({
  title,
  onClick,
  children,
  accent,
  className,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "ob-press inline-flex h-7 items-center justify-center gap-1 rounded px-2 text-xs",
        accent ? "text-accent hover:bg-accent/10 font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
