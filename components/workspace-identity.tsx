"use client";

import { Check, Edit3, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveWorkspaceSettingsAction } from "@/app/actions";
import type { WorkspaceSettings } from "@/lib/workspace";

/** A compact editor for the repository-backed name shown across the workspace. */
export function WorkspaceIdentity({ workspace }: { workspace: WorkspaceSettings }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [tagline, setTagline] = useState(workspace.tagline);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setName(workspace.name);
    setTagline(workspace.tagline);
  }, [workspace]);

  const close = () => {
    setName(workspace.name);
    setTagline(workspace.tagline);
    setError(null);
    setEditing(false);
  };

  const save = () => {
    const nextName = name.trim();
    const nextTagline = tagline.trim();
    if (!nextName) {
      setError("Give this workspace a name.");
      return;
    }
    if (nextName === workspace.name && nextTagline === workspace.tagline) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const next = await saveWorkspaceSettingsAction({ name: nextName, tagline: nextTagline });
        setName(next.name);
        setTagline(next.tagline);
        setEditing(false);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not save workspace identity.");
      }
    });
  };

  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Workspace name"
            className="min-w-0 flex-1 rounded border border-accent bg-surface px-2 py-1 font-serif text-xl font-semibold leading-tight text-ink outline-none"
          />
          <button type="submit" disabled={pending} className="btn-primary px-2 py-1 text-xs">
            {pending ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
            Save
          </button>
          <button type="button" onClick={close} className="btn-ghost px-1.5 py-1 text-xs" aria-label="Cancel workspace edit">
            <X size={14} />
          </button>
        </div>
        <input
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
          aria-label="Workspace tagline"
          placeholder="A short description"
          className="rounded border border-line bg-surface px-2 py-1 text-xs text-muted outline-none focus:border-accent"
        />
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <div className="group flex min-w-0 items-start gap-1.5">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 text-left"
        aria-label="Edit workspace name"
        title="Edit workspace name"
      >
        <div className="truncate font-serif text-xl font-semibold leading-tight text-ink">{workspace.name}</div>
        {workspace.tagline && <div className="truncate text-xs text-muted">{workspace.tagline}</div>}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="ob-press mt-0.5 rounded p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-2 hover:text-ink"
        aria-label="Edit workspace identity"
        title="Edit workspace identity"
      >
        <Edit3 size={13} />
      </button>
      {saved && <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-m-final"><Check size={12} /> Saved</span>}
    </div>
  );
}
