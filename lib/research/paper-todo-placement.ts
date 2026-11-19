/** Browser-safe TODO placement and relocation helpers over a bundled source. */

import { deriveSections } from "@/lib/tex-project/section-ranges";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { composeObtodo } from "@/lib/todo-meta";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";

export type TodoPlacementResult = {
  source: string;
  id: string;
  sectionFound: boolean;
  filePath?: string;
  sectionId?: string;
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

function rootTargetPart(source: string): TargetPart | null {
  const part = splitBundleSource(source)[0] || (source ? {
    filePath: "",
    bodyFrom: 0,
    body: source,
    bodyTo: source.length,
  } : null);
  if (!part) return null;
  const documentEnd = findMacroMatches(part.body, ["end"])
    .filter((match) => match.body.trim() === "document")
    .at(-1);
  return {
    filePath: part.filePath,
    bodyFrom: part.bodyFrom,
    body: part.body,
    endOffset: documentEnd?.index ?? part.body.length,
  };
}

function targetPart(source: string, sectionId?: string): TargetPart | null {
  const normalizedSectionId = sectionId?.trim();
  if (!normalizedSectionId) return rootTargetPart(source);
  for (const part of splitBundleSource(source)) {
    const section = deriveSections(part.body, part.filePath).find(section => section.id === normalizedSectionId);
    if (section) return { filePath: part.filePath, bodyFrom: part.bodyFrom, body: part.body, endOffset: section.to };
  }
  return null;
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
  sectionId: string | undefined,
  text: string,
  title?: string,
  id?: string,
  textFormat: "plain" | "tex" = "plain",
): TodoPlacementResult {
  const normalizedSectionId = sectionId?.trim() || undefined;
  const target = targetPart(source, normalizedSectionId);
  const composed = composeObtodo({ id, title, text, textFormat });
  const idMatch = /\bid=([A-Za-z0-9._-]+)/.exec(composed);
  const todoId = id || idMatch?.[1] || "";
  if (!target) {
    return {
      source,
      id: todoId,
      sectionFound: false,
      ...(normalizedSectionId ? { sectionId: normalizedSectionId } : {}),
      from: source.length,
      to: source.length,
      before: "",
      after: "",
      nextSource: source,
      error: normalizedSectionId ? `Unknown paper section id "${normalizedSectionId}".` : "The paper has no writable source location.",
    };
  }
  const invalidBody = textFormat === "tex" && findMacroMatches(composed, ["obtodo"])[0]?.length !== composed.length;
  if (invalidBody || target.endOffset < 0) {
    return {
      source,
      id: todoId,
      sectionFound: true,
      sectionId: normalizedSectionId,
      filePath: target.filePath,
      from: target.bodyFrom + target.body.length,
      to: target.bodyFrom + target.body.length,
      before: target.body.slice(Math.max(0, target.body.length - 320)),
      after: "",
      nextSource: source,
      error: invalidBody
        ? "Check the TeX braces and escape literal percent signs before creating the paper TODO."
        : `Section "${normalizedSectionId}" has no complete OB-EDIT-END marker. Repair the envelope before inserting a TODO.`,
    };
  }
  const inserted = insertAtTarget(source, target, composed);
  return {
    source,
    id: todoId,
    sectionFound: true,
    filePath: target.filePath,
    ...(normalizedSectionId ? { sectionId: normalizedSectionId } : {}),
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
