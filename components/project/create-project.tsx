"use client";

import { useRouter } from "next/navigation";
import { cloneElement, useState, type ReactElement } from "react";
import { Modal } from "@/components/modal";
import { ArrowUpRight, LoaderCircle, Plus } from "lucide-react";

import { checkProjectNameAction, connectProjectOverleafAction, createProjectAction } from "@/app/actions";
import { overleafProjectId } from "@/lib/server/git-url";
import type { NewProjectInput } from "@/lib/store";
import { cn } from "@/lib/utils";

function OverleafDashboard({ children }: { children: React.ReactNode }) {
  return <a className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" href="https://www.overleaf.com/project" target="_blank" rel="noreferrer">
    {children} <ArrowUpRight size={12} aria-hidden="true" />
  </a>;
}

function OverleafProjectLinkField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-semibold text-ink">
    Overleaf project URL
    <input value={value} onChange={event => onChange(event.target.value)} type="text" required maxLength={2048}
      placeholder="https://www.overleaf.com/project/…" className="p-field input mt-1 text-sm" />
    <span className="mt-1 block font-normal text-muted">Paste the editor or Git URL. OpenBar uses the host’s Overleaf Git access.</span>
  </label>;
}

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
  const [destination, setDestination] = useState<NonNullable<NewProjectInput["destination"]>>("local");
  const [overleafUrl, setOverleafUrl] = useState("");
  const [checked, setChecked] = useState<{ key: string; slug: string }>();
  const [nameChecked, setNameChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [created, setCreated] = useState<{ slug: string; message: string }>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameKey = JSON.stringify([title.trim(), slug.trim()]);
  const nameAvailable = checked?.key === nameKey;

  function openProject(projectSlug: string) {
    setOpen(false);
    setTitle("");
    setSlug("");
    setTagline("");
    setDestination("local");
    setOverleafUrl("");
    setChecked(undefined);
    setNameChecked(false);
    setCreated(undefined);
    router.push(`/p/${projectSlug}/paper`);
    router.refresh();
  }

  async function checkName() {
    setChecking(true);
    setError(null);
    try {
      const result = await checkProjectNameAction({ title, slug });
      if (result.ok) setChecked({ key: nameKey, slug: result.slug });
      else { setChecked(undefined); setError(result.message); }
    } catch {
      setError("OpenBar could not check the project name. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (created) { openProject(created.slug); return; }
    if (destination === "new" && (!nameAvailable || !nameChecked)) return;
    const id = destination === "local" ? undefined : overleafProjectId(overleafUrl);
    if (destination !== "local" && !id) { setError("Paste an Overleaf editor or Git URL."); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await createProjectAction({
        title: title.trim(),
        slug: slug.trim() || undefined,
        tagline: tagline.trim() || undefined,
        destination,
        overleafUrl: id ? `https://www.overleaf.com/project/${id}` : undefined,
        nameChecked: destination === "new" && nameChecked,
      });
      if (!result.ok) setError(result.message);
      else if (result.message) setCreated({ slug: result.slug, message: result.message });
      else openProject(result.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Modal open={open} onClose={() => { if (created) openProject(created.slug); else setOpen(false); }} title="Create a TeX project" busy={saving} className="w-[29rem] p-4"
        trigger={trigger ? cloneElement(trigger, { onClick: () => setOpen(true) }) : <button
        type="button"
        className={compact ? "p-button p-button-default btn-outline ob-brand-font px-2 py-1 text-xs" : "p-button p-button-primary btn-primary ob-brand-font text-sm"}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={compact ? 12 : 14} />
        New project
      </button>}>
        <form onSubmit={(event) => void onSubmit(event)} className="w-full">
          <p className="mb-3 text-sm font-semibold text-ink">{created ? "Project created" : "Create a TeX project"}</p>
          {created ? <p className="mb-3 text-sm text-muted" role="status">{created.message}</p> : <fieldset disabled={saving} className="min-w-0">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Title
            <input
              required
              maxLength={240}
              value={title}
              onChange={(event) => { setTitle(event.target.value); setNameChecked(false); setChecked(undefined); setError(null); }}
              className="p-field input mt-1 text-sm"
              placeholder="Working paper title"
            />
          </label>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Slug <span className="font-normal normal-case text-faint">(optional)</span>
            <input
              value={slug}
              maxLength={120}
              onChange={(event) => { setSlug(event.target.value); setNameChecked(false); setChecked(undefined); setError(null); }}
              className="p-field input mt-1 font-mono text-sm"
              placeholder="auto-from-title"
            />
          </label>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-wide text-muted">
            Tagline <span className="font-normal normal-case text-faint">(optional)</span>
            <input
              value={tagline}
              maxLength={240}
              onChange={(event) => setTagline(event.target.value)}
              className="p-field input mt-1 text-sm"
              placeholder="One-line research tension"
            />
          </label>
          <label className="mb-2 block text-xs font-semibold text-ink">
            Where should this project live?
            <select className="p-field input mt-1 text-sm" value={destination}
              onChange={event => { setDestination(event.target.value as NonNullable<NewProjectInput["destination"]>); setOverleafUrl(""); setNameChecked(false); setError(null); }}>
              <option value="local">OpenBar only</option>
              <option value="existing">Use an existing Overleaf project</option>
              <option value="new">Create a new Overleaf project</option>
            </select>
          </label>
          {destination === "local" && <p className="mb-3 text-xs text-muted">This paper will be saved in OpenBar. You can connect it to Overleaf later.</p>}
          {destination === "existing" && <div className="mb-3 space-y-2 text-xs text-muted">
            <p><OverleafDashboard>Open your Overleaf projects</OverleafDashboard> and choose the paper to import and sync.</p>
            <OverleafProjectLinkField value={overleafUrl} onChange={setOverleafUrl} />
          </div>}
          {destination === "new" && <div className="mb-3 space-y-2 text-xs text-muted">
            {!nameAvailable ? <>
              <p>Check that the name and address are free in OpenBar before creating the Overleaf project.</p>
              <button type="button" className="p-button p-button-default btn-outline text-xs" disabled={!title.trim() || checking} onClick={() => void checkName()}>
                {checking ? "Checking…" : "Check OpenBar name"}
              </button>
            </> : <>
              <p role="status">Available in OpenBar at <code>{checked.slug}</code>.</p>
              <p><OverleafDashboard>Check the name in Overleaf</OverleafDashboard>. Search your projects for <strong className="text-ink">{title.trim()}</strong>. If the name is free, create a Blank project there and paste its URL below.</p>
              <label className="flex items-start gap-2 text-ink">
                <input type="checkbox" checked={nameChecked} onChange={event => setNameChecked(event.target.checked)} className="mt-0.5" />
                <span>I checked the name in Overleaf and created a blank project.</span>
              </label>
              <OverleafProjectLinkField value={overleafUrl} onChange={setOverleafUrl} />
            </>}
          </div>}
          </fieldset>}
          {error && <p className="mb-2 text-xs text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            {!created && <button type="button" disabled={saving} className="p-button p-button-borderless btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>}
            <button type="submit" className="p-button p-button-primary btn-primary text-xs"
              disabled={!created && (saving || checking || !title.trim() || (destination !== "local" && !overleafUrl.trim()) || (destination === "new" && (!nameAvailable || !nameChecked)))}>
              {saving ? <LoaderCircle size={12} className="animate-spin" /> : null}
              {created ? "Open paper" : destination === "existing" ? "Import and connect" : destination === "new" ? "Create and sync" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function ConnectOverleafButton({ project }: { project: { slug: string; title: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function close() {
    setOpen(false);
    if (message) router.refresh();
  }

  return <Modal open={open} onClose={close} busy={saving} title="Connect this paper to Overleaf" className="w-[29rem] p-4"
    trigger={<button type="button" className="p-button p-button-default btn-outline text-xs" onClick={() => { setOpen(true); setError(""); }}>Connect Overleaf</button>}>
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (message) { close(); return; }
      const id = overleafProjectId(url);
      if (!id) { setError("Paste an Overleaf editor or Git URL."); return; }
      setSaving(true);
      setError("");
      void connectProjectOverleafAction(project.slug, `https://www.overleaf.com/project/${id}`).then(result => {
        if (!result.ok) setError(result.message);
        else if (result.message) setMessage(result.message);
        else { setOpen(false); router.refresh(); }
      }).catch(() => setError("OpenBar could not connect this project. Try again.")).finally(() => setSaving(false));
    }}>
      <p className="text-sm font-semibold text-ink">Connect {project.title} to Overleaf</p>
      {message ? <p className="text-sm text-muted" role="status">{message}</p> : <fieldset disabled={saving} className="min-w-0 space-y-3">
        <p className="text-xs text-muted"><OverleafDashboard>Open your Overleaf projects</OverleafDashboard>. Search for this title before creating a blank project. Choose a blank project or an Overleaf copy with the same files.</p>
        <OverleafProjectLinkField value={url} onChange={setUrl} />
      </fieldset>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        {!message && <button type="button" className="p-button p-button-borderless btn-ghost text-xs" disabled={saving} onClick={close}>Cancel</button>}
        <button type="submit" className="p-button p-button-primary btn-primary text-xs" disabled={saving || (!message && !url.trim())}>
          {saving && <LoaderCircle size={12} className="animate-spin" />}
          {message ? "Done" : "Connect and sync"}
        </button>
      </div>
    </form>
  </Modal>;
}
