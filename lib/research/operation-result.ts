/**
 * Shared domain result type for paper/CAS operations.
 *
 * Browser WebMCP and server actions share this vocabulary. This module has no SDK or React dependency.
 */

export const OPERATION_ERROR_CODES = {
  stale_live_state: "stale_live_state",
  stale_disk_state: "stale_disk_state",
  stale_selection: "stale_selection",
  invalid_tex: "invalid_tex",
  invalid_arguments: "invalid_arguments",
  unknown_section: "unknown_section",
  unknown_citation: "unknown_citation",
  unknown_todo: "unknown_todo",
  compile_failed: "compile_failed",
  cancelled: "cancelled",
  permission_denied: "permission_denied",
  migration_required: "migration_required",
  conversion_loss: "conversion_loss",
  conflict: "conflict",
  capability_unavailable: "capability_unavailable",
  invalid_path: "invalid_path",
  multi_file_span: "multi_file_span",
} as const;

/** @deprecated Use OPERATION_ERROR_CODES. Kept for WebMCP contract imports. */
export const WEBMCP_ERROR_CODES = OPERATION_ERROR_CODES;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[keyof typeof OPERATION_ERROR_CODES];

export type OperationDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  sectionId?: string;
  filePath?: string;
};

/** Explicit Overleaf visibility for a locally successful mutation. */
export type RemoteSyncOutcome = {
  status: "pushed" | "pending" | "failed" | "unconfigured";
  message: string;
  code?: string;
  commitHash?: string;
  retryable: boolean;
  credentialNeeded?: boolean;
};

export type ConflictPayload = {
  currentRevision: number;
  currentHash: string;
  changedRanges?: Array<{ from: number; to: number }>;
  refresh: "reread" | "reload_document" | "reload_project";
};

export type OperationResult<T> =
  | {
      ok: true;
      value: T;
      revision?: number;
      diskHash?: string;
      remote?: RemoteSyncOutcome;
      warnings?: OperationDiagnostic[];
      diagnostics?: OperationDiagnostic[];
    }
  | {
      ok: false;
      code: OperationErrorCode | string;
      message: string;
      retryable: boolean;
      remote?: RemoteSyncOutcome;
      currentRevision?: number;
      currentHash?: string;
      diagnostics?: OperationDiagnostic[];
      conflict?: ConflictPayload;
    };

export function okResult<T>(
  value: T,
  extra: {
    revision?: number;
    diskHash?: string;
    remote?: RemoteSyncOutcome;
    warnings?: OperationDiagnostic[];
    diagnostics?: OperationDiagnostic[];
  } = {},
): OperationResult<T> {
  return { ok: true, value, ...extra };
}

export function failResult(
  code: OperationErrorCode | string,
  message: string,
  extra:
    | boolean
    | {
        retryable: boolean;
        remote?: RemoteSyncOutcome;
        currentRevision?: number;
        currentHash?: string;
        diagnostics?: OperationDiagnostic[];
        conflict?: ConflictPayload;
      } = false,
): OperationResult<never> {
  if (typeof extra === "boolean") {
    return { ok: false, code, message, retryable: extra };
  }
  return {
    ok: false,
    code,
    message,
    retryable: extra.retryable,
    remote: extra.remote,
    currentRevision: extra.currentRevision,
    currentHash: extra.currentHash,
    diagnostics: extra.diagnostics,
    conflict: extra.conflict,
  };
}

export function isOperationResult(value: unknown): value is OperationResult<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.ok === true) return "value" in result;
  if (result.ok === false) {
    return typeof result.code === "string" && typeof result.message === "string" && typeof result.retryable === "boolean";
  }
  return false;
}
