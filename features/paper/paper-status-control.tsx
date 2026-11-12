"use client";

import { Cog } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { SaveStatusIcon, type SaveRemoteState } from "@/components/save-sync-status";
import { cn } from "@/lib/utils";
import styles from "./paper-outline-rail.module.css";

export function PaperStatusControl({
  saved, saving, conflict = false, remote, gitIssue, gitDescription, localIssue, pdfCurrent, compiling, compileError, compileDelayed, onCompile, onGitIssue, onLocalIssue, onResumeCompile,
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
}) {
  const status = localIssue || (saving ? "Saving changes" : saved ? "Saved locally" : "Unsaved changes");
  const gitStatus = gitIssue || gitDescription;
  const pdfStatus = compiling ? "Compiling PDF" : compileError ? `PDF compile failed: ${compileError}` : pdfCurrent ? "PDF is up to date" : "PDF needs recompiling";
  const action = gitIssue ? "Open Git sync details" : localIssue ? "Open save details" : compileDelayed ? "Resume checking the compile job" : compiling ? "Compiling PDF" : "Press to recompile PDF";
  const label = `${status}. ${gitStatus}. ${pdfStatus}. ${action}.`;
  const saveIcon = <SaveStatusIcon saved={saved} saving={saving} remote={remote} conflict={conflict} attention={Boolean(gitIssue || localIssue)} size={18} />;
  return <FastTooltip label={label}>
    <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.unifiedStatus)}
      onClick={gitIssue ? onGitIssue : localIssue ? onLocalIssue : compileDelayed ? onResumeCompile : onCompile} disabled={compiling && !gitIssue && !localIssue && !compileDelayed} aria-label={label}>
      <span className={styles.statusIcon} aria-hidden="true">
        {gitIssue || localIssue ? saveIcon
          : compiling ? <Cog size={16} className={cn(styles.compileGear, styles.compileRunning)} />
            : compileError ? <><Cog size={16} /><span className={styles.statusBadge}>!</span></>
              : <>
                  <span className={styles.statusChecks}>{saveIcon}</span>
                  <Cog size={16} className={styles.statusHoverGear} />
                </>}
      </span>
    </button>
  </FastTooltip>;
}
