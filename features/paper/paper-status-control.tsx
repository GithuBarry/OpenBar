"use client";

import { useEffect, useState } from "react";
import { Cog, LockKeyhole, RefreshCw } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { SaveStatusIcon, type SaveRemoteState, type StatusPillTone } from "@/components/save-sync-status";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { hostBusyDetail, type EditorIssue } from "@/lib/editor-issue-priority";
import styles from "./paper-outline-rail.module.css";

export function PaperStatusControl({
  saved, saving, conflict = false, remote, gitIssue, gitDescription, localIssue, pdfCurrent, compiling, compileError, compileDelayed, onCompile, onGitIssue, onLocalIssue, onResumeCompile, onConnectionIssue, onForceSync, primaryIssue,
}: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  remote: SaveRemoteState;
  gitIssue: string | null;
  gitDescription: string;
  localIssue: string | null;
  pdfCurrent: boolean;
  compiling: boolean;
  compileError: string | null;
  compileDelayed: boolean;
  onCompile: () => void;
  onGitIssue: () => void;
  onLocalIssue: () => void;
  onResumeCompile: () => void;
  onConnectionIssue: () => void;
  onForceSync?: () => void;
  primaryIssue?: EditorIssue | null;
}) {
  const session = useProjectWriteSession();
  const reconnecting = session.connectionState === "reconnecting";
  const host = !reconnecting && !primaryIssue && !conflict && !localIssue && !gitIssue && !compileError
    ? hostBusyDetail(session.hostResources) : null;
  const status = localIssue || (saving ? "Saving changes" : saved ? "Saved locally" : "Unsaved changes");
  const gitStatus = gitIssue || gitDescription;
  const pdfStatus = compiling ? "Compiling PDF" : compileError ? `PDF compile failed: ${compileError}` : pdfCurrent ? "PDF is up to date" : "PDF needs recompiling";
  const action = reconnecting ? "Open connection details" : localIssue ? "Open save details" : gitIssue ? "Open Git sync details" : compileDelayed ? "Resume checking the compile job" : compiling ? "Compiling PDF" : "Press to recompile PDF";
  const label = [reconnecting ? "Reconnecting to OpenBar" : primaryIssue?.title || host, status, gitStatus, pdfStatus, action, onForceSync ? "⌥-click: Sync Git now" : null, session.canRelease ? "⇧-click: Release edit access" : null].filter(Boolean).join(". ");
  const saveIcon = <SaveStatusIcon saved={saved} saving={saving} remote={remote} conflict={conflict} attention={Boolean(gitIssue || localIssue)} size={18} connectionUnavailable={reconnecting} hostBusy={Boolean(host)} />;

  let pillCue: string | null = null;
  let pillTone: StatusPillTone | undefined;
  if (reconnecting) {
    pillCue = "Offline";
    pillTone = "warn";
  } else if (conflict || localIssue) {
    pillCue = conflict ? "Conflict" : "Save error";
    pillTone = "danger";
  } else if (gitIssue) {
    pillCue = "Sync Git";
    pillTone = remote === "failed" || remote === "unavailable" ? "danger" : "warn";
  } else if (compileError) {
    pillCue = "PDF !";
    pillTone = "danger";
  }

  const [retainedCue, setRetainedCue] = useState<string>("");
  useEffect(() => {
    if (pillCue) setRetainedCue(pillCue);
  }, [pillCue]);
  const displayCue = pillCue || retainedCue;

  const handleClick = reconnecting
    ? onConnectionIssue
    : host
      ? undefined
      : localIssue
        ? onLocalIssue
        : gitIssue
          ? onGitIssue
          : compileDelayed
            ? onResumeCompile
            : onCompile;

  return <FastTooltip label={label}>
    <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.unifiedStatus)}
      data-status-tone={pillTone}
      onClick={(event) => {
        if (event.shiftKey && session.canRelease) { event.preventDefault(); void session.release(); return; }
        if (event.altKey && onForceSync) { event.preventDefault(); onForceSync(); return; }
        handleClick?.();
      }} disabled={!reconnecting && compiling && !gitIssue && !localIssue && !compileDelayed && !onForceSync && !session.canRelease} aria-disabled={host ? true : undefined} data-editor-notice={reconnecting || undefined} aria-label={label}>
      <span className={cn(styles.statusIcon, "ob-mod-swap")} aria-hidden="true">
        <span className="ob-mod-primary">
          {reconnecting || host || gitIssue || localIssue ? saveIcon
            : compiling ? <Cog size={16} className={cn(styles.compileGear, styles.compileRunning)} />
              : compileError ? <><Cog size={16} /><span className={styles.statusBadge}>!</span></>
                : <>
                    <span className={styles.statusChecks}>{saveIcon}</span>
                    <Cog size={16} className={styles.statusHoverGear} />
                  </>}
        </span>
        {onForceSync && <span className="ob-mod-alt"><RefreshCw size={15} /></span>}
        {session.canRelease && <span className="ob-mod-shift"><LockKeyhole size={15} /></span>}
      </span>
      <span className="ob-status-label-track" data-open={pillCue ? "true" : "false"} aria-hidden={!pillCue}>
        <span className="ob-status-label-inner">{displayCue}</span>
      </span>
    </button>
  </FastTooltip>;
}
