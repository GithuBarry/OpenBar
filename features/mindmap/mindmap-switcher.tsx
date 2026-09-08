"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Plus, Trash2, ChevronDown, Check } from "lucide-react";

import { createMindmapAction, deleteMindmapAction } from "@/app/actions";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import * as Popover from "@radix-ui/react-popover";
import styles from "./mindmap-switcher.module.css";

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
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = maps.find((map) => map.id === activeId) || maps[0];
  const hrefFor = (id: string) => (isPrimaryMindmap(id) ? `/p/${project}/mindmap` : `/p/${project}/mindmap/${id}`);

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
    if (!active || isPrimaryMindmap(active)) return;
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
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label="Choose mindmap" title={active?.title || "Mindmaps"}><span>{active?.title || "Mindmaps"}</span><ChevronDown size={12} /></button>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content className={styles.menu} align="end" sideOffset={10} collisionPadding={12} aria-label="Mindmaps">
        <p className={styles.heading}>Mindmaps</p>
        <div className={styles.maps}>
          {maps.map((map) => <button key={map.id} type="button" className={styles.row} onClick={() => void navigateTo(hrefFor(map.id))} aria-current={map.id === activeId ? "page" : undefined}>
            <span>{map.title}</span>{isPrimaryMindmap(map) && <small>Primary</small>}{map.id === activeId && <Check size={14} />}
          </button>)}
        </div>
        {creating ? <form onSubmit={(event) => void onCreate(event)} className={styles.create}>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Map title" aria-label="New map title" />
          <div><button type="submit" disabled={saving || !title.trim()}>{saving ? <LoaderCircle size={13} className="animate-spin" /> : "Create map"}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form> : <button type="button" className={styles.row} onClick={() => setCreating(true)}><Plus size={14} /><span>New map</span></button>}
        {active && !isPrimaryMindmap(active) && <button type="button" className={styles.delete} onClick={() => void onDelete()} disabled={saving}><Trash2 size={13} />Delete this map</button>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}
