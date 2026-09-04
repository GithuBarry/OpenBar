/** Durable, bounded replay metadata for idempotent server mutations. */

import fs from "node:fs";
import path from "node:path";

import { sha256, stableJson, withWriteLock, writeTextAtomic } from "@/lib/tex-project/codec";
import { texPaths } from "@/lib/tex-project/project";

const VERSION = 1 as const;
const MAX_ENTRIES = 200;

export type RequestReplayEntry = {
  requestId: string;
  operation: string;
  fingerprint: string;
  result: Record<string, unknown>;
  createdAt: string;
};

type ReplayFile = { version: typeof VERSION; entries: RequestReplayEntry[] };

function replayPath(projectDir: string): string {
  return path.join(texPaths(projectDir).openBarDir, "request-replay.json");
}

function readFile(projectDir: string): ReplayFile {
  const file = replayPath(projectDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ReplayFile>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.entries)) return { version: VERSION, entries: [] };
    return {
      version: VERSION,
      entries: parsed.entries.filter((entry): entry is RequestReplayEntry => (
        Boolean(entry)
        && typeof entry === "object"
        && typeof entry.requestId === "string"
        && typeof entry.operation === "string"
        && typeof entry.fingerprint === "string"
        && Boolean(entry.result && typeof entry.result === "object")
        && typeof entry.createdAt === "string"
      )).slice(-MAX_ENTRIES),
    };
  } catch {
    return { version: VERSION, entries: [] };
  }
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
  withWriteLock(file, () => {
    const current = readFile(projectDir);
    const entries = current.entries.filter((item) => item.requestId !== entry.requestId);
    entries.push({ ...entry, createdAt: entry.createdAt || new Date().toISOString() });
    writeTextAtomic(file, JSON.stringify({ version: VERSION, entries: entries.slice(-MAX_ENTRIES) }, null, 2) + "\n");
  });
}

export function requestReplayPath(projectDir: string): string {
  return replayPath(projectDir);
}
