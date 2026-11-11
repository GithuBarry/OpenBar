"use client";

import type { OperationResult } from "@/lib/research/operation-result";

type FileOperation = () => Promise<OperationResult<unknown>>;
type EditorHandler = (operation: FileOperation, writing: boolean) => Promise<OperationResult<unknown>>;
const editors = new Map<string, EditorHandler>();

/** Route file access through the mounted editor's save and reconciliation queue. */
export function registerProjectFileEditor(project: string, handler: EditorHandler): () => void {
  editors.set(project, handler);
  return () => { if (editors.get(project) === handler) editors.delete(project); };
}

export async function runProjectFileOperation<T>(project: string, writing: boolean, operation: () => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
  const handler = editors.get(project);
  return (handler ? handler(operation, writing) : operation()) as Promise<OperationResult<T>>;
}
