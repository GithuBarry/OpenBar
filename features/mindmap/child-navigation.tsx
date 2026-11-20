"use client";

import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { RichText } from "@/components/rich-text";
import { childPortLayout } from "@/lib/mindmap/child-ports";
import styles from "./child-navigation.module.css";

export type CardNavigationItem = {
  id: string;
  title: string;
  body: string;
  format?: "plain" | "markdown" | "tex" | "html";
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable], .cm-editor"));
}

export function ChildNavigation({ parentTitle, items, height, onJump }: {
  parentTitle: string;
  items: CardNavigationItem[];
  height: number;
  onJump: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    if (!activeId) return;
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      const list = itemsRef.current;
      const index = list.findIndex(item => item.id === activeId);
      if (index < 0) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActiveId(null);
        if (railRef.current?.contains(document.activeElement)) {
          railRef.current.closest("[data-mind-node]")?.querySelector<HTMLButtonElement>(".mindmap-collapse-toggle")?.focus();
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const targetId = list[index]!.id;
        setActiveId(null);
        onJumpRef.current(targetId);
        return;
      }

      if (list.length <= 1) return;
      let next = -1;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % list.length;
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      if (next < 0) return;

      event.preventDefault();
      event.stopPropagation();
      const nextItem = list[next]!;
      setActiveId(nextItem.id);
      if (railRef.current?.contains(document.activeElement)) {
        railRef.current.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [activeId]);

  const layout = childPortLayout(items.map(item => item.id), height);
  if (!items.length) return null;

  return <nav ref={railRef} className={`${styles.rail} nodrag nopan`} data-exploring={activeId ? "true" : undefined} aria-label={`Children of ${parentTitle}`} style={{ height }}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {items.map((item, index) => <Tooltip.Root key={item.id} delayDuration={60} open={activeId === item.id}
      onOpenChange={open => setActiveId(current => open ? item.id : current === item.id ? null : current)}>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.tick} style={{ top: `${layout.ports[index].top}%`, height: layout.hitHeight }} data-child-port={layout.ports[index].id} aria-label={`Jump to ${item.title || (item.format === "html" ? "HTML card" : "Untitled card")}`}
          onFocus={() => setActiveId(item.id)}
          onClick={() => { const targetId = activeId || item.id; setActiveId(null); onJump(targetId); }} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.previewWrap} side="right" sideOffset={10} align="start" collisionPadding={12}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <div className={styles.preview}>
            <strong><RichText text={item.title || (item.format === "html" ? "HTML card" : "Untitled card")} format={item.format === "html" ? "plain" : item.format} /></strong>
            {item.body.trim() && <div className={styles.body}><RichText text={item.body} format={item.format} /></div>}
          </div>
          <span className={styles.hint}>{items.length > 1 ? `Click to jump (${index + 1}/${items.length}), ↑ ↓ to explore` : "Click to jump"}</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>)}
  </nav>;
}
