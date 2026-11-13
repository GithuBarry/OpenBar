"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Move } from "lucide-react";
import styles from "./map-navigation-dock.module.css";

export function MapNavigationDock({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transientOpen = useRef(false);
  const suppressFocus = useRef(false);
  const pointerType = useRef("");
  const [compact, setCompact] = useState(true);
  const [open, setOpen] = useState(false);
  const expanded = !compact || open;
  useLayoutEffect(() => {
    const editor = rootRef.current?.closest<HTMLElement>("[data-mindmap-editor]");
    if (!editor) return;
    const measure = () => setCompact(editor.clientWidth <= 1100);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!compact || !open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { transientOpen.current = false; setOpen(false); }
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [compact, open]);
  const show = () => {
    clearTimeout(closeTimer.current);
    if (!open) { transientOpen.current = true; setOpen(true); }
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (rootRef.current?.contains(document.activeElement)) return;
      transientOpen.current = false;
      setOpen(false);
    }, 180);
  };
  return <div ref={rootRef} className={styles.widget} data-map-navigation data-compact={compact || undefined} role="group" aria-label="Zoom and history"
    onPointerEnter={event => { if (event.pointerType === "mouse") show(); }}
    onPointerLeave={event => { if (event.pointerType === "mouse") closeSoon(); }}
    onPointerDownCapture={event => { pointerType.current = event.pointerType; }}
    onFocusCapture={() => {
      clearTimeout(closeTimer.current);
      if (suppressFocus.current) { suppressFocus.current = false; return; }
      if (pointerType.current === "touch") { pointerType.current = ""; return; }
      show();
    }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && compact) {
        event.preventDefault();
        clearTimeout(closeTimer.current);
        transientOpen.current = false;
        setOpen(false);
        if (document.activeElement !== triggerRef.current) { suppressFocus.current = true; triggerRef.current?.focus(); }
      }
    }}>
    <button ref={triggerRef} type="button" className={styles.toggle} hidden={!compact} aria-label="Zoom and history controls" aria-expanded={expanded} title="Zoom and history"
      onClick={() => {
        clearTimeout(closeTimer.current);
        if (transientOpen.current) { transientOpen.current = false; setOpen(true); }
        else setOpen(current => !current);
      }}>
      {open ? <ChevronDown size={16} aria-hidden="true" /> : <Move size={16} aria-hidden="true" />}
    </button>
    <div className={styles.panel} hidden={!expanded} inert={!expanded} aria-label="Zoom and history actions">
      <div className={styles.zoom} data-mindmap-zoom-controls role="group" aria-label="Map zoom controls" />
      <div className={styles.history}>{children}</div>
    </div>
  </div>;
}
