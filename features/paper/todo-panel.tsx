"use client";

import { useEffect, useMemo, useState } from "react";

import type { EditorTodo } from "@/features/paper/tex-source";
import { composeObtodo, generateTodoId, type TodoAttrPatch } from "@/lib/todo-meta";
import { formatWorkspaceDate } from "@/lib/utils";

export type PlacementTarget = { id: string; label: string };

export function TodoPanel({
  todos,
  placementTargets = [],
  boundTodoIds = [],
  onJump,
  onResolve,
  onPatch,
  onInsert,
  onPlace,
}: {
  todos: EditorTodo[];
  placementTargets?: PlacementTarget[];
  boundTodoIds?: string[];
  onJump: (todo: EditorTodo) => void;
  onResolve: (todo: EditorTodo) => void;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => void;
  onEditText: (todo: EditorTodo, text: string) => void;
  onInsert: (tex: string) => void;
  onPlace?: (todoId: string, parentId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [placeUnder, setPlaceUnder] = useState("");
  const [showDone, setShowDone] = useState(false);
  const bound = useMemo(() => new Set(boundTodoIds), [boundTodoIds]);
  const sorted = useMemo(
    () => [...todos].sort((a, b) => Number(a.completed) - Number(b.completed) || a.from - b.from),
    [todos],
  );
  const visible = showDone ? sorted : sorted.filter((todo) => !todo.completed);
  const openCount = todos.filter((todo) => !todo.completed).length;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden px-3 pb-3 pt-2 sm:px-4">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Open items</p>
          <span className="text-[10px] text-faint">{openCount} open · {todos.length} total</span>
        </div>
        <button
          type="button"
          className="text-[10px] text-accent hover:underline"
          onClick={() => setShowDone((value) => !value)}
        >
          {showDone ? "Hide complete" : "Show complete"}
        </button>
      </div>
      <form
        className="mb-2 shrink-0 rounded-lg border border-line/70 bg-canvas/35 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() && !text.trim()) return;
          const id = generateTodoId();
          onInsert(composeObtodo({ id, title: title.trim() || undefined, text: text.trim() }));
          if (placeUnder) onPlace?.(id, placeUnder);
          setTitle("");
          setText("");
        }}
      >
        <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)_auto]">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            aria-label="New TODO title"
            className="input h-7 min-w-0 px-2 py-0 text-xs"
          />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Details (optional) — appears Unplaced on the Primary map until you place it"
            aria-label="New TODO details"
            className="input h-7 min-w-0 flex-1 px-2 py-0 text-xs"
          />
          <button type="submit" className="btn-outline px-2 py-0.5 text-[11px]" disabled={!title.trim() && !text.trim()}>
            Add
          </button>
        </div>
        {placementTargets.length > 0 && (
          <label className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
            <span className="shrink-0">Add to Primary map under</span>
            <select
              value={placeUnder}
              onChange={(event) => setPlaceUnder(event.target.value)}
              className="input h-6 min-w-0 flex-1 px-1.5 py-0 text-[11px]"
            >
              <option value="">Unplaced (later)</option>
              {placementTargets.map((target) => (
                <option key={target.id} value={target.id}>{target.label}</option>
              ))}
            </select>
          </label>
        )}
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-xs text-faint">No \\obtodo anchors in this paper.</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((todo, index) => (
              <TodoRow
                key={todo.id || `${todo.from}:${index}`}
                todo={todo}
                unplaced={Boolean(todo.id && !bound.has(todo.id))}
                placementTargets={placementTargets}
                onJump={onJump}
                onResolve={onResolve}
                onPatch={onPatch}
                onPlace={onPlace}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TodoRow({
  todo,
  unplaced,
  placementTargets,
  onJump,
  onResolve,
  onPatch,
  onPlace,
}: {
  todo: EditorTodo;
  unplaced: boolean;
  placementTargets: PlacementTarget[];
  onJump: (todo: EditorTodo) => void;
  onResolve: (todo: EditorTodo) => void;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => void;
  onPlace?: (todoId: string, parentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(todo.title || "");
  const [draftText, setDraftText] = useState(todo.text);
  useEffect(() => {
    if (!editing) {
      setDraftTitle(todo.title || "");
      setDraftText(todo.text);
    }
  }, [editing, todo.title, todo.text]);

  const done = todo.completed;
  const title = todo.title?.trim() || "";
  const meta = [todo.section, todo.id, done ? "complete" : unplaced ? "primary unplaced" : null].filter(Boolean).join(" · ");
  return (
    <li className="group min-w-0 rounded-lg border border-line/70 bg-canvas/25 p-2 hover:bg-surface-2/70">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-faint">
            <span>{meta}</span>
            {todo.createdAt && <span className="normal-case tracking-normal">created {formatWorkspaceDate(todo.createdAt)}</span>}
          </div>
          {editing ? (
            <form
              className="mt-1.5 space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                const text = draftText.trim();
                const title = draftTitle.trim();
                if (!title && !text) return;
                onPatch(todo, { title: title || null, text });
                setEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.requestSubmit();
                }
              }}
            >
              <label className="block text-[10px] font-medium uppercase tracking-wide text-faint">
                Title <span className="normal-case font-normal tracking-normal">(optional)</span>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="input mt-1 h-7 !w-full px-2 py-1 text-xs font-normal normal-case tracking-normal"
                  aria-label="TODO title"
                />
              </label>
              <label className="block text-[10px] font-medium uppercase tracking-wide text-faint">
                Details
                <textarea
                  rows={3}
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  className="input mt-1 min-h-16 !w-full resize-y px-2 py-1 text-xs font-normal normal-case tracking-normal leading-snug"
                  aria-label="TODO details"
                />
              </label>
              <div className="flex gap-1">
                <button
                  type="submit"
                  className="btn-outline px-2 py-0.5 text-[11px]"
                  disabled={!draftText.trim()}
                >
                  Save TODO
                </button>
                <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="mt-1 block min-w-0 max-w-[75ch] text-left"
              onClick={() => onJump(todo)}
              title={[title, todo.text].filter(Boolean).join("\n\n")}
            >
              <span className="block max-h-20 overflow-y-auto whitespace-pre-wrap break-words leading-snug">
                {title && <span className={`block text-xs font-semibold ${done ? "text-faint line-through" : "text-ink"}`}>{title}</span>}
                <span className={`block text-xs ${title ? "mt-0.5" : ""} ${done ? "text-faint line-through" : "text-ink"}`}>
                  {todo.text || "(empty)"}
                </span>
              </span>
            </button>
          )}
          {unplaced && todo.id && placementTargets.length > 0 && onPlace && (
            <label className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
              <span className="shrink-0">Place on Primary map under</span>
              <select
                defaultValue=""
                className="input h-6 min-w-0 flex-1 px-1.5 py-0 text-[11px]"
                onChange={(event) => {
                  const parentId = event.target.value;
                  if (parentId) onPlace(todo.id!, parentId);
                }}
              >
                <option value="">Choose a card…</option>
                {placementTargets.map((target) => (
                  <option key={target.id} value={target.id}>{target.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={() => onPatch(todo, done ? { completed: false } : { completed: true })}
          >
            {done ? "Reopen" : "Complete"}
          </button>
          <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setEditing((value) => !value)}>
            {editing ? "Close" : "Edit"}
          </button>
          <button type="button" className="text-[11px] text-faint hover:underline" onClick={() => onResolve(todo)}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
