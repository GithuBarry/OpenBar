"use client";

import { cloneElement, type HTMLAttributes, type ReactElement } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import styles from "./fast-tooltip.module.css";

export function FastTooltip({ label, children }: {
  label: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{cloneElement(children, { title: undefined })}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} side="top" sideOffset={6} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
