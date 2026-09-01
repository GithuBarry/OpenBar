"use client";

import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
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
          bottom: window.innerHeight - rect.top + 6,
          right: window.innerWidth - rect.right,
        });
        return;
      }
      setBox({
        position: "fixed",
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
        width: Math.max(rect.width, 260),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, origin, present]);

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
    <div className={cn("ob-pop", origin === "br" && "ob-pop-br", !open && "is-leave", className)} style={box}>
      {children}
    </div>,
    document.body,
  );
}
