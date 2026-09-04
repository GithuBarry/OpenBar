"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpenText, Edit3, Network, Plus, X } from "lucide-react";

import { saveProjectAction } from "@/app/actions";
import { safeUrl } from "@/lib/safe-url";
import type { Project, ProjectLink } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatDate(iso?: string) {
  if (!iso) return "recently";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  removable = false,
  onRemove,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-ink"
            aria-label={`Remove ${label}`}
          >
            <X size={10} /> Remove
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="input min-h-[4.5rem] resize-y text-sm leading-6"
        />
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input text-sm"
        />
      )}
    </div>
  );
}

export function ProjectCard({
  project,
  todos,
}: {
  project: Project;
  todos: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [tagline, setTagline] = useState(project.tagline);
  const [overview, setOverview] = useState(project.overview);
  const [researchKind, setResearchKind] = useState(project.researchKind ?? "");
  const [color, setColor] = useState(project.color ?? "");
  const [icon, setIcon] = useState(project.icon ?? "");
  const [label, setLabel] = useState(project.label ?? "");
  const [venue, setVenue] = useState(project.venue ?? "");
  const [collaborators, setCollaborators] = useState((project.collaborators ?? []).join(", "));
  const [links, setLinks] = useState<ProjectLink[]>(project.links ?? []);
  const [archived, setArchived] = useState(Boolean(project.archivedAt));
  const [error, setError] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<"icon" | "title">("title");
  const iconInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(project.title);
    setTagline(project.tagline);
    setOverview(project.overview);
    setResearchKind(project.researchKind ?? "");
    setColor(project.color ?? "");
    setIcon(project.icon ?? "");
    setLabel(project.label ?? "");
    setVenue(project.venue ?? "");
    setCollaborators((project.collaborators ?? []).join(", "));
    setLinks(project.links ?? []);
    setArchived(Boolean(project.archivedAt));
  }, [project]);

  useEffect(() => {
    if (!editing) return;
    const input = focusField === "icon" ? iconInputRef.current : titleInputRef.current;
    input?.focus();
    input?.select();
  }, [editing, focusField]);

  const persist = (patch: Partial<Project>, close = true) => {
    setError(null);
    startTransition(async () => {
      try {
        await saveProjectAction({
          ...project,
          ...patch,
          updatedAt: new Date().toISOString(),
        });
        if (close) setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save project.");
      }
    });
  };

  const saveForm = () => {
    const nextLinks = links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim(), kind: link.kind }))
      .filter((link) => link.label || link.url);
    if (nextLinks.some((link) => !link.label || !safeUrl(link.url))) {
      setError("Each link needs a label and a safe http(s) URL.");
      return;
    }
    persist({
      title: title.trim() || project.title,
      tagline: tagline.trim(),
      overview: overview.trim(),
      researchKind: researchKind.trim(),
      color: color.trim(),
      icon: icon.trim(),
      label: label.trim() || undefined,
      venue: venue.trim(),
      collaborators: collaborators.split(",").map((name) => name.trim()).filter(Boolean),
      links: nextLinks,
      archivedAt: archived ? project.archivedAt || new Date().toISOString() : undefined,
    });
  };

  const cancel = () => {
    setTitle(project.title);
    setTagline(project.tagline);
    setOverview(project.overview);
    setResearchKind(project.researchKind ?? "");
    setColor(project.color ?? "");
    setIcon(project.icon ?? "");
    setLabel(project.label ?? "");
    setVenue(project.venue ?? "");
    setCollaborators((project.collaborators ?? []).join(", "));
    setLinks(project.links ?? []);
    setArchived(Boolean(project.archivedAt));
    setError(null);
    setEditing(false);
  };

  const openEditor = (field: "icon" | "title") => {
    setFocusField(field);
    setEditing(true);
  };

  return (
    <article className="card ob-home-card flex flex-col p-5">
      <div className="relative">
      <form
        className={cn("ob-card-face flex flex-col gap-3", editing ? "relative" : "is-away absolute inset-0 overflow-hidden")}
        inert={!editing}
        aria-hidden={!editing}
        onSubmit={(event) => {
          event.preventDefault();
          saveForm();
        }}
      >
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <Field
              id={`project-${project.slug}-icon`}
              label="Icon"
              value={icon}
              onChange={setIcon}
              placeholder="🧪"
              inputRef={iconInputRef}
            />
            <Field
              id={`project-${project.slug}-title`}
              label="Title"
              value={title}
              onChange={setTitle}
              placeholder="Project title"
              inputRef={titleInputRef}
            />
          </div>
          <Field
            id={`project-${project.slug}-tagline`}
            label="Tagline"
            value={tagline}
            onChange={setTagline}
            placeholder="One-line pitch"
            removable={Boolean(tagline)}
            onRemove={() => setTagline("")}
          />
          <Field
            id={`project-${project.slug}-overview`}
            label="Overview"
            value={overview}
            onChange={setOverview}
            placeholder="Longer description"
            multiline
            removable={Boolean(overview)}
            onRemove={() => setOverview("")}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              id={`project-${project.slug}-research-kind`}
              label="Research kind"
              value={researchKind}
              onChange={setResearchKind}
              placeholder="method, benchmark, theory…"
              removable={Boolean(researchKind)}
              onRemove={() => setResearchKind("")}
            />
            <Field
              id={`project-${project.slug}-color`}
              label="Accent color"
              value={color}
              onChange={setColor}
              placeholder="#648fff"
              removable={Boolean(color)}
              onRemove={() => setColor("")}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              id={`project-${project.slug}-label`}
              label="Label"
              value={label}
              onChange={setLabel}
              placeholder="submitted, on hold, camera ready…"
              removable={Boolean(label)}
              onRemove={() => setLabel("")}
            />
            <Field
              id={`project-${project.slug}-venue`}
              label="Venue"
              value={venue}
              onChange={setVenue}
              placeholder="Target venue"
              removable={Boolean(venue)}
              onRemove={() => setVenue("")}
            />
          </div>
          <Field
            id={`project-${project.slug}-collaborators`}
            label="Collaborators"
            value={collaborators}
            onChange={setCollaborators}
            placeholder="Comma-separated names"
            removable={Boolean(collaborators)}
            onRemove={() => setCollaborators("")}
          />
          <div className="block">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Links</span>
              <button
                type="button"
                onClick={() => setLinks((current) => [...current, { label: "", url: "", kind: "web" }])}
                className="text-[10px] text-muted hover:text-ink"
              >
                + Add link
              </button>
            </div>
            <div className="space-y-1.5">
              {links.map((link, index) => (
                <div key={`${project.slug}-link-${index}`} className="grid gap-1 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto_auto]">
                  <input
                    value={link.label}
                    onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
                    placeholder="Label"
                    aria-label={`Link ${index + 1} label`}
                    className="input text-sm"
                  />
                  <input
                    value={link.url}
                    onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}
                    placeholder="https://…"
                    aria-label={`Link ${index + 1} URL`}
                    className="input text-sm"
                  />
                  <select
                    value={link.kind}
                    onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as ProjectLink["kind"] } : item))}
                    aria-label={`Link ${index + 1} kind`}
                    className="input text-sm"
                  >
                    <option value="web">Web</option>
                    <option value="repo">Repo</option>
                    <option value="arxiv">arXiv</option>
                    <option value="overleaf">Overleaf</option>
                    <option value="latex">LaTeX</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="btn-ghost px-1.5 text-xs"
                    aria-label={`Remove link ${index + 1}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
            Archive this project in the workspace
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className="btn-primary px-2.5 py-1 text-xs">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={cancel} className="btn-ghost px-2 py-1 text-xs">
              Cancel
            </button>
          </div>
      </form>
      <div
        className={cn("ob-card-face", editing ? "is-away absolute inset-0 overflow-hidden" : "relative")}
        inert={editing}
        aria-hidden={editing}
      >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-1.5">
              <button
                type="button"
                onClick={() => openEditor("icon")}
                className="ob-press shrink-0 rounded px-0.5 text-lg leading-none hover:bg-surface-2"
                title="Edit project icon"
                aria-label="Edit project icon"
              >
                {project.icon ?? "🧪"}
              </button>
              <Link href={`/p/${project.slug}/paper`} className="group min-w-0">
                <h2 className="truncate font-serif text-lg font-semibold transition-colors duration-ui group-hover:text-accent">
                  {project.title}
                </h2>
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {project.label && <span className="chip text-[11px]">{project.label}</span>}
              {project.archivedAt && <span className="chip text-[11px]">Archived</span>}
              <button
                type="button"
                onClick={() => openEditor("title")}
                className="ob-press rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                title="Edit project"
              >
                <Edit3 size={13} />
              </button>
            </div>
          </div>

          {project.tagline ? (
            <div className="group/tagline relative mt-1 pr-6">
              <p className="line-clamp-2 text-sm text-muted">{project.tagline}</p>
              <button
                type="button"
                onClick={() => persist({ tagline: "" }, false)}
                className="absolute right-0 top-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover/tagline:opacity-100"
                title="Remove tagline"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openEditor("title")}
              className="mt-1 inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-muted"
            >
              <Plus size={12} /> Add tagline
            </button>
          )}

          {todos > 0 && (
            <div className="mt-3 text-xs text-muted">
              <span className="font-mono font-semibold text-ink">{todos}</span> open {todos === 1 ? "TODO" : "TODOs"}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5 text-[11px] text-faint">
            {project.venue ? <span className="truncate">{project.venue}</span> : <span>Created {formatDate(project.createdAt)}</span>}
            <span>Edited {formatDate(project.updatedAt)}</span>
          </div>

          <nav className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
            <Quick href={`/p/${project.slug}/paper`} icon={<BookOpenText size={13} />} label="Paper" />
            <Quick href={`/p/${project.slug}/mindmap`} icon={<Network size={13} />} label="Mindmap" />
          </nav>
      </div>
      </div>
    </article>
  );
}

function Quick({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="ob-press inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-muted transition-colors duration-ui hover:bg-accent-soft hover:text-accent">
      {icon}
      {label}
    </Link>
  );
}
