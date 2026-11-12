"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";

import { synctexEditAction } from "@/app/actions";
import { FastTooltip } from "@/components/fast-tooltip";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { isBackendTransportError } from "@/lib/backend-connection";
import { scrollFollowSmoothingMs, smoothScrollStep, type PdfScrollSync } from "./scroll-follow";

import type { PDFViewer } from "pdfjs-dist/types/web/pdf_viewer";

import styles from "./pdf-viewer.module.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type PdfSourceTarget = { page: number; x: number; y: number; width?: number; height?: number };

export function PdfJsViewer({
  project,
  src,
  stale,
  observationMessage,
  artifactId,
  sourceTarget,
  scrollSync,
  onScrollProgress,
  onScrollStart,
  onJumpToSource,
  page,
  compact = false,
  suppressStatus = false,
}: {
  project: string;
  src: string;
  stale?: boolean;
  observationMessage?: string;
  artifactId?: string;
  sourceTarget?: PdfSourceTarget | null;
  scrollSync?: PdfScrollSync;
  onScrollProgress?: (progress: number) => void;
  onScrollStart?: () => void;
  onJumpToSource?: (file: string, line: number) => void;
  page?: number;
  compact?: boolean;
  suppressStatus?: boolean;
}) {
  const { connectionState, isBackendUnavailable } = useProjectWriteSession();
  const retryOnReconnectRef = useRef(false);
  const [transportLoadFailure, setTransportLoadFailure] = useState(false);
  const hideStatus = suppressStatus || connectionState === "reconnecting";
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const followScrollFrameRef = useRef<number | null>(null);
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStage, setLoadStage] = useState<"opening" | "rendering" | "ready">("opening");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [loadSlow, setLoadSlow] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [renderedZoom, setRenderedZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const latest = useRef({ project, artifactId, onJumpToSource, page });
  latest.current = { project, artifactId, onJumpToSource, page };
  const locationRef = useRef<{ pageNumber: number; left: number; top: number } | null>(null);

  useEffect(() => {
    if (connectionState === "reconnecting" && !viewerRef.current?.pdfDocument) retryOnReconnectRef.current = true;
    if (connectionState === "connected" && transportLoadFailure && retryOnReconnectRef.current && !viewerRef.current?.pdfDocument) {
      retryOnReconnectRef.current = false;
      setTransportLoadFailure(false);
      setLoadAttempt(attempt => attempt + 1);
    }
  }, [connectionState, transportLoadFailure]);

  useEffect(() => {
    const container = scrollerRef.current;
    const host = hostRef.current;
    const stage = stageRef.current;
    if (!container || !host || !stage) return;
    const controller = new AbortController();
    let viewer: PDFViewer | null = null;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    let observer: ResizeObserver | undefined;
    let initialized = false;
    let hasRenderedPage = false;
    let previousWidth = container.clientWidth;
    const savedLocation = locationRef.current;
    setPages(0);
    setError(null);
    setLoadError(null);
    setLoadStage("opening");
    setLoadProgress(null);
    setLoadSlow(false);
    const slowTimer = window.setTimeout(() => setLoadSlow(true), 8000);

    // The viewer bundle reads the core's global export. Load it after the core,
    // inside the browser effect, so server rendering never evaluates DOM APIs.
    const start = async () => {
      const { PDFViewer, PDFSinglePageViewer, PDFLinkService, EventBus } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (controller.signal.aborted) return;
      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus, externalLinkRel: "noreferrer noopener" });
      const Viewer = page ? PDFSinglePageViewer : PDFViewer;
      viewer = new Viewer({
        container,
        viewer: host,
        eventBus,
        linkService,
        annotationMode: AnnotationMode.ENABLE,
        removePageBorders: true,
        // PDFViewer accepts this lifecycle signal in the installed 6.3.289
        // implementation. Its generated declarations omit the option.
        ...{ abortSignal: controller.signal },
      });
      viewerRef.current = viewer;
      linkService.setViewer(viewer);
      const resizeCompact = () => {
        if (!compact || !viewer || !initialized) return;
        const current = viewer.getPageView(viewer.currentPageNumber - 1);
        if (current) stage.style.height = `${Math.ceil(current.div.getBoundingClientRect().height) + 2}px`;
      };
      const reportRender = ({ error: reason }: { error?: unknown }) => {
        if (controller.signal.aborted) return;
        if (reason) {
          if (isBackendTransportError(reason) || isBackendUnavailable()) return;
          const message = reason instanceof Error ? reason.message : "Could not render the PDF.";
          if (hasRenderedPage) setError(`A PDF page could not be displayed: ${message}`);
          else setLoadError(message);
        } else {
          hasRenderedPage = true;
          window.clearTimeout(slowTimer);
          setLoadError(null);
          setLoadStage("ready");
        }
        resizeCompact();
      };
      eventBus.on("pagerendered", reportRender);
      eventBus.on("scalechanging", ({ scale }: { scale: number }) => {
        setRenderedZoom(scale);
        resizeCompact();
      });
      eventBus.on("pagechanging", resizeCompact);
      eventBus.on("updateviewarea", ({ location }: { location: { pageNumber: number; left: number; top: number } }) => {
        if (initialized) locationRef.current = { pageNumber: location.pageNumber, left: location.left, top: location.top };
      });
      eventBus.on("pagesinit", () => {
        if (!viewer || controller.signal.aborted) return;
        initialized = true;
        viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, latest.current.page ?? savedLocation?.pageNumber ?? 1));
        if (container.clientWidth > 0) viewer.currentScaleValue = zoomRef.current === null ? "page-width" : String(zoomRef.current);
        if (savedLocation && !latest.current.page) {
          viewer.scrollPageIntoView({
            pageNumber: Math.min(viewer.pagesCount, savedLocation.pageNumber),
            destArray: [null, { name: "XYZ" }, savedLocation.left, savedLocation.top, null],
            ignoreDestinationZoom: true,
            allowNegativeOffset: true,
          });
        }
        resizeCompact();
        setReady(version => version + 1);
      });
      observer = new ResizeObserver(() => {
        if (!viewer || !initialized) return;
        if (previousWidth !== container.clientWidth) {
          previousWidth = container.clientWidth;
          if (zoomRef.current === null && container.clientWidth > 0) viewer.currentScaleValue = "page-width";
        }
        resizeCompact();
        viewer.update();
      });
      observer.observe(container);
      observer.observe(host);

      container.addEventListener("click", event => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest("a, button, input, textarea, select")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        const element = target.closest<HTMLElement>(".page[data-page-number]");
        if (!element || !viewer) return;
        const number = Number(element.dataset.pageNumber);
        const view = viewer.getPageView(number - 1);
        if (!view?.pdfPage) return;
        const rect = element.getBoundingClientRect();
        const [pdfX, pdfY] = view.viewport.convertToPdfPoint(
          (event.clientX - rect.left - element.clientLeft) * view.viewport.width / element.clientWidth,
          (event.clientY - rect.top - element.clientTop) * view.viewport.height / element.clientHeight,
        );
        // SyncTeX uses points from the top-left. PDF destinations use points
        // from the bottom-left, with the page box providing the origin.
        const [left, , , top] = view.pdfPage.view;
        const { project: currentProject, artifactId: currentArtifact, onJumpToSource: jump } = latest.current;
        const clickedViewer = viewer;
        void synctexEditAction(currentProject, number, pdfX - left, top - pdfY, currentArtifact).then(result => {
          if (!controller.signal.aborted && viewer === clickedViewer && result.ok) jump?.(result.edit.file, result.edit.line);
        }).catch(reason => {
          if (!controller.signal.aborted && !isBackendTransportError(reason) && !isBackendUnavailable()) setError(reason instanceof Error ? reason.message : "Could not locate the PDF source.");
        });
      }, { signal: controller.signal });

      loadingTask = getDocument({ url: src, withCredentials: true });
      loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (!controller.signal.aborted && total > 0) setLoadProgress(Math.min(100, Math.round(loaded / total * 100)));
      };
      const pdf = await loadingTask.promise;
      if (controller.signal.aborted) return;
      setPages(pdf.numPages);
      setLoadStage("rendering");
      linkService.setDocument(pdf);
      viewer.setDocument(pdf);
    };
    void start().catch(reason => {
      if (controller.signal.aborted) return;
      const transport = isBackendTransportError(reason) || isBackendUnavailable();
      if (!transport) setLoadError(reason instanceof Error ? reason.message : "Could not open the PDF.");
      if (transport || retryOnReconnectRef.current) setTransportLoadFailure(true);
    });
    return () => {
      window.clearTimeout(slowTimer);
      // Capture a scroll that happened just before React replaced the artifact,
      // including moves whose animation-frame scroll observer is still queued.
      if (initialized && viewer?.pdfDocument) viewer.update();
      controller.abort();
      observer?.disconnect();
      // The installed implementation uses null to cancel page views and reset.
      if (viewer) (viewer.setDocument as (document: PDFDocumentProxy | null) => void)(null);
      if (viewerRef.current === viewer) viewerRef.current = null;
      void loadingTask?.destroy();
    };
  }, [src, Boolean(page), compact, isBackendUnavailable, loadAttempt]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer?.pdfDocument || !ready) return;
    const container = scrollerRef.current;
    if (zoom === null && !container?.clientWidth) return;
    const horizontalCenter = container && container.scrollWidth > container.clientWidth
      ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth
      : 0.5;
    viewer.currentScaleValue = zoom === null ? "page-width" : String(zoom);
    if (container) container.scrollLeft = Math.max(0, horizontalCenter * container.scrollWidth - container.clientWidth / 2);
  }, [zoom, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer?.pdfDocument || !ready || !page) return;
    viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, page));
  }, [page, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!sourceTarget || !viewer?.pdfDocument || !ready) return;
    if (followScrollFrameRef.current != null) window.cancelAnimationFrame(followScrollFrameRef.current);
    followScrollFrameRef.current = null;
    if (scrollSync) scrollSync.progress = null;
    const pdfDocument = viewer.pdfDocument;
    let cancelled = false;
    const navigate = async () => {
      const targetPage = Math.max(1, Math.min(viewer.pagesCount, sourceTarget.page));
      const pdfPage = await pdfDocument.getPage(targetPage);
      if (cancelled || viewerRef.current !== viewer) return;
      const [left, , , top] = pdfPage.view;
      viewer.scrollPageIntoView({
        pageNumber: targetPage,
        destArray: [null, { name: "XYZ" }, left + sourceTarget.x, top - sourceTarget.y, null],
        ignoreDestinationZoom: true,
        allowNegativeOffset: true,
        center: "vertical",
      });
    };
    void navigate().catch(reason => {
      if (!cancelled && !isBackendTransportError(reason) && !isBackendUnavailable()) setError(reason instanceof Error ? reason.message : "Could not locate the PDF position.");
    });
    return () => { cancelled = true; };
  }, [sourceTarget, ready, scrollSync]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scrollSync || !scroller || !ready || compact) return;
    let lastFrame: number | null = null;
    let followingPosition = scroller.scrollTop;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let smoothingMs = scrollFollowSmoothingMs();
    const animate = (time: number) => {
      followScrollFrameRef.current = null;
      if (userScrollingRef.current || scrollSync.progress == null) return;
      const range = scroller.scrollHeight - scroller.clientHeight;
      if (range <= 0) return;
      const target = Math.max(0, Math.min(1, scrollSync.progress)) * range;
      const elapsed = lastFrame === null ? 1000 / 60 : time - lastFrame;
      lastFrame = time;
      followingPosition = smoothScrollStep(followingPosition, target, elapsed, reducedMotion, smoothingMs);
      scroller.scrollTop = followingPosition;
      if (Math.abs(target - followingPosition) >= 0.75) followScrollFrameRef.current = window.requestAnimationFrame(animate);
    };
    const follow = () => {
      userScrollingRef.current = false;
      if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
      if (followScrollFrameRef.current != null) return;
      followingPosition = scroller.scrollTop;
      lastFrame = null;
      smoothingMs = scrollFollowSmoothingMs();
      followScrollFrameRef.current = window.requestAnimationFrame(animate);
    };
    scrollSync.follow = follow;
    if (scrollSync.progress != null) follow();
    return () => {
      if (scrollSync.follow === follow) scrollSync.follow = null;
      if (followScrollFrameRef.current != null) window.cancelAnimationFrame(followScrollFrameRef.current);
      followScrollFrameRef.current = null;
    };
  }, [scrollSync, ready, compact]);
  useEffect(() => () => {
    if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
  }, []);

  const beginUserScroll = () => {
    if (followScrollFrameRef.current != null) window.cancelAnimationFrame(followScrollFrameRef.current);
    followScrollFrameRef.current = null;
    if (scrollSync) scrollSync.progress = null;
    userScrollingRef.current = true;
    if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = window.setTimeout(() => { userScrollingRef.current = false; }, 180);
    onScrollStart?.();
  };

  const changeZoom = (direction: -1 | 1) => setZoom(current => {
    const scale = current ?? renderedZoom;
    const steps = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    return direction > 0
      ? steps.find(step => step > scale + 0.001) ?? 4
      : steps.reverse().find(step => step < scale - 0.001) ?? 0.1;
  });

  return (
    <div className={`${styles.viewer}${compact ? ` ${styles.compact}` : ""}`}>
      {!hideStatus && observationMessage && (
        <p className={styles.notice} role="status">{observationMessage}</p>
      )}
      {!hideStatus && error && <p className={styles.error} role="alert">{error}</p>}
      <div ref={stageRef} className={styles.stage}>
      {stale && <span className={styles.staleNotice} title="The source has changed since this PDF was compiled.">Previous PDF</span>}
      {!hideStatus && (loadStage !== "ready" || loadError) && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingCard} role={loadError ? "alert" : "status"}>
            {!loadError && <span className={styles.loadingSpinner} aria-hidden="true" />}
            <span>{loadError ? "Could not display the PDF." : loadSlow ? "PDF is taking longer than expected." : loadStage === "opening" ? `Opening PDF${loadProgress !== null && loadProgress < 100 ? ` ${loadProgress}%` : "…"}` : "Rendering PDF pages…"}</span>
            {(loadError || loadSlow) && (
              <div className={styles.loadingActions}>
                <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry</button>
                <a href={src} target="_blank" rel="noreferrer">Open PDF</a>
              </div>
            )}
            {loadError && <span className={styles.loadingDetail}>{loadError}</span>}
          </div>
        </div>
      )}
      <div ref={scrollerRef} className={styles.scrollport} aria-label="PDF pages" tabIndex={0}
        onWheelCapture={beginUserScroll} onTouchStartCapture={beginUserScroll} onPointerDownCapture={beginUserScroll} onKeyDownCapture={beginUserScroll}
        onScroll={event => {
          const scroller = event.currentTarget;
          const range = scroller.scrollHeight - scroller.clientHeight;
          if (!compact && range > 0 && userScrollingRef.current) {
            if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
            userScrollTimerRef.current = window.setTimeout(() => { userScrollingRef.current = false; }, 180);
            onScrollProgress?.(Math.max(0, Math.min(1, scroller.scrollTop / range)));
          }
        }}>
        <div ref={hostRef} className={`pdfViewer ${styles.pages}`} />
      </div>
      </div>
      <div className={`p-glass-sm ${styles.toolbar}`} role="toolbar" aria-label="PDF viewing">
        {compact && pages > 0 && <span>PDF figure</span>}
        <div className={styles.zoomControls}>
          <FastTooltip label="Zoom out">
            <button type="button" aria-label="Zoom out" disabled={pages === 0 || renderedZoom <= 0.1} onClick={() => changeZoom(-1)}><Minus size={13} /></button>
          </FastTooltip>
          <output aria-label="PDF zoom" className={styles.zoomReadout}>{Math.round(renderedZoom * 100)}%</output>
          <FastTooltip label="Zoom in">
            <button type="button" aria-label="Zoom in" disabled={pages === 0 || renderedZoom >= 4} onClick={() => changeZoom(1)}><Plus size={13} /></button>
          </FastTooltip>
          <FastTooltip label="Fit to width">
            <button type="button" aria-label="Fit to width" aria-pressed={zoom === null} disabled={pages === 0} className={styles.fitButton} onClick={() => { setZoom(null); if (scrollerRef.current) scrollerRef.current.scrollLeft = 0; }}><Maximize2 size={12} /><span>Fit</span></button>
          </FastTooltip>
        </div>
        <a href={src} target="_blank" rel="noreferrer">Open PDF</a>
      </div>
    </div>
  );
}
