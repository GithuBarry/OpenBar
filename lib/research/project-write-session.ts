import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { openBarPaths } from "@/lib/config/openbar-paths";
import { sha256, withWriteLockAsync, writeTextAtomic } from "@/lib/tex-project/codec";
import {
  projectWriteIdentityPath,
  withProjectWriteGuard,
  withProjectWriteLockAsync,
} from "./project-lock";

import {
  PROJECT_WRITE_SESSION_TTL_MS,
  type ProjectWriteSessionCredential,
  type ProjectWriteSessionStatus,
  type ProjectWriteSessionResult,
} from "./project-write-session-contract";

export * from "./project-write-session-contract";

type SessionRecord = {
  version: 1;
  sessionId: string;
  generation: string;
  tokenHash: string;
  label: string;
  acquiredAt: number;
  updatedAt: number;
  expiresAt: number;
  releasedAt: number | null;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;

export class ProjectWriteSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 423,
  ) {
    super(message);
    this.name = "ProjectWriteSessionError";
  }
}

export function parseProjectWriteSessionCredential(value: unknown): ProjectWriteSessionCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectWriteSessionError("write_session_required", "Open this project in its writing tab to save changes.");
  }
  const input = value as Partial<ProjectWriteSessionCredential>;
  if (typeof input.sessionId !== "string" || !UUID.test(input.sessionId)
    || typeof input.token !== "string" || !HASH.test(input.token)
    || typeof input.generation !== "string" || !UUID.test(input.generation)) {
    throw new ProjectWriteSessionError("write_session_invalid", "Refresh this project's writing session before saving.", 400);
  }
  return { sessionId: input.sessionId, token: input.token, generation: input.generation };
}

export function projectWriteSessionPath(projectPath: string): string {
  const key = sha256(projectWriteIdentityPath(projectPath));
  return path.join(openBarPaths().runtimeRoot, "project-write-sessions", `${key}.json`);
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readRecord(projectPath: string): SessionRecord | null {
  const file = projectWriteSessionPath(projectPath);
  let source: string;
  try { source = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ProjectWriteSessionError("write_session_unavailable", "The project's writing session could not be read. Keep your draft open and retry.", 503);
  }
  let value: Partial<SessionRecord>;
  try { value = JSON.parse(source); }
  catch {
    throw new ProjectWriteSessionError("write_session_unavailable", "The project's writing session needs recovery. Keep your draft open and inspect the session file.", 503);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
    || typeof value.sessionId !== "string" || !UUID.test(value.sessionId)
    || typeof value.generation !== "string" || !UUID.test(value.generation)
    || typeof value.tokenHash !== "string" || !HASH.test(value.tokenHash)
    || typeof value.label !== "string" || value.label.length > 80
    || !validTime(value.acquiredAt) || !validTime(value.updatedAt) || !validTime(value.expiresAt)
    || value.updatedAt < value.acquiredAt || value.expiresAt < value.updatedAt
    || (value.releasedAt !== null && !validTime(value.releasedAt))) {
    throw new ProjectWriteSessionError("write_session_unavailable", "The project's writing session needs recovery. Keep your draft open and inspect the session file.", 503);
  }
  return value as SessionRecord;
}

function matches(record: SessionRecord | null, credential: ProjectWriteSessionCredential): boolean {
  return record !== null && record.sessionId === credential.sessionId && record.generation === credential.generation
    && timingSafeEqual(Buffer.from(record.tokenHash, "hex"), Buffer.from(sha256(credential.token), "hex"));
}

function active(record: SessionRecord | null, now: number): record is SessionRecord {
  return record !== null && record.releasedAt === null && record.expiresAt > now;
}

function statusFor(record: SessionRecord | null, credential?: ProjectWriteSessionCredential, now = Date.now()): ProjectWriteSessionStatus {
  const occupied = active(record, now);
  return {
    state: occupied ? "occupied" : "available",
    writable: occupied && credential !== undefined && matches(record, credential),
    ownerLabel: occupied ? record.label : null,
    ownerGeneration: occupied ? record.generation : null,
    expiresAt: occupied ? record.expiresAt : null,
    serverTime: now,
  };
}

function writeRecord(projectPath: string, record: SessionRecord): void {
  writeTextAtomic(projectWriteSessionPath(projectPath), `${JSON.stringify(record)}\n`);
}

function labelFor(value?: string): string {
  return value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Another OpenBar session";
}

function newRecord(sessionId: string, label: string, now: number): { credential: ProjectWriteSessionCredential; record: SessionRecord } {
  const credential = { sessionId, token: randomBytes(32).toString("hex"), generation: randomUUID() };
  return {
    credential,
    record: {
      version: 1,
      sessionId,
      generation: credential.generation,
      tokenHash: sha256(credential.token),
      label,
      acquiredAt: now,
      updatedAt: now,
      expiresAt: now + PROJECT_WRITE_SESSION_TTL_MS,
      releasedAt: null,
    },
  };
}

function denied(record: SessionRecord | null, code: string, message: string): ProjectWriteSessionResult {
  return { ok: false, code, message, status: statusFor(record) };
}

/** Atomic reads keep observation independent of long paper and Git mutations. */
export function getProjectWriteSessionStatus(projectPath: string, credential?: ProjectWriteSessionCredential): ProjectWriteSessionStatus {
  return statusFor(readRecord(projectPath), credential);
}

/** Ownership transitions follow project-lock -> session-lock order. */
function transition<T>(projectPath: string, operation: () => T): Promise<T> {
  return withProjectWriteLockAsync(projectPath, () => withWriteLockAsync(projectWriteSessionPath(projectPath), operation));
}

export async function acquireProjectWriteSession(
  projectPath: string,
  input: { sessionId: string; label?: string; expectedOwnerGeneration?: string | null },
): Promise<ProjectWriteSessionResult> {
  if (!UUID.test(input.sessionId)) throw new ProjectWriteSessionError("write_session_invalid", "A fresh browser session identity is required.", 400);
  if (input.expectedOwnerGeneration !== undefined && input.expectedOwnerGeneration !== null && !UUID.test(input.expectedOwnerGeneration)) {
    throw new ProjectWriteSessionError("write_session_invalid", "Read the current editing session before resuming editing.", 400);
  }
  return transition(projectPath, () => {
    const current = readRecord(projectPath);
    const now = Date.now();
    const ownerGeneration = active(current, now) ? current.generation : null;
    if (input.expectedOwnerGeneration !== undefined && ownerGeneration !== input.expectedOwnerGeneration) {
      return denied(current, "write_session_changed", "Editing access changed. Check the current session and try again.");
    }
    if (ownerGeneration !== null && input.expectedOwnerGeneration === undefined) return denied(current, "project_in_use", "Another session is writing this project. This tab can read the latest saved work.");
    const next = newRecord(input.sessionId, labelFor(input.label), now);
    writeRecord(projectPath, next.record);
    return { ok: true, credential: next.credential, status: statusFor(next.record, next.credential, now) };
  });
}

/** A refreshed document proves ownership, then fences every previous document. */
export async function resumeProjectWriteSession(
  projectPath: string,
  input: ProjectWriteSessionCredential,
  label?: string,
): Promise<ProjectWriteSessionResult> {
  const credential = parseProjectWriteSessionCredential(input);
  return transition(projectPath, () => {
    const current = readRecord(projectPath);
    if (!matches(current, credential)) return denied(current, "write_session_lost", "This writing session has changed. This tab can read the latest saved work.");
    const now = Date.now();
    const next = newRecord(credential.sessionId, label === undefined ? current!.label : labelFor(label), now);
    writeRecord(projectPath, next.record);
    return { ok: true, credential: next.credential, status: statusFor(next.record, next.credential, now) };
  });
}

/** Heartbeats use the short metadata lock while admitted work holds the project lock. */
export async function renewProjectWriteSession(projectPath: string, input: ProjectWriteSessionCredential): Promise<ProjectWriteSessionResult> {
  const credential = parseProjectWriteSessionCredential(input);
  return withWriteLockAsync(projectWriteSessionPath(projectPath), () => {
    const current = readRecord(projectPath);
    const now = Date.now();
    if (!matches(current, credential)) return denied(current, "write_session_lost", "Another session now owns writing access. Your draft remains available in this browser.");
    if (!active(current, now)) return denied(current, "write_session_expired", "Writing access expired. Preserve your draft and start a fresh writing session.");
    const next = { ...current, updatedAt: now, expiresAt: now + PROJECT_WRITE_SESSION_TTL_MS };
    writeRecord(projectPath, next);
    return { ok: true, status: statusFor(next, credential, now) };
  });
}

export async function releaseProjectWriteSession(projectPath: string, input: ProjectWriteSessionCredential): Promise<ProjectWriteSessionResult> {
  const credential = parseProjectWriteSessionCredential(input);
  return transition(projectPath, () => {
    const current = readRecord(projectPath);
    if (!matches(current, credential)) return denied(current, "write_session_lost", "This writing session has already changed.");
    const next = { ...current!, releasedAt: Date.now() };
    writeRecord(projectPath, next);
    return { ok: true, status: statusFor(next) };
  });
}

export function assertProjectWriteSession(projectPath: string, input: ProjectWriteSessionCredential): void {
  const credential = parseProjectWriteSessionCredential(input);
  const current = readRecord(projectPath);
  if (!matches(current, credential)) {
    throw new ProjectWriteSessionError("write_session_lost", "Another session now owns writing access. Preserve your draft before reloading the saved project.");
  }
  if (!active(current, Date.now())) {
    throw new ProjectWriteSessionError("write_session_expired", "Writing access expired. Preserve your draft and start a fresh writing session.");
  }
}

/** Browser requests revalidate their original credential inside every project lock. */
export function withProjectWriteSessionContext<T>(
  projectPath: string,
  input: ProjectWriteSessionCredential,
  operation: () => T,
): T {
  const credential = Object.freeze(parseProjectWriteSessionCredential(input));
  const key = projectWriteIdentityPath(projectPath);
  assertProjectWriteSession(projectPath, credential);
  return withProjectWriteGuard((lockedProjectPath) => {
    if (projectWriteIdentityPath(lockedProjectPath) !== key) {
      throw new ProjectWriteSessionError("write_session_invalid", "Writing access belongs to a different project.", 403);
    }
    assertProjectWriteSession(lockedProjectPath, credential);
  }, operation);
}
