import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { writeTextAtomic } from "@/lib/tex-project/codec";
import { texPaths } from "@/lib/tex-project/project";
import { withProjectWriteLock } from "./project-lock";

export type CelebrationScope = "screen" | "card";

export type CelebrationEvent = {
  id: string;
  reason: string;
  scope: CelebrationScope;
  emoji?: string;
  mapId?: string;
  nodeId?: string;
  createdAt: string;
};

type CelebrationStore = { version: 1; pending: CelebrationEvent[] };

const MAX_PENDING = 10;
const FILE_NAME = "celebrations.json";

function storePath(projectDir: string): string {
  return path.join(texPaths(projectDir).openBarDir, FILE_NAME);
}

function readStore(projectDir: string): CelebrationStore {
  const file = storePath(projectDir);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CelebrationStore>;
    if (raw?.version === 1 && Array.isArray(raw.pending)) {
      return {
        version: 1,
        pending: raw.pending.filter((item): item is CelebrationEvent => Boolean(
          item && typeof item.id === "string" && typeof item.reason === "string" && (item.scope === "screen" || item.scope === "card"),
        )).slice(-MAX_PENDING),
      };
    }
  } catch { /* Missing or unreadable queue starts empty. */ }
  return { version: 1, pending: [] };
}

function writeStore(projectDir: string, store: CelebrationStore): void {
  const file = storePath(projectDir);
  if (!store.pending.length) {
    try { fs.unlinkSync(file); } catch { /* Already cleared. */ }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeTextAtomic(file, JSON.stringify({ version: 1, pending: store.pending.slice(-MAX_PENDING) }) + "\n");
}

export function listPendingCelebrations(projectDir: string): CelebrationEvent[] {
  return readStore(projectDir).pending;
}

export function queueCelebration(
  projectDir: string,
  input: { reason: string; scope?: CelebrationScope; emoji?: string; mapId?: string; nodeId?: string },
): CelebrationEvent {
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!reason) throw new Error("Celebration needs a short reason.");
  const scope: CelebrationScope = input.scope === "card" && input.nodeId?.trim() ? "card" : "screen";
  const event: CelebrationEvent = {
    id: randomUUID(),
    reason,
    scope,
    ...(input.emoji?.trim() ? { emoji: input.emoji.trim().slice(0, 8) } : {}),
    ...(input.mapId?.trim() ? { mapId: input.mapId.trim() } : {}),
    ...(input.nodeId?.trim() ? { nodeId: input.nodeId.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  return withProjectWriteLock(projectDir, () => {
    const current = readStore(projectDir);
    current.pending.push(event);
    writeStore(projectDir, current);
    return event;
  });
}

export function consumeCelebrations(projectDir: string, ids: string[]): number {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return 0;
  return withProjectWriteLock(projectDir, () => {
    const current = readStore(projectDir);
    const next = current.pending.filter((item) => !set.has(item.id));
    const removed = current.pending.length - next.length;
    if (removed > 0) writeStore(projectDir, { version: 1, pending: next });
    return removed;
  });
}
