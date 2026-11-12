import type { HostResources } from "./host-resources";

export type EditorIssue = {
  id: string;
  severity: "connection" | "conflict" | "compile" | "error";
  title: string;
  message: string;
};

const ISSUE_PRIORITY = { connection: 0, conflict: 1, compile: 2, error: 3 } as const;

/** Stable ordering keeps local conflicts ahead of Git conflicts at equal severity. */
export function selectEditorIssue(issues: readonly EditorIssue[]): EditorIssue | null {
  return issues.reduce<EditorIssue | null>((selected, issue) =>
    !selected || ISSUE_PRIORITY[issue.severity] < ISSUE_PRIORITY[selected.severity] ? issue : selected, null);
}

export function hostBusyDetail(sample: HostResources | null | undefined, now = Date.now()): string | null {
  if (!sample || now - sample.sampledAt > 30_000 || sample.sampledAt > now + 5_000
    || (!sample.pressure.cpu && !sample.pressure.memory)) return null;
  return [
    "Host busy",
    sample.cpuPercent === null ? undefined : `CPU ${Math.round(sample.cpuPercent)}%`,
    `Memory ${Math.round(sample.memory.usedPercent)}% used, ${(sample.memory.availableBytes / 1024 ** 3).toFixed(1)} GiB available`,
  ].filter(Boolean).join(". ");
}
