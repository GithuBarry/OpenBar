/** Durable, bounded replay metadata for idempotent server mutations. */

import fs from "node:fs";
import path from "node:path";

import { sha256, stableJson, withWriteLock, writeTextAtomic } from "@/lib/tex-project/codec";
import { texPaths } from "@/lib/tex-project/project";

const VERSION = 1 as const;
const MAX_ENTRIES = 200;
const JOURNAL_VERSION = 1 as const;
const JOURNAL_MAX_ENTRIES = 200;
const JOURNAL_NAME = "request-replay-journal.json";

export type RequestReplayEntry = {
  requestId: string;
  operation: string;
  fingerprint: string;
  result: Record<string, unknown>;
  createdAt: string;
};

type ReplayFile = { version: typeof VERSION; entries: RequestReplayEntry[] };
export type RequestReplayJournalEntry = {
  requestId: string;
  operation: string;
  fingerprint: string;
  phase: "intent" | "result";
  result?: Record<string, unknown>;
  createdAt: string;
};

type ReplayJournalFile = { version: typeof JOURNAL_VERSION; entries: RequestReplayJournalEntry[] };

export class RequestReplayStoreError extends Error {
  constructor(
    readonly store: "replay" | "journal",
    readonly file: string,
    message: string,
  ) {
    super(`Request replay ${store} store is unavailable or corrupted at ${file}: ${message}`);
    this.name = "RequestReplayStoreError";
  }
}

export class RequestReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestReplayConflictError";
  }
}

export type RequestReplayPersistence = {
  status: "recorded" | "pending" | "unavailable";
  message?: string;
};

export type RequestReplayRecovery = {
  status: "none" | "recovered" | "pending" | "conflict";
  entry?: RequestReplayEntry;
  phase?: "intent" | "result";
  message?: string;
};

function replayPath(projectDir: string): string {
  return path.join(texPaths(projectDir).openBarDir, "request-replay.json");
}

function journalPath(projectDir: string): string {
  return path.join(texPaths(projectDir).openBarDir, JOURNAL_NAME);
}

function isReplayEntry(value: unknown): value is RequestReplayEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<RequestReplayEntry>;
  return Boolean(
    typeof entry.requestId === "string"
      && typeof entry.operation === "string"
      && typeof entry.fingerprint === "string"
      && entry.result
      && typeof entry.result === "object"
      && !Array.isArray(entry.result)
      && typeof entry.createdAt === "string",
  );
}

function isJournalEntry(value: unknown): value is RequestReplayJournalEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<RequestReplayJournalEntry>;
  const resultValid = entry.result !== undefined
    && entry.result !== null
    && typeof entry.result === "object"
    && !Array.isArray(entry.result);
  return Boolean(
    typeof entry.requestId === "string"
      && typeof entry.operation === "string"
      && typeof entry.fingerprint === "string"
      && (entry.phase === "intent" || entry.phase === "result")
      && (entry.phase === "intent" || resultValid)
      && typeof entry.createdAt === "string",
  );
}

function readFile(projectDir: string): ReplayFile {
  const file = replayPath(projectDir);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: VERSION, entries: [] };
    throw new RequestReplayStoreError("replay", file, error instanceof Error ? error.message : String(error));
  }
  let parsed: Partial<ReplayFile>;
  try {
    parsed = JSON.parse(source) as Partial<ReplayFile>;
  } catch (error) {
    throw new RequestReplayStoreError("replay", file, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.version !== VERSION) {
    throw new RequestReplayStoreError("replay", file, `unsupported version ${String(parsed.version)}.`);
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.some((entry) => !isReplayEntry(entry))) {
    throw new RequestReplayStoreError("replay", file, "entries are malformed.");
  }
  const entries = parsed.entries as RequestReplayEntry[];
  if (new Set(entries.map((entry) => entry.requestId)).size !== entries.length) {
    throw new RequestReplayStoreError("replay", file, "entries contain duplicate request IDs.");
  }
  return { version: VERSION, entries: entries.slice(-MAX_ENTRIES) };
}

function readJournal(projectDir: string): ReplayJournalFile {
  const file = journalPath(projectDir);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: JOURNAL_VERSION, entries: [] };
    throw new RequestReplayStoreError("journal", file, error instanceof Error ? error.message : String(error));
  }
  let parsed: Partial<ReplayJournalFile>;
  try {
    parsed = JSON.parse(source) as Partial<ReplayJournalFile>;
  } catch (error) {
    throw new RequestReplayStoreError("journal", file, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.version !== JOURNAL_VERSION) {
    throw new RequestReplayStoreError("journal", file, `unsupported version ${String(parsed.version)}.`);
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.some((entry) => !isJournalEntry(entry))) {
    throw new RequestReplayStoreError("journal", file, "entries are malformed.");
  }
  const entries = parsed.entries as RequestReplayJournalEntry[];
  if (new Set(entries.map((entry) => entry.requestId)).size !== entries.length) {
    throw new RequestReplayStoreError("journal", file, "entries contain duplicate request IDs.");
  }
  // Keep every unresolved intent available for recovery. New intents are
  // rejected at the bounded capacity, so a stale intent can never be
  // silently evicted and retried as a duplicate mutation.
  return { version: JOURNAL_VERSION, entries };
}

export function requestFingerprint(value: unknown): string {
  return sha256(stableJson(value));
}

export function readRequestReplay(projectDir: string, requestId: string): RequestReplayEntry | undefined {
  return readFile(projectDir).entries.find((entry) => entry.requestId === requestId);
}

export function recordRequestReplay(
  projectDir: string,
  entry: Omit<RequestReplayEntry, "createdAt"> & { createdAt?: string },
): void {
  if (!entry.requestId.trim()) throw new Error("A request replay entry needs a request id.");
  const file = replayPath(projectDir);
  const normalized: RequestReplayEntry = {
    ...entry,
    requestId: entry.requestId.trim(),
    createdAt: entry.createdAt || new Date().toISOString(),
  };
  try {
    withWriteLock(file, () => {
      const current = readFile(projectDir);
      const existing = current.entries.find((item) => item.requestId === normalized.requestId);
      if (existing && (existing.operation !== normalized.operation || existing.fingerprint !== normalized.fingerprint)) {
        throw new RequestReplayConflictError(`requestId "${normalized.requestId}" is already recorded for a different operation or argument fingerprint.`);
      }
      if (existing && stableJson(existing.result) !== stableJson(normalized.result)) {
        throw new RequestReplayConflictError(`requestId "${normalized.requestId}" already has a different replay result for the same operation and argument fingerprint.`);
      }
      if (existing) return;
      const entries = [...current.entries, normalized];
      writeTextAtomic(file, JSON.stringify({ version: VERSION, entries: entries.slice(-MAX_ENTRIES) }) + "\n");
    });
  } catch (error) {
    if (error instanceof RequestReplayStoreError || error instanceof RequestReplayConflictError) throw error;
    throw new RequestReplayStoreError("replay", file, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Record a successful mutation's replay receipt through a small recovery
 * journal. The journal is written before the replay file, so a process that
 * survives a replay-file failure can promote the durable receipt on retry.
 */
export function persistRequestReplay(
  projectDir: string,
  entry: Omit<RequestReplayEntry, "createdAt"> & { createdAt?: string },
): RequestReplayPersistence {
  const normalized: Omit<RequestReplayEntry, "createdAt"> & { createdAt: string } = {
    ...entry,
    createdAt: entry.createdAt || new Date().toISOString(),
  };
  try {
    writeRequestReplayJournal(projectDir, normalized);
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : String(error) };
  }

  try {
    recordRequestReplay(projectDir, normalized);
  } catch (error) {
    return {
      status: error instanceof RequestReplayStoreError || error instanceof RequestReplayConflictError ? "unavailable" : "pending",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    clearRequestReplayJournal(projectDir, normalized.requestId);
  } catch {
    // The replay result is durable. A later retry can clear the duplicate
    // journal entry after reading that result.
  }
  return { status: "recorded" };
}

/** Reserve a request ID before mutating any project state. */
export function writeRequestReplayIntent(
  projectDir: string,
  entry: { requestId: string; operation: string; fingerprint: string },
): RequestReplayEntry | undefined {
  if (!entry.requestId.trim()) throw new Error("A request replay intent needs a request id.");
  const file = journalPath(projectDir);
  const normalized: RequestReplayJournalEntry = {
    ...entry,
    requestId: entry.requestId.trim(),
    phase: "intent",
    createdAt: new Date().toISOString(),
  };
  return withWriteLock(file, () => {
    const current = readJournal(projectDir);
    const existingReplay = readRequestReplay(projectDir, normalized.requestId);
    if (existingReplay) {
      if (existingReplay.operation !== normalized.operation || existingReplay.fingerprint !== normalized.fingerprint) {
        throw new Error(`requestId "${normalized.requestId}" is already recorded for a different operation or argument fingerprint.`);
      }
      return existingReplay;
    }
    const existing = current.entries.find((item) => item.requestId === normalized.requestId);
    if (existing) {
      if (existing.operation !== normalized.operation || existing.fingerprint !== normalized.fingerprint) {
        throw new Error(`requestId "${normalized.requestId}" is already reserved for a different operation or argument fingerprint.`);
      }
      throw new Error(`requestId "${normalized.requestId}" has an unresolved ${existing.phase} replay journal entry.`);
    }
    if (current.entries.length >= JOURNAL_MAX_ENTRIES) {
      throw new Error("The request replay recovery journal is full. Retry after pending requests are recovered.");
    }
    const entries = [...current.entries, normalized];
    writeTextAtomic(file, JSON.stringify({ version: JOURNAL_VERSION, entries }, null, 2) + "\n");
  });
}

/** Persist the post-mutation receipt before attempting replay-file recording. */
export function writeRequestReplayJournal(
  projectDir: string,
  entry: Omit<RequestReplayEntry, "createdAt"> & { createdAt?: string },
): void {
  if (!entry.requestId.trim()) throw new Error("A request replay journal entry needs a request id.");
  const file = journalPath(projectDir);
  const normalized: RequestReplayJournalEntry = { ...entry, requestId: entry.requestId.trim(), phase: "result", createdAt: entry.createdAt || new Date().toISOString() };
  try {
    withWriteLock(file, () => {
      const current = readJournal(projectDir);
      const existing = current.entries.find((item) => item.requestId === normalized.requestId);
      if (existing && (existing.operation !== normalized.operation || existing.fingerprint !== normalized.fingerprint)) {
        throw new RequestReplayConflictError(`requestId "${normalized.requestId}" is already reserved for a different operation or argument fingerprint.`);
      }
      if (existing?.phase === "result") {
        if (!existing.result || stableJson(existing.result) !== stableJson(normalized.result)) {
          throw new RequestReplayConflictError(`requestId "${normalized.requestId}" already has a different replay result for the same operation and argument fingerprint.`);
        }
        return;
      }
      const entries = current.entries.filter((item) => item.requestId !== normalized.requestId);
      if (!existing && entries.length >= JOURNAL_MAX_ENTRIES) {
        throw new Error("The request replay recovery journal is full. Retry after pending requests are recovered.");
      }
      entries.push(normalized);
      writeTextAtomic(file, JSON.stringify({ version: JOURNAL_VERSION, entries }, null, 2) + "\n");
    });
  } catch (error) {
    if (error instanceof RequestReplayStoreError || error instanceof RequestReplayConflictError) throw error;
    throw new RequestReplayStoreError("journal", file, error instanceof Error ? error.message : String(error));
  }
}

export function readRequestReplayJournal(projectDir: string, requestId: string): RequestReplayJournalEntry | undefined {
  return readJournal(projectDir).entries.find((entry) => entry.requestId === requestId);
}

export function clearRequestReplayJournal(projectDir: string, requestId: string): void {
  const file = journalPath(projectDir);
  withWriteLock(file, () => {
    const current = readJournal(projectDir);
    const entries = current.entries.filter((entry) => entry.requestId !== requestId);
    if (entries.length) {
      writeTextAtomic(file, JSON.stringify({ version: JOURNAL_VERSION, entries }, null, 2) + "\n");
      return;
    }
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}

export type RequestReplayIntentResolution =
  | { action: "clear" }
  | { action: "promote"; result: Record<string, unknown> };

export type RequestReplayIntentResolutionResult = {
  status: "missing" | "cleared" | "promoted" | "pending" | "conflict";
  entry?: RequestReplayEntry;
  message?: string;
};

/**
 * Resolve an intent-only journal after an operator has inspected the saved
 * project. `clear` is safe after confirming that the mutation did not land.
 * `promote` is safe after reconstructing the exact original result. Both
 * actions require the original operation and fingerprint to avoid consuming a
 * request ID belonging to different arguments.
 */
export function resolveRequestReplayIntent(
  projectDir: string,
  requestId: string,
  operation: string,
  fingerprint: string,
  resolution: RequestReplayIntentResolution,
): RequestReplayIntentResolutionResult {
  let pending: RequestReplayJournalEntry | undefined;
  try {
    pending = readRequestReplayJournal(projectDir, requestId);
  } catch (error) {
    return { status: "pending", message: error instanceof Error ? error.message : String(error) };
  }
  if (!pending) return { status: "missing" };
  if (pending.operation !== operation || pending.fingerprint !== fingerprint) {
    return { status: "conflict", message: `requestId "${requestId}" has a pending receipt for a different operation or argument fingerprint.` };
  }
  if (pending.phase !== "intent") {
    return { status: "pending", message: `requestId "${requestId}" already has a result journal. Retry the request to finish replay recovery.` };
  }
  if (resolution.action === "clear") {
    clearRequestReplayJournal(projectDir, requestId);
    return { status: "cleared" };
  }
  const persistence = persistRequestReplay(projectDir, {
    requestId,
    operation,
    fingerprint,
    result: resolution.result,
    createdAt: pending.createdAt,
  });
  if (persistence.status === "pending") return { status: "pending", message: persistence.message };
  if (persistence.status === "unavailable") return { status: "pending", message: persistence.message };
  const entry = readRequestReplay(projectDir, requestId);
  return entry ? { status: "promoted", entry } : { status: "pending", message: "The replay receipt was recorded but could not be read back." };
}

/**
 * Finish a receipt left in the journal by a prior process. Matching operation
 * and fingerprint are required before promotion, preserving request-ID
 * collision behavior during recovery.
 */
export function recoverRequestReplay(
  projectDir: string,
  requestId: string,
  operation: string,
  fingerprint: string,
): RequestReplayRecovery {
  let pending: RequestReplayJournalEntry | undefined;
  try {
    pending = readRequestReplayJournal(projectDir, requestId);
  } catch (error) {
    return { status: "pending", phase: "result", message: error instanceof Error ? error.message : String(error) };
  }
  if (!pending) return { status: "none" };
  if (pending.operation !== operation || pending.fingerprint !== fingerprint) {
    return { status: "conflict", message: `requestId "${requestId}" has a pending receipt for a different operation or argument fingerprint.` };
  }
  // A replay result can be durable while an older intent remains in the
  // journal, for example when journal cleanup lost a race or a fallback replay
  // write succeeded while journal persistence was unavailable. The result is
  // authoritative, so recover it and retire the stale intent before treating
  // an intent-only entry as uncertain.
  let existing: RequestReplayEntry | undefined;
  try {
    existing = readRequestReplay(projectDir, requestId);
  } catch (error) {
    return { status: "pending", phase: pending.phase, message: error instanceof Error ? error.message : String(error) };
  }
  if (existing) {
    if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
      return { status: "conflict", entry: existing, message: `requestId "${requestId}" was already used for a different operation or argument fingerprint.` };
    }
    try { clearRequestReplayJournal(projectDir, requestId); } catch { /* replay is already durable */ }
    return { status: "recovered", entry: existing };
  }

  if (pending.phase === "intent") {
    return {
      status: "pending",
      phase: "intent",
      message: `requestId "${requestId}" has a durable mutation intent without an outcome receipt. Inspect the project state and clear or complete the pending recovery before retrying it.`,
    };
  }

  try {
    if (!pending.result) return { status: "pending", phase: "result", message: "The replay journal result is missing." };
    recordRequestReplay(projectDir, {
      requestId: pending.requestId,
      operation: pending.operation,
      fingerprint: pending.fingerprint,
      result: pending.result,
      createdAt: pending.createdAt,
    });
    try { clearRequestReplayJournal(projectDir, requestId); } catch { /* the replay remains durable */ }
    return {
      status: "recovered",
      phase: "result",
      entry: {
        requestId: pending.requestId,
        operation: pending.operation,
        fingerprint: pending.fingerprint,
        result: pending.result,
        createdAt: pending.createdAt,
      },
    };
  } catch (error) {
    return { status: "pending", phase: "result", message: error instanceof Error ? error.message : String(error) };
  }
}

export function requestReplayPath(projectDir: string): string {
  return replayPath(projectDir);
}

export function requestReplayJournalPath(projectDir: string): string {
  return journalPath(projectDir);
}
