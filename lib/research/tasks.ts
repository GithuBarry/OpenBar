/**
 * Thin TODO view over parsed `\obtodo` anchors.
 */

import { composeObtodo, todoIsComplete, type TodoAttrPatch } from "@/lib/todo-meta";
import type { PaperTodo } from "@/lib/research/paper-analysis";

export type SourceReference = {
  filePath?: string;
  from: number;
  to: number;
  hash?: string;
};

export type ResearchTask = {
  id: string | null;
  title?: string;
  text: string;
  completed: boolean;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  sourceRef: SourceReference;
};

export function taskFromTodo(todo: PaperTodo, sourceRef?: SourceReference): ResearchTask {
  return {
    id: todo.id,
    ...(todo.title ? { title: todo.title } : {}),
    text: todo.text,
    completed: todoIsComplete(todo.attrs) || Boolean(todo.completedAt),
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    completedAt: todo.completedAt,
    sourceRef: sourceRef || { from: todo.start, to: todo.end },
  };
}

export function composeResearchTodo(task: { id?: string; title?: string; text: string; completedAt?: string; createdAt?: string }): string {
  return composeObtodo({
    id: task.id,
    title: task.title,
    text: task.text,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  });
}

export type { TodoAttrPatch };
