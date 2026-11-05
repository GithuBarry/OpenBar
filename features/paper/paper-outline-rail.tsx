"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
type JumpBookmark = { title: string; slug: string; line: number; level: number };
import styles from "./paper-outline-rail.module.css";

function sectionExcerpt(pane: HTMLElement | null, heading: HTMLElement | null | undefined): string {
  if (!pane || !heading) return "";
  const elements = [...pane.querySelectorAll<HTMLElement>("[data-ob-heading-key], p, li, figcaption")];
  const start = elements.indexOf(heading);
  if (start < 0) return "";
  for (const element of elements.slice(start + 1)) {
    if (element.hasAttribute("data-ob-heading-key")) break;
    if (heading.contains(element) || element.closest("table, pre, .katex")) continue;
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length >= 24) return text.slice(0, 180);
  }
  return "";
}

export function PaperOutlineRail({ bookmarks, activeSlug, onJump, previewRef }: {
  bookmarks: JumpBookmark[];
  activeSlug: string;
  onJump: (bookmark: JumpBookmark) => void;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  const [preview, setPreview] = useState<{ slug: string; title: string; parent: string; excerpt: string; x: number; y: number } | null>(null);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!preview) return;
    const previewSlug = preview.slug;
    function handlePreviewKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (target instanceof Element && (railRef.current?.contains(target) || target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], .cm-editor"))) return;
      if (event.key === "Escape") {
        setPreview(null);
        return;
      }
      const index = bookmarks.findIndex((bookmark) => bookmark.slug === previewSlug);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowDown") next = Math.min(bookmarks.length - 1, index + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = bookmarks.length - 1;
      else return;
      event.preventDefault();
      const button = railRef.current?.querySelectorAll<HTMLButtonElement>("button")[next];
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", handlePreviewKey);
    return () => window.removeEventListener("keydown", handlePreviewKey);
  }, [preview, bookmarks]);

  const baseLevel = Math.min(...bookmarks.map((bookmark) => bookmark.level));
  const activeIndex = Math.max(0, bookmarks.findIndex((bookmark) => bookmark.slug === activeSlug));
  const activeParents = new Set<string>();
  let ancestorLevel = bookmarks[activeIndex]?.level ?? 0;
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const bookmark = bookmarks[index];
    if (bookmark.level < ancestorLevel) {
      activeParents.add(bookmark.slug);
      ancestorLevel = bookmark.level;
    }
  }
  if (bookmarks.length === 0) return null;

  function showPreview(bookmark: JumpBookmark, button: HTMLButtonElement) {
    const bounds = button.getBoundingClientRect();
    const pane = previewRef.current;
    const heading = pane?.querySelector<HTMLElement>(`.ob-pv-heading[data-ob-heading-key="${CSS.escape(bookmark.slug)}"]`);
    const excerpt = sectionExcerpt(pane, heading);
    const index = bookmarks.findIndex((item) => item.slug === bookmark.slug);
    const parent = bookmarks.slice(0, index).reverse().find((item) => item.level < bookmark.level)?.title || "";
    setPreview({ slug: bookmark.slug, title: bookmark.title, parent, excerpt, x: Math.max(12, Math.min(bounds.right + 6, window.innerWidth - 280)), y: Math.max(12, Math.min(bounds.top - 12, window.innerHeight - 160)) });
  }

  return (
    <nav ref={railRef} className={styles.rail} aria-label="Paper outline">
      <div className={styles.track}>
        {bookmarks.map((bookmark, index) => (
          <button key={bookmark.slug} type="button" className={styles.mark} data-depth={Math.min(3, bookmark.level - baseLevel)} aria-label={`Jump to ${bookmark.title}`} data-active-parent={activeParents.has(bookmark.slug) || undefined} aria-current={index === activeIndex ? "location" : undefined} aria-describedby={preview?.slug === bookmark.slug ? "paper-outline-preview" : undefined} tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onJump(bookmark)}
            onMouseEnter={(event) => showPreview(bookmark, event.currentTarget)} onMouseLeave={() => setPreview(null)}
            onFocus={(event) => showPreview(bookmark, event.currentTarget)} onBlur={() => setPreview(null)}
            onKeyDown={(event) => {
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
              if (!buttons) return;
              let next = index;
              if (event.key === "ArrowDown") next = Math.min(bookmarks.length - 1, index + 1);
              else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = bookmarks.length - 1;
              else if (event.key === "Escape") { setPreview(null); return; }
              else return;
              event.preventDefault();
              buttons[next]?.focus({ preventScroll: true });
              buttons[next]?.scrollIntoView({ block: "nearest" });
            }}>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      {preview && createPortal(
        <div id="paper-outline-preview" className={styles.preview} role="tooltip" style={{ left: preview.x, top: preview.y }}>
          {preview.parent && <span className={styles.parent}>{preview.parent}</span>}
          <strong>{preview.title}</strong>
          {preview.excerpt && <p>{preview.excerpt}</p>}
          <span className={styles.hint}>Click to jump or use ↑ ↓ to explore</span>
        </div>, document.body,
      )}
    </nav>
  );
}
