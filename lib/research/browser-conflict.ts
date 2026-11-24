export type BrowserConflictReport = {
  kind: "mindmap" | "paper";
  code: "mindmap_conflict" | "paper_conflict";
  message: string;
  mapId?: string;
  nodeIds?: string[];
  files?: string[];
  expectedHash?: string;
  currentHash?: string;
};

/** Notify OpenBar of an unresolved browser save conflict without disrupting editor recovery. */
export function reportBrowserConflict(project: string, report: BrowserConflictReport): void {
  if (typeof fetch !== "function") return;
  void fetch(`/api/p/${encodeURIComponent(project)}/conflict`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

/** Clear a previously reported browser save conflict after reload or recovery. */
export function clearBrowserConflict(project: string, kind: "mindmap" | "paper", mapId?: string): void {
  if (typeof fetch !== "function") return;
  const query = new URLSearchParams({ kind, ...(kind === "mindmap" && mapId ? { mapId } : {}) });
  void fetch(`/api/p/${encodeURIComponent(project)}/conflict?${query}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).catch(() => undefined);
}
