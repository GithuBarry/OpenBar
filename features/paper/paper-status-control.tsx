"use client";

import { Circle, CircleAlert, Cog, LoaderCircle, RefreshCw } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { SaveChecks } from "@/components/save-sync-status";
import { cn } from "@/lib/utils";
import styles from "./paper-outline-rail.module.css";

export function PaperStatusControl({
  saved, saving, gitSynced, gitIssue, gitDescription, localIssue, pdfCurrent, compiling, compileError, compileDelayed, onCompile, onGitIssue, onLocalIssue, onResumeCompile,
}: {
  saved: boolean;
  saving: boolean;
  gitSynced: boolean;
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
  return <FastTooltip label={label}>
    <button type="button" className={cn("p-button p-button-glass ob-glass-button", styles.unifiedStatus)}
      onClick={gitIssue ? onGitIssue : localIssue ? onLocalIssue : compileDelayed ? onResumeCompile : onCompile} disabled={compiling && !gitIssue && !localIssue && !compileDelayed} aria-label={label}>
      <span className={styles.statusIcon} aria-hidden="true">
        {gitIssue ? <><RefreshCw size={16} /><span className={styles.statusBadge}>!</span></>
          : localIssue ? <CircleAlert size={16} />
          : compiling ? <Cog size={16} className={cn(styles.compileGear, styles.compileRunning)} />
            : compileError ? <><Cog size={16} /><span className={styles.statusBadge}>!</span></>
              : saving || !saved ? <><span className={styles.statusChecks}>{saving ? <LoaderCircle size={16} className={styles.statusSpinner} /> : <Circle size={9} fill="currentColor" />}</span><Cog size={16} className={styles.statusHoverGear} /></>
                : <>
                  <span className={styles.statusChecks}><SaveChecks saved={saved} synced={gitSynced} size={18} /></span>
                  <Cog size={16} className={styles.statusHoverGear} />
                </>}
      </span>
    </button>
  </FastTooltip>;
}
