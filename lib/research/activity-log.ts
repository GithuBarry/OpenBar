import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { projectMetadataDir, withProjectWriteLock } from "./project-lock";

const ACTIVITY_VERSION = 1 as const;
const MAX_DETAIL_CHARS = 600;
export const ACTIVITY_MAX_RESOURCES = 50;
export const ACTIVITY_MAX_CHANGES = 50;
export const ACTIVITY_MAX_READ = 2_000;

export type ActivityActor = "human" | "webmcp" | "system";

export type ActivityResource = {
  kind: string;
  id: string;
  mapId?: string;
};

export type ActivityChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

export type ActivityEvent = {
  version: typeof ACTIVITY_VERSION;
  id: string;
  at: string;
  actor: ActivityActor;
  operation: string;
  projectId?: string;
  requestId?: string;
  resources: ActivityResource[];
  changes?: ActivityChange[];
  title?: string;
  href?: string;
  deleted?: boolean;
};

/** Keep activity details useful to readers while keeping every projection bounded. */
export function compactActivityResources(
  resources: ActivityResource[] | undefined,
  limit = 8,
): ActivityResource[] {
  return (resources || [])
    .filter((resource) => resource && typeof resource.kind === "string" && typeof resource.id === "string")
    .slice(0, Math.max(0, Math.min(ACTIVITY_MAX_RESOURCES, Math.floor(limit))))
    .map((resource) => ({
      kind: resource.kind.slice(0, 80),
      id: resource.id.slice(0, 240),
      ...(resource.mapId ? { mapId: resource.mapId.slice(0, 160) } : {}),
    }));
}

/** Preserve before/after evidence in summaries with the same bounds as the log. */
export function compactActivityChanges(
  changes: ActivityChange[] | undefined,
  limit = 8,
): ActivityChange[] {
  return (changes || [])
    .filter((change) => change && typeof change.field === "string")
    .slice(0, Math.max(0, Math.min(ACTIVITY_MAX_CHANGES, Math.floor(limit))))
    .map((change) => {
      const before = boundedValue(change.before);
      const after = boundedValue(change.after);
      return {
        field: change.field.slice(0, 120),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      };
    });
}

function activityFile(projectPath: string): string {
  return path.join(projectMetadataDir(projectPath), "activity.jsonl");
}

function boundedValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, MAX_DETAIL_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 24).map(boundedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 24).map(([key, child]) => [key.slice(0, 80), boundedValue(child)]));
  }
  return undefined;
}

function normalizeEvent(input: Omit<ActivityEvent, "version" | "id" | "at"> & Partial<Pick<ActivityEvent, "id" | "at">>): ActivityEvent {
  const resources = compactActivityResources(input.resources, ACTIVITY_MAX_RESOURCES);
  return {
    version: ACTIVITY_VERSION,
    id: input.id || randomUUID(),
    at: input.at || new Date().toISOString(),
    actor: input.actor,
    operation: input.operation.slice(0, 120),
    ...(input.projectId ? { projectId: input.projectId.slice(0, 160) } : {}),
    ...(input.requestId ? { requestId: input.requestId.slice(0, 160) } : {}),
    resources,
    ...(input.changes?.length ? { changes: compactActivityChanges(input.changes, ACTIVITY_MAX_CHANGES) } : {}),
    ...(input.title ? { title: input.title.slice(0, MAX_DETAIL_CHARS) } : {}),
    ...(input.href ? { href: input.href.slice(0, 2_000) } : {}),
    ...(input.deleted ? { deleted: true } : {}),
  };
}

function parseEvent(value: unknown): ActivityEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ActivityEvent>;
  if (candidate.version !== ACTIVITY_VERSION || typeof candidate.id !== "string" || typeof candidate.at !== "string" || typeof candidate.operation !== "string") return null;
  if (candidate.actor !== "human" && candidate.actor !== "webmcp" && candidate.actor !== "system") return null;
  if (!Array.isArray(candidate.resources)) return null;
  return normalizeEvent(candidate as Omit<ActivityEvent, "version" | "id" | "at"> & Partial<Pick<ActivityEvent, "id" | "at">>);
}

export function activityLogPath(projectPath: string): string {
  return activityFile(projectPath);
}

/** Append one event after the authored operation has reached local storage. */
export function appendActivity(
  projectPath: string,
  input: Omit<ActivityEvent, "version" | "id" | "at"> & Partial<Pick<ActivityEvent, "id" | "at">>,
): ActivityEvent {
  const event = normalizeEvent(input);
  const file = activityFile(projectPath);
  withProjectWriteLock(projectPath, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const descriptor = fs.openSync(file, "a");
    try {
      fs.writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  });
  return event;
}

export function readActivity(projectPath: string, limit = 500): ActivityEvent[] {
  const file = activityFile(projectPath);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const bounded = Math.max(1, Math.min(ACTIVITY_MAX_READ, Math.floor(limit)));
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-bounded)
    .map((line) => {
      try {
        return parseEvent(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((event): event is ActivityEvent => Boolean(event))
    .sort((a, b) => b.at.localeCompare(a.at));
}
