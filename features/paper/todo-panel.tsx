"use client";

import { Select } from "@/components/select";
import { AnchoredPop } from "@/components/pop";
import { RichText } from "@/components/rich-text";
import { ArrowUpRight, MoreHorizontal, Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { EditorTodo } from "@/features/paper/tex-source";
import { composeObtodo, generateTodoId, type TodoAttrPatch } from "@/lib/todo-meta";
import { cn } from "@/lib/utils";
import paperStyles from "./paper-outline-rail.module.css";

import { TexCodeMirror } from "./tex-codemirror";

export type PlacementTarget = { id: string; label: string };

type TodoFilter = "open" | "completed";
export type TodoUndoSnapshot = {
  tex: string;
  before: string;
  after: string;
  baseHash?: string;
  todoId?: string;
  from?: number;
  to?: number;
};
type UndoAction =
  | { kind: "complete"; todo: EditorTodo }
  | { kind: "remove"; todo: EditorTodo; snapshot: TodoUndoSnapshot };

export function TodoPanel({
  todos,
  placementTargets = [],
  boundTodoIds = [],
  onJump,
  onResolve,
  onPatch,
  onInsert,
  onClose,
  onPlace,
  getTodoSource,
  onRestore,
}: {
  todos: EditorTodo[];
  placementTargets?: PlacementTarget[];
  boundTodoIds?: string[];
  onJump: (todo: EditorTodo) => void;
  onResolve: (todo: EditorTodo) => Promise<boolean>;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => Promise<boolean>;
  onInsert: (tex: string) => void;
  onClose: () => void;
  onPlace?: (todoId: string, parentId: string) => void;
  getTodoSource?: (todo: EditorTodo) => TodoUndoSnapshot;
  onRestore?: (todo: EditorTodo, snapshot: TodoUndoSnapshot) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TodoFilter>("open");
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingTodoId, setPendingTodoId] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const bound = useMemo(() => new Set(boundTodoIds), [boundTodoIds]);
  const needle = query.trim().toLowerCase();
  const searched = useMemo(() => {
    const sorted = [...todos].sort((a, b) => Number(a.completed) - Number(b.completed) || a.from - b.from);
    if (!needle) return sorted;
    return sorted.filter((todo) => {
      const hay = `${todo.title || ""} ${todo.text} ${todo.section}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [needle, todos]);
  const visible = searched.filter((todo) => (filter === "completed" ? todo.completed : !todo.completed));
  const openCount = todos.filter((todo) => !todo.completed).length;
  const emptyCopy = !todos.length
    ? "No TODOs in this paper."
    : !searched.length
      ? "No TODOs match this search."
      : filter === "completed"
        ? "No completed TODOs."
        : "No open TODOs.";

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden px-3 pb-3 pt-2 sm:px-4">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <label className="relative min-w-0 basis-full sm:flex-1 sm:basis-40">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search TODOs"
            aria-label="Search TODOs"
            className="p-field input todo-search-input h-7 w-full text-xs"
          />
        </label>
        <div className="flex rounded-md border border-line p-0.5 text-xs">
          <button
            type="button"
            className={cn("rounded px-2 py-0.5", filter === "open" ? "bg-accent/15 text-ink ring-1 ring-inset ring-accent/40" : "text-muted")}
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
          >
            Open {openCount}
          </button>
          <button
            type="button"
            className={cn("rounded px-2 py-0.5", filter === "completed" ? "bg-accent/15 text-ink ring-1 ring-inset ring-accent/40" : "text-muted")}
            aria-pressed={filter === "completed"}
            onClick={() => setFilter("completed")}
          >
            Completed
          </button>
        </div>
        <button
          type="button"
          className="ob-press inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs font-medium text-accent hover:border-accent/50 hover:bg-accent/10 hover:text-ink"
          onClick={() => {
            setCreating(true);
            setCreateTitle("");
            setCreateBody("");
            setCreateError(null);
          }}
        >
          <Plus size={11} />
          TODO
        </button>
        <button
          type="button"
          className={paperStyles.todoClose}
          aria-label="Close Open items"
          title="Close Open items"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {creating && (
        <div className="mb-2 shrink-0 rounded-lg border border-accent/30 bg-accent/5 p-2">
          <div className="mb-1 text-xs font-medium text-ink">New TODO at the current paper cursor</div>
          <input
            value={createTitle}
            onChange={(event) => setCreateTitle(event.target.value)}
            placeholder="Title (optional when body is filled)"
            aria-label="New TODO title"
            className="p-field input mb-1.5 h-7 w-full px-2 text-xs"
          />
          <TexCodeMirror
            variant="compact"
            value={createBody}
            onChange={setCreateBody}
            onCommit={() => {
              const title = createTitle.trim();
              const text = createBody.trim();
              if (!title && !text) {
                setCreateError("Add a title or body before saving the TODO.");
                return;
              }
              onInsert(composeObtodo({ id: generateTodoId(), title: title || undefined, text, textFormat: "tex" }));
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            placeholder="TODO body"
            className="min-h-16 overflow-hidden rounded border border-line"
          />
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              className="p-button p-button-primary btn-primary px-2 py-0.5 text-xs"
              onClick={() => {
                const title = createTitle.trim();
                const text = createBody.trim();
                if (!title && !text) {
                  setCreateError("Add a title or body before saving the TODO.");
                  return;
                }
                onInsert(composeObtodo({ id: generateTodoId(), title: title || undefined, text, textFormat: "tex" }));
                setCreating(false);
              }}
            >Save TODO</button>
            <button type="button" className="p-button p-button-borderless btn-ghost px-2 py-0.5 text-xs" onClick={() => setCreating(false)}>Cancel</button>
            {createError && <span className="text-xs text-danger" role="alert">{createError}</span>}
          </div>
        </div>
      )}
      {undo && (
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-md border border-line bg-canvas/50 px-2 py-1 text-xs">
          <span className="text-muted">{undo.kind === "complete" ? "Marked complete" : "Removed TODO"}</span>
          <button
            type="button"
            className="text-accent hover:underline"
            disabled={undoBusy}
            onClick={() => {
              if (undoBusy) return;
              setUndoBusy(true);
              const operation = undo.kind === "complete"
                ? onPatch(undo.todo, { completed: false })
                : onRestore?.(undo.todo, undo.snapshot) || Promise.resolve(false);
              void operation
                .then((ok) => { if (ok) setUndo(null); })
                .finally(() => setUndoBusy(false));
            }}
          >
            Undo
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-xs text-faint">{emptyCopy}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((todo, index) => (
              <TodoRow
                key={todo.id || `${todo.from}:${index}`}
                todo={todo}
                unplaced={Boolean(todo.id && !bound.has(todo.id))}
                placementTargets={placementTargets}
                onJump={onJump}
                onComplete={() => {
                  const key = todo.id || `${todo.from}:${todo.to}`;
                  if (pendingTodoId) return;
                  setPendingTodoId(key);
                  void onPatch(todo, { completed: true })
                    .then((ok) => { if (ok) setUndo({ kind: "complete", todo }); })
                    .finally(() => setPendingTodoId(null));
                }}
                onReopen={() => {
                  const key = todo.id || `${todo.from}:${todo.to}`;
                  if (pendingTodoId) return;
                  setPendingTodoId(key);
                  void onPatch(todo, { completed: false }).finally(() => setPendingTodoId(null));
                }}
                onPatch={onPatch}
                onPlace={onPlace}
                onRemove={() => {
                  const key = todo.id || `${todo.from}:${todo.to}`;
                  const snapshot = getTodoSource?.(todo) || { tex: "", before: "", after: "" };
                  setRemovingId(key);
                  void onResolve(todo).then((ok) => {
                    if (ok) setUndo({ kind: "remove", todo, snapshot });
                  }).finally(() => setRemovingId(null));
                }}
                removing={removingId === (todo.id || `${todo.from}:${todo.to}`)}
                pending={pendingTodoId === (todo.id || `${todo.from}:${todo.to}`)}
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
  onComplete,
  onReopen,
  onPatch,
  onPlace,
  onRemove,
  removing,
  pending,
}: {
  todo: EditorTodo;
  unplaced: boolean;
  placementTargets: PlacementTarget[];
  onJump: (todo: EditorTodo) => void;
  onComplete: () => void;
  onReopen: () => void;
  onPatch: (todo: EditorTodo, patch: TodoAttrPatch) => Promise<boolean>;
  onPlace?: (todoId: string, parentId: string) => void;
  onRemove: () => void;
  removing?: boolean;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) titleInputRef.current?.focus(); }, [editing]);
  const [details, setDetails] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title || "");
  const [bodyDraft, setBodyDraft] = useState(todo.text);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) {
      setTitleDraft(todo.title || "");
      setBodyDraft(todo.text);
      setEditError(null);
    }
  }, [editing, todo.id, todo.text, todo.title]);
  const done = todo.completed;
  const title = todo.title?.trim() || todo.text.split(/\n/)[0]?.slice(0, 80) || "Untitled TODO";
  const detail = todo.title ? todo.text : todo.text.split(/\n/).slice(1).join("\n").trim();
  const cancelDraft = () => {
    setTitleDraft(todo.title || "");
    setBodyDraft(todo.text);
    setEditError(null);
    setEditing(false);
  };
  const startEditing = () => {
    setTitleDraft(todo.title || "");
    setBodyDraft(todo.text);
    setEditError(null);
    setEditing(true);
  };
  const commitDraft = async () => {
    const nextTitle = titleDraft.trim();
    const nextText = bodyDraft.trim();
    // An empty body is valid when a title carries the TODO's meaning.
    if (!nextTitle && !nextText) {
      setEditError("Add a title or body before saving the TODO.");
      return;
    }
    if (editBusy) return;
    if (nextTitle === (todo.title || "") && nextText === todo.text) { setEditing(false); return; }
    setEditBusy(true);
    setEditError(null);
    try {
      const saved = await onPatch(todo, { title: nextTitle || null, text: nextText, textFormat: "tex" });
      if (saved) setEditing(false);
      else setEditError("The TODO could not be saved. Your draft is still open.");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The TODO could not be saved. Your draft is still open.");
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <li data-paper-todo={todo.id} className={cn("group min-w-0 rounded-lg border px-2 py-2", editing ? "border-accent/40 bg-surface" : "border-line/60 bg-surface hover:border-line")}>
      <div className="flex min-w-0 items-start gap-2">
        <label className="inline-flex h-7 w-7 shrink-0 items-center justify-center max-sm:h-9 max-sm:w-9">
        <input
          type="checkbox"
          checked={done}
          className="h-4 w-4 rounded border-line accent-accent"
          aria-label={`TODO completed: ${title}`}
          disabled={pending || removing || editing}
          onChange={() => (done ? onReopen() : onComplete())}
        />
        </label>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder="TODO title (optional)"
                aria-label="TODO title"
                className="w-full rounded border-0 bg-transparent px-0 py-0.5 text-xs font-semibold text-ink outline-none focus:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDraft(); }
                  else if (event.key === "Enter") { event.preventDefault(); void commitDraft(); }
                }}
              />
              <TexCodeMirror
                variant="compact"
                value={bodyDraft}
                onChange={setBodyDraft}
                onCommit={() => { void commitDraft(); }}
                onCancel={cancelDraft}
                placeholder="TODO body (optional when a title is present)"
                className="min-h-10 overflow-hidden rounded border border-line/50"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  className="p-button p-button-default btn-outline px-2 py-0.5 text-xs"
                  disabled={editBusy}
                  onClick={() => { void commitDraft(); }}
                >
                  {editBusy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="p-button p-button-default btn-outline px-2 py-0.5 text-xs"
                  disabled={editBusy}
                  onClick={cancelDraft}
                >
                  Cancel
                </button>
                <span className="ml-auto hidden self-center text-xs text-faint sm:inline">Ctrl/⌘ Enter to save, Esc to cancel</span>
              </div>
              {editError && <p className="text-xs text-danger" role="alert">{editError}</p>}
            </div>
          ) : (
            <button type="button" className="block w-full min-w-0 text-left" aria-label={`Edit TODO: ${title}`} title="Click to edit TODO" disabled={pending || removing} onClick={startEditing}>
              <span className={cn("block text-sm font-semibold", done ? "text-faint line-through" : "text-ink")}><TodoTexText text={title} /></span>
              {detail && (
                <span className={cn("mt-0.5 block text-sm leading-snug", done ? "text-faint" : "text-muted")}>
                  <TodoTexText text={detail} />
                </span>
              )}
              <span className="mt-0.5 block text-xs text-faint">{todo.section}{unplaced ? " (Unplaced)" : ""}</span>
            </button>
          )}
          {details && (
            <p className="mt-1 font-mono text-xs text-faint">
              {todo.id || "no id"}
              {todo.createdAt ? `, ${todo.createdAt}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink max-sm:h-9 max-sm:w-9" aria-label="Reveal TODO in paper" title="Reveal in paper" onClick={() => onJump(todo)}><ArrowUpRight size={13} /></button>
          {!editing && <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink max-sm:hidden" aria-label="Edit TODO" title="Edit TODO" disabled={pending || removing} onClick={startEditing}><Pencil size={12} /></button>}
          <div className="relative">
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-surface-2 hover:text-ink max-sm:h-9 max-sm:w-9"
              ref={actionsRef}
              aria-label="More TODO actions"
              aria-expanded={placing}
              disabled={pending || removing || editing}
              onClick={() => setPlacing((value) => !value)}
            >
              <MoreHorizontal size={12} />
            </button>
            <AnchoredPop open={placing} anchorRef={actionsRef} origin="br" onDismiss={() => setPlacing(false)} className="w-56 max-w-[calc(100vw-16px)] p-2">
                <button type="button" className="ob-menu-item w-full text-left" onClick={() => { onJump(todo); setPlacing(false); }}>
                  Reveal in paper
                </button>
                {unplaced && todo.id && placementTargets.length > 0 && onPlace && (
                  <label className="mt-1 block text-xs font-medium uppercase tracking-wide text-faint">
                    Place on map
                    <Select label="Primary map parent" placeholder="Choose a card…"
                      className="mt-1 h-7 w-full text-xs normal-case tracking-normal"
                      options={placementTargets.map(target => ({ value: target.id, label: target.label }))}
                      onValueChange={parentId => { onPlace(todo.id!, parentId); setPlacing(false) }}
                    />
                  </label>
                )}
                <button type="button" className="ob-menu-item w-full text-left" onClick={() => setDetails((value) => !value)}>
                  {details ? "Hide details" : "Show id and timestamps"}
                </button>
                <button
                  type="button"
                  className="ob-menu-item w-full text-left text-danger"
                  disabled={pending || removing}
                  onClick={() => {
                    onRemove();
                    setPlacing(false);
                  }}
                >
                  Remove
                </button>
            </AnchoredPop>
          </div>
        </div>
      </div>
    </li>
  );
}

function TodoTexText({ text }: { text: string }): ReactNode {
  return <RichText text={text} format="tex" />;
}
