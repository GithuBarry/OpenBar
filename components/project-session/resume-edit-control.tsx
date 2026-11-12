"use client";

import { Info, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-write-session";
import styles from "./resume-edit-control.module.css";

export function ResumeEditControl({ className, embedded = false, suppressError = false }: { className?: string; embedded?: boolean; suppressError?: boolean }) {
  const session = useProjectWriteSession();
  if (session.writable || session.connectionState === "reconnecting") return null;
  const failed = Boolean(session.accessError) && !suppressError;
  return <div className={cn(styles.control, !embedded && "p-glass-sm", !embedded && styles.floating, className)} data-resume-edit>
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
