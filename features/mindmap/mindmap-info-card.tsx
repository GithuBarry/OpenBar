"use client";

import { useEffect, useMemo, useState } from "react";

import { getProjectGitHistoryAction } from "@/app/actions";
import {
  buildMindmapInfoMetadata,
  type MindmapInfoGitCommit,
} from "@/lib/research/mindmap-info";
import type { Mindmap, MindmapNode } from "@/lib/types";

type InfoMindmap = Pick<Mindmap, "id" | "createdAt" | "updatedAt">;
type InfoNode = Pick<MindmapNode, "id" | "todoId" | "createdAt" | "updatedAt">;

export type MindmapInfoCardProps = {
  project: string;
  mindmap: InfoMindmap;
  node?: InfoNode | null;
  /** Pass the existing bounded history read when the parent already owns it. */
  history?: readonly MindmapInfoGitCommit[];
  historyMessage?: string | null;
  className?: string;
};

function dateLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MindmapInfoCard({
  project,
  mindmap,
  node,
  history: suppliedHistory,
  historyMessage: suppliedHistoryMessage,
  className,
}: MindmapInfoCardProps) {
  const [fetchedHistory, setFetchedHistory] = useState<MindmapInfoGitCommit[]>([]);
  const [fetchedHistoryMessage, setFetchedHistoryMessage] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(suppliedHistory === undefined);

  useEffect(() => {
    if (suppliedHistory !== undefined) {
      setHistoryLoading(false);
      return;
    }

    let active = true;
    setHistoryLoading(true);
    void getProjectGitHistoryAction(project, undefined, 1)
      .then((result) => {
        if (!active) return;
        setFetchedHistory(result.ok ? result.commits : []);
        setFetchedHistoryMessage(result.ok ? null : result.message || "Git history is unavailable for this project.");
      })
      .catch((error) => {
        if (!active) return;
        setFetchedHistory([]);
        setFetchedHistoryMessage(error instanceof Error ? error.message : "Git history is unavailable for this project.");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [project, suppliedHistory]);

  const metadata = useMemo(
    () => buildMindmapInfoMetadata(mindmap, node, suppliedHistory ?? fetchedHistory),
    [fetchedHistory, mindmap, node, suppliedHistory],
  );
  const historyMessage = suppliedHistory !== undefined ? suppliedHistoryMessage : fetchedHistoryMessage;
  const git = metadata.git;
  const targetLabel = metadata.target.kind === "mindmap-node" ? "Card info" : "Mindmap info";
  const classes = ["mindmap-card-info text-xs", className].filter(Boolean).join(" ");

  return (
    <aside className={classes} aria-label={targetLabel}>
      <dl className="mt-2 grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-faint">{node?.todoId ? "Added to map" : "Created"}</dt>
          <dd className="text-right text-muted">
            {metadata.authored.createdAt ? <time dateTime={metadata.authored.createdAt}>{dateLabel(metadata.authored.createdAt)}</time> : "Unavailable"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-faint">{node?.todoId ? "Map card edited" : "Last edited"}</dt>
          <dd className="text-right text-muted">
            {metadata.authored.updatedAt ? <time dateTime={metadata.authored.updatedAt}>{dateLabel(metadata.authored.updatedAt)}</time> : "Unavailable"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-line pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Latest project commit</p>
        {historyLoading ? (
          <p className="mt-1 text-muted">Loading history…</p>
        ) : git ? (
          <dl className="mt-1 grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-faint">Commit date</dt>
              <dd className="text-right text-muted"><time dateTime={git.commitDate}>{dateLabel(git.commitDate)}</time></dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-faint">Author</dt>
              <dd className="max-w-[65%] truncate text-right text-muted">{git.author || "Unknown author"}</dd>
            </div>
            <div className="text-muted">
              <span className="text-faint">Message · </span>{git.message || "Untitled commit"}
            </div>
            <div className="text-muted">
              <span className="text-faint">Hash · </span><code>{git.hash.slice(0, 12)}…</code>
            </div>

          </dl>
        ) : (
          <p className="mt-1 text-muted">{historyMessage || "No Git commit in the supplied history window."}</p>
        )}
      </div>
    </aside>
  );
}
