/**
 * Translate the filesystem Git result into the user-facing local/remote
 * outcome shared by the UI and WebMCP. A remote failure never implies that a
 * successful local mutation was undone.
 */

import type { OverleafGitPushResult } from "@/lib/tex-project/overleaf-git";

export type RemoteSyncStatus = "pushed" | "pending" | "failed" | "unconfigured";

export type RemoteSyncResult = {
  status: RemoteSyncStatus;
  message: string;
  code?: string;
  commitHash?: string;
  retryable: boolean;
  credentialNeeded?: boolean;
};

const UNCONFIGURED_CODES = new Set(["not_git_repo", "remote_unconfigured", "remote_not_overleaf"]);
const PENDING_CODES = new Set(["push_failed", "remote_ahead", "remote_conflict", "remote_check_failed"]);

export function remoteSyncResult(result: OverleafGitPushResult): RemoteSyncResult {
  if (result.ok) {
    return {
      status: "pushed",
      message: result.message,
      retryable: false,
      ...(result.commitHash ? { commitHash: result.commitHash } : {}),
    };
  }
  const code = result.code || "remote_sync_failed";
  if (UNCONFIGURED_CODES.has(code)) {
    return {
      status: "unconfigured",
      message: result.message,
      code,
      retryable: false,
      credentialNeeded: code === "remote_unconfigured",
    };
  }
  if (result.commitHash || PENDING_CODES.has(code)) {
    return {
      status: "pending",
      message: result.message,
      code,
      retryable: true,
      ...(result.commitHash ? { commitHash: result.commitHash } : {}),
      credentialNeeded: code === "push_failed",
    };
  }
  return {
    status: "failed",
    message: result.message,
    code,
    retryable: true,
    ...(result.commitHash ? { commitHash: result.commitHash } : {}),
  };
}
