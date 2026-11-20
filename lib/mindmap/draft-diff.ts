import type { RecentActivityItem } from "@/lib/research/project-state";

export type DraftChangeInfo = {
  isNew: boolean;
  titleChanged: boolean;
  bodyChanged: boolean;
  notesChanged: boolean;
  beforeTitle?: string;
  beforeText?: string;
};

function stringVal(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Derive what changed on each agent-draft card from recent project activity.
 * Falls back to marking title + body changed when no recent record is present.
 */
export function draftChangesByNode(
  recent: readonly RecentActivityItem[] | undefined,
  draftIds: ReadonlySet<string>,
): Map<string, DraftChangeInfo> {
  const out = new Map<string, DraftChangeInfo>();
  if (!draftIds.size) return out;

  for (const item of recent || []) {
    if (!item.changes?.length) continue;
    const nodeIds = (item.resources || [])
      .filter((r) => r.kind === "mindmap-node" && draftIds.has(r.id))
      .map((r) => r.id);
    if (!nodeIds.length) continue;

    for (const nodeId of nodeIds) {
      if (out.has(nodeId)) continue;
      if (item.operation === "add_mindmap_node" || item.changes.some((c) => c.field === "added" && c.after === nodeId)) {
        out.set(nodeId, { isNew: true, titleChanged: true, bodyChanged: true, notesChanged: false });
        continue;
      }
      let titleChanged = false;
      let bodyChanged = false;
      let notesChanged = false;
      let beforeTitle: string | undefined;
      let beforeText: string | undefined;

      for (const change of item.changes) {
        const field = change.field;
        const mapSave = item.operation === "save_mindmap";
        if ((!mapSave && field === "title") || field === `node:${nodeId}.title`) {
          titleChanged = true;
          beforeTitle = stringVal(change.before);
        } else if ((!mapSave && field === "text") || field === `node:${nodeId}.text`) {
          bodyChanged = true;
          beforeText = stringVal(change.before);
        } else if ((!mapSave && (field === "caption" || field === "caution")) || field === `node:${nodeId}.caption` || field === `node:${nodeId}.caution`) {
          notesChanged = true;
        } else if (field === `node:${nodeId}` && change.after && typeof change.after === "object") {
          if (!change.before) {
            out.set(nodeId, { isNew: true, titleChanged: true, bodyChanged: true, notesChanged: false });
            break;
          }
          const b = change.before as Record<string, unknown>;
          const a = change.after as Record<string, unknown>;
          if (b.title !== a.title) { titleChanged = true; beforeTitle = stringVal(b.title); }
          if (b.text !== a.text) { bodyChanged = true; beforeText = stringVal(b.text); }
          if (b.caption !== a.caption || JSON.stringify(b.caution) !== JSON.stringify(a.caution)) notesChanged = true;
        }
      }

      if (!out.has(nodeId) && (titleChanged || bodyChanged || notesChanged)) {
        out.set(nodeId, { isNew: false, titleChanged, bodyChanged, notesChanged, beforeTitle, beforeText });
      }
    }
  }

  for (const id of draftIds) {
    if (!out.has(id)) {
      out.set(id, { isNew: true, titleChanged: true, bodyChanged: true, notesChanged: false });
    }
  }
  return out;
}

/**
 * Word-level diff highlighting added/modified tokens in `after` compared to `before`.
 * Returns null if `before` is absent or appears truncated so the caller can underline the whole field.
 */
export function diffChangedWordSpans(
  before: string | undefined,
  after: string,
): Array<{ text: string; changed: boolean }> | null {
  if (!before || !after || before.endsWith("…") || before.length >= 600) return null;
  const aTokens = before.match(/\S+|\s+/g) || [];
  const bTokens = after.match(/\S+|\s+/g) || [];
  if (aTokens.length > 400 || bTokens.length > 400) return null;

  const aWords = aTokens.filter((t) => !/^\s+$/.test(t));
  const bWords = bTokens.filter((t) => !/^\s+$/.test(t));
  const n = aWords.length;
  const m = bWords.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = aWords[i] === bWords[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const unchanged = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aWords[i] === bWords[j]) {
      unchanged.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const spans: Array<{ text: string; changed: boolean }> = [];
  let wordIdx = 0;
  for (const token of bTokens) {
    const isSpace = /^\s+$/.test(token);
    const changed = isSpace ? false : !unchanged.has(wordIdx++);
    const prev = spans[spans.length - 1];
    if (isSpace && prev) {
      // Attach space between two changed words to the changed run so the underline stays continuous.
      spans.push({ text: token, changed: prev.changed });
    } else {
      spans.push({ text: token, changed });
    }
  }
  // Don't leave trailing spaces underlined before unchanged words.
  for (let k = 0; k < spans.length; k++) {
    const cur = spans[k]!;
    if (/^\s+$/.test(cur.text) && cur.changed) {
      const next = spans[k + 1];
      if (!next || !next.changed) cur.changed = false;
    }
  }
  // Merge adjacent runs with same `changed` flag.
  const merged: Array<{ text: string; changed: boolean }> = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && prev.changed === span.changed) prev.text += span.text;
    else merged.push({ ...span });
  }
  return merged;
}
