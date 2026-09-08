"use client";

import { useState, type RefObject } from "react";
import { createPortal } from "react-dom";
type JumpBookmark = { title: string; slug: string; line: number; level: number };
import styles from "./paper-outline-rail.module.css";

export function PaperOutlineRail({ bookmarks, activeSlug, onJump, previewRef }: {
  bookmarks: JumpBookmark[];
  activeSlug: string;
  onJump: (bookmark: JumpBookmark) => void;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  const [preview, setPreview] = useState<{ slug: string; title: string; parent: string; excerpt: string; x: number; y: number } | null>(null);
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
    const heading = pane?.querySelector<HTMLElement>(`[data-ob-heading-key="${CSS.escape(bookmark.slug)}"]`);
    let next = heading?.nextElementSibling;
    let excerpt = heading?.querySelector("p")?.textContent || "";
    while (next && !next.hasAttribute("data-ob-heading-key") && excerpt.length < 140) {
      excerpt += ` ${next.textContent || ""}`;
      next = next.nextElementSibling;
    }
    const index = bookmarks.findIndex((item) => item.slug === bookmark.slug);
    const parent = bookmarks.slice(0, index).reverse().find((item) => item.level < bookmark.level)?.title || "Paper";
    setPreview({ slug: bookmark.slug, title: bookmark.title, parent, excerpt: excerpt.trim().slice(0, 180), x: Math.max(12, Math.min(bounds.right + 12, window.innerWidth - 280)), y: Math.max(12, Math.min(bounds.top - 12, window.innerHeight - 160)) });
  }

  return (
    <nav className={styles.rail} aria-label="Paper outline">
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
          <span className={styles.parent}>{preview.parent}</span>
          <strong>{preview.title}</strong>
          {preview.excerpt && <p>{preview.excerpt}</p>}
          <span className={styles.hint}>Click to jump · ↑ ↓ to explore</span>
        </div>, document.body,
      )}
    </nav>
  );
}
