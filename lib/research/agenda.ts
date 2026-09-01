/**
 * Project agenda: TODOs, deadlines, milestones, and conversion warnings.
 */

import type { ResearchTask } from "./tasks";

export type ProjectMilestone = {
  id: string;
  title: string;
  due?: string;
  status?: "open" | "done";
};

export type AgendaItem = {
  id: string;
  kind: "todo" | "deadline" | "milestone" | "comment" | "conversion";
  title: string;
  due?: string;
  priority?: string;
  href?: string;
};

export function buildAgenda(input: {
  projectId: string;
  tasks: ResearchTask[];
  milestones?: ProjectMilestone[];
  conversionWarnings?: Array<{ id: string; message: string }>;
}): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const task of input.tasks) {
    if (task.status === "done") continue;
    items.push({
      id: task.id,
      kind: task.due ? "deadline" : "todo",
      title: task.text,
      due: task.due,
      priority: task.priority,
      href: `/p/${input.projectId}/paper#todo-${task.id}`,
    });
  }
  for (const milestone of input.milestones || []) {
    if (milestone.status === "done") continue;
    items.push({
      id: milestone.id,
      kind: "milestone",
      title: milestone.title,
      due: milestone.due,
      href: `/p/${input.projectId}/paper`,
    });
  }
  for (const warning of input.conversionWarnings || []) {
    items.push({
      id: warning.id,
      kind: "conversion",
      title: warning.message,
    });
  }
  return items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.title.localeCompare(b.title));
}
