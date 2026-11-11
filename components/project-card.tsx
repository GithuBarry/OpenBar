"use client";

import { ChoiceButtons } from "./choice-buttons";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpRight, Edit3, FileText, LoaderCircle, Network, Plus, X } from "lucide-react";

import { saveProjectFromHomeAction } from "@/app/actions";
import { takeProjectNavigationSession } from "@/components/project-session/project-write-session";
import { safeUrl } from "@/lib/safe-url";
import type { Project, ProjectLink } from "@/lib/types";
import type { ProjectGitDestination } from "@/lib/tex-project/overleaf-git";
import { cn } from "@/lib/utils";
import { ConnectOverleafButton } from "./project/create-project";

function formatDate(iso?: string) {
  if (!iso) return "recently";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatEditedDate(iso: string | undefined, now: number | null) {
  if (!iso || now === null) return formatDate(iso);
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 14 * 24 * 60 * 60 * 1000) return formatDate(iso);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return "1 week ago";
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
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
  hint?: string;
  multiline?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink [@media(pointer:coarse)]:min-h-11"
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
          className="p-field input min-h-[4.5rem] resize-y text-sm leading-6"
        />
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="p-field input text-sm"
        />
      )}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[11px] leading-tight text-muted">{hint}</p>}
    </div>
  );
}

export function ProjectCard({
  project,
  todos,
  destination,
  dragHandle,
  pendingMessage,
}: {
  project: Project;
  todos: number;
  destination?: ProjectGitDestination;
  dragHandle?: React.ReactNode;
  pendingMessage?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [tagline, setTagline] = useState(project.tagline);
  const [overview, setOverview] = useState(project.overview);
  const [color, setColor] = useState(project.color ?? "");
  const [icon, setIcon] = useState(project.icon ?? "");
  const [label, setLabel] = useState(project.label ?? "");
  const [venue, setVenue] = useState(project.venue ?? "");
  const [collaborators, setCollaborators] = useState((project.collaborators ?? []).join(", "));
  const [links, setLinks] = useState<ProjectLink[]>(project.links ?? []);
  const [archived, setArchived] = useState(Boolean(project.archivedAt));
  const [error, setError] = useState<string | null>(null);
  const [savingMessage, setSavingMessage] = useState("Saving project…");
  const [now, setNow] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<"icon" | "title">("title");
  const iconInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setTitle(project.title);
    setTagline(project.tagline);
    setOverview(project.overview);
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
    const archiveChanged = "archivedAt" in patch && Boolean(patch.archivedAt) !== Boolean(project.archivedAt);
    setSavingMessage(archiveChanged ? patch.archivedAt ? "Archiving project…" : "Restoring project…" : "Saving project…");
    startTransition(async () => {
      try {
        const result = await saveProjectFromHomeAction({
          ...project,
          ...patch,
          updatedAt: new Date().toISOString(),
        }, takeProjectNavigationSession(project.slug));
        if (!result.ok) {
          setError(result.message);
          return;
        }
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

  const busyMessage = pendingMessage || (pending ? savingMessage : undefined);

  return (
    <article data-project-slug={project.slug} className="card ob-home-card relative flex flex-col overflow-hidden px-5 py-4">
      <div className="relative" aria-busy={Boolean(busyMessage)} inert={Boolean(busyMessage)}>
      <form
        className={cn("ob-card-face flex flex-col gap-3", editing ? "relative" : "is-away absolute inset-0 overflow-hidden")}
        inert={!editing}
        aria-hidden={!editing}
        onSubmit={(event) => {
          event.preventDefault();
          saveForm();
        }}
      >
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <Field
              id={`project-${project.slug}-icon`}
              label="Project icon"
              value={icon}
              onChange={setIcon}
              placeholder="🧪"
              hint="Type or paste an emoji."
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
          <div className="grid gap-2">
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Links</span>
              <button
                type="button"
                onClick={() => setLinks((current) => [...current, { label: "", url: "", kind: "web" }])}
                className="text-xs text-muted hover:text-ink [@media(pointer:coarse)]:min-h-11"
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
                    className="p-field input text-sm"
                  />
                  <input
                    value={link.url}
                    onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}
                    placeholder="https://…"
                    aria-label={`Link ${index + 1} URL`}
                    className="p-field input text-sm"
                  />
                  <ChoiceButtons label={`Link ${index + 1} kind`} value={link.kind} options={[{value:"web",label:"Web"},{value:"repo",label:"Repo"},{value:"arxiv",label:"arXiv"},{value:"overleaf",label:"Git"},{value:"latex",label:"LaTeX"}]} onChange={(value) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: value as ProjectLink["kind"] } : item))} />
                  <button
                    type="button"
                    onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="p-button p-button-borderless btn-ghost px-1.5 text-xs"
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
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className="p-button p-button-primary btn-primary px-2.5 py-1 text-xs">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={cancel} className="p-button p-button-borderless btn-ghost px-2 py-1 text-xs">
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
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => openEditor("icon")}
                className="ob-press inline-flex h-7 min-w-6 shrink-0 items-center justify-center rounded px-0.5 text-lg leading-none hover:bg-surface-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
                title="Change project icon"
                aria-label="Change project icon"
              >
                {project.icon ?? "🧪"}
              </button>
              <Link href={`/p/${project.slug}/paper`} className="group min-w-0">
                <h2 className="ob-project-title ob-brand-font truncate text-lg transition-colors duration-ui group-hover:text-accent">
                  {project.title}
                </h2>
              </Link>
            </div>
            <div className="-mr-1 -mt-0.5 flex shrink-0 items-center gap-0.5">
              {dragHandle}
              <button
                type="button"
                onClick={() => openEditor("title")}
                className="ob-press inline-grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                title="Edit project"
                aria-label={`Edit ${project.title}`}
              >
                <Edit3 size={16} aria-hidden="true" />
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
            <div className="mt-2 text-xs text-muted">
              <span className="font-mono font-semibold text-ink">{todos}</span> open {todos === 1 ? "TODO" : "TODOs"}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs leading-5 text-muted">
            {(project.label || project.venue) && <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{[project.label, project.venue].filter(Boolean).join(", ")}</span>}
            <time className="ml-auto" dateTime={project.lastEditedAt || project.updatedAt} title={`Latest saved project change: ${new Date(project.lastEditedAt || project.updatedAt).toLocaleString()}${project.createdAt ? `, created ${formatDate(project.createdAt)}` : ""}`}>Edited {formatEditedDate(project.lastEditedAt || project.updatedAt, now)}</time>
          </div>

          <nav aria-label={`${project.title} links`} className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
            <Quick href={`/p/${project.slug}/paper`} icon={<FileText size={13} />} label="Paper" />
            <Quick href={`/p/${project.slug}/mindmap`} icon={<Network size={13} />} label="Mindmap" />
            {(project.links ?? []).map((link, index) => <ExternalProjectLink key={`${link.url}-${index}`} link={link} projectTitle={project.title} />)}
          </nav>
          {destination && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            {destination.kind === "overleaf" ? <>
              <span>Overleaf connected</span>
              <a href={destination.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Open in Overleaf <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            </> : <>
              <span>{destination.kind === "git" ? "Git checkout · Overleaf disconnected" : "OpenBar only"}</span>
              {destination.kind === "local" && <ConnectOverleafButton project={project} />}
            </>}
          </div>}
          {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      </div>
      </div>
      {busyMessage && <div className="ob-home-card-loading" role="status" aria-live="polite">
        <LoaderCircle size={22} className="motion-safe:animate-spin" aria-hidden="true" />
        <span>{busyMessage}</span>
      </div>}
    </article>
  );
}

function ExternalProjectLink({ link, projectTitle }: { link: ProjectLink; projectTitle: string }) {
  const href = safeUrl(link.url)
  if (!href) return null
  const hostname = new URL(href).hostname
  const label = link.label.trim() || hostname
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} for ${projectTitle} (opens in a new tab)`}
      title={`${label} (${hostname})`}
      className="p-button p-button-default btn-outline min-w-0 max-w-full text-xs"
    >
      <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{label}</span>
      <ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
    </a>
  )
}

function Quick({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="p-button p-button-default btn-outline text-xs">
      {icon}
      {label}
    </Link>
  );
}
