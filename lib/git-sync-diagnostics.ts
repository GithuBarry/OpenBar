type GitFailureKind = "temporary-service" | "authentication" | "conflict" | "network" | "other";

type GitSyncDiagnosticStatus = {
  ahead?: number;
  behind?: number;
  changedFiles?: readonly string[];
};

type GitSyncDiagnosticInput = {
  message: string;
  editingPaused?: boolean;
  status?: GitSyncDiagnosticStatus;
  fileGroups?: readonly { label: string; files: readonly string[] }[];
  detailsError?: string;
};

/** Classification describes a reported failure and leaves synchronization decisions to Git. */
export function classifyGitSyncFailure(message: string): { kind: GitFailureKind; httpStatus?: number } {
  const match = message.match(/(?:returned error:|http(?:\/[\d.]+)?(?:\s+(?:error|status|code))?\s*[:=]?)\s*(\d{3})\b/i);
  const httpStatus = match ? Number(match[1]) : undefined;
  const status = httpStatus ? { httpStatus } : {};
  if (httpStatus === 401 || httpStatus === 403 || /authentication (?:failed|required)|could not read (?:username|password)|invalid (?:username|password|credentials|token)|permission denied|access denied/i.test(message)) {
    return { kind: "authentication", ...status };
  }
  if (/\bconflicts?\b|\bdiverged\b|non-fast-forward|fetch first|newer commits|pull and reconcile/i.test(message)) {
    return { kind: "conflict", ...status };
  }
  if ([429, 500, 502, 503, 504].includes(httpStatus || 0) || /upstream connect error|upstream.*disconnect\/reset before headers|service unavailable|bad gateway|gateway timeout/i.test(message)) {
    return { kind: "temporary-service", ...status };
  }
  if (/could not resolve host|failed to connect|couldn't connect|connection (?:timed out|refused|reset|failure)|network is unreachable|operation timed out|TLS|SSL connect|remote end hung up/i.test(message)) {
    return { kind: "network", ...status };
  }
  return { kind: "other", ...status };
}

export function gitSyncNoticeDiagnostics({ message, editingPaused, status, fileGroups = [], detailsError }: GitSyncDiagnosticInput) {
  const failure = classifyGitSyncFailure(message);
  const summarized = failure.kind === "temporary-service" && !editingPaused;
  const localCommitsSaved = (status?.ahead || 0) > 0 || /local commits remain (?:intact|available|saved)|local save complete|saved locally/i.test(message);
  const summary = summarized ? [
    `The remote Git service is temporarily unavailable${failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ""}.`,
    localCommitsSaved ? "Your local commits remain saved in OpenBar." : "",
    "Remote synchronization is pending. Try again shortly.",
  ].filter(Boolean).join(" ") : message;
  const descriptions: Record<GitFailureKind, string> = {
    "temporary-service": "Temporary remote service failure",
    authentication: "Git authentication or access failure",
    conflict: "Git history or content needs review",
    network: "Git network connection failure",
    other: "Git operation failure",
  };
  const report = [
    `Failure type: ${descriptions[failure.kind]}${failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ""}`,
    summarized ? `Raw Git error:\n${message}` : "",
    editingPaused ? "Editing is paused." : "",
    status ? `Last checked Git state: ${status.behind || 0} incoming commits, ${status.ahead || 0} local commits` : "",
    ...fileGroups.filter(group => group.files.length > 0).map(group => `${group.label}:\n${group.files.join("\n")}`),
    status?.changedFiles?.length ? `Locally modified repository files:\n${status.changedFiles.join("\n")}` : "",
    detailsError,
  ].filter(Boolean).join("\n\n");
  return { message: summary, report };
}
