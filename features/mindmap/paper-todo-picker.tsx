"use client";

import { useId, useState } from "react";
import { ChevronDown, FileCheck2 } from "lucide-react";
import { linkedTodoCaption } from "@/lib/mindmap/link-existing-todo";
import { mindmapCardContentForTodo } from "@/lib/research/todo-map";
import type { ProjectStateOutlineItem, ProjectStateTodo } from "@/lib/research/project-state";
import type { MindmapNode } from "@/lib/types";
import styles from "./paper-todo-picker.module.css";

type Props = {
  card: MindmapNode;
  todos: ProjectStateTodo[];
  sections: ProjectStateOutlineItem[];
  disabled: boolean;
  onLink: (todoId: string, asChild: boolean) => Promise<void>;
  onCreate: (sectionId?: string) => Promise<void>;
};

export function PaperTodoPicker({ card, todos, sections, disabled, onLink, onCreate }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [todoId, setTodoId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const visual = card.contentFormat === "html";
  const chosen = todos.find(todo => todo.id === todoId);
  const preview = chosen && mindmapCardContentForTodo(chosen);

  async function submit() {
    setError("");
    setPending(true);
    try {
      if (mode === "existing" && chosen) await onLink(chosen.id, visual);
      if (mode === "create" && !visual) await onCreate(sectionId || undefined);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the paper TODO.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button type="button" className="mindmap-card-menu-row" disabled={disabled || pending}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <FileCheck2 size={14} aria-hidden="true" />
      <span>Paper TODO</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <fieldset id={panelId} className={styles.panel} disabled={disabled || pending}>
      {!visual && <div role="group" aria-label="Paper TODO action" className={styles.modes}>
        <button type="button" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setError(""); }}>Link existing</button>
        <button type="button" aria-pressed={mode === "create"} onClick={() => { setMode("create"); setError(""); }}>Create new</button>
      </div>}
      {mode === "existing" || visual ? <>
        <label>Paper TODO
          <select value={chosen?.id || ""} onChange={event => { setTodoId(event.target.value); setError(""); }}>
            <option value="">{todos.length ? "Choose a TODO…" : "No available TODOs"}</option>
            {todos.map(todo => <option key={todo.id} value={todo.id}>
              {todo.title || todo.text.split("\n")[0]}{todo.sectionTitle ? ` · ${todo.sectionTitle}` : ""}
            </option>)}
          </select>
        </label>
        {chosen && preview && <>
          <p className={styles.context}>{[chosen.headingPath?.join(" › ") || chosen.sectionTitle, chosen.file].filter(Boolean).join(" · ")}</p>
          {preview.body && <p className={styles.excerpt}>{preview.body}</p>}
          {visual ? <p>The visual stays on this card. The task appears beneath it.</p>
            : linkedTodoCaption(card, chosen) !== card.caption && <p>Linking shows the paper’s wording and keeps this card’s other text in Notes.</p>}
        </>}
        <button type="button" className={styles.submit} disabled={!chosen} onClick={() => void submit()}>
          {pending ? "Linking…" : visual ? "Place TODO as child" : "Link to this card"}
        </button>
      </> : <>
        <label>Manuscript location
          <select value={sectionId} onChange={event => setSectionId(event.target.value)}>
            <option value="">End of manuscript</option>
            {sections.map(section => <option key={section.id} value={section.id}>{section.headingPath?.join(" › ") || section.title}</option>)}
          </select>
        </label>
        <button type="button" className={styles.submit} onClick={() => void submit()}>{pending ? "Creating…" : "Create paper TODO from card"}</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </fieldset>}
  </>;
}
