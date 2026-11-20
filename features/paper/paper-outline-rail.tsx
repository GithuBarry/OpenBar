"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
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
    if (text.length >= 24) return text.slice(0, 340);
  }
  return "";
}

export function PaperOutlineRail({ bookmarks, activeSlug, onJump, previewRef }: {
  bookmarks: JumpBookmark[];
  activeSlug: string;
  onJump: (bookmark: JumpBookmark) => void;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  const [preview, setPreview] = useState<{ slug: string; title: string; parent: string; excerpt: string } | null>(null);
  const railRef = useRef<HTMLElement>(null);

  function focusBookmark(index: number, key: string): boolean {
    const next = key === "ArrowDown" ? Math.min(bookmarks.length - 1, index + 1)
      : key === "ArrowUp" ? Math.max(0, index - 1)
      : key === "Home" ? 0 : key === "End" ? bookmarks.length - 1 : undefined;
    if (next === undefined) return false;
    const button = railRef.current?.querySelectorAll<HTMLButtonElement>("button")[next];
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest" });
    return true;
  }

  useEffect(() => {
    if (!preview) return;
    const previewSlug = preview.slug;
    function handlePreviewKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (target instanceof Element && (railRef.current?.contains(target) || target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], .cm-editor"))) return;
      const index = bookmarks.findIndex((bookmark) => bookmark.slug === previewSlug);
      if (index < 0) return;
      if (focusBookmark(index, event.key)) event.preventDefault();
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

  function showPreview(bookmark: JumpBookmark) {
    const pane = previewRef.current;
    const heading = pane?.querySelector<HTMLElement>(`.ob-pv-heading[data-ob-heading-key="${CSS.escape(bookmark.slug)}"]`);
    const excerpt = sectionExcerpt(pane, heading);
    const index = bookmarks.findIndex((item) => item.slug === bookmark.slug);
    const parent = bookmarks.slice(0, index).reverse().find((item) => item.level < bookmark.level)?.title || "";
    setPreview({ slug: bookmark.slug, title: bookmark.title, parent, excerpt });
  }

  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
    <nav ref={railRef} className={styles.rail} aria-label="Paper outline">
      <div className={styles.track}>
        {bookmarks.map((bookmark, index) => (
          <Tooltip.Root key={bookmark.slug} open={preview?.slug === bookmark.slug} onOpenChange={open => {
            if (open) showPreview(bookmark);
            else setPreview(current => current?.slug === bookmark.slug ? null : current);
          }}>
          <Tooltip.Trigger asChild>
          <button type="button" className={styles.mark} data-depth={Math.min(3, bookmark.level - baseLevel)} aria-label={`Jump to ${bookmark.title}`} data-active-parent={activeParents.has(bookmark.slug) || undefined} aria-current={index === activeIndex ? "location" : undefined} tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onJump(bookmark)}
            onKeyDown={(event) => {
              if (focusBookmark(index, event.key)) event.preventDefault();
            }}>
            <span aria-hidden="true" />
          </button>
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className={styles.previewWrap} side="right" align="start" sideOffset={6} alignOffset={-12} collisionPadding={12}>
            <div className={styles.preview}>
              {preview?.parent && <span className={styles.parent}>{preview.parent}</span>}
              <strong>{bookmark.title}</strong>
              {preview?.excerpt && <p>{preview.excerpt}</p>}
            </div>
            <span className={styles.hint}>Click to jump, ↑ ↓ to explore</span>
          </Tooltip.Content></Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
    </nav>
    </Tooltip.Provider>
  );
}
