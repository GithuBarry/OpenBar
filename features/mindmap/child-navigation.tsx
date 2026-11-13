"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { RichText } from "@/components/rich-text";
import styles from "./child-navigation.module.css";

export type CardNavigationItem = {
  id: string;
  title: string;
  body: string;
  format?: "plain" | "markdown" | "tex";
};

export function ChildNavigation({ parentTitle, items, onJump }: {
  parentTitle: string;
  items: CardNavigationItem[];
  onJump: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  if (!items.length) return null;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    const buttons = Array.from(railRef.current?.querySelectorAll<HTMLButtonElement>("button") || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setActiveId(null);
      railRef.current?.closest("[data-mind-node]")?.querySelector<HTMLButtonElement>(".mindmap-collapse-toggle")?.focus();
      return;
    } else return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return <nav ref={railRef} className={`${styles.rail} nodrag nopan`} aria-label={`Children of ${parentTitle}`}
    onKeyDown={onKeyDown} onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {items.map(item => <Tooltip.Root key={item.id} delayDuration={60} open={activeId === item.id}
      onOpenChange={open => setActiveId(current => open ? item.id : current === item.id ? null : current)}>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.tick} aria-label={`Jump to ${item.title || "Untitled card"}`}
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
