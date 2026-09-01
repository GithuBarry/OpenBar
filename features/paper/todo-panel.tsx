"use client";

import { useEffect, useMemo, useState } from "react";

import type { EditorTodo } from "@/features/paper/tex-source";
import {
  composeObtodo,
  TODO_PRIORITIES,
  TODO_STATUSES,
  todoPriorityRank,
  todayStamp,
  type TodoAttrPatch,
  type TodoPriority,
  type TodoStatus,
} from "@/lib/todo-meta";
import { formatWorkspaceDate } from "@/lib/utils";

export function TodoPanel({
  todos,
  onJump,
  onResolve,
  onPatch,
  onEditText,
  onInsert,
}: {
  todos: EditorTodo[];
  onJump: (todo: EditorTodo) => void;
  onResolve: (todo: EditorTodo) => void;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => void;
  onEditText: (todo: EditorTodo, text: string) => void;
  onInsert: (tex: string) => void;
}) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"" | TodoPriority>("");
  const [due, setDue] = useState("");
  const [showDone, setShowDone] = useState(false);
  const sorted = useMemo(
    () =>
      [...todos].sort(
        (a, b) =>
          Number(a.status === "done") - Number(b.status === "done")
          || todoPriorityRank(a.priority) - todoPriorityRank(b.priority)
          || (a.due || "9999").localeCompare(b.due || "9999")
          || a.from - b.from,
      ),
    [todos],
  );
  const visible = showDone ? sorted : sorted.filter((todo) => todo.status !== "done");
  const openCount = todos.filter((todo) => todo.status !== "done").length;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden px-3 pb-3 pt-2 sm:px-4">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Open items</p>
          <span className="text-[10px] text-faint">{openCount} open · {todos.length} total</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] text-accent hover:underline"
            title={showDone ? "Hide completed items" : "Show completed items"}
            onClick={() => setShowDone((value) => !value)}
          >
            {showDone ? "Hide done" : "Show done"}
          </button>
          <span className="font-mono text-[11px] text-faint">{openCount}</span>
        </div>
      </div>
      <form
        className="mb-2 shrink-0 rounded-lg border border-line/70 bg-canvas/35 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          onInsert(composeObtodo({
            text: text.trim(),
            priority: priority || undefined,
            due: due || undefined,
            createdAt: todayStamp(),
          }));
          setText("");
          setPriority("");
          setDue("");
        }}
      >
        <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_4rem_10.5rem_auto]">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="New todo"
            className="input h-7 !w-full min-w-0 px-2 py-0 text-xs"
            title="Describe a new task for this paper"
          />
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as "" | TodoPriority)}
            className="input h-7 !w-full px-1 py-0 text-[11px]"
            aria-label="Priority"
            title="Set an optional priority"
          >
            <option value="">Prio</option>
            {TODO_PRIORITIES.map((value) => (
              <option key={value} value={value}>{value.toUpperCase()}</option>
            ))}
          </select>
          <input
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            className="input h-7 !w-full px-1 py-0 text-[11px]"
            aria-label="Target date"
            title="Set an optional target date"
          />
          <button type="submit" className="btn-outline justify-self-start px-2 py-0.5 text-[11px] sm:justify-self-auto" title="Insert this task into the current source" disabled={!text.trim()}>
            Add
          </button>
        </div>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-xs text-faint">No \\obtodo or {"{?…}"} markers in this paper.</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((todo, index) => (
              <TodoRow
                key={todo.id ? `${todo.kind}:${todo.id}` : `${todo.kind}:${todo.from}:${index}`}
                todo={todo}
                onJump={onJump}
                onResolve={onResolve}
                onPatch={onPatch}
                onEditText={onEditText}
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
  onJump,
  onResolve,
  onPatch,
  onEditText,
}: {
  todo: EditorTodo;
  onJump: (todo: EditorTodo) => void;
  onResolve: (todo: EditorTodo) => void;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => void;
  onEditText: (todo: EditorTodo, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const [ownerDraft, setOwnerDraft] = useState(todo.owner || "");
  useEffect(() => {
    if (!editing) setDraft(todo.text);
    setOwnerDraft(todo.owner || "");
  }, [editing, todo.owner, todo.text]);

  const done = todo.status === "done";
  const meta = [
    todo.section,
    todo.kind === "obtodo" ? undefined : todo.kind,
    todo.priority?.toUpperCase(),
    todo.due ? `due ${formatWorkspaceDate(todo.due)}` : null,
    todo.owner ? `owner ${todo.owner}` : null,
    done ? "done" : todo.status && todo.status !== "open" ? todo.status.replace("_", " ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="group min-w-0 rounded-lg border border-line/70 bg-canvas/25 p-2 hover:bg-surface-2/70">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-faint">
            <span>{meta}</span>
            {todo.createdAt && <span className="normal-case tracking-normal">created {formatWorkspaceDate(todo.createdAt)}</span>}
          </div>
          {editing ? (
            <div className="mt-1.5 space-y-1.5">
              <textarea
                autoFocus
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="input min-h-16 !w-full resize-y px-2 py-1 text-xs leading-snug"
                aria-label="TODO text"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn-outline px-2 py-0.5 text-[11px]"
                  title="Save the edited task text"
                  disabled={!draft.trim()}
                  onClick={() => {
                    onEditText(todo, draft.trim());
                    setEditing(false);
                  }}
                >
                  Save text
                </button>
                <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" title="Keep the current task text" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="mt-1 block min-w-0 max-w-[75ch] text-left" onClick={() => onJump(todo)} title={todo.text}>
              <span className={`block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-snug ${done ? "text-faint line-through" : "text-ink"}`}>
                {todo.text || "(empty)"}
              </span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
          {todo.kind === "obtodo" && (
            <button
              type="button"
              className="text-[11px] text-accent hover:underline"
              title={done ? "Mark this task as open" : "Mark this task as complete"}
              onClick={() => onPatch(todo, done
                ? { status: "open", completedAt: null }
                : { status: "done", completedAt: todayStamp() })}
            >
              {done ? "Reopen" : "Complete"}
            </button>
          )}
          {todo.kind === "obtodo" && (
            <button type="button" className="text-[11px] text-accent hover:underline" title={editing ? "Close the text editor" : "Edit this task text"} onClick={() => setEditing((value) => !value)}>
              {editing ? "Close" : "Edit"}
            </button>
          )}
          {todo.kind === "obtodo" && (
            <button type="button" className="text-[11px] text-accent hover:underline" title={detailsOpen ? "Hide task fields" : "Edit status, priority, due date, and owner"} onClick={() => setDetailsOpen((value) => !value)}>
              {detailsOpen ? "Hide fields" : "Details"}
            </button>
          )}
          <button type="button" className="text-[11px] text-faint hover:underline" title="Resolve this task in the source" onClick={() => onResolve(todo)}>
            Resolve
          </button>
        </div>
      </div>
      {todo.kind === "obtodo" && detailsOpen && (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-[7.5rem_4rem_10.5rem_minmax(8rem,1fr)]">
          <select
            value={todo.status || "open"}
            aria-label="Status"
            title="Change task status"
            className="input h-6 !w-full px-1 py-0 text-[10px]"
            onChange={(event) => {
              const value = event.target.value as TodoStatus;
              onPatch(todo, value === "done" ? { status: value, completedAt: todayStamp() } : { status: value, completedAt: null });
            }}
          >
            {TODO_STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace("_", " ")}</option>
            ))}
          </select>
          <select
            value={todo.priority || ""}
            aria-label="Priority"
            title="Change task priority"
            className="input h-6 !w-full px-1 py-0 text-[10px]"
            onChange={(event) => {
              const value = event.target.value as TodoPriority | "";
              onPatch(todo, { priority: value || null });
            }}
          >
            <option value="">Prio</option>
            {TODO_PRIORITIES.map((value) => (
              <option key={value} value={value}>{value.toUpperCase()}</option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Target date"
            title="Change target date"
            value={todo.due || ""}
            className="input h-6 !w-full px-1 py-0 text-[10px]"
            onChange={(event) => onPatch(todo, { due: event.target.value || null })}
          />
          <input
            type="text"
            aria-label="Owner"
            title="Set the task owner"
            placeholder="Owner"
            value={ownerDraft}
            className="input h-6 !w-full min-w-0 px-1.5 py-0 text-[10px]"
            onChange={(event) => setOwnerDraft(event.target.value)}
            onBlur={() => {
              const next = ownerDraft.trim();
              if (next !== (todo.owner || "")) onPatch(todo, { owner: next || null });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      )}
    </li>
  );
}
