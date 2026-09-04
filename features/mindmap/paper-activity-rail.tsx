"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import type { ProjectState } from "@/lib/research/project-state";
import { availableTodoCandidates } from "@/lib/research/map-todo-candidates";
import { DRAFT_MINDMAP_ID, isPrimaryMindmap, mindmapCardContentForTodo } from "@/lib/research/todo-map";
import type { MindmapNode } from "@/lib/types";

export function PaperActivityRail({
  state,
  nodes,
  onPlaceTodo,
}: {
  state: ProjectState;
  nodes: ReadonlyArray<Pick<MindmapNode, "id" | "todoId">>;
  onPlaceTodo?: (todoId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const viewingPrimary = state.currentMap?.primary ?? isPrimaryMindmap(state.current?.mapId || DRAFT_MINDMAP_ID);
  const paperTodos = state.paper?.todos || [];
  const items = useMemo(
    () => availableTodoCandidates(paperTodos, nodes),
    [nodes, paperTodos],
  );
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((todo) => `${(todo as { title?: string }).title || ""}\n${todo.text}\n${todo.id}`.toLowerCase().includes(needle))
    : items;
  const missing = viewingPrimary
    ? (state.todoSync?.warnings || []).filter((warning) => warning.kind === "missing-source")
    : [];
  const duplicates = viewingPrimary
    ? (state.todoSync?.warnings || []).filter((warning) => warning.kind === "duplicate-tex-id" || warning.kind === "duplicate-binding")
    : [];
  const idless = viewingPrimary
    ? (state.todoSync?.warnings || []).find((warning) => warning.kind === "idless-todo")
    : undefined;
  if (items.length === 0 && duplicates.length === 0 && missing.length === 0 && !idless) return null;

  return (
    <aside className="mindmap-activity" aria-label={viewingPrimary ? "Unplaced TODOs" : "Add paper TODO"}>
      {duplicates.map((warning, index) => (
        <p key={`${warning.kind}-${index}`} className="mindmap-activity-warn text-danger">
          {warning.kind === "duplicate-tex-id" ? `TeX id ${warning.todoId} appears twice.` : `Card bindings for ${warning.todoId} collide.`}
        </p>
      ))}
      {idless && (
        <p className="mindmap-activity-warn text-warn">Assign stable IDs to {idless.count} TODOs in the paper.</p>
      )}
      {missing.length > 0 && (
        <p
          className="mindmap-activity-warn text-warn truncate"
          title={missing.map((warning) => `Card still points at ${warning.todoId}`).join("\n")}
        >
          {missing.length} card link{missing.length === 1 ? "" : "s"} need review
        </p>
      )}
      {(items.length > 0) && (
        <div className="mindmap-activity-row">
          <p className="mindmap-activity-label">
            {viewingPrimary ? `Unplaced ${items.length}` : "Add paper TODO"}
          </p>
          {!viewingPrimary && (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="input h-6 w-full px-1.5 py-0 text-[11px]"
              aria-label="Search paper TODOs"
            />
          )}
          {visible.map((todo) => (
            <div
              key={todo.id}
              className="mindmap-activity-item"
              draggable={Boolean(onPlaceTodo)}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-openbar-todo", todo.id);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              {(() => {
                const content = mindmapCardContentForTodo(todo);
                return (
              <Link
                href={todo.href}
                className={`min-w-0 truncate hover:text-accent ${todo.completed ? "line-through text-faint" : ""}`}
              >
                <span className="font-medium">{content.title || "Untitled TODO"}</span>
                {content.body.trim() && <span className="text-muted"> · {content.body.trim()}</span>}
              </Link>
                );
              })()}
              {onPlaceTodo && (
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-accent hover:underline"
                  title={viewingPrimary ? "Place under the selected card" : "Add this paper TODO to this map"}
                  onClick={() => onPlaceTodo(todo.id)}
                >
                  {viewingPrimary ? "Place" : "Add"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
