"use client";

import { useRouter } from "next/navigation";
import { cloneElement, useState, type ReactElement } from "react";
import { Modal } from "@/components/modal";
import { LoaderCircle, Plus } from "lucide-react";

import { createProjectAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export function CreateProjectButton({
  className,
  compact = false,
  trigger,
}: {
  className?: string;
  compact?: boolean;
  trigger?: ReactElement<{ onClick?: () => void }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [tagline, setTagline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createProjectAction({
        title: title.trim(),
        slug: slug.trim() || undefined,
        tagline: tagline.trim() || undefined,
      });
      setOpen(false);
      setTitle("");
      setSlug("");
      setTagline("");
      router.push(`/p/${created.slug}/paper`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a TeX project" busy={saving} className="w-80 p-3"
        trigger={trigger ? cloneElement(trigger, { onClick: () => setOpen(true) }) : <button
        type="button"
        className={compact ? "p-button p-button-default btn-outline ob-brand-font px-2 py-1 text-xs" : "p-button p-button-primary btn-primary ob-brand-font text-sm"}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={compact ? 12 : 14} />
        New project
      </button>}>
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="w-full"
        >
          <p className="mb-2 text-xs font-semibold text-ink">Create a TeX project</p>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-faint">
            Title
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="p-field input mt-1 text-sm"
              placeholder="Working paper title"
            />
          </label>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-faint">
            Slug <span className="font-normal normal-case text-faint">(optional)</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="p-field input mt-1 font-mono text-sm"
              placeholder="auto-from-title"
            />
          </label>
          <label className="mb-3 block text-[10px] font-semibold uppercase tracking-wide text-faint">
            Tagline <span className="font-normal normal-case text-faint">(optional)</span>
            <input
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              className="p-field input mt-1 text-sm"
              placeholder="One-line research tension"
            />
          </label>
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="p-button p-button-borderless btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="p-button p-button-primary btn-primary text-xs" disabled={saving || !title.trim()}>
              {saving ? <LoaderCircle size={12} className="animate-spin" /> : null}
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
