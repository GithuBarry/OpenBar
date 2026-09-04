"use client";

import { Plus } from "lucide-react";
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
  onInsert: (tex: string) => void;
  onPlace?: (todoId: string, parentId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [newTodoOpen, setNewTodoOpen] = useState(false);
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="ob-press inline-flex h-5 w-5 items-center justify-center rounded border border-line text-accent hover:border-accent/50 hover:bg-accent/10"
            title={newTodoOpen ? "Hide new TODO" : "New TODO"}
            aria-label="New TODO"
            aria-expanded={newTodoOpen}
            onClick={() => setNewTodoOpen((value) => !value)}
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            className="text-[10px] text-accent hover:underline"
            onClick={() => setShowDone((value) => !value)}
          >
            {showDone ? "Hide complete" : "Show complete"}
          </button>
        </div>
      </div>
      {newTodoOpen && (
        <form
          className="mb-2 shrink-0 rounded-lg border border-line/70 bg-canvas/35 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() && !text.trim()) return;
            const id = generateTodoId();
            onInsert(composeObtodo({ id, title: title.trim() || undefined, text: text.trim() }));
            setTitle("");
            setText("");
          }}
        >
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink">New TODO</p>
            <span className="text-[10px] text-faint">Saved to TeX · Unplaced on Primary</span>
          </div>
          <div className="grid min-w-0 items-end gap-1.5 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)_auto]">
            <label className="block min-w-0 text-[10px] font-medium uppercase tracking-wide text-faint">
              Title <span className="normal-case font-normal tracking-normal">(optional)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short TODO title"
                aria-label="New TODO title"
                className="input mt-1 h-7 min-w-0 !w-full px-2 py-1 text-xs font-normal normal-case tracking-normal"
              />
            </label>
            <label className="block min-w-0 text-[10px] font-medium uppercase tracking-wide text-faint">
              Content
              <textarea
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="TODO content"
                aria-label="New TODO content"
                className="input mt-1 min-h-14 min-w-0 !w-full resize-y px-2 py-1 text-xs font-normal normal-case tracking-normal leading-snug"
              />
            </label>
            <button type="submit" className="btn-outline px-2 py-0.5 text-[11px]" disabled={!title.trim() && !text.trim()}>
              Add
            </button>
          </div>
        </form>
      )}
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
  const [placing, setPlacing] = useState(false);
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
                Content
                <textarea
                  rows={3}
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  className="input mt-1 min-h-16 !w-full resize-y px-2 py-1 text-xs font-normal normal-case tracking-normal leading-snug"
                  placeholder="TODO content"
                  aria-label="TODO content"
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
                {title ? (
                  <span className="block">
                    <span className="mr-1 text-[9px] font-medium uppercase tracking-wide text-faint">Title</span>
                    <span className={`text-xs font-semibold ${done ? "text-faint line-through" : "text-ink"}`}>{title}</span>
                  </span>
                ) : (
                  <span className="block text-[9px] font-medium uppercase tracking-wide text-faint">Untitled TODO</span>
                )}
                <span className={`block text-xs ${title ? "mt-0.5" : "mt-1"} ${done ? "text-faint line-through" : "text-ink"}`}>
                  <span className="mr-1 text-[9px] font-medium uppercase tracking-wide text-faint">Content</span>
                  {todo.text || "(empty)"}
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
          {unplaced && todo.id && placementTargets.length > 0 && onPlace && (
            <div className="relative">
              <button
                type="button"
                className="text-[11px] text-accent hover:underline"
                aria-expanded={placing}
                onClick={() => setPlacing((value) => !value)}
              >
                Place
              </button>
              {placing && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-line bg-canvas p-2 shadow-lg">
                  <label className="block text-[10px] font-medium uppercase tracking-wide text-faint">
                    Place under
                    <select
                      autoFocus
                      defaultValue=""
                      aria-label="Primary map parent"
                      className="input mt-1 h-7 w-full px-1.5 py-0 text-[11px] normal-case tracking-normal"
                      onChange={(event) => {
                        const parentId = event.target.value;
                        if (parentId) {
                          onPlace(todo.id!, parentId);
                          setPlacing(false);
                        }
                      }}
                    >
                      <option value="">Choose a card…</option>
                      {placementTargets.map((target) => (
                        <option key={target.id} value={target.id}>{target.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="mt-1 text-[10px] text-faint hover:underline" onClick={() => setPlacing(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
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
