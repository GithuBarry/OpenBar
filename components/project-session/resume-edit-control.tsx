"use client";

import { Info, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-write-session";
import styles from "./resume-edit-control.module.css";

export function ResumeEditControl({ className }: { className?: string }) {
  const session = useProjectWriteSession();
  if (session.writable) return null;
  return <div className={cn(styles.control, className)} data-resume-edit>
    <FastTooltip label={session.accessMessage}><span className={styles.trigger} tabIndex={session.accessError ? 0 : undefined}>
      <button type="button" disabled={!session.canRestore} onClick={session.restore} aria-label="Resume edit">
        {session.canRestore ? <LockKeyholeOpen size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
        <span>{session.accessError ? "Resume edit failed" : "Resume edit"}</span>
        {session.accessError && <Info size={13} aria-hidden="true" />}
      </button>
    </span></FastTooltip>
    <span className="sr-only" role="status">{session.accessMessage}</span>
    <FastTooltip label="Check editing access again"><button type="button" className={styles.retry} disabled={session.checking} aria-label="Check again" aria-busy={session.checking} onClick={() => { void session.check(); }}><RefreshCw size={14} aria-hidden="true" /></button></FastTooltip>
  </div>;
}
