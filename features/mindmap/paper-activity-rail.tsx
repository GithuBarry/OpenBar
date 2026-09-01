"use client";

import Link from "next/link";
import { Check, FileText, Pin } from "lucide-react";

import type { ProjectState } from "@/lib/research/project-state";

function relativeWhen(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} h ago`;
  if (delta < 2 * 86_400_000) return "yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PaperActivityRail({
  state,
  onPinTodo,
}: {
  state: ProjectState;
  onPinTodo?: (todo: NonNullable<ProjectState["paper"]>["todos"][number]) => void;
}) {
  const openTodos = (state.paper?.todos || []).filter((todo) => todo.status !== "done");
  const grouped = new Map<string, typeof openTodos>();
  for (const todo of openTodos) {
    const key = todo.sectionTitle || "Paper";
    const list = grouped.get(key);
    if (list) list.push(todo);
    else grouped.set(key, [todo]);
  }
  const recent = state.recent.slice(0, 8);

  return (
    <aside className="mindmap-activity" aria-label="Paper work">
      <div className="mindmap-activity-heading">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Paper work</p>
        <p className="mt-0.5 text-sm font-semibold text-ink">
          {openTodos.length} open TODO{openTodos.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="mindmap-activity-scroll">
        {openTodos.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">No open manuscript TODOs.</p>
        ) : (
          [...grouped.entries()].map(([section, todos]) => (
            <div key={section} className="mindmap-activity-group">
              <p className="mindmap-activity-label">{section}</p>
              {todos.map((todo) => (
                <div key={todo.id} className="mindmap-activity-item">
                  <Link href={todo.href} className="min-w-0 flex-1 text-left hover:text-accent">
                    <span className="block truncate">{todo.text}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
                      <FileText size={10} /> Paper
                    </span>
                  </Link>
                  {onPinTodo && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-faint hover:bg-surface-2 hover:text-ink"
                      title="Pin to map"
                      onClick={() => onPinTodo(todo)}
                    >
                      <Pin size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}

        {recent.length > 0 && (
          <div className="mindmap-activity-group">
            <p className="mindmap-activity-label">Recent</p>
            {recent.map((item, index) => (
              <Link key={`${item.kind}-${index}-${item.href}`} href={item.href} className="mindmap-activity-item hover:text-accent">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {item.kind === "todo_completed" && <Check size={11} className="shrink-0 text-m-final" />}
                    <span className="truncate">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-faint">
                    {item.kind === "section_edit" ? "edited " : item.kind === "todo_completed" ? "completed " : ""}
                    {relativeWhen(item.at)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
