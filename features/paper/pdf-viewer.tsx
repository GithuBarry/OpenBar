"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnnotationLayer,
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";

import { synctexEditAction } from "@/app/actions";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type PdfSourceTarget = { page: number; x: number; y: number; width?: number; height?: number };

export function PdfJsViewer({
  project,
  src,
  stale,
  artifactId,
  sourceTarget,
  onJumpToSource,
  page,
  compact = false,
}: {
  project: string;
  src: string;
  stale?: boolean;
  artifactId?: string;
  sourceTarget?: PdfSourceTarget | null;
  onJumpToSource?: (file: string, line: number) => void;
  page?: number;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setPages(0);
    setError(null);
    const task = getDocument({ url: src, withCredentials: true });
    void task.promise.then(async (pdf) => {
      if (cancelled) {
        await pdf.cleanup();
        return;
      }
      const previous = docRef.current;
      docRef.current = pdf;
      loaded = pdf;
      void previous?.cleanup();
      setPages(pdf.numPages);
      setError(null);
      setDocumentVersion((version) => version + 1);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open the PDF.");
    });
    return () => {
      cancelled = true;
      void task.destroy();
      if (docRef.current === loaded) {
        void loaded?.cleanup();
        docRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    const host = hostRef.current;
    const pdf = docRef.current;
    if (!host || !pdf || pages === 0) return;
    let cancelled = false;
    const layers: Array<{ canvas: HTMLCanvasElement; text?: TextLayer; annotation?: AnnotationLayer }> = [];
    const renderTasks: Array<{ cancel: () => void }> = [];
    const pageNumbers = page
      ? [Math.max(1, Math.min(pages, page))]
      : Array.from({ length: pages }, (_, index) => index + 1);
    const deviceScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const linkService = {
      addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow = false) {
        if (!url) return;
        link.href = url;
        link.rel = "noreferrer noopener";
        if (newWindow) link.target = "_blank";
      },
      getDestinationHash: () => "#",
      goToDestination: () => undefined,
      getAnchorUrl: (hash: string) => hash || "#",
      executeNamedAction: () => undefined,
    };
    const render = async () => {
      host.replaceChildren();
      for (const pageNumber of pageNumbers) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.15 });
        const wrapper = document.createElement("div");
        wrapper.dataset.page = String(pageNumber);
        wrapper.className = compact
          ? "pdf-viewer-page relative mb-2 w-full max-w-2xl overflow-hidden rounded border border-line bg-white shadow-xs"
          : "pdf-viewer-page relative mb-3 w-full max-w-3xl overflow-hidden rounded border border-line bg-white shadow-xs";
        wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        wrapper.style.width = `${viewport.width}px`;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.className = "relative z-0 block h-auto w-full cursor-crosshair";
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        const context = canvas.getContext("2d");
        if (!context) continue;
        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
        });
        renderTasks.push(renderTask);
        await renderTask.promise;
        if (cancelled) {
          renderTask.cancel();
          return;
        }
        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        const annotationLayerDiv = document.createElement("div");
        annotationLayerDiv.className = "annotationLayer";
        wrapper.appendChild(canvas);
        wrapper.appendChild(textLayerDiv);
        wrapper.appendChild(annotationLayerDiv);
        host.appendChild(wrapper);
        const textContent = await page.getTextContent();
        const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
        await textLayer.render();
        const annotations = await page.getAnnotations({ intent: "display" });
        const annotationLayer = new AnnotationLayer({
          div: annotationLayerDiv,
          accessibilityManager: null,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          page,
          viewport,
          structTreeLayer: null,
          commentManager: null,
          annotationStorage: undefined,
          linkService: linkService as never,
        });
        await annotationLayer.render({
          annotations,
          div: annotationLayerDiv,
          page,
          viewport,
          linkService: linkService as never,
          renderForms: false,
        });
        canvas.addEventListener("click", (event) => {
          const rect = canvas.getBoundingClientRect();
          const viewportX = (event.clientX - rect.left) * (viewport.width / rect.width);
          const viewportY = (event.clientY - rect.top) * (viewport.height / rect.height);
          const [pdfX, pdfY] = viewport.convertToPdfPoint(viewportX, viewportY);
          void synctexEditAction(project, pageNumber, pdfX, pdfY, artifactId).then((result) => {
            if (result.ok) onJumpToSource?.(result.edit.file, result.edit.line);
          });
        });
        layers.push({ canvas, text: textLayer, annotation: annotationLayer });
      }
    };
    void render().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not render the PDF.");
    });
    return () => {
      cancelled = true;
      for (const task of renderTasks) task.cancel();
      for (const layer of layers) {
        layer.text?.cancel();
        layer.annotation?.destroy();
        layer.canvas.replaceWith();
      }
    };
  }, [artifactId, compact, documentVersion, onJumpToSource, page, pages, project]);

  useEffect(() => {
    if (!sourceTarget || !hostRef.current) return;
    const target = hostRef.current.querySelector(`[data-page="${sourceTarget.page}"]`) as HTMLElement | null;
    target?.scrollIntoView({ block: "center" });
  }, [sourceTarget]);

  return (
    <div className={compact ? "relative min-h-0 overflow-hidden" : "relative h-full min-h-0 overflow-auto bg-canvas/40 p-4"}>
      {stale && (
        <p className="mb-3 text-[11px] font-medium text-warn">Showing the last successful PDF. Source has changed.</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-faint">
        {pages > 0 && <span>{compact ? "PDF figure" : `${pages} page${pages === 1 ? "" : "s"}`}</span>}
        <a className="text-accent hover:underline" href={src} target="_blank" rel="noreferrer">Open PDF</a>
      </div>
      <div ref={hostRef} />
    </div>
  );
}
