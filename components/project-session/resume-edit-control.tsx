"use client";

import { Info, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { FastTooltip } from "@/components/fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-write-session";
import styles from "./resume-edit-control.module.css";

export function ResumeEditControl({ className, embedded = false, suppressError = false, attentionRequest = 0 }: { className?: string; embedded?: boolean; suppressError?: boolean; attentionRequest?: number }) {
  const session = useProjectWriteSession();
  const controlRef = useRef<HTMLDivElement>(null);
  const attentionAnimation = useRef<Animation | null>(null);
  const lastAttentionRequest = useRef(0);
  useEffect(() => {
    attentionAnimation.current?.cancel();
    attentionAnimation.current = null;
    if (lastAttentionRequest.current === attentionRequest) return;
    lastAttentionRequest.current = attentionRequest;
    const control = controlRef.current;
    if (!attentionRequest || session.writable || session.connectionState === "reconnecting" || !control) return;
    const baseShadow = getComputedStyle(control).boxShadow;
    const glow = `${baseShadow === "none" ? "" : `${baseShadow}, `}0 0 0 3px rgb(var(--accent) / .45), 0 0 24px rgb(var(--accent) / .3)`;
    const hold = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? .75 : .3;
    attentionAnimation.current = control.animate([
      { boxShadow: glow, offset: 0 },
      { boxShadow: glow, offset: hold },
      { boxShadow: baseShadow, offset: 1 },
    ], { duration: 1400, easing: "ease-out" });
    return () => {
      attentionAnimation.current?.cancel();
      attentionAnimation.current = null;
    };
  }, [attentionRequest, session.writable, session.connectionState]);
  if (session.writable || session.connectionState === "reconnecting") return null;
  const failed = Boolean(session.accessError) && !suppressError;
  return <div ref={controlRef} className={cn(styles.control, !embedded && "p-glass-sm", !embedded && styles.floating, className)} data-resume-edit data-resume-edit-attention={attentionRequest || undefined}>
    <FastTooltip label={session.accessMessage}><span className={styles.trigger} tabIndex={failed ? 0 : undefined}>
      <button type="button" className="p-button p-button-secondary" disabled={!session.canRestore} onClick={session.restore} aria-label="Resume edit" aria-busy={session.checking}>
        {session.canRestore ? <LockKeyholeOpen size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
        <span>{failed ? "Resume edit failed" : "Resume edit"}</span>
        {failed && <Info size={13} aria-hidden="true" />}
      </button>
    </span></FastTooltip>
    <span className="sr-only" role="status">{session.accessMessage}</span>
    <FastTooltip label="Check editing access again"><button type="button" className={cn("p-button p-button-borderless p-button-icon-only", styles.retry)} disabled={session.checking} aria-label="Check again" aria-busy={session.checking} onClick={() => { void session.check(); }}><RefreshCw size={14} aria-hidden="true" /></button></FastTooltip>
  </div>;
}
