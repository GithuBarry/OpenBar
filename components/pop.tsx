"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export function useOpen(open: boolean, ms = 180) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const id = window.setTimeout(() => setPresent(false), ms);
    return () => window.clearTimeout(id);
  }, [ms, open]);
  return present;
}

export function Pop({
  open,
  origin = "tl",
  className,
  children,
}: {
  open: boolean;
  origin?: "tl" | "br";
  className?: string;
  children: ReactNode;
}) {
  const present = useOpen(open);
  if (!present) return null;
  return (
    <div className={cn("ob-pop", origin === "br" && "ob-pop-br", !open && "is-leave", className)}>
      {children}
    </div>
  );
}

export function AnchoredPop({
  open,
  anchorRef,
  origin = "tl",
  className,
  onDismiss,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  origin?: "tl" | "br";
  className?: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const present = useOpen(open);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!present) {
      setBox(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (origin === "br") {
        setBox({
          position: "fixed",
          top: rect.bottom + 6,
          right: Math.max(8, window.innerWidth - rect.right),
          visibility: "hidden",
        });
        return;
      }
      setBox({
        position: "fixed",
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
        width: Math.max(rect.width, 260),
        visibility: "hidden",
      });
    };
    place();
  }, [anchorRef, origin, present]);

  const hasBox = box !== null;
  useLayoutEffect(() => {
    if (!present || !hasBox) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 6;
      const padding = 8;
      const popWidth = popRef.current?.offsetWidth ?? 0;
      const popHeight = popRef.current?.offsetHeight ?? 0;

      if (origin === "br") {
        const right = Math.max(padding, Math.min(window.innerWidth - rect.right, window.innerWidth - popWidth - padding));
        const aboveTop = rect.top - gap - popHeight;
        const belowTop = rect.bottom + gap;
        const fitsAbove = popHeight > 0 && aboveTop >= padding;
        const fitsBelow = popHeight > 0 && belowTop + popHeight <= window.innerHeight - padding;
        const top = fitsAbove
          ? aboveTop
          : fitsBelow
            ? belowTop
            : Math.max(padding, Math.min(belowTop, window.innerHeight - Math.max(popHeight, 1) - padding));
        setBox({
          position: "fixed",
          top,
          right,
          visibility: "visible",
        });
        return;
      }

      const width = Math.max(rect.width, 260);
      const left = Math.max(padding, Math.min(rect.left, window.innerWidth - Math.max(popWidth, width) - padding));
      const belowTop = rect.bottom + gap;
      const aboveTop = rect.top - gap - popHeight;
      const top = popHeight > 0 && belowTop + popHeight > window.innerHeight - padding && aboveTop >= padding
        ? aboveTop
        : belowTop;
      setBox({
        position: "fixed",
        top,
        left,
        width,
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
  }, [anchorRef, hasBox, origin, present]);

  useEffect(() => {
    if (!open || !onDismiss) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(".ob-pop")) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onDismiss, open]);

  if (!present || !box || typeof document === "undefined") return null;
  return createPortal(
    <div ref={popRef} className={cn("ob-pop", origin === "br" && "ob-pop-br", !open && "is-leave", className)} style={box}>
      {children}
    </div>,
    document.body,
  );
}
