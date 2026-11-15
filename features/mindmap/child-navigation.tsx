"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Popover from "@radix-ui/react-popover";
import { RichText } from "@/components/rich-text";
import { childPortLayout } from "@/lib/mindmap/child-ports";
import styles from "./child-navigation.module.css";

export type CardNavigationItem = {
  id: string;
  title: string;
  body: string;
  format?: "plain" | "markdown" | "tex";
};

export function ChildNavigation({ parentTitle, items, height, onJump }: {
  parentTitle: string;
  items: CardNavigationItem[];
  height: number;
  onJump: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverOpen = useRef(false);
  const layout = childPortLayout(items.map(item => item.id), height);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { if (!layout.grouped) { hoverOpen.current = false; setGroupOpen(false); } }, [layout.grouped]);
  if (!items.length) return null;

  function closeGroupSoon() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (groupRef.current?.contains(document.activeElement)) return;
      hoverOpen.current = false;
      setGroupOpen(false);
    }, 180);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setActiveId(null);
      hoverOpen.current = false;
      setGroupOpen(false);
      railRef.current?.closest("[data-mind-node]")?.querySelector<HTMLButtonElement>(".mindmap-collapse-toggle")?.focus();
      return;
    } else return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return <nav ref={railRef} className={`${styles.rail} nodrag nopan`} aria-label={`Children of ${parentTitle}`} style={{ height }} data-grouped={layout.grouped || undefined}
    onKeyDown={onKeyDown} onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {layout.grouped ? <Popover.Root open={groupOpen} onOpenChange={open => { clearTimeout(closeTimer.current); hoverOpen.current = false; setGroupOpen(open); }}>
      <Popover.Trigger asChild>
        <button type="button" className={`${styles.tick} ${styles.groupTick}`} style={{ top: "50%" }} data-child-port={layout.ports[0].id}
          aria-label={`Preview ${items.length} child cards`}
          onPointerEnter={event => { if (event.pointerType === "mouse") { clearTimeout(closeTimer.current); hoverOpen.current = !groupOpen; setGroupOpen(true); } }}
          onPointerLeave={closeGroupSoon}
          onClick={event => { if (event.detail > 0 && hoverOpen.current) { event.preventDefault(); hoverOpen.current = false; } }}>
          <span className={styles.groupCount}>{items.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content ref={groupRef} className={`${styles.preview} ${styles.childList}`} side="right" sideOffset={10} align="center" collisionPadding={12}
          aria-label={`Children of ${parentTitle}`}
          onOpenAutoFocus={event => { if (hoverOpen.current) event.preventDefault(); }}
          onPointerEnter={() => clearTimeout(closeTimer.current)} onPointerLeave={closeGroupSoon}
          onWheel={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
          onKeyDown={onKeyDown}>
          {items.map(item => <button type="button" key={item.id} onClick={() => { hoverOpen.current = false; setGroupOpen(false); onJump(item.id); }}>
            <RichText text={item.title || "Untitled card"} format={item.format} />
          </button>)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root> : items.map((item, index) => <Tooltip.Root key={item.id} delayDuration={60} open={activeId === item.id}
      onOpenChange={open => setActiveId(current => open ? item.id : current === item.id ? null : current)}>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.tick} style={{ top: `${layout.ports[index].top}%` }} data-child-port={layout.ports[index].id} aria-label={`Jump to ${item.title || "Untitled card"}`}
          onFocus={() => setActiveId(item.id)}
          onClick={() => { setActiveId(null); onJump(item.id); }} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.preview} side="right" sideOffset={10} align="start" collisionPadding={12}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <strong><RichText text={item.title || "Untitled card"} format={item.format} /></strong>
          {item.body.trim() && <div className={styles.body}><RichText text={item.body} format={item.format} /></div>}
          <span className={styles.hint}>↑ ↓ preview · Enter to jump</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>)}
  </nav>;
}
