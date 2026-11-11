"use client";

import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { DragDropProvider, DragOverlay, useDroppable, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Archive, ArrowDown, GripVertical } from "lucide-react";
import { moveWorkspaceProjectToolAction } from "@/app/actions";
import type { Project } from "@/lib/types";
import type { ProjectGitDestination } from "@/lib/tex-project/overleaf-git";
import { ProjectCard } from "./project-card";
import { cn } from "@/lib/utils";
import styles from "./project-board.module.css";

type Row = { project: Project; todos: number; destination?: ProjectGitDestination };
type Group = "active" | "archived";
const groupOf = (project: Project): Group => project.archivedAt ? "archived" : "active";

export function ProjectBoard({ rows: initialRows, initialHash, readOnly = false }: {
  rows: Row[];
  initialHash: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [hash, setHash] = useState(initialHash);
  const [dragged, setDragged] = useState<string | null>(null);
  const [movingProject, setMovingProject] = useState<{ slug: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  useEffect(() => {
    if (dragged || pending) return;
    setRows(initialRows);
    setHash(initialHash);
  }, [initialRows, initialHash, dragged, pending]);

  const active = rows.filter(({ project }) => groupOf(project) === "active");
  const archived = rows.filter(({ project }) => groupOf(project) === "archived");
  const visibleArchived = archiveExpanded || dragged ? archived : archived.slice(0, 2);
  const draggedRow = rows.find(({ project }) => project.slug === dragged);

  function finishDrag(event: DragEndEvent) {
    setDragged(null);
    if (event.canceled || readOnly || pending) return;
    const { source, target } = event.operation;
    if (!isSortable(source) || !target) return;
    const slug = String(source.id);
    const row = rows.find(({ project }) => project.slug === slug);
    const group = isSortable(target) ? target.group : target.data.group;
    if (!row || (group !== "active" && group !== "archived")) return;
    const destination = rows.filter(({ project }) => groupOf(project) === group && project.slug !== slug);
    const index = isSortable(target)
      ? Math.max(0, Math.min(target.id === source.id ? source.index : target.index, destination.length))
      : destination.length;
    const beforeSlug = destination[index]?.project.slug;
    const afterSlug = destination[index - 1]?.project.slug;
    const moved = { ...row, project: { ...row.project, archivedAt: group === "archived" ? row.project.archivedAt || new Date().toISOString() : undefined } };
    destination.splice(index, 0, moved);
    const remaining = rows.filter(({ project }) => groupOf(project) !== group && project.slug !== slug);
    const next = group === "active" ? [...destination, ...remaining] : [...remaining, ...destination];
    if (next.every((item, i) => item.project.slug === rows[i]?.project.slug && groupOf(item.project) === groupOf(rows[i].project))) return;
    flushSync(() => {
      setDragged(null);
      setRows(next);
      setError(null);
      if (group !== groupOf(row.project)) setMovingProject({ slug, message: group === "archived" ? "Archiving project…" : "Restoring project…" });
      setPending(true);
    });
    void (async () => {
      try {
        const move = await moveWorkspaceProjectToolAction({ slug, archived: group === "archived", beforeSlug, afterSlug, expectedHash: hash });
        if (!move.ok) throw new Error(move.message);
        const result = move.value;
        const previousRows = new Map(rows.map(item => [item.project.slug, item]));
        setRows(result.projects.map(project => ({
          project,
          todos: previousRows.get(project.slug)?.todos || 0,
          destination: previousRows.get(project.slug)?.destination,
        })));
        setHash(result.hash);
        setNotice(`${row.project.title} ${group !== groupOf(row.project) ? group === "archived" ? "archived" : "restored" : "moved"}.`);
      } catch (cause) {
        setRows(rows);
        setError(cause instanceof Error ? cause.message : "Could not save the project arrangement.");
        router.refresh();
      } finally {
        setMovingProject(null);
        setPending(false);
      }
    })();
  }

  return <DragDropProvider onDragStart={event => { setDragged(String(event.operation.source?.id)); setError(null); }}
    onDragOver={event => {
      // React owns card order. The default sortable behavior moves DOM nodes
      // independently and leaves that order behind when a drop has no target.
      event.preventDefault();
    }} onDragEnd={finishDrag}>
    <p id="project-drag-help" className="sr-only">Press Space to pick up a project, use the arrow keys to move, and press Space to drop. Escape cancels.</p>
    <div className={styles.board} aria-busy={pending}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <span role="status" className="sr-only">{pending ? "Saving project arrangement…" : notice}</span>
      <ProjectGroup group="active" disabled={readOnly || pending} dragging={Boolean(dragged)}>
        {active.length === 0 && <p className={styles.empty}>Drag a project here to keep it active.</p>}
        {active.map((row, index) => <SortableProject key={row.project.slug} row={row} index={index} group="active" disabled={readOnly || pending} pendingMessage={movingProject?.slug === row.project.slug ? movingProject.message : undefined} />)}
      </ProjectGroup>
      <ProjectGroup group="archived" disabled={readOnly || pending} dragging={Boolean(dragged)}>
        {archived.length === 0 && <p className={styles.empty}>Drag projects here to archive them.</p>}
        {visibleArchived.map((row, index) => <SortableProject key={row.project.slug} row={row} index={index} group="archived" disabled={readOnly || pending} pendingMessage={movingProject?.slug === row.project.slug ? movingProject.message : undefined} />)}
        {archived.length > 2 && <button type="button" className={`p-button p-button-glass ob-glass-button ${styles.archiveToggle}`}
          aria-expanded={archiveExpanded || Boolean(dragged)} aria-controls="archived-projects"
          onClick={() => setArchiveExpanded(expanded => !expanded)} disabled={Boolean(dragged)}>
          {archiveExpanded ? "Show fewer" : `Show all ${archived.length} archived projects`}
        </button>}
      </ProjectGroup>
    </div>
    <DragOverlay>
      {draggedRow && <div className={styles.dragPreview}><span>{draggedRow.project.icon || "🧪"}</span><strong>{draggedRow.project.title}</strong></div>}
    </DragOverlay>
    <AboutCue dragging={Boolean(dragged)} />
  </DragDropProvider>;
}

function SortableProject({ row, index, group, disabled, pendingMessage }: { row: Row; index: number; group: Group; disabled: boolean; pendingMessage?: string }) {
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({ id: row.project.slug, index, group, type: "project", accept: "project", data: { group }, disabled });
  return <div ref={ref} className={cn(styles.sortable, isDragSource && styles.dragging, isDropTarget && !isDragSource && styles.dropTarget)}>
    <ProjectCard {...row} pendingMessage={pendingMessage} dragHandle={disabled ? undefined : <button type="button" ref={handleRef} className={styles.handle}
      aria-label={`Move ${row.project.title}`} aria-describedby="project-drag-help" title="Drag to move project">
      <GripVertical size={16} aria-hidden="true" />
    </button>} />
  </div>;
}

function ProjectGroup({ group, disabled, dragging, children }: { group: Group; disabled: boolean; dragging: boolean; children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({ id: `projects-${group}`, type: "project-group", accept: "project", data: { group }, collisionPriority: -1, disabled });
  return <section ref={ref} aria-label={group === "active" ? "Projects" : "Archived projects"}
    id={group === "archived" ? "archived-projects" : undefined} data-project-group={group} className={cn(styles.group, group === "active" ? styles.active : styles.archive, dragging && styles.ready, isDropTarget && styles.over)}>
    {group === "archived" && <div className={styles.archiveHeading}><Archive size={17} aria-hidden="true" /><h2>Archived</h2></div>}
    <div className={styles.grid}>{children}</div>
  </section>;
}

function AboutCue({ dragging }: { dragging: boolean }) {
  return dragging ? null : <div className={styles.aboutCueSlot}>
    <a href="#about" className={`p-button p-button-glass ${styles.aboutCue}`} aria-label="Scroll to About">About <ArrowDown size={14} aria-hidden="true" /></a>
  </div>;
}
