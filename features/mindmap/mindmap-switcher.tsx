"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import { createMindmapAction, deleteMindmapAction } from "@/app/actions";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import { cn } from "@/lib/utils";

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
    if (!(await flushBeforeNavigation())) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMindmapAction(project, active.id);
      router.push(`/p/${project}/mindmap`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the mindmap.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="flex max-w-full flex-wrap items-center gap-1">
        {maps.map((map) => (
          <button
            key={map.id}
            type="button"
            className={cn(
              "btn-outline px-2 py-0.5 text-[11px]",
              map.id === activeId && "border-accent/50 bg-accent/10 text-accent",
            )}
            onClick={() => void navigateTo(hrefFor(map.id))}
            title={map.createdAt ? `Created ${map.createdAt.slice(0, 10)}` : undefined}
          >
            {map.title}
            {isPrimaryMindmap(map) ? " · Primary" : ""}
          </button>
        ))}
      </div>
      {creating ? (
        <form onSubmit={(event) => void onCreate(event)} className="flex items-center gap-1">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Map title"
            className="input h-7 w-36 px-2 py-0 text-xs"
          />
          <button type="submit" className="btn-primary px-2 py-0.5 text-[11px]" disabled={saving || !title.trim()}>
            {saving ? <LoaderCircle size={11} className="animate-spin" /> : "Add"}
          </button>
          <button type="button" className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" onClick={() => setCreating(true)}>
          <Plus size={11} /> New map
        </button>
      )}
      {active && !isPrimaryMindmap(active) && (
        <button type="button" className="btn-outline px-2 py-0.5 text-[11px] text-danger" onClick={() => void onDelete()} disabled={saving}>
          <Trash2 size={11} /> Delete map
        </button>
      )}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
