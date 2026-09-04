/**
 * Persist TODO operations onto the manuscript include graph.
 */

import { applySourceOperation } from "@/lib/research/operation-service";
import type { SourceOperation } from "@/lib/research/operations";
import { failResult } from "@/lib/research/operation-result";
import { persistSourceBundle, persistVirtualRange } from "@/lib/tex-project/source-persist";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { parseSectionMeta } from "@/lib/tex-project/codec";
import { analyzePaper } from "@/lib/research/paper-analysis";
import { composeObtodo } from "@/lib/todo-meta";

export function persistPaperTodoOperation(input: {
  manuscriptDir: string;
  operation: SourceOperation;
  expectedBundleHash?: string;
  dryRun?: boolean;
}) {
  const bundle = buildSourceBundle(input.manuscriptDir);
  const expectedSourceHash = "expectedSourceHash" in input.operation ? input.operation.expectedSourceHash : undefined;
  if (expectedSourceHash && expectedSourceHash !== bundle.bundleHash) {
    return failResult("stale_disk_state", "The paper changed on disk. Reload the paper before saving this TODO.", {
      retryable: true,
      currentHash: bundle.bundleHash,
    });
  }
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

export function insertTodoAtSection(source: string, sectionId: string, text: string, id?: string, title?: string): {
  source: string;
  id: string;
  from: number;
  to: number;
  sectionFound: boolean;
} {
  const composed = composeObtodo({ id, title, text });
  const idMatch = composed.match(/id=([A-Za-z0-9._-]+)/);
  const todoId = id || idMatch?.[1] || "";
  const parts = splitBundleSource(source);
  const targetPart = parts.find((part) => {
    try {
      return parseSectionMeta(part.body).id === sectionId.trim();
    } catch {
      return false;
    }
  });
  if (!targetPart) {
    return { source, id: todoId, from: source.length, to: source.length, sectionFound: false };
  }
  const editEnd = /^%\s*OB-EDIT-END[^\n]*(?:\n|$)/m.exec(targetPart.body);
  const insertAt = editEnd ? targetPart.bodyFrom + editEnd.index : targetPart.bodyTo;
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
