/**
 * Persist TODO operations onto the manuscript include graph.
 */

import { applySourceOperation } from "@/lib/research/operation-service";
import type { SourceOperation } from "@/lib/research/operations";
import { persistSourceBundle, persistVirtualRange } from "@/lib/tex-project/source-persist";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { analyzePaper } from "@/lib/research/paper-analysis";
import { composeObtodo } from "@/lib/todo-meta";
import { TEX_HEADING_LINE } from "@/lib/tex-project/paper-compose";

export function persistPaperTodoOperation(input: {
  manuscriptDir: string;
  operation: SourceOperation;
  expectedBundleHash?: string;
  dryRun?: boolean;
}) {
  const bundle = buildSourceBundle(input.manuscriptDir);
  const applied = applySourceOperation(bundle.source, input.operation);
  if (!applied.ok) return applied;
  if (applied.value.patches.length === 1 && applied.value.patches[0]!.filePath === "") {
    const patch = applied.value.patches[0]!;
    if (patch.from === 0 && patch.to === bundle.source.length) {
      return persistSourceBundle({
        manuscriptDir: input.manuscriptDir,
        nextSource: applied.value.source,
        expectedBundleHash: input.expectedBundleHash,
        dryRun: input.dryRun,
      });
    }
    return persistVirtualRange({
      manuscriptDir: input.manuscriptDir,
      from: patch.from,
      to: patch.to,
      text: patch.next,
      expectedBundleHash: input.expectedBundleHash,
      dryRun: input.dryRun,
    });
  }
  return persistSourceBundle({
    manuscriptDir: input.manuscriptDir,
    nextSource: applied.value.source,
    expectedBundleHash: input.expectedBundleHash,
    dryRun: input.dryRun,
  });
}

export function insertTodoAtSection(source: string, sectionTitle: string, text: string, id?: string, title?: string): {
  source: string;
  id: string;
  from: number;
  to: number;
  sectionFound: boolean;
} {
  const composed = composeObtodo({ id, title, text });
  const idMatch = composed.match(/id=([A-Za-z0-9._-]+)/);
  const todoId = id || idMatch?.[1] || "";
  const lines = source.split("\n");
  const lineStarts: number[] = [];
  let lineCursor = 0;
  for (const line of lines) {
    lineStarts.push(lineCursor);
    lineCursor += line.length + 1;
  }
  let insertAt = source.length;
  let targetLine = -1;
  let nextHeadingLine = -1;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const match = TEX_HEADING_LINE.exec(lines[i] || "");
    if (!match || match[1] === "title") continue;
    const title = match[2]!.trim();
    if (!found && title.toLowerCase() === sectionTitle.trim().toLowerCase()) {
      found = true;
      targetLine = i;
      continue;
    }
    if (found && match) {
      nextHeadingLine = i;
      break;
    }
  }
  if (!found) {
    return { source, id: todoId, from: source.length, to: source.length, sectionFound: false };
  }
  const parts = splitBundleSource(source);
  if (targetLine >= 0) {
    const targetOffset = lineStarts[targetLine] ?? source.length;
    const targetPart = parts.find((part) => targetOffset >= part.bodyFrom && targetOffset < part.bodyTo);
    const editEnd = targetPart && /^%\s*OB-EDIT-END[^\n]*(?:\n|$)/m.exec(targetPart.body);
    if (targetPart && editEnd) {
      insertAt = targetPart.bodyFrom + editEnd.index;
    } else if (nextHeadingLine >= 0) {
      const nextOffset = lineStarts[nextHeadingLine] ?? source.length;
      const nextPart = parts.find((part) => nextOffset >= part.bodyFrom && nextOffset < part.bodyTo);
      if (targetPart && nextPart && targetPart !== nextPart) insertAt = nextPart.bannerFrom;
      else insertAt = nextOffset;
    } else if (targetPart) {
      insertAt = targetPart.bodyTo;
    } else {
      insertAt = source.length;
    }
  }
  const prefix = source.slice(0, insertAt).replace(/\s*$/, "\n");
  const suffix = source.slice(insertAt).replace(/^\s*/, "\n");
  const next = `${prefix}${composed}${suffix}`;
  const from = prefix.length;
  return { source: next, id: todoId, from, to: from + composed.length, sectionFound: true };
}

export function findSectionTitleForId(source: string, sectionId: string, sections: Array<{ id: string; title: string }>): string | undefined {
  return sections.find((section) => section.id === sectionId)?.title;
}

export function paperTodos(source: string) {
  return analyzePaper(source).todos;
}
