"use client";

import { memo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { AnchoredPop } from "@/components/pop";
import { refId, referenceFields, type BibEntry } from "@/lib/bibtex";
import styles from "./citation-preview.module.css";

import { sanitizeHtmlFragmentSync } from "@/lib/html-policy";
import type { PreviewBlock } from "@/lib/tex-project/preview-html";
import type { EditorTodo } from "./tex-source";

const PdfJsViewer = dynamic(() => import("./pdf-viewer").then((module) => module.PdfJsViewer), { ssr: false });

type AnnotationDetail = { label: string; text: string; section: string; source: string; from?: number; to?: number };
type InlineDetail = { pinned: boolean } & ({ kind: "citation"; key: string } | ({ kind: "annotation" } & AnnotationDetail));

function PdfFigure({ project, src, page }: { project: string; src: string; page?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "400px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} style={{ minHeight: 240 }}>{visible ? <PdfJsViewer project={project} src={src} page={page} compact /> : <div className="flex min-h-60 items-center justify-center text-xs text-muted">PDF figure</div>}</div>;
}

export const TexPreview = memo(function TexPreview({
  project,
  blocks,
  bibliography = [],
  todos = [],
  todoDisabled = false,
  onToggleTodo,
  onNavigate,
  onShowSource,
}: {
  project: string;
  blocks: PreviewBlock[];
  bibliography?: BibEntry[];
  todos?: EditorTodo[];
  todoDisabled?: boolean;
  onToggleTodo?: (todoId: string, completed: boolean) => Promise<boolean>;
  onNavigate?: () => void;
  onShowSource?: (source: string, from?: number, to?: number) => void;
}) {
  const previewRoot = useRef<HTMLDivElement>(null);
  const [todoPending, setTodoPending] = useState(false);
  const todoPendingRef = useRef(false);
  useEffect(() => {
    const byId = new Map(todos.filter(todo => todo.id).map(todo => [todo.id, todo]));
    for (const input of previewRoot.current?.querySelectorAll<HTMLInputElement>("input[data-ob-todo-id]") || []) {
      const todo = byId.get(input.dataset.obTodoId);
      input.disabled = todoDisabled || todoPending || !onToggleTodo || !todo;
      if (todo) {
        input.checked = todo.completed;
        input.setAttribute("aria-label", `TODO completed: ${todo.title || todo.text}`);
        const block = input.closest<HTMLElement>(".ob-todo-inline");
        if (block) block.dataset.completed = String(todo.completed);
      }
    }
  }, [blocks, todos, todoDisabled, todoPending, onToggleTodo]);
  const [detail, setDetail] = useState<InlineDetail | null>(null);
  const citation = detail?.kind === "citation" ? detail : null;
  const annotation = detail?.kind === "annotation" ? detail : null;
  const [copyStatus, setCopyStatus] = useState("");
  const anchor = useRef<HTMLElement | null>(null);
  const referenceTarget = useRef<HTMLElement | null>(null);
  const annotationTarget = useRef<AnnotationDetail | null>(null);
  const detailPanel = useRef<HTMLDivElement | null>(null);
  const restoringFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  const closeSoon = () => { cancelClose(); if (!detail?.pinned) timer.current = setTimeout(() => setDetail(null), 220); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = (target: EventTarget, pinned = false) => {
    if (target instanceof Element && target.closest("input[data-ob-todo-id]")) return false;
    const link = target instanceof Element ? target.closest<HTMLElement>(".ob-cite[data-cite-key], [data-ob-annotation]") : null;
    if (!link) return false;
    cancelClose();
    const sameAnchor = anchor.current === link;
    anchor.current = link;
    setCopyStatus("");
    setDetail(current => {
      if (sameAnchor && current) return pinned && !current.pinned ? { ...current, pinned: true } : current;
      if (link.dataset.citeKey) return { kind: "citation", key: link.dataset.citeKey, pinned };
      const block = link.closest<HTMLElement>("[data-preview-from]");
      const from = Number(block?.dataset.previewFrom), to = Number(block?.dataset.previewTo);
      return { kind: "annotation", pinned, label: link.dataset.obAnnotation!, text: link.textContent?.trim() || "", source: link.dataset.annotationSource || "",
        section: block?.querySelector(".ob-pv-heading")?.textContent?.trim() || "",
        ...(Number.isFinite(from) ? { from } : {}), ...(Number.isFinite(to) ? { to } : {}),
      };
    });
    return true;
  };
  const entry = bibliography.find(entry => entry.key.toLowerCase() === citation?.key.toLowerCase());
  const fields = entry ? referenceFields(entry) : null;
  return (
    <div
      ref={previewRoot}
      onInput={event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || !input.matches("input[data-ob-todo-id]")) return;
        event.stopPropagation();
        if (!onToggleTodo || todoDisabled || todoPendingRef.current || !input.dataset.obTodoId) return;
        todoPendingRef.current = true;
        setTodoPending(true);
        void onToggleTodo(input.dataset.obTodoId, input.checked).finally(() => {
          todoPendingRef.current = false;
          setTodoPending(false);
        });
      }}
      onPointerMove={event => { if (event.pointerType === "mouse") show(event.target); }}
      onMouseOut={event => { const link = event.target instanceof Element ? event.target.closest(".ob-cite, [data-ob-annotation]") : null; if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) closeSoon(); }}
      onFocus={event => { if (!restoringFocus.current) show(event.target); }}
      onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest("input[data-ob-todo-id]")) return;
        if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.closest("[data-ob-annotation]")) {
          event.preventDefault(); show(event.target, true);
          requestAnimationFrame(() => detailPanel.current?.querySelector("button")?.focus());
        }
      }}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest("input[data-ob-todo-id]")) { event.stopPropagation(); return; }
        const reference = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.ob-tex-ref") : null;
        if (reference && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
          const target = document.getElementById(reference.hash.slice(1));
          if (target) {
            event.preventDefault();
            onNavigate?.();
            target.tabIndex = -1;
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "center", behavior: "instant" });
          }
        }
        if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) && show(event.target, true)) event.preventDefault();
      }}
      className={`${styles.preview} ob-tex-hast tex-document prose max-w-none`}>
      <AnchoredPop open={!!detail} anchorRef={anchor} onDismiss={() => setDetail(null)} className={styles.popover}
        onOpenAutoFocus={event => { if (!detail?.pinned) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = referenceTarget.current;
          referenceTarget.current = null;
          const source = annotationTarget.current;
          annotationTarget.current = null;
          restoringFocus.current = true;
          if (source) onShowSource?.(source.source, source.from, source.to);
          else if (target) {
            onNavigate?.();
            target.tabIndex = -1;
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "center", behavior: "instant" });
          } else anchor.current?.focus({ preventScroll: true });
          restoringFocus.current = false;
        }}>
        {citation && <div role="dialog" aria-label="Citation details" onMouseEnter={cancelClose} onMouseLeave={closeSoon}>
          <div className={styles.heading}><strong>{fields?.title || citation.key}</strong><button type="button" aria-label="Close citation" onClick={() => setDetail(null)}>×</button></div>
          {fields?.authors && <p>{fields.authors}</p>}
          {fields && <p className={styles.venue}>{[fields.venue, fields.year].filter(Boolean).join(", ")}</p>}
          <code>{citation.key}</code>
          <div className={styles.actions}>
            {fields?.url && <a href={fields.url} target="_blank" rel="noreferrer">Open paper ↗</a>}
            <button type="button" onClick={() => { referenceTarget.current = document.getElementById(refId(citation.key.toLowerCase())) || document.getElementById(refId(citation.key)); cancelClose(); setDetail(null); }}>Go to reference</button>
            <button type="button" onClick={() => { void (async () => { try { await navigator.clipboard.writeText(citation.key); setCopyStatus("Copied"); } catch { setCopyStatus("Copy unavailable"); } })(); }}>{copyStatus || "Copy key"}</button>
          </div>
        </div>}
        {annotation && <div ref={detailPanel} role="dialog" aria-label={`${annotation.label} details`} onMouseEnter={cancelClose} onMouseLeave={closeSoon}>
          <div className={styles.heading}><strong>{annotation.label}</strong><button type="button" aria-label="Close annotation" onClick={() => setDetail(null)}>×</button></div>
          {annotation.section && <p className={styles.venue}>{annotation.section}</p>}
          <p>{annotation.text}</p>
          {onShowSource && <div className={styles.actions}><button type="button" onClick={() => { annotationTarget.current = annotation; cancelClose(); setDetail(null); }}>Show in source</button></div>}
        </div>}
      </AnchoredPop>
      {blocks.map((block) => (
        block.kind === "source" ? (
          <pre
            key={block.key}
            className="ob-tex-source-block whitespace-pre-wrap break-words rounded-md border border-line bg-canvas/60 p-3 text-xs"
            data-preview-block={block.key}
            data-preview-from={block.sourceFrom}
            data-preview-to={block.sourceTo}
            title={block.diagnostic}
          >
            {block.diagnostic && <span className="mb-2 block text-danger">{block.diagnostic}</span>}
            {block.html}
          </pre>
        ) : block.kind === "figure" ? (
          <div key={block.key} data-preview-block={block.key} data-preview-from={block.sourceFrom} data-preview-to={block.sourceTo} className="ob-preview-figure">
            <PdfFigure project={project} src={block.src} page={block.page} />
            {block.caption && (
              <div className="ob-tex-caption" dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragmentSync(block.caption) }} />
            )}
          </div>
        ) : (
          <div
            key={block.key}
            data-preview-block={block.key}
            data-preview-from={block.sourceFrom}
            data-preview-to={block.sourceTo}
            data-ob-heading-key={block.headingKey}
          >
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragmentSync(block.html) }} />
          </div>
        )
      ))}
    </div>
  );
});
