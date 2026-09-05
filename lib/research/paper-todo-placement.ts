/** Browser-safe TODO placement and relocation helpers over a bundled source. */

import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { composeObtodo } from "@/lib/todo-meta";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";

export type TodoPlacementResult = {
  source: string;
  id: string;
  sectionFound: boolean;
  filePath?: string;
  sectionId: string;
  from: number;
  to: number;
  before: string;
  after: string;
  nextSource: string;
  error?: string;
};

type TargetPart = {
  filePath: string;
  bodyFrom: number;
  body: string;
  endOffset: number;
};

function sectionIdFromBody(body: string): string | undefined {
  const line = body.match(/^%\s*OB-SECTION\s+(\{.*\})\s*$/m)?.[1];
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id.trim() : undefined;
  } catch {
    return /"id"\s*:\s*"([^"\\]+)"/.exec(line)?.[1]?.trim();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function targetPart(source: string, sectionId: string): TargetPart | null {
  const part = splitBundleSource(source).find((candidate) => sectionIdFromBody(candidate.body) === sectionId.trim());
  if (!part) return null;
  const marker = new RegExp(`^%\\s*OB-EDIT-END\\s+id=${escapeRegExp(sectionId.trim())}\\s*$`, "m").exec(part.body);
  if (marker && marker.index !== undefined) {
    return { filePath: part.filePath, bodyFrom: part.bodyFrom, body: part.body, endOffset: marker.index };
  }
  // Some older or minimal section fixtures have stable OB-SECTION metadata
  // without an editable envelope. They remain valid insertion targets: append
  // at the end of that file. A present BEGIN marker with no matching END is
  // different—it is a damaged envelope and must be repaired explicitly.
  const begin = new RegExp(`^%\\s*OB-EDIT-BEGIN\\s+[^\\n]+\\s+id=${escapeRegExp(sectionId.trim())}\\s*$`, "m").test(part.body);
  if (!begin) {
    return { filePath: part.filePath, bodyFrom: part.bodyFrom, body: part.body, endOffset: part.body.length };
  }
  if (!marker || marker.index === undefined) {
    return { filePath: part.filePath, bodyFrom: part.bodyFrom, body: part.body, endOffset: -1 };
  }
  return { filePath: part.filePath, bodyFrom: part.bodyFrom, body: part.body, endOffset: marker.index };
}

function insertAtTarget(source: string, target: TargetPart, text: string): {
  source: string;
  from: number;
  to: number;
  before: string;
  after: string;
} {
  const at = target.bodyFrom + target.endOffset;
  const prefix = source.slice(0, at);
  const suffix = source.slice(at);
  const beforeNewline = prefix.endsWith("\n") ? "" : "\n";
  const afterNewline = suffix.startsWith("\n") ? "" : "\n";
  const inserted = `${beforeNewline}${text}${afterNewline}`;
  const from = at + beforeNewline.length;
  return {
    source: `${prefix}${inserted}${suffix}`,
    from,
    to: from + text.length,
    before: source.slice(Math.max(0, at - 320), at),
    after: source.slice(at, Math.min(source.length, at + 320)),
  };
}

export function previewTodoAtSection(
  source: string,
  sectionId: string,
  text: string,
  title?: string,
  id?: string,
): TodoPlacementResult {
  const target = targetPart(source, sectionId);
  const composed = composeObtodo({ id, title, text });
  const idMatch = /\bid=([A-Za-z0-9._-]+)/.exec(composed);
  const todoId = id || idMatch?.[1] || "";
  if (!target) {
    return {
      source,
      id: todoId,
      sectionFound: false,
      sectionId,
      from: source.length,
      to: source.length,
      before: "",
      after: "",
      nextSource: source,
      error: `Unknown paper section id "${sectionId}".`,
    };
  }
  if (target.endOffset < 0) {
    return {
      source,
      id: todoId,
      sectionFound: true,
      filePath: target.filePath,
      sectionId,
      from: target.bodyFrom + target.body.length,
      to: target.bodyFrom + target.body.length,
      before: target.body.slice(Math.max(0, target.body.length - 320)),
      after: "",
      nextSource: source,
      error: `Section "${sectionId}" has no complete OB-EDIT-END marker. Repair the envelope before inserting a TODO.`,
    };
  }
  const inserted = insertAtTarget(source, target, composed);
  return {
    source,
    id: todoId,
    sectionFound: true,
    filePath: target.filePath,
    sectionId,
    from: inserted.from,
    to: inserted.to,
    before: inserted.before,
    after: inserted.after,
    nextSource: inserted.source,
  };
}

export function relocateTodoInBundle(source: string, todoId: string, sectionId: string): {
  source: string;
  todoFound: boolean;
  targetFound: boolean;
  id: string;
  filePath?: string;
  from: number;
  to: number;
  before: string;
  after: string;
  error?: string;
} {
  const match = findMacroMatches(source, ["obtodo"])
    .find((candidate) => parseAnchorAttrs(candidate.attrs).id === todoId);
  if (!match) {
    return { source, todoFound: false, targetFound: false, id: todoId, from: -1, to: -1, before: "", after: "" };
  }
  const originalPart = splitBundleSource(source).find((part) => match.index >= part.bodyFrom && match.index < part.bodyTo);
  const without = `${source.slice(0, match.index)}${source.slice(match.index + match.length)}`;
  const target = targetPart(without, sectionId);
  if (!target) {
    return { source, todoFound: true, targetFound: false, id: todoId, filePath: originalPart?.filePath, from: -1, to: -1, before: "", after: "", error: `Unknown paper section id "${sectionId}".` };
  }
  if (target.endOffset < 0) {
    return { source, todoFound: true, targetFound: true, id: todoId, filePath: originalPart?.filePath, from: -1, to: -1, before: "", after: "", error: `Section "${sectionId}" has no complete OB-EDIT-END marker.` };
  }
  const inserted = insertAtTarget(without, target, source.slice(match.index, match.index + match.length));
  return {
    source: inserted.source,
    todoFound: true,
    targetFound: true,
    id: todoId,
    filePath: target.filePath,
    from: inserted.from,
    to: inserted.to,
    before: inserted.before,
    after: inserted.after,
  };
}
