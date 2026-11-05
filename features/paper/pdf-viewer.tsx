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
  onJumpToSource,
  page,
  compact = false,
}: {
  project: string;
  src: string;
  stale?: boolean;
  observationMessage?: string;
  artifactId?: string;
  sourceTarget?: PdfSourceTarget | null;
  onJumpToSource?: (file: string, line: number) => void;
  page?: number;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [renderedZoom, setRenderedZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const latest = useRef({ project, artifactId, onJumpToSource, page });
  latest.current = { project, artifactId, onJumpToSource, page };
  const locationRef = useRef<{ pageNumber: number; left: number; top: number } | null>(null);

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
    let previousWidth = container.clientWidth;
    const savedLocation = locationRef.current;
    setPages(0);
    setError(null);

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
        // PDFViewer accepts this lifecycle signal in the installed 6.3.289
        // implementation. Its generated declarations omit the option.
        ...{ abortSignal: controller.signal },
      });
      viewerRef.current = viewer;
      linkService.setViewer(viewer);
      const resizeCompact = () => {
        if (!compact || !viewer || !initialized) return;
        const current = viewer.getPageView(viewer.currentPageNumber - 1);
        if (current) stage.style.height = `${Math.ceil(current.div.getBoundingClientRect().height + 2)}px`;
      };
      const reportRender = ({ error: reason }: { error?: unknown }) => {
        if (controller.signal.aborted) return;
        if (reason) setError(reason instanceof Error ? reason.message : "Could not render the PDF.");
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
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not locate the PDF source.");
        });
      }, { signal: controller.signal });

      loadingTask = getDocument({ url: src, withCredentials: true });
      const pdf = await loadingTask.promise;
      if (controller.signal.aborted) return;
      setPages(pdf.numPages);
      linkService.setDocument(pdf);
      viewer.setDocument(pdf);
    };
    void start().catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open the PDF.");
    });
    return () => {
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
  }, [src, Boolean(page), compact]);

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
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not locate the PDF position.");
    });
    return () => { cancelled = true; };
  }, [sourceTarget, ready]);

  const changeZoom = (factor: number) => setZoom(current => Math.min(4, Math.max(0.1, (current ?? renderedZoom) * factor)));

  return (
    <div className={`${styles.viewer}${compact ? ` ${styles.compact}` : ""}`}>
      {observationMessage && (
        <p className={styles.notice} role="status">{observationMessage}</p>
      )}
      {stale && (
        <p className={styles.notice}>Showing the last successful PDF. Source has changed.</p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.toolbar} role="toolbar" aria-label="PDF viewing">
        {pages > 0 && <span>{compact ? "PDF figure" : `${pages} page${pages === 1 ? "" : "s"}`}</span>}
        <div className={styles.zoomControls}>
          <FastTooltip label="Zoom out">
            <button type="button" aria-label="Zoom out" disabled={pages === 0 || renderedZoom <= 0.1} onClick={() => changeZoom(1 / 1.2)}><Minus size={13} /></button>
          </FastTooltip>
          <output aria-label="PDF zoom" className={styles.zoomReadout}>{Math.round(renderedZoom * 100)}%</output>
          <FastTooltip label="Zoom in">
            <button type="button" aria-label="Zoom in" disabled={pages === 0 || renderedZoom >= 4} onClick={() => changeZoom(1.2)}><Plus size={13} /></button>
          </FastTooltip>
          <FastTooltip label="Fit to width">
            <button type="button" aria-label="Fit to width" aria-pressed={zoom === null} disabled={pages === 0} className={styles.fitButton} onClick={() => { setZoom(null); if (scrollerRef.current) scrollerRef.current.scrollLeft = 0; }}><Maximize2 size={12} /><span>Fit</span></button>
          </FastTooltip>
        </div>
        <a href={src} target="_blank" rel="noreferrer">Open PDF</a>
      </div>
      <div ref={stageRef} className={styles.stage}>
      <div ref={scrollerRef} className={styles.scrollport} aria-label="PDF pages" tabIndex={0}>
        <div ref={hostRef} className={`pdfViewer ${styles.pages}`} />
      </div>
      </div>
    </div>
  );
}
