"use client";

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactElement } from "react";
import { createPortal } from "react-dom";

import styles from "./fast-tooltip.module.css";

let warmUntil = 0;
let activeTooltip: { id: string; hide: () => void } | null = null;

export function FastTooltip({ label, children }: {
  label: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<CSSProperties>({ visibility: "hidden" });

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const show = (anchor: HTMLElement, delay: number) => {
    if (activeTooltip?.id !== id) activeTooltip?.hide();
    activeTooltip = { id, hide };
    clearTimer();
    anchorRef.current = anchor;
    if (delay === 0) setOpen(true);
    else timerRef.current = setTimeout(() => { timerRef.current = null; setOpen(true); }, delay);
  };
  const hide = () => {
    clearTimer();
    if (activeTooltip?.id === id) activeTooltip = null;
    if (open) warmUntil = Date.now() + 700;
    setOpen(false);
    setBox({ visibility: "hidden" });
  };

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (activeTooltip?.id === id) activeTooltip = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const rect = anchor.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const above = rect.top - height - 6;
      const below = rect.bottom + 20;
      setBox({
        left: Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8)),
        top: above >= 8 ? above : Math.min(below, window.innerHeight - height - 8),
        visibility: "visible",
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, label]);

  return <>
    {cloneElement(children, {
      title: "",
      "aria-describedby": open ? [children.props["aria-describedby"], id].filter(Boolean).join(" ") : children.props["aria-describedby"],
      onPointerEnter: event => {
        children.props.onPointerEnter?.(event);
        if (event.pointerType !== "touch") show(event.currentTarget, Date.now() < warmUntil ? 0 : 150);
      },
      onPointerLeave: event => {
        children.props.onPointerLeave?.(event);
        hide();
      },
      onPointerDown: event => {
        children.props.onPointerDown?.(event);
        hide();
      },
      onFocus: event => {
        children.props.onFocus?.(event);
        if (event.currentTarget.matches(":focus-visible")) show(event.currentTarget, 0);
      },
      onBlur: event => {
        children.props.onBlur?.(event);
        hide();
      },
      onKeyDown: event => {
        children.props.onKeyDown?.(event);
        if (event.key === "Escape") hide();
      },
    })}
    {open && createPortal(<div ref={popRef} id={id} role="tooltip" className={styles.tooltip} style={box}>{label}</div>, document.body)}
  </>;
}
