"use client";

import { CloudOff } from "lucide-react";
import { useProjectWriteSession } from "./project-session/project-write-session";
import { EditorNotice } from "./editor-notice";
import { cn } from "@/lib/utils";
import type { EditorIssue } from "@/lib/editor-issue-priority";
import styles from "./project-session/resume-edit-control.module.css";

export function BackendStatusNotice({ project, issues, diagnosticContext, embedded = false, className, openRequest }: {
  project: string;
  issues: readonly EditorIssue[];
  diagnosticContext?: () => unknown;
  embedded?: boolean;
  className?: string;
  openRequest?: number;
}) {
  const session = useProjectWriteSession();
  if (session.connectionState !== "reconnecting") return null;
  return <div className={cn(styles.control, !embedded && "p-glass-sm", !embedded && styles.floating, className)} data-backend-connection data-resume-edit>
    <EditorNotice project={project} title="Connection to OpenBar" label="Reconnecting…"
      message="Waiting for OpenBar. Your edits remain in this tab."
      report={session.connectionError || undefined} icon={<CloudOff size={14} />} inline triggerClassName="p-button p-button-secondary"
      triggerLabel="Connection details" openRequest={openRequest} relatedIssues={issues.filter(issue => issue.severity !== "connection")} diagnosticContext={diagnosticContext}>
      <button type="button" disabled={session.checking} onClick={() => { void session.check(); }}>Check connection</button>
    </EditorNotice>
  </div>;
}
