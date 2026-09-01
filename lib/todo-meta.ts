/**
 * Optional metadata on `\obtodo[…]{…}` anchors.
 *
 * Stored as ordinary key=value attrs next to `id` / `claim`. Unknown keys pass
 * through. Brace `{?todo:}` markers stay lightweight and have no structured fields.
 */

import { findMacroMatches, parseAnchorAttrs, serializeAnchorAttrs } from "@/lib/marker-codec";
import { escapeTexText } from "@/lib/tex-project/tex-encode";

export const TODO_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

const PRIORITY_ALIASES: Record<string, TodoPriority> = {
  p0: "p0",
  p1: "p1",
  p2: "p2",
  p3: "p3",
  high: "p0",
  urgent: "p0",
  medium: "p1",
  med: "p1",
  low: "p2",
};

export const TODO_STATUSES = ["open", "in_progress", "blocked", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export type TodoAttrPatch = {
  priority?: TodoPriority | null;
  due?: string | null;
  owner?: string | null;
  createdAt?: string | null;
  status?: TodoStatus | null;
  completedAt?: string | null;
};

export function parseTodoStatus(raw?: string): TodoStatus {
  const value = (raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (value === "done" || value === "complete" || value === "completed") return "done";
  if (value === "in_progress" || value === "wip") return "in_progress";
  if (value === "blocked") return "blocked";
  return "open";
}

export function parseTodoPriority(raw?: string): TodoPriority | undefined {
  if (!raw) return undefined;
  return PRIORITY_ALIASES[raw.trim().toLowerCase()];
}

/** Accept YYYY-MM-DD or an ISO datetime; store YYYY-MM-DD. */
export function parseTodoDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const day = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!day) return undefined;
  const parsed = new Date(`${day[1]}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const [year, month, date] = day[1]!.split("-").map(Number);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== date) return undefined;
  return day[1];
}

export function todayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function todoPriorityRank(priority?: TodoPriority): number {
  if (priority === "p0") return 0;
  if (priority === "p1") return 1;
  if (priority === "p2") return 2;
  if (priority === "p3") return 3;
  return 4;
}

export function todoMetaFromAttrs(attrs: Record<string, string>): {
  priority?: TodoPriority;
  due?: string;
  owner?: string;
  createdAt?: string;
  status?: TodoStatus;
  completedAt?: string;
} {
  const status = parseTodoStatus(attrs.status);
  return {
    priority: parseTodoPriority(attrs.priority),
    due: parseTodoDate(attrs.due || attrs.target || attrs.targetDate),
    owner: attrs.owner?.trim() || undefined,
    createdAt: parseTodoDate(attrs.created || attrs.createdAt),
    status: status === "open" ? undefined : status,
    completedAt: parseTodoDate(attrs.completed || attrs.completedAt),
  };
}

export function composeObtodo(spec: {
  id?: string;
  text: string;
  claim?: string;
  owner?: string;
  priority?: TodoPriority;
  due?: string;
  createdAt?: string;
}): string {
  const generatedId = () => {
    const random = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
    return `t${Date.now().toString(36)}-${random}`;
  };
  const attrs: Record<string, string> = {
    id: spec.id?.trim() || generatedId(),
  };
  if (spec.claim?.trim()) attrs.claim = spec.claim.trim();
  if (spec.owner?.trim()) attrs.owner = spec.owner.trim();
  if (spec.priority) attrs.priority = spec.priority;
  const due = parseTodoDate(spec.due);
  if (due) attrs.due = due;
  const created = parseTodoDate(spec.createdAt);
  if (created) attrs.created = created;
  return `\\obtodo[${serializeAnchorAttrs(attrs)}]{${escapeTexText(spec.text)}}`;
}

function applyPatch(attrs: Record<string, string>, patch: TodoAttrPatch): void {
  if (patch.status === null || patch.status === "open") {
    delete attrs.status;
    delete attrs.completed;
    delete attrs.completedAt;
  } else if (patch.status) {
    attrs.status = patch.status;
    if (patch.status === "done") {
      const completed = parseTodoDate(patch.completedAt ?? undefined) || attrs.completed || todayStamp();
      attrs.completed = completed;
    } else {
      delete attrs.completed;
      delete attrs.completedAt;
    }
  }
  if (patch.completedAt === null) {
    delete attrs.completed;
    delete attrs.completedAt;
  } else if (patch.completedAt !== undefined && patch.status !== "open" && patch.status !== null) {
    const completed = parseTodoDate(patch.completedAt);
    if (completed) attrs.completed = completed;
  }

  if (patch.priority === null) delete attrs.priority;
  else if (patch.priority) attrs.priority = patch.priority;

  if (patch.due === null) {
    delete attrs.due;
    delete attrs.target;
    delete attrs.targetDate;
  } else if (patch.due !== undefined) {
    const due = parseTodoDate(patch.due);
    delete attrs.target;
    delete attrs.targetDate;
    if (due) attrs.due = due;
    else delete attrs.due;
  }

  if (patch.owner === null) delete attrs.owner;
  else if (patch.owner !== undefined) {
    if (patch.owner.trim()) attrs.owner = patch.owner.trim();
    else delete attrs.owner;
  }

  if (patch.createdAt === null) {
    delete attrs.created;
    delete attrs.createdAt;
  } else if (patch.createdAt !== undefined) {
    const created = parseTodoDate(patch.createdAt);
    delete attrs.createdAt;
    if (created) attrs.created = created;
    else delete attrs.created;
  }
}

export function rewriteObtodo(tex: string, patch: TodoAttrPatch): string {
  const match = findMacroMatches(tex, ["obtodo"])[0];
  if (!match) return tex;
  const attrs = parseAnchorAttrs(match.attrs);
  applyPatch(attrs, patch);
  const serialized = serializeAnchorAttrs(attrs);
  return `\\obtodo${serialized ? `[${serialized}]` : ""}{${match.body}}`;
}

/** Rewrite only the visible TODO text while preserving its attributes. */
export function rewriteObtodoText(tex: string, text: string): string {
  const match = findMacroMatches(tex, ["obtodo"])[0];
  if (!match) return tex;
  const attrs = parseAnchorAttrs(match.attrs);
  const serialized = serializeAnchorAttrs(attrs);
  return `\\obtodo${serialized ? `[${serialized}]` : ""}{${escapeTexText(text)}}`;
}

export function patchObtodoInSource(source: string, from: number, to: number, patch: TodoAttrPatch): string {
  return `${source.slice(0, from)}${rewriteObtodo(source.slice(from, to), patch)}${source.slice(to)}`;
}
