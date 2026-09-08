/**
 * `\obtodo[id=…, title=…, created=…, updated=…, completed=…]{text}`
 *
 * TeX owns id, title, text, and completion. Unknown attributes round-trip.
 * Completion is the only workflow state: absent = open, present = complete.
 */

import { findMacroMatches, parseAnchorAttrs, serializeAnchorAttrs } from "@/lib/marker-codec";
import { escapeTexText } from "@/lib/tex-project/tex-encode";

export type TodoAttrPatch = {
  id?: string;
  title?: string | null;
  text?: string;
  textFormat?: "plain" | "tex";
  completed?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  /** Free-form attribute writes. `null` deletes the key. */
  attrs?: Record<string, string | null>;
};

export function generateTodoId(now = new Date()): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `t${now.getTime().toString(36)}${random}`;
}

export function nowStamp(now = new Date()): string {
  return now.toISOString();
}

/** Accept ISO datetime or YYYY-MM-DD. */
export function parseTodoTimestamp(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return undefined;
    const [year, month, date] = value.split("-").map(Number);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== date) {
      return undefined;
    }
    return parsed.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function todoIsComplete(attrs: Record<string, string> | { completedAt?: string; completed?: string }): boolean {
  const record = attrs as Record<string, string>;
  const completed = record.completed || record.completedAt;
  return Boolean(completed && parseTodoTimestamp(completed));
}

export function todoMetaFromAttrs(attrs: Record<string, string>): {
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
} {
  return {
    createdAt: parseTodoTimestamp(attrs.created || attrs.createdAt),
    updatedAt: parseTodoTimestamp(attrs.updated || attrs.updatedAt),
    completedAt: parseTodoTimestamp(attrs.completed || attrs.completedAt),
  };
}

export function todoTitleFromAttrs(attrs: Record<string, string>): string | undefined {
  const title = attrs.title?.trim();
  return title || undefined;
}

export function composeObtodo(spec: {
  id?: string;
  title?: string;
  text: string;
  textFormat?: "plain" | "tex";
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  now?: Date;
}): string {
  const now = spec.now ?? new Date();
  const created = parseTodoTimestamp(spec.createdAt) || nowStamp(now);
  const attrs: Record<string, string> = {
    id: spec.id?.trim() || generateTodoId(now),
    created,
  };
  const title = spec.title?.trim();
  if (title) attrs.title = title;
  const updated = parseTodoTimestamp(spec.updatedAt);
  if (updated) attrs.updated = updated;
  const completed = parseTodoTimestamp(spec.completedAt);
  if (completed) attrs.completed = completed;
  return `\\obtodo[${serializeAnchorAttrs(attrs)}]{${spec.textFormat === "tex" ? spec.text : escapeTexText(spec.text)}}`;
}

function applyPatch(attrs: Record<string, string>, patch: TodoAttrPatch, now: Date): void {
  if (patch.id?.trim() && !attrs.id?.trim()) attrs.id = patch.id.trim();
  if (patch.createdAt === null) {
    delete attrs.created;
    delete attrs.createdAt;
  } else if (patch.createdAt !== undefined) {
    const created = parseTodoTimestamp(patch.createdAt);
    delete attrs.createdAt;
    if (created) attrs.created = created;
    else delete attrs.created;
  }

  let touched = patch.title !== undefined || patch.text !== undefined;
  if (patch.completed === false || patch.completed === null || patch.completedAt === null) {
    delete attrs.completed;
    delete attrs.completedAt;
    delete attrs.status;
    touched = true;
  } else if (patch.completed === true || patch.completedAt !== undefined) {
    const completed = parseTodoTimestamp(patch.completedAt ?? undefined) || attrs.completed || nowStamp(now);
    attrs.completed = completed;
    delete attrs.completedAt;
    delete attrs.status;
    touched = true;
  }

  if (patch.attrs) {
    for (const [key, value] of Object.entries(patch.attrs)) {
      if (key === "id" && attrs.id?.trim()) continue;
      if (value === null || value === "") {
        delete attrs[key];
        touched = true;
      } else {
        attrs[key] = value;
        touched = true;
      }
    }
  }

  if (patch.title !== undefined) {
    const title = patch.title?.trim();
    if (title) attrs.title = title;
    else delete attrs.title;
    touched = true;
  }

  if (patch.updatedAt === null) {
    delete attrs.updated;
    delete attrs.updatedAt;
  } else if (patch.updatedAt !== undefined) {
    const updated = parseTodoTimestamp(patch.updatedAt);
    delete attrs.updatedAt;
    if (updated) attrs.updated = updated;
    else delete attrs.updated;
  } else if (touched) {
    attrs.updated = nowStamp(now);
  }
}

export function rewriteObtodo(tex: string, patch: TodoAttrPatch, now = new Date()): string {
  const match = findMacroMatches(tex, ["obtodo"])[0];
  if (!match) return tex;
  const attrs = parseAnchorAttrs(match.attrs);
  applyPatch(attrs, patch, now);
  const body = patch.text !== undefined ? patch.textFormat === "tex" ? patch.text : escapeTexText(patch.text) : match.body;
  const serialized = serializeAnchorAttrs(attrs);
  return `\\obtodo${serialized ? `[${serialized}]` : ""}{${body}}`;
}

export function rewriteObtodoText(tex: string, text: string, now = new Date()): string {
  return rewriteObtodo(tex, { text }, now);
}

export function patchObtodoInSource(source: string, from: number, to: number, patch: TodoAttrPatch, now = new Date()): string {
  return `${source.slice(0, from)}${rewriteObtodo(source.slice(from, to), patch, now)}${source.slice(to)}`;
}

export function assignMissingTodoIds(source: string, now = new Date()): { source: string; assigned: string[] } {
  const matches = findMacroMatches(source, ["obtodo"]);
  if (!matches.length) return { source, assigned: [] };
  const used = new Set<string>();
  for (const match of matches) {
    const id = parseAnchorAttrs(match.attrs).id?.trim();
    if (id) used.add(id);
  }
  const assigned: string[] = [];
  let next = source;
  let shift = 0;
  for (const match of matches) {
    const attrs = parseAnchorAttrs(match.attrs);
    if (attrs.id?.trim()) continue;
    let id = generateTodoId(now);
    while (used.has(id)) id = generateTodoId(now);
    used.add(id);
    assigned.push(id);
    const created = parseTodoTimestamp(attrs.created || attrs.createdAt) || nowStamp(now);
    const rewritten = rewriteObtodo(
      next.slice(match.index + shift, match.index + shift + match.length),
      { id, createdAt: created },
      now,
    );
    next = `${next.slice(0, match.index + shift)}${rewritten}${next.slice(match.index + shift + match.length)}`;
    shift += rewritten.length - match.length;
  }
  return { source: next, assigned };
}
