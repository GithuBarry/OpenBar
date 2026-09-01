/**
 * Durable research tasks parsed from `\obtodo` attributes.
 */

import { composeObtodo, parseTodoDate, parseTodoPriority, parseTodoStatus, type TodoStatus } from "@/lib/todo-meta";

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done"] as const;
export type TaskStatus = TodoStatus;

export const TASK_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type SourceReference = {
  filePath?: string;
  from: number;
  to: number;
  hash?: string;
};

export type ResearchTask = {
  id: string;
  text: string;
  status: TaskStatus;
  due?: string;
  priority?: TaskPriority;
  owner?: string;
  createdAt: string;
  completedAt?: string;
  sourceRef: SourceReference;
  tags: string[];
  claimId?: string;
};

export function parseTaskStatus(raw?: string): TaskStatus {
  return parseTodoStatus(raw);
}

export function parseTaskPriority(raw?: string): TaskPriority | undefined {
  return parseTodoPriority(raw);
}

export function taskFromAttrs(
  attrs: Record<string, string>,
  text: string,
  sourceRef: SourceReference,
  now = new Date(),
): ResearchTask {
  const status = parseTaskStatus(attrs.status);
  const createdAt = parseTodoDate(attrs.created || attrs.createdAt) || now.toISOString().slice(0, 10);
  const completedAt = parseTodoDate(attrs.completed || attrs.completedAt);
  const tags = (attrs.tags || "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    id: attrs.id || `todo-off-${sourceRef.from}`,
    text,
    status,
    due: parseTodoDate(attrs.due),
    priority: parseTaskPriority(attrs.priority),
    owner: attrs.owner?.trim() || undefined,
    createdAt,
    completedAt: status === "done" ? completedAt || createdAt : completedAt,
    sourceRef,
    tags,
    claimId: attrs.claim,
  };
}

export function composeResearchTodo(task: Partial<ResearchTask> & { text: string }): string {
  const base = composeObtodo({
    id: task.id,
    text: task.text,
    claim: task.claimId,
    owner: task.owner,
    priority: task.priority,
    due: task.due,
    createdAt: task.createdAt,
  });
  const extra: string[] = [];
  if (task.status && task.status !== "open") extra.push(`status=${task.status}`);
  if (task.completedAt) extra.push(`completed=${task.completedAt}`);
  if (task.tags?.length) extra.push(`tags=${task.tags.join("+")}`);
  if (!extra.length) return base;
  return base.replace("\\obtodo[", `\\obtodo[${extra.join(", ")}, `);
}
