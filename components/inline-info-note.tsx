"use client";

import { useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import styles from "./inline-info-note.module.css";

export function InlineInfoNote({ label, children }: { label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={60}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={`${styles.trigger} nodrag nopan`}
          aria-label={`More info: ${label}`}
          data-inline-info-trigger=""
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Info size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={styles.tooltip}
          data-inline-info-tooltip=""
          side="top"
          sideOffset={6}
          collisionPadding={10}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {children ?? label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
