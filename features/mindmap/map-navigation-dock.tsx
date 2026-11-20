"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const show = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(current => { if (!current) transientOpen.current = true; return true; });
  }, []);
  const closeSoon = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (rootRef.current?.contains(document.activeElement)) return;
      transientOpen.current = false;
      setOpen(false);
    }, 180);
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    const enter = (event: PointerEvent) => { if (event.pointerType === "mouse") show(); };
    const leave = (event: PointerEvent) => { if (event.pointerType === "mouse") closeSoon(); };
    root?.addEventListener("pointerenter", enter);
    root?.addEventListener("pointerleave", leave);
    return () => { root?.removeEventListener("pointerenter", enter); root?.removeEventListener("pointerleave", leave); clearTimeout(closeTimer.current); };
  }, [show, closeSoon]);
  useEffect(() => {
    if (!compact || !open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      clearTimeout(closeTimer.current);
      transientOpen.current = false;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [compact, open]);
  return (
    <div ref={rootRef} className={styles.widget} data-map-navigation data-compact={compact || undefined} role="group" aria-label="Map navigation and history"
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
        if (event.key === "Escape" && compact && open) {
          clearTimeout(closeTimer.current);
          transientOpen.current = false;
          setOpen(false);
          if (document.activeElement !== triggerRef.current) { suppressFocus.current = true; triggerRef.current?.focus(); }
        }
      }}>
      <button ref={triggerRef} type="button" className={styles.toggle} hidden={!compact} aria-expanded={compact ? open : undefined} aria-label="Map navigation and history controls" title="Map navigation and history"
        onClick={() => {
          clearTimeout(closeTimer.current);
          if (transientOpen.current) { transientOpen.current = false; setOpen(true); return; }
          setOpen(current => !current);
        }}>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <Move size={16} aria-hidden="true" />}
      </button>
      <div className={styles.panel} hidden={!expanded} inert={!expanded} role={compact ? "dialog" : "group"} aria-label="Map navigation and history actions">
        <div className={styles.zoom} data-mindmap-zoom-controls role="group" aria-label="Zoom and pan" />
        <div className={styles.history}>{children}</div>
      </div>
    </div>
  );
}
