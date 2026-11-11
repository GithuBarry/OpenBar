"use client";

import { useRouter } from "next/navigation";
import { FastTooltip } from "@/components/fast-tooltip";
import { useRef, useState } from "react";
import { LoaderCircle, Plus, Trash2, ChevronDown, Check, Network, Pencil } from "lucide-react";

import { createMindmapAction, deleteMindmapAction } from "@/app/actions";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import * as Popover from "@radix-ui/react-popover";
import { PopoverSurface } from "@/components/pop";
import styles from "./mindmap-switcher.module.css";
import { useMindmapTitle } from "./mindmap-title-context";

export type MindmapListItem = {
  id: string;
  title: string;
  role: "draft" | "planning";
  createdAt?: string;
};

export function MindmapSwitcher({
  project,
  maps,
  activeId,
}: {
  project: string;
  maps: MindmapListItem[];
  activeId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  const active = maps.find((map) => map.id === activeId) || maps[0];
  const titleContext = useMindmapTitle();
  const editor = titleContext?.editor?.id === activeId ? titleContext.editor : null;
  const activeTitle = editor?.title || active?.title || "Mindmaps";
  const hrefFor = (id: string) => (isPrimaryMindmap(id) ? `/p/${project}/mindmap` : `/p/${project}/mindmap/${id}`);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreating(false);
      setRenaming(false);
      setError(null);
    }
  }

  function cancelRename() {
    setRenaming(false);
    setError(null);
    requestAnimationFrame(() => renameButtonRef.current?.focus());
  }

  async function onRename(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || editor.readOnly || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (!(await flushBeforeNavigation())) return;
      await editor.rename(title.trim());
      cancelRename();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the mindmap.");
    } finally {
      setSaving(false);
    }
  }

  async function flushBeforeNavigation(): Promise<boolean> {
    const flush = (window as Window & { __openbarFlushMindmap?: () => Promise<void> }).__openbarFlushMindmap;
    if (!flush) return true;
    try {
      await flush();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save the current map before navigating.");
      return false;
    }
  }

  async function navigateTo(href: string) {
    if (!(await flushBeforeNavigation())) return;
    setOpen(false);
    router.push(href);
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || editor.readOnly || !title.trim()) return;
    if (!(await flushBeforeNavigation())) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createMindmapAction(project, title.trim());
      setTitle("");
      setCreating(false);
      setOpen(false);
      router.push(`/p/${project}/mindmap/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the mindmap.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editor || editor.readOnly || !active || isPrimaryMindmap(active)) return;
    if (!window.confirm(`Delete “${active.title}” and its map cards? Paper TODOs remain in the paper.`)) return;
    if (!(await flushBeforeNavigation())) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMindmapAction(project, active.id);
      setOpen(false);
      router.push(`/p/${project}/mindmap`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the mindmap.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <FastTooltip label={activeTitle}><Popover.Trigger asChild>
        <button type="button" className={`p-button p-button-glass ob-glass-button ${styles.trigger}`} aria-label="Choose mindmap"><Network size={16} className={styles.phoneMapIcon} /><span>{activeTitle}</span><ChevronDown size={12} /></button>
      </Popover.Trigger></FastTooltip>
      <PopoverSurface className={styles.menu} align="end" sideOffset={10} collisionPadding={12} aria-label="Mindmaps"
        onEscapeKeyDown={(event) => { if (renaming) { event.preventDefault(); if (!saving) cancelRename(); } }}>
        <p className={styles.heading}>Mindmaps</p>
        <div className={styles.maps}>
          {maps.map((map) => <button key={map.id} type="button" className={styles.row} onClick={() => void navigateTo(hrefFor(map.id))} aria-current={map.id === activeId ? "page" : undefined}>
            <span>{map.id === activeId ? activeTitle : map.title}</span>{isPrimaryMindmap(map) && <small>Primary</small>}{map.id === activeId && <Check size={14} />}
          </button>)}
        </div>
        {renaming ? <form onSubmit={(event) => void onRename(event)} className={styles.create}>
          <label htmlFor="mindmap-rename-title">Map title</label>
          <input id="mindmap-rename-title" autoFocus onFocus={(event) => event.target.select()} value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} aria-label="Rename map title" />
          <div><button type="submit" disabled={saving || !title.trim() || editor?.readOnly}>{saving ? <LoaderCircle size={13} className="animate-spin" /> : "Save name"}</button><button type="button" disabled={saving} onClick={cancelRename}>Cancel</button></div>
        </form> : <button ref={renameButtonRef} type="button" className={styles.row} disabled={saving || !editor || editor.readOnly} onClick={() => { setTitle(activeTitle); setCreating(false); setRenaming(true); setError(null); }}><Pencil size={14} /><span>Rename map</span></button>}
        {creating ? <form onSubmit={(event) => void onCreate(event)} className={styles.create}>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Map title" aria-label="New map title" />
          <div><button type="submit" disabled={saving || !title.trim() || !editor || editor.readOnly}>{saving ? <LoaderCircle size={13} className="animate-spin" /> : "Create map"}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form> : <button type="button" className={styles.row} disabled={saving || !editor || editor.readOnly} title={!editor || editor.readOnly ? "Enable editing to create a map" : undefined} onClick={() => { setTitle(""); setRenaming(false); setCreating(true); setError(null); }}><Plus size={14} /><span>New map</span></button>}
        {active && !isPrimaryMindmap(active) && <button type="button" className={styles.delete} onClick={() => void onDelete()} disabled={saving || !editor || editor.readOnly} title={!editor || editor.readOnly ? "Enable editing to delete a map" : undefined}><Trash2 size={13} />Delete this map</button>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </PopoverSurface>
    </Popover.Root>
  );
}
