import "server-only";

import { headers } from "next/headers";

import {
  PROJECT_WRITE_SESSION_HEADER,
  ProjectWriteSessionError,
  assertProjectWriteSession,
  parseProjectWriteSessionCredential,
  withProjectWriteSessionContext,
  type ProjectWriteSessionCredential,
} from "@/lib/research/project-write-session";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";
import { isViewOnlyMode } from "./view-only";

export function projectWriteSessionCredentialFromHeaders(
  input: Pick<Headers, "get">,
): ProjectWriteSessionCredential {
  const value = input.get(PROJECT_WRITE_SESSION_HEADER);
  if (!value) {
    throw new ProjectWriteSessionError("write_session_required", "Open this project in its writing tab to save changes.");
  }
  if (value.length > 512) {
    throw new ProjectWriteSessionError("write_session_invalid", "Refresh this project's writing session before saving.", 400);
  }
  let credential: unknown;
  try { credential = JSON.parse(value); }
  catch {
    throw new ProjectWriteSessionError("write_session_invalid", "Refresh this project's writing session before saving.", 400);
  }
  return parseProjectWriteSessionCredential(credential);
}

/** Authenticate project access first, then scope browser mutations to this lease. */
export async function withBrowserProjectWriteSession<T>(
  projectPath: string,
  operation: () => Promise<T> | T,
  request?: Request,
): Promise<T> {
  if (isViewOnlyMode()) throw new ProjectWriteSessionError("write_session_required", "This OpenBar link provides view-only access.", 403)
  const requestHeaders = request?.headers ?? await headers();
  const credential = projectWriteSessionCredentialFromHeaders(requestHeaders);
  await withProjectWriteLockAsync(projectPath, () => assertProjectWriteSession(projectPath, credential));
  return withProjectWriteSessionContext(projectPath, credential, operation);
}
