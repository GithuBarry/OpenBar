"use client";

import "katex/dist/katex.min.css";
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
  getEditablePaperAction,
  getPaperCompileStatusAction,
  previewTableFallbacksAction,
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
import { SectionMenu } from "./jump-reel";
import { NestedBundleEditor } from "./nested-bundle-editor";
import { type TexCodeMirrorHandle } from "./tex-codemirror";
import { TexHastDocument } from "./tex-hast-document";
import {
  lintLivePaper,
  liveSnapshotFromSource,
  sectionBodyRange,
  usePaperWebMcp,
} from "./use-paper-webmcp";
import { AnchoredPop } from "@/components/pop";
import { composeObcomment } from "@/lib/research/paper-analysis";
import { assignMissingTodoIds, composeObtodo, rewriteObtodo, rewriteObtodoText, type TodoAttrPatch } from "@/lib/todo-meta";
import { proposedTableRepair, suspiciousTexSequences } from "@/lib/tex-project/tex-repair";
import { extractComplexTableFragments } from "@/lib/tex-project/table-fragments";
import { applyTexLintFix, lintProsePercentages } from "@/lib/tex-project/tex-lint";
import { PaperMetrics } from "./paper-metrics";
import { PaperAppearance, type PaperEditorWidth, type PaperReaderFont } from "./paper-appearance";
import { countPaperWords } from "./paper-stats";
import { TodoPanel } from "./todo-panel";
import { sharedWebMcpActions } from "@/features/webmcp-actions";
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

const AUTOSAVE_DELAY = 600;
const COMPANION_RENDER_DELAY = 200;
const TABLE_FALLBACK_DELAY = 2_000;
const COMPILE_POLL_MS = 400;
const COMPILE_POLL_MAX_MS = 120_000;
const PAGE_BUDGET_REFRESH_MS = 3 * 60_000;
const TODO_PANEL_DEFAULT = 192;
const TODO_PANEL_MIN = 96;
const SPLIT_MIN = 22;
const SPLIT_MAX = 78;
const HEADING_ALIGN = 0.2;
const TODO_CONTEXT_LINES = 3;
const DEFAULT_PREVIEW_FONT_SCALE = 0.9;
const DEFAULT_EDITOR_FONT_SCALE = 1;
const DEFAULT_PREVIEW_LINE_HEIGHT = 1.75;
const DEFAULT_PREVIEW_FONT: PaperReaderFont = "serif";

const REPAIR_LABELS: Record<string, string> = {
  "escaped-backslash-braces": "escaped backslash braces",
  "escaped-hline": "escaped \\hline text",
  "escaped-marker-braces": "escaped marker braces",
  "lost-cell-delimiters": "lost table-cell delimiters",
};

type HydratedPaper = {
  title: string;
  sections: PaperEditorSection[];
  bundle: ClientSourceBundle;
  pandocTables?: Record<string, string>;
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

export function PaperEditor({
  project,
  title,
  initialSections,
  initialBundle,
  bibliography,
  bibliographyRaw,
  initialPandocTables,
  placementTargets = [],
  boundTodoIds = [],
}: {
  project: string;
  title: string;
  initialSections: PaperEditorSection[];
  initialBundle: ClientSourceBundle;
  bibliography?: BibEntry[];
  bibliographyRaw?: string;
  initialPandocTables?: Record<string, string>;
  placementTargets?: { id: string; label: string }[];
  boundTodoIds?: string[];
}) {
  const router = useRouter();
  const initialSource = initialBundle.source;
  const [source, setSource] = useState(initialSource);
  const [renderSource, setRenderSource] = useState(initialSource);
  const [savedSource, setSavedSource] = useState(initialSource);
  const [bundleHash, setBundleHash] = useState(initialBundle.bundleHash);
  const [bundleDiagnostics, setBundleDiagnostics] = useState(initialBundle.diagnostics);
  const [pandocTables, setPandocTables] = useState<Record<string, string>>(initialPandocTables || {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
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
  const [compile, setCompile] = useState<PaperCompileStatus>({ state: "idle" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [focusedTodoId, setFocusedTodoId] = useState<string | null>(null);
  const [previewAnnotate, setPreviewAnnotate] = useState<{
    from: number;
    to: number;
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [commentKindDraft, setCommentKindDraft] = useState("");

  const editorRef = useRef<TexCodeMirrorHandle>(null);
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
  const saveTimerRef = useRef<number | null>(null);
  const tablePreviewRevisionRef = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
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

  const bookmarks = useMemo(() => listBookmarks(inlineBundleIncludes(renderSource)), [renderSource]);
  const todos = useMemo(() => collectEditorTodos(renderSource), [renderSource]);
  const focusedTodo = useMemo(
    () => (focusedTodoId ? collectEditorTodos(source).find((todo) => todo.id === focusedTodoId) || null : null),
    [focusedTodoId, source],
  );
  const focusContext = useMemo(
    () => focusedTodo
      ? {
          from: focusedTodo.from,
          to: focusedTodo.to,
          beforeLines: TODO_CONTEXT_LINES,
          afterLines: TODO_CONTEXT_LINES,
        }
      : null,
    [focusedTodo],
  );
  const wordCount = useMemo(() => countPaperWords(inlineBundleIncludes(renderSource)), [renderSource]);
  const repairHits = useMemo(() => suspiciousTexSequences(renderSource), [renderSource]);
  const repairSummary = useMemo(
    () => repairHits.map((hit) => REPAIR_LABELS[hit] || hit.replaceAll("-", " ")).join(", "),
    [repairHits],
  );
  const percentFixes = useMemo(() => lintProsePercentages(renderSource), [renderSource]);
  const companionCurrent = source === renderSource;
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const activeBookmarkRef = useRef(activeBookmark);
  activeBookmarkRef.current = activeBookmark;
  const bibliographyRef = useRef(bibliography);
  bibliographyRef.current = bibliography;

  useEffect(() => {
    if (focusedTodoId && !focusedTodo) setFocusedTodoId(null);
  }, [focusedTodo, focusedTodoId]);

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
    setFocusedTodoId(null);
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
    setRenderSource(next);
    setSavedSource(next);
    setBundleHash(paper.bundle.bundleHash);
    setBundleDiagnostics(paper.bundle.diagnostics);
    if (paper.pandocTables) setPandocTables(paper.pandocTables);
    setSaveError(null);
    setSaveConflict(false);
    setCompile((current) => ({
      state: "idle",
      message: "Source changed. Compile to refresh the PDF.",
      pdfAvailable: current.pdfAvailable,
      pageBudget: current.pageBudget,
    }));
  }, []);

  const doSave = useCallback(async (text: string, signal?: AbortSignal) => {
    const job = saveQueueRef.current.then(async () => {
      saveFailureRef.current = null;
      if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      const baseline = savedSourceRef.current;
      if (text === baseline) return;
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
      setCompile((current) => ({
        state: "idle",
        message: "Source changed. Compile to refresh the PDF.",
        pdfAvailable: current.pdfAvailable,
        pageBudget: current.pageBudget,
      }));
      setSaveError(null);
      setSaveConflict(false);
      setSaving(false);
    });
    saveQueueRef.current = job.then(() => undefined, () => undefined);
    try {
      await job;
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
      if (failureCode !== "cancelled") setSaveError(failureMessage);
      return false;
    }
  }, [project]);

  const reloadLatest = useCallback(async () => {
    const paper = await getEditablePaperAction(project);
    if (!paper) {
      setSaveError("Could not reload the paper.");
      return;
    }
    applyHydrated(paper);
  }, [applyHydrated, project]);

  const runStructure = useCallback(async (op: () => Promise<HydratedPaper | null>) => {
    if (sourceRef.current !== savedSourceRef.current) {
      const saved = await doSave(sourceRef.current);
      if (!saved) return;
    }
    try {
      const next = await op();
      if (!next) throw new Error("Could not update section structure.");
      applyHydrated(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not update section structure.");
    }
  }, [applyHydrated, doSave]);

  const scheduleSave = useCallback((nextSource: string, immediate = false) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (saveConflictRef.current && !immediate) return;
    if (immediate) {
      void doSave(nextSource);
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (saveConflictRef.current) return;
      void doSave(nextSource);
    }, AUTOSAVE_DELAY);
  }, [doSave]);

  const saveNow = useCallback(async (nextSource: string, signal?: AbortSignal) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return doSave(nextSource, signal);
  }, [doSave]);

  const onChangeSource = useCallback((text: string) => {
    revisionRef.current += 1;
    sourceRef.current = text;
    setSource(text);
    scheduleSave(text);
  }, [scheduleSave]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderSource(source), COMPANION_RENDER_DELAY);
    return () => window.clearTimeout(timer);
  }, [source]);

  useEffect(() => {
    const requestRevision = ++tablePreviewRevisionRef.current;
    let active = true;
    const timer = window.setTimeout(() => {
      if (extractComplexTableFragments(source).length === 0) {
        if (active && requestRevision === tablePreviewRevisionRef.current) setPandocTables({});
        return;
      }
      void previewTableFallbacksAction(project, source)
        .then((tables) => {
          if (active && requestRevision === tablePreviewRevisionRef.current) setPandocTables(tables);
        })
        .catch(() => {
          // The regular HAST preview remains available when the optional table fallback is unavailable.
        });
    }, TABLE_FALLBACK_DELAY);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [project, source]);

  useEffect(() => {
    let active = true;
    const refreshCompileStatus = async () => {
      try {
        const status = await getPaperCompileStatusAction(project);
        if (active) setCompile(status);
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
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (sourceRef.current !== savedSourceRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        scheduleSave(sourceRef.current, true);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKey);
    };
  }, [scheduleSave]);

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
          setPreviewFontScale(Math.max(0.8, Math.min(1.2, prefs.previewFontScale)));
        }
        if (typeof prefs.editorFontScale === "number" && Number.isFinite(prefs.editorFontScale)) {
          setEditorFontScale(Math.max(0.8, Math.min(1.2, prefs.editorFontScale)));
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
      setCompile((current) => ({
        ...status,
        pdfAvailable: status.pdfAvailable ?? current.pdfAvailable,
        pageBudget: status.pageBudget ?? current.pageBudget,
      }));
      return status;
    } catch (error) {
      const cancelled = signal?.aborted || (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "cancelled");
      if (cancelled) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
      const status: PaperCompileStatus = { state: "error", message: error instanceof Error ? error.message : "Could not compile PDF." };
      setCompile(status);
      return status;
    }
  }, [doSave, project]);

  useEffect(() => {
    if (compile.state !== "running") return;
    let cancelled = false;
    let delay = COMPILE_POLL_MS;
    let timer = 0;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - started > COMPILE_POLL_MAX_MS) {
        setCompile({ state: "error", message: "Compilation timed out." });
        return;
      }
      try {
        const status = await getPaperCompileStatusAction(project);
        if (cancelled) return;
        setCompile(status);
        if (status.state === "running") {
          delay = Math.min(Math.round(delay * 1.5), 4000);
          timer = window.setTimeout(tick, delay);
        }
      } catch {
        if (cancelled) return;
        delay = Math.min(Math.round(delay * 1.5), 4000);
        timer = window.setTimeout(tick, delay);
      }
    };
    timer = window.setTimeout(tick, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [compile.state, project]);

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
    if (live) {
      setFocusedTodoId(live.id || null);
      editorRef.current?.setSelection(live.from, live.to);
    }
  }, [currentTodo]);

  const jumpToSourceLine = useCallback((file: string, line: number) => {
    const from = offsetForSourceFileLine(sourceRef.current, file, line);
    if (from == null) return;
    setFocusedTodoId(null);
    editorRef.current?.setSelection(from, from);
  }, []);

  const applyPaperHash = useCallback((rawHash?: string) => {
    const hash = decodeURIComponent((rawHash ?? window.location.hash).replace(/^#/, "")).trim();
    if (!hash) return false;
    if (expectedSectionsRef.current.some((section) => section.id === hash)) {
      jumpToExpectedSection(hash);
      return true;
    }
    const todo = collectEditorTodos(sourceRef.current).find((item) => item.id === hash);
    if (todo) {
      jumpToTodo(todo);
      return true;
    }
    const comment = collectEditorComments(sourceRef.current).find((item) => item.id === hash);
    if (comment) {
      setFocusedTodoId(null);
      editorRef.current?.setSelection(comment.from, comment.to);
      return true;
    }
    const bookmark = bookmarksRef.current.find((item) => item.slug === hash);
    if (bookmark) {
      jumpToSection(bookmark);
      return true;
    }
    return false;
  }, [jumpToExpectedSection, jumpToSection, jumpToTodo]);

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
    const result = await removePaperTodoAction(project, todoId, bundleHashRef.current);
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    await reloadLatest();
  }, [project, reloadLatest, saveNow]);

  const resolveTodo = useCallback((todo: EditorTodo) => {
    void removeTodoEverywhere(todo.id || "")
      .catch((error) => setSaveError(error instanceof Error ? error.message : "Could not remove the paper TODO."));
  }, [removeTodoEverywhere]);

  const patchTodo = useCallback((todo: EditorTodo, patch: TodoAttrPatch) => {
    const current = editorRef.current?.getLiveSource() ?? sourceRef.current;
    if (todo.kind !== "obtodo") return;
    const live = currentTodo(todo, current);
    if (!live) return;
    const nextMacro = rewriteObtodo(current.slice(live.from, live.to), patch);
    editorRef.current?.applyVirtualChange(live.from, live.to, nextMacro);
  }, [currentTodo]);

  const editTodoText = useCallback((todo: EditorTodo, text: string) => {
    const current = editorRef.current?.getLiveSource() ?? sourceRef.current;
    if (todo.kind !== "obtodo" || !text.trim()) return;
    const live = currentTodo(todo, current);
    if (!live) return;
    const nextMacro = rewriteObtodoText(current.slice(live.from, live.to), text);
    editorRef.current?.applyVirtualChange(live.from, live.to, nextMacro);
  }, [currentTodo]);

  const liveSource = () => editorRef.current?.getLiveSource() ?? sourceRef.current;

  const applyAndSave = useCallback(async (from: number, to: number, insert: string, signal?: AbortSignal) => {
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
      sourceSegments: sourceSegmentsRef.current,
      activeHeadingKey: activeBookmarkRef.current || lastHeadingKeyRef.current,
      compileState: { state: compileRef.current.state, sourceHash: compileRef.current.sourceHash },
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
        throw new Error(status.message || "Compilation failed.");
      }
      return { status: status.state, sourceHash: status.sourceHash };
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
  const pdfCurrent = isSaved && compile.state === "success";
  const widthClass =
    editorWidth === "compact"
      ? "max-w-5xl mx-auto"
      : editorWidth === "wide"
        ? "w-full max-w-[calc(100%_-_8rem)] mx-auto"
        : "w-full max-w-none px-0";
  const previewStyle = {
    "--paper-preview-font-scale": previewFontScale,
    "--paper-preview-line-height": previewLineHeight,
    "--font-serif": previewFont === "sans" ? "var(--font-sans)" : "var(--font-paper)",
  } as CSSProperties;
  const editorStyle = {
    "--paper-editor-font-scale": editorFontScale,
  } as CSSProperties;

  return (
    <div className={cn("flex h-[calc(100vh-85px)] w-full flex-col gap-2", widthClass)}>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-xs [grid-template-areas:'switch_actions'_'title_title'] md:h-11 md:grid-cols-[auto_minmax(min-content,1fr)_minmax(0,max-content)_minmax(0,auto)] md:grid-rows-1 md:gap-3 md:overflow-visible md:py-0 md:[grid-template-areas:'switch_title_status_actions']">
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
          <SectionMenu
            sections={expectedSections}
            onJump={jumpToExpectedSection}
            onRename={(id, nextTitle) => void runStructure(() => renamePaperSectionAction(project, id, nextTitle))}
            onSetLevel={(id, level) => void runStructure(() => setPaperSectionHeadingAction(project, id, { level }))}
            onToggleAppendix={(id) => {
              const current = expectedSections.find((section) => section.id === id);
              void runStructure(() => setPaperSectionHeadingAction(project, id, { appendix: !current?.appendix }));
            }}
            onAddAfter={(id, nextTitle) => {
              const current = expectedSections.find((section) => section.id === id);
              void runStructure(() => addPaperSectionAction(project, {
                title: nextTitle,
                afterId: id,
                level: current?.level,
                appendix: current?.appendix,
              }));
            }}
            onRemove={(id) => void runStructure(() => removePaperSectionAction(project, id))}
          />
        </div>

        <div
          className="hidden h-8 min-w-0 items-center overflow-hidden [grid-area:status] md:flex"
          title={saving ? "Saving…" : uploading ? "Uploading…" : saveConflict ? "Conflict" : isSaved ? "Saved" : "Unsaved"}
        >
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-faint">
            {saving || uploading ? (
              <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
            ) : saveConflict ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            ) : isSaved ? (
              <Check size={12} className="shrink-0 text-ok" />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            )}
            <span className="hidden min-w-0 truncate font-medium tabular-nums xl:inline">
              {saving ? "Saving…" : uploading ? "Uploading…" : saveConflict ? "Conflict" : isSaved ? "Saved" : "Unsaved"}
            </span>
          </span>
        </div>

        <div className="flex h-8 min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto [grid-area:actions]">
          {compile.pdfAvailable && (
            <span className={cn("hidden shrink-0 text-[11px] font-medium xl:inline", pdfCurrent ? "text-ok" : "text-warn")}>
              {pdfCurrent ? "PDF current" : "PDF stale"}
            </span>
          )}

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
      {saveConflict ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/15 px-3 py-2 text-xs text-danger" role="alert">
          <div>
            <p className="font-semibold">Conflict</p>
            <p className="mt-0.5 text-ink">The manuscript changed on disk. Your unsaved buffer is still in the editor.</p>
          </div>
          <button type="button" className="btn-outline shrink-0 px-2 py-0.5 text-[11px]" onClick={() => void reloadLatest()}>
            Reload latest (discards local edits)
          </button>
        </div>
      ) : saveError ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          <p>{saveError}</p>
        </div>
      ) : null}
      {bundleDiagnostics.length > 0 && (
        <div className="shrink-0 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink">
          Include graph: {bundleDiagnostics.map((item) => item.message).join(" · ")}
        </div>
      )}
      {companionCurrent && (repairHits.length > 0 || percentFixes.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-ink">
          <p>
            {percentFixes.length ? `${percentFixes.length} prose percentage${percentFixes.length === 1 ? "" : "s"} should use \\%.` : ""}
            {percentFixes.length && repairHits.length ? " " : ""}
            {repairHits.length ? `Potential table syntax issue: ${repairSummary}. Review the proposed source change before applying it.` : ""}
          </p>
          <div className="flex gap-1">
            {percentFixes.length > 0 && (
              <button
                type="button"
                className="btn-outline px-2 py-0.5 text-[11px]"
                onClick={() => {
                  let next = renderSource;
                  for (const fix of [...percentFixes].reverse()) next = applyTexLintFix(next, fix);
                  onChangeSource(next);
                }}
              >
                Fix percentages
              </button>
            )}
            {repairHits.length > 0 && (
              <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" onClick={() => setRepairOpen((open) => !open)}>
                {repairOpen ? "Hide repair" : "Review repair"}
              </button>
            )}
          </div>
        </div>
      )}
      {companionCurrent && repairOpen && repairHits.length > 0 && (
        <div className="grid shrink-0 gap-2 rounded-lg border border-line bg-surface p-3 text-xs md:grid-cols-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted">{renderSource}</pre>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{proposedTableRepair(renderSource)}</pre>
          <button
            type="button"
            className="btn-outline justify-self-start px-2 py-0.5 text-[11px]"
            onClick={() => {
              onChangeSource(proposedTableRepair(renderSource));
              setRepairOpen(false);
            }}
          >
            Apply repair to live source
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
            <div
              ref={previewRef}
              data-ob-scroll="paper-preview"
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
                const located = locatePreviewSnippet(renderSource, paragraph.textContent.slice(0, 160));
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
                const hintBookmark = listBookmarks(renderSource).find((item) => item.slug === activeBookmark);
                const hint = hintBookmark ? offsetForBookmarkLine(renderSource, hintBookmark.line) : 0;
                const located = locatePreviewSnippet(renderSource, snippet, hint);
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
              className={cn("ob-split-pane paper-view overflow-y-auto overflow-x-hidden p-8", layout !== "document" && "is-hide")}
              style={previewStyle}
            >
              <div className="prose-ob max-w-full relative">
                <TexHastDocument
                  assetBaseUrl={`/api/p/${project}/asset`}
                  bibliography={bibliography}
                  source={renderSource}
                  pandocTables={pandocTables}
                  requireHeadingKeys
                />
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
            <div className={cn("ob-split-pane overflow-hidden", layout !== "pdf" && "is-hide")}>
              <PdfPreview project={project} compile={compile} onJumpToSource={jumpToSourceLine} />
            </div>
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
            <div className="ob-editor-container overflow-hidden" style={{ position: "absolute", inset: 0, ...editorStyle }}>
            <NestedBundleEditor
              ref={editorRef}
              value={source}
              onChange={onChangeSource}
              onScroll={handleEditorScroll}
              placeholder="Write TeX…"
              focusContext={focusContext}
              className="h-full"
            />

            <div className="ob-format-bar absolute bottom-4 right-6 z-20 flex items-center gap-0.5 rounded-full border border-line bg-surface/92 px-2 py-1 shadow-lg backdrop-blur-md">
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
              <Tool title="Todo" accent onClick={() => insertAtSelection((selected) => composeObtodo({ text: selected || "Next actionable experiment or writing item" }), composeObtodo({ text: "Next actionable experiment or writing item" }))}><ListTodo size={12} /></Tool>
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
        className={cn("ob-todo-slot", todoOpen && "is-open", todoDragging && "is-drag")}
      >
        <div className="ob-todo-clip">
        <div
          className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-transparent bg-surface shadow-card"
          style={{ height: todoPanelHeight }}
        >
          <div className="relative flex h-5 shrink-0 items-center border-b border-line">
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize open items"
              title="Drag to resize Open items"
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
              aria-label="Hide open items"
              className="ob-press absolute right-1 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-[3px] text-faint hover:bg-surface-2 hover:text-ink"
              onClick={() => setTodoOpen(false)}
            >
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
          <TodoPanel
            todos={todos}
            placementTargets={placementTargets}
            boundTodoIds={boundTodoIds}
            onJump={jumpToTodo}
            onResolve={resolveTodo}
            onPatch={patchTodo}
            onEditText={editTodoText}
            onInsert={insertBlock}
            onPlace={(todoId, parentId) => {
              void placeTodoOnMindmapAction(project, todoId, parentId).catch((error) => {
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
                  const next = assignMissingTodoIds(sourceRef.current);
                  onChangeSource(next.source);
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
          <PdfPreview project={project} compile={compile} onJumpToSource={jumpToSourceLine} />
        </div>
      )}
    </div>
  );
}

function PdfPreview({
  project,
  compile,
  onJumpToSource,
}: {
  project: string;
  compile: PaperCompileStatus;
  onJumpToSource?: (file: string, line: number) => void;
}) {
  if (compile.state === "unavailable") {
    return <div className="p-12 text-center text-sm text-muted">LaTeX compilation is not available on this server.</div>;
  }
  if (compile.state === "error") {
    const fileHits = parseTexFileLines(compile.diagnostics || []);
    const first = fileHits[0];
    return (
      <div className="flex flex-col gap-3 p-6 text-xs text-danger">
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
          <div className="max-h-96 overflow-auto rounded bg-surface-2 p-3 font-mono leading-relaxed">
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
        {compile.pdfAvailable && <LastGoodPdf project={project} />}
      </div>
    );
  }
  if (compile.state !== "success") {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 text-sm text-muted">
        <div className="flex items-center gap-2 font-medium text-ink">
          <LoaderCircle size={15} className="animate-spin text-accent" />
          Compiling TeX with latexmk…
        </div>
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
        {compile.pdfAvailable && <LastGoodPdf project={project} />}
      </div>
    );
  }
  return <iframe className="h-full min-h-0 w-full border-0" title="Compiled paper PDF" src={`/api/p/${project}/paper/pdf?v=${compile.sourceHash || "latest"}`} />;
}

function LastGoodPdf({ project }: { project: string }) {
  return (
    <div className="w-full">
      <p className="mb-2 text-[11px] font-medium text-muted">Last successful PDF</p>
      <iframe className="h-[calc(100vh-320px)] min-h-96 w-full border-0 rounded-xl" title="Last successful compiled paper PDF" src={`/api/p/${project}/paper/pdf?v=last-good`} />
    </div>
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

function Tool({ title, onClick, children, accent }: { title: string; onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "ob-press inline-flex h-7 items-center justify-center gap-1 rounded px-2 text-xs",
        accent ? "text-accent hover:bg-accent/10 font-medium" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
