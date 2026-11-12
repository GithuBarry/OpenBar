"use client";

import { useRef, type ReactNode, type RefObject, type ComponentProps } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export function PopoverSurface({ className, sideOffset = 8, collisionPadding = 12, ...props }: ComponentProps<typeof Popover.Content>) {
  return <Popover.Portal forceMount={props.forceMount}><Popover.Content className={cn("p-popover p-popover--no-arrow ob-pop", className)} sideOffset={sideOffset} collisionPadding={collisionPadding} {...props} /></Popover.Portal>
}

export function MenuSurface({ className, sideOffset = 8, collisionPadding = 12, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return <DropdownMenu.Portal><DropdownMenu.Content className={cn("p-menu ob-pop", className)} sideOffset={sideOffset} collisionPadding={collisionPadding} {...props} /></DropdownMenu.Portal>
}

export function AnchoredPop({ open, anchorRef, origin = "tl", className, onDismiss, onOpenAutoFocus, onCloseAutoFocus, children }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  origin?: "tl" | "br";
  className?: string;
  onDismiss?: () => void;
  onOpenAutoFocus?: ComponentProps<typeof Popover.Content>["onOpenAutoFocus"];
  onCloseAutoFocus?: ComponentProps<typeof Popover.Content>["onCloseAutoFocus"];
  children: ReactNode;
}) {
  const returnFocus = useRef(true);
  return (
    <Popover.Root open={open} onOpenChange={(next) => { if (!next) onDismiss?.(); }}>
      <Popover.Anchor virtualRef={anchorRef} />
        <PopoverSurface
          className={className}
          side={origin === "br" ? "top" : "bottom"}
          align={origin === "br" ? "end" : "start"}
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => { returnFocus.current = true; onOpenAutoFocus?.(event); }}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
            else returnFocus.current = false;
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (returnFocus.current) anchorRef.current?.focus();
          }}
        >
          {children}
        </PopoverSurface>
    </Popover.Root>
  );
}
