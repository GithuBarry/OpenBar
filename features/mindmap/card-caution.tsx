"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";

import styles from "./card-caution.module.css";

export function CardCaution({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const suppressFocusOpen = useRef(false);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => {
    clearCloseTimer();
    setOpen(true);
  };
  const hide = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      const focused = document.activeElement;
      if (focused?.matches(":focus-visible") && (
        focused === triggerRef.current || contentRef.current?.contains(focused)
      )) return;
      setOpen(false);
    }, 150);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  if (!text?.trim()) return null;

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} nodrag nopan`}
        aria-label="Caution scratchpad"
        title=""
        onPointerEnter={event => { if (event.pointerType !== "touch") show(); }}
        onPointerLeave={event => { if (event.pointerType !== "touch") hide(); }}
        onFocus={event => {
          if (!suppressFocusOpen.current && event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={hide}
        onKeyDown={event => {
          if (event.key === "Tab" && !event.shiftKey && open && bodyRef.current) {
            event.preventDefault();
            event.stopPropagation();
            clearCloseTimer();
            bodyRef.current.focus();
          }
        }}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          clearCloseTimer();
          event.stopPropagation();
        }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        ref={contentRef}
        className={`${styles.scratchpad} nodrag nopan`}
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        role="tooltip"
        aria-label="Caution scratchpad"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => {
          event.preventDefault();
          clearCloseTimer();
          if (restoreFocus.current) {
            restoreFocus.current = false;
            suppressFocusOpen.current = true;
            triggerRef.current?.focus();
            suppressFocusOpen.current = false;
          }
        }}
        onEscapeKeyDown={() => {
          clearCloseTimer();
          restoreFocus.current = Boolean(contentRef.current?.contains(document.activeElement));
        }}
        onPointerEnter={event => { if (event.pointerType !== "touch") show(); }}
        onPointerLeave={event => { if (event.pointerType !== "touch") hide(); }}
        onFocus={show}
        onBlur={hide}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Tab" && event.target === bodyRef.current) {
            clearCloseTimer();
            triggerRef.current?.focus();
            if (event.shiftKey) event.preventDefault();
            else setOpen(false);
          }
        }}
      >
        <div className={styles.heading}>Caution scratchpad</div>
        <div ref={bodyRef} className={styles.body} tabIndex={0}>{text}</div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
