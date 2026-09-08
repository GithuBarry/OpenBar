"use client";

import { useEffect, useMemo, useState } from "react";

import { getProjectGitHistoryAction } from "@/app/actions";
import type { RecentActivityItem, ProjectState } from "@/lib/research/project-state";

export type MindmapChangesHistoryEntry = {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
};

type ActivityEntry = {
  kind: "activity";
  at: string;
  href: string;
  title: string;
  description: string;
  detail?: string;
  item: RecentActivityItem;
};

type GitEntry = {
  kind: "git";
  at: string;
  href: string;
  title: string;
  description: string;
  detail?: string;
  commit: MindmapChangesHistoryEntry;
};

type ChangeEntry = ActivityEntry | GitEntry;

export type MindmapChangesViewProps = {
  project: string;
  recent: ProjectState["recent"];
  /** A parent may supply Git history when it already owns that read. */
  history?: MindmapChangesHistoryEntry[];
  historyMessage?: string | null;
};

const DEFAULT_WINDOW_DAYS = 7;
const MAX_VISIBLE_ENTRIES = 40;
const MAX_SUMMARY_ENTRIES = 12;

function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return calendarDate(date);
}

function parseDate(value: string): number {
  const parsed = Date.parse(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return value;
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string): string {
  const parsed = parseDate(value);
  if (!parsed) return value;
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readableOperation(operation?: string): string {
  if (!operation) return "Recorded an edit";
  const words = operation.replace(/[_-]+/g, " ").trim();
  if (!words) return "Recorded an edit";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function readableActor(actor?: RecentActivityItem["actor"]): string {
  if (actor === "webmcp") return "WebMCP agent";
  if (actor === "system") return "System";
  if (actor === "human") return "Human";
  return "Recorded activity";
}

function readableResourceKind(kind: string): string {
  if (kind === "mindmap-node") return "card";
  if (kind === "mindmap") return "mindmap";
  if (kind === "paper-todo") return "paper TODO";
  if (kind === "paper-section") return "paper section";
  if (kind === "paper-comment") return "paper comment";
  if (kind === "project") return "project";
  return kind.replace(/[_-]+/g, " ");
}

function displayValue(value: unknown): string {
  if (value === undefined) return "unset";
  if (value === null) return "empty";
  if (typeof value === "string") return value.trim() ? value : "empty text";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized ? serialized : "empty";
  } catch {
    return "unavailable";
  }
}

function shortValue(value: unknown, max = 180): string {
  const display = displayValue(value).replace(/\s+/g, " ");
  return display.length > max ? `${display.slice(0, max - 1)}…` : display;
}

function activityTarget(item: RecentActivityItem): string {
  if (item.title.trim()) return item.title.trim();
  if (item.nodeId) return item.nodeId;
  if (item.sectionId) return item.sectionId;
  if (item.resources?.[0]) return item.resources[0].id;
  return item.kind === "section_edit" ? "Paper section" : item.kind === "todo" ? "Paper TODO" : "Mindmap card";
}

function activityDescription(item: RecentActivityItem): string {
  const actor = readableActor(item.actor);
  const operation = readableOperation(item.operation);
  const target = activityTarget(item);
  const state = item.deleted ? " Deleted." : ".";
  return `${actor}: ${operation} “${target}”${state}`;
}

function activityDetail(item: RecentActivityItem): string | undefined {
  const resourceDetail = item.resources?.length
    ? item.resources
      .slice(0, 6)
      .map((resource) => `${readableResourceKind(resource.kind)} ${resource.id}`)
      .join(" · ")
    : undefined;
  const changeDetail = item.changes?.length
    ? item.changes
      .slice(0, 6)
      .map((change) => `${change.field}: ${shortValue(change.before)} → ${shortValue(change.after)}`)
      .join(" · ")
    : undefined;
  return [changeDetail, resourceDetail].filter(Boolean).join(" | ") || undefined;
}

function activityEntry(item: RecentActivityItem): ActivityEntry {
  return {
    kind: "activity",
    at: item.at,
    href: item.href,
    title: activityTarget(item),
    description: activityDescription(item),
    detail: activityDetail(item),
    item,
  };
}

function gitEntry(project: string, commit: MindmapChangesHistoryEntry): GitEntry {
  return {
    kind: "git",
    at: commit.date,
    href: `/p/${encodeURIComponent(project)}/paper`,
    title: commit.message || commit.hash.slice(0, 8),
    description: `Git commit by ${commit.author || "Unknown actor"}.`,
    detail: commit.files.length ? commit.files.slice(0, 8).join(" · ") : commit.hash.slice(0, 8),
    commit,
  };
}

function summaryLine(entry: ChangeEntry): string {
  const detail = entry.detail ? ` Details: ${entry.detail}.` : "";
  return `- ${formatDate(entry.at)} — ${entry.kind === "activity" ? entry.description : `${entry.title}: ${entry.description}`}${detail}`;
}

export function MindmapChangesView({
  project,
  recent,
  history: suppliedHistory,
  historyMessage: suppliedHistoryMessage,
}: MindmapChangesViewProps) {
  const [since, setSince] = useState(() => daysAgoDate(DEFAULT_WINDOW_DAYS));
  const [history, setHistory] = useState<MindmapChangesHistoryEntry[]>(suppliedHistory || []);
  const [historyMessage, setHistoryMessage] = useState<string | null>(suppliedHistoryMessage || null);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorText, setAdvisorText] = useState("");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (suppliedHistory) {
      setHistory(suppliedHistory);
      setHistoryMessage(suppliedHistoryMessage || null);
      return;
    }
    let active = true;
    setHistoryMessage(null);
    void getProjectGitHistoryAction(project, since, 40)
      .then((result) => {
        if (!active) return;
        setHistory(result.ok ? result.commits : []);
        setHistoryMessage(result.ok ? null : result.message || "Git history is unavailable for this project.");
      })
      .catch((error) => {
        if (!active) return;
        setHistory([]);
        setHistoryMessage(error instanceof Error ? error.message : "Git history is unavailable for this project.");
      });
    return () => { active = false; };
  }, [project, since, suppliedHistory, suppliedHistoryMessage]);

  const visible = useMemo(() => {
    const start = parseDate(since);
    const activity = recent
      .filter((item) => parseDate(item.at) >= start)
      .map(activityEntry);
    const commits = history
      .filter((commit) => parseDate(commit.date) >= start)
      .map((commit) => gitEntry(project, commit));
    return [...activity, ...commits]
      .sort((left, right) => parseDate(right.at) - parseDate(left.at))
      .slice(0, MAX_VISIBLE_ENTRIES);
  }, [history, project, recent, since]);

  const unknownActorCount = useMemo(
    () => visible.filter((entry) => entry.kind === "activity" && !entry.item.actor).length,
    [visible],
  );
  const boundedFeed = recent.length >= MAX_VISIBLE_ENTRIES;
  const olderThanOrientationWindow = parseDate(since) < parseDate(daysAgoDate(DEFAULT_WINDOW_DAYS));
  const advisorDraft = useMemo(() => {
    const lines = [
      `Project changes since ${since}`,
      ...visible.slice(0, MAX_SUMMARY_ENTRIES).map(summaryLine),
    ];
    if (unknownActorCount > 0) lines.push(`- ${unknownActorCount} recorded item${unknownActorCount === 1 ? " has" : "s have"} no actor field.`);
    if (boundedFeed) lines.push("- The project-state feed is bounded. Request get_activity for older pages.");
    if (olderThanOrientationWindow && !boundedFeed) lines.push("- This date reaches beyond the default project-state window. Request get_activity for the complete selected range.");
    if (visible.length > MAX_SUMMARY_ENTRIES) lines.push(`- ${visible.length - MAX_SUMMARY_ENTRIES} additional item${visible.length - MAX_SUMMARY_ENTRIES === 1 ? " is" : "s are"} in the selected range.`);
    return lines.join("\n");
  }, [boundedFeed, olderThanOrientationWindow, since, unknownActorCount, visible]);

  async function copyMeetingSummary() {
    setCopyStatus(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(advisorText || advisorDraft);
      setCopyStatus("Copied meeting summary.");
    } catch {
      setCopyStatus("Copy is unavailable here. Select the summary text to copy it.");
    }
  }

  return (
    <section className="mindmap-peer-view mindmap-changes-view" aria-label="Project changes">
      <div className="mindmap-peer-view-heading">
        <div>
          <p className="mindmap-peer-view-kicker">Recorded edits</p>
          <h2>Changes</h2>
        </div>
        <label className="mindmap-change-date">
          <span>Since</span>
          <input
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value || daysAgoDate(DEFAULT_WINDOW_DAYS))}
          />
        </label>
      </div>

      {historyMessage && <p className="mindmap-peer-warning">Version history: {historyMessage}</p>}
      {boundedFeed && (
        <p className="mindmap-peer-warning">Showing the bounded project-state activity feed. Agents can request older pages with get_activity.</p>
      )}
      {olderThanOrientationWindow && !boundedFeed && (
        <p className="mindmap-peer-warning">This date reaches beyond the default project-state window. Agents can request the complete range with get_activity.</p>
      )}
      {unknownActorCount > 0 && (
        <p className="mindmap-peer-warning">{unknownActorCount} recorded item{unknownActorCount === 1 ? "" : "s"} have an unknown actor.</p>
      )}

      {visible.length === 0 ? (
        <p className="mindmap-peer-empty">
          No recorded changes since {formatDate(since)}. Activity begins when an authored save records an operation.
        </p>
      ) : (
        <ul className="mindmap-changes-list">
          {visible.map((entry, index) => (
            <li key={`${entry.kind}:${entry.at}:${entry.href}:${entry.title}:${index}`} className="mindmap-change-item">
              <div className="min-w-0 flex-1">
                <a href={entry.href} className="mindmap-unplaced-title">{entry.title}</a>
                <p>{entry.description}</p>
                {entry.detail && (
                  <details>
                    <summary className="cursor-pointer text-[10px] text-faint">Details</summary>
                    <p className="font-mono text-[10px] text-faint">{entry.detail}</p>
                  </details>
                )}
              </div>
              <time dateTime={entry.at} title={entry.at}>{formatTime(entry.at)}</time>
            </li>
          ))}
        </ul>
      )}

      <div className="mindmap-advisor-panel">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            disabled={visible.length === 0}
            onClick={() => {
              setAdvisorText(advisorDraft);
              setAdvisorOpen(true);
              setCopyStatus(null);
            }}
          >
            Prepare advisor summary
          </button>
          {advisorOpen && (
            <button type="button" className="btn-outline" onClick={() => void copyMeetingSummary()}>
              Copy meeting summary
            </button>
          )}
        </div>
        {advisorOpen && (
          <label className="mindmap-field">
            <span>Editable meeting summary</span>
            <textarea value={advisorText} onChange={(event) => setAdvisorText(event.target.value)} rows={7} aria-label="Advisor meeting summary" />
            <small>Summary lines describe recorded operations, actors, resources, and bounded field changes.</small>
            {copyStatus && <small role="status">{copyStatus}</small>}
          </label>
        )}
      </div>
    </section>
  );
}
