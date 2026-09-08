/**
 * Persist TODO operations onto the manuscript include graph.
 */

import { applySourceOperation } from "@/lib/research/operation-service";
import type { SourceOperation } from "@/lib/research/operations";
import { failResult } from "@/lib/research/operation-result";
import { persistSourceBundle, persistVirtualRange } from "@/lib/tex-project/source-persist";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { analyzePaper } from "@/lib/research/paper-analysis";
import { previewTodoAtSection, relocateTodoInBundle } from "./paper-todo-placement";

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

export function insertTodoAtSection(source: string, sectionId: string | undefined, text: string, id?: string, title?: string): {
  source: string;
  id: string;
  from: number;
  to: number;
  sectionFound: boolean;
  filePath?: string;
  sectionId?: string;
  before?: string;
  after?: string;
  error?: string;
} {
  const placement = previewTodoAtSection(source, sectionId, text, title, id);
  return {
    source: placement.nextSource,
    id: placement.id,
    from: placement.from,
    to: placement.to,
    sectionFound: placement.sectionFound,
    ...(placement.filePath ? { filePath: placement.filePath } : {}),
    ...(placement.sectionId ? { sectionId: placement.sectionId } : {}),
    before: placement.before,
    after: placement.after,
    ...(placement.error ? { error: placement.error } : {}),
  };
}

export function previewPaperTodoPlacement(input: {
  manuscriptDir: string;
  sectionId?: string;
  text: string;
  title?: string;
  id?: string;
}) {
  const bundle = buildSourceBundle(input.manuscriptDir);
  return {
    ...previewTodoAtSection(bundle.source, input.sectionId, input.text, input.title, input.id),
    bundleHash: bundle.bundleHash,
  };
}

export function persistPaperTodoPlacement(input: {
  manuscriptDir: string;
  sectionId?: string;
  text: string;
  title?: string;
  id?: string;
  expectedBundleHash?: string;
}) {
  const preview = previewPaperTodoPlacement(input);
  if (!preview.sectionFound || preview.error) {
    return failResult(preview.sectionFound ? "invalid_tex" : "unknown_section", preview.error || (input.sectionId ? `Unknown paper section id "${input.sectionId}".` : "The paper has no writable source location."), {
      retryable: false,
    });
  }
  const result = persistSourceBundle({
    manuscriptDir: input.manuscriptDir,
    nextSource: preview.nextSource,
    expectedBundleHash: input.expectedBundleHash ?? preview.bundleHash,
  });
  if (!result.ok) return result;
  return {
    ...result,
    value: {
      ...result.value,
      id: preview.id,
      ...(preview.sectionId ? { sectionId: preview.sectionId } : {}),
      filePath: preview.filePath,
      from: preview.from,
      to: preview.to,
      before: preview.before,
      after: preview.after,
      changed: true,
    },
  };
}

export function relocatePaperTodo(input: {
  manuscriptDir: string;
  todoId: string;
  sectionId: string;
  expectedBundleHash?: string;
}) {
  const bundle = buildSourceBundle(input.manuscriptDir);
  if (input.expectedBundleHash && input.expectedBundleHash !== bundle.bundleHash) {
    return failResult("stale_disk_state", "The paper changed on disk. Reload the paper before relocating this TODO.", {
      retryable: true,
      currentHash: bundle.bundleHash,
    });
  }
  const moved = relocateTodoInBundle(bundle.source, input.todoId, input.sectionId);
  if (!moved.todoFound) return failResult("unknown_todo", `Unknown TODO "${input.todoId}".`, false);
  if (!moved.targetFound || moved.error) return failResult(moved.targetFound ? "invalid_tex" : "unknown_section", moved.error || `Unknown paper section id "${input.sectionId}".`, false);
  const result = persistSourceBundle({
    manuscriptDir: input.manuscriptDir,
    nextSource: moved.source,
    expectedBundleHash: input.expectedBundleHash ?? bundle.bundleHash,
  });
  if (!result.ok) return result;
  return {
    ...result,
    value: {
      ...result.value,
      todoId: moved.id,
      sectionId: input.sectionId,
      filePath: moved.filePath,
      from: moved.from,
      to: moved.to,
      before: moved.before,
      after: moved.after,
      changed: true,
    },
  };
}

export function findSectionTitleForId(source: string, sectionId: string, sections: Array<{ id: string; title: string }>): string | undefined {
  return sections.find((section) => section.id === sectionId)?.title;
}

export function paperTodos(source: string) {
  return analyzePaper(source).todos;
}
