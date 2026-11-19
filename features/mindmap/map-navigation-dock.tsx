"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
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
  return <Popover.Root open={expanded} onOpenChange={next => {
    clearTimeout(closeTimer.current);
    transientOpen.current = false;
    if (compact) setOpen(next);
  }}>
    <Popover.Anchor asChild>
    <div ref={rootRef} className={styles.widget} data-map-navigation data-compact={compact || undefined} role="group" aria-label="Map navigation and history"
      onPointerDownCapture={event => { pointerType.current = event.pointerType; }}
      onFocusCapture={() => {
        clearTimeout(closeTimer.current);
        if (suppressFocus.current) { suppressFocus.current = false; return; }
        if (pointerType.current === "touch") { pointerType.current = ""; return; }
        show();
      }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon(); }}
      onKeyDown={event => event.stopPropagation()}>
      <Popover.Trigger asChild><button ref={triggerRef} type="button" className={styles.toggle} hidden={!compact} aria-label="Map navigation and history controls" title="Map navigation and history"
        onClick={event => {
          if (transientOpen.current) { event.preventDefault(); transientOpen.current = false; setOpen(true); }
        }}>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <Move size={16} aria-hidden="true" />}
      </button></Popover.Trigger>
      <Popover.Content forceMount className={styles.panel} hidden={!expanded} inert={!expanded} role={compact ? "dialog" : "group"} aria-label="Map navigation and history actions" side="top" align="start" sideOffset={compact ? 6 : 0} collisionPadding={12}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if (!compact || !open || rootRef.current?.contains(event.target as Node)) event.preventDefault(); }}
        onEscapeKeyDown={event => {
          if (!compact || !open) { event.preventDefault(); return; }
          event.stopPropagation();
          if (document.activeElement !== triggerRef.current) { suppressFocus.current = true; triggerRef.current?.focus(); }
        }}>
        <div className={styles.zoom} data-mindmap-zoom-controls role="group" aria-label="Zoom and pan" />
        <div className={styles.history}>{children}</div>
      </Popover.Content>
    </div>
    </Popover.Anchor>
  </Popover.Root>;
}
