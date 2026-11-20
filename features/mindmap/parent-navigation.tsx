"use client";

import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { RichText } from "@/components/rich-text";
import type { CardNavigationItem } from "./child-navigation";
import previewStyles from "./child-navigation.module.css";
import styles from "./parent-navigation.module.css";

function isOutsideInteractive(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable], .cm-editor")) return true;
  if (container?.contains(target)) return false;
  return Boolean(target.closest('button, a, summary, [role="menuitem"], [role="option"], [data-radix-popper-content-wrapper]'));
}

export function ParentNavigation({ cardTitle, item, onJump }: {
  cardTitle: string;
  item?: CardNavigationItem;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const itemIdRef = useRef(item?.id);
  itemIdRef.current = item?.id;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    if (!item) setOpen(false);
  }, [item]);

  useEffect(() => {
    if (!open) return;
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isOutsideInteractive(event.target, navRef.current)) return;
      if (document.querySelector("[data-ob-modal]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      } else if (event.key === "Enter" && itemIdRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const targetId = itemIdRef.current;
        setOpen(false);
        onJumpRef.current(targetId);
      }
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [open]);

  if (!item) return null;
  return <nav ref={navRef} className={`${styles.anchor} nodrag nopan`} aria-label={`Parent of ${cardTitle}`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}>
    <Tooltip.Root delayDuration={60} open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.point} aria-label={`Jump to parent: ${item.title || (item.format === "html" ? "HTML card" : "Untitled card")}`}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => { setOpen(false); onJump(item.id); }} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={previewStyles.previewWrap} side="left" sideOffset={10} align="center" collisionPadding={12}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <div className={previewStyles.preview}>
            <strong><RichText text={item.title || (item.format === "html" ? "HTML card" : "Untitled card")} format={item.format === "html" ? "plain" : item.format} /></strong>
            {item.body.trim() && <div className={previewStyles.body}><RichText text={item.body} format={item.format} /></div>}
          </div>
          <span className={previewStyles.hint}>Click or Enter to jump to parent</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </nav>;
}
