"use client";

import { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { RichText } from "@/components/rich-text";
import type { CardNavigationItem } from "./child-navigation";
import previewStyles from "./child-navigation.module.css";
import styles from "./parent-navigation.module.css";

export function ParentNavigation({ cardTitle, item, onJump }: {
  cardTitle: string;
  item?: CardNavigationItem;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!item) return null;
  return <nav className={`${styles.anchor} nodrag nopan`} aria-label={`Parent of ${cardTitle}`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    }}>
    <Tooltip.Root delayDuration={60} open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.point} aria-label={`Jump to parent: ${item.title || (item.format === "html" ? "HTML card" : "Untitled card")}`}
          onFocus={() => setOpen(true)}
          onClick={() => { setOpen(false); onJump(item.id); }} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={previewStyles.preview} side="left" sideOffset={10} align="center" collisionPadding={12}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <strong><RichText text={item.title || (item.format === "html" ? "HTML card" : "Untitled card")} format={item.format === "html" ? "plain" : item.format} /></strong>
          {item.body.trim() && <div className={previewStyles.body}><RichText text={item.body} format={item.format} /></div>}
          <span className={previewStyles.hint}>Enter to jump to parent</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </nav>;
}
