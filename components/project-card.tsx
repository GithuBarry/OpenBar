"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BookOpenText, Edit3, FileText, Network, Plus, X } from "lucide-react";

import { saveProjectAction } from "@/app/actions";
import type { Project, ProjectMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<Project["status"], string> = {
  active: "active",
  submitted: "submitted",
  incubating: "incubating",
  paused: "paused",
  archived: "archived",
};

const MODE_LABEL: Record<string, string> = {
  paper: "paper",
  benchmark: "benchmark",
  "security-attack": "security attack",
  "privacy-audit": "privacy audit",
  rebuttal: "rebuttal",
  exploration: "exploration",
  tooling: "tooling",
  "artifact-release": "artifact release",
};

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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  removable?: boolean;
  onRemove?: () => void;
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
  const [icon, setIcon] = useState(project.icon ?? "");
  const [status, setStatus] = useState(project.status);
  const [mode, setMode] = useState(project.mode ?? "");
  const [venue, setVenue] = useState(project.venue ?? "");
  const [collaborators, setCollaborators] = useState((project.collaborators ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(project.title);
    setTagline(project.tagline);
    setOverview(project.overview);
    setIcon(project.icon ?? "");
    setStatus(project.status);
    setMode(project.mode ?? "");
    setVenue(project.venue ?? "");
    setCollaborators((project.collaborators ?? []).join(", "));
  }, [project]);

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
    persist({
      title: title.trim() || project.title,
      tagline: tagline.trim(),
      overview: overview.trim(),
      icon: icon.trim(),
      status,
      mode: (mode || undefined) as Project["mode"],
      venue: venue.trim(),
      collaborators: collaborators.split(",").map((name) => name.trim()).filter(Boolean),
    });
  };

  const cancel = () => {
    setTitle(project.title);
    setTagline(project.tagline);
    setOverview(project.overview);
    setIcon(project.icon ?? "");
    setStatus(project.status);
    setMode(project.mode ?? "");
    setVenue(project.venue ?? "");
    setCollaborators((project.collaborators ?? []).join(", "));
    setError(null);
    setEditing(false);
  };

  return (
    <article className="card ob-home-card flex flex-col p-5">
      <div className="relative">
      <div
        className={cn("ob-card-face flex flex-col gap-3", editing ? "relative" : "is-away absolute inset-0 overflow-hidden")}
        inert={!editing}
        aria-hidden={!editing}
      >
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <Field id={`project-${project.slug}-icon`} label="Icon" value={icon} onChange={setIcon} placeholder="🧪" />
            <Field id={`project-${project.slug}-title`} label="Title" value={title} onChange={setTitle} placeholder="Project title" />
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
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as Project["status"])} className="input text-sm">
                {(Object.keys(STATUS_LABEL) as Project["status"][]).map((value) => (
                  <option key={value} value={value}>{STATUS_LABEL[value]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className="input text-sm">
                <option value="">None</option>
                {Object.keys(MODE_LABEL).map((value) => (
                  <option key={value} value={value}>{MODE_LABEL[value]}</option>
                ))}
              </select>
            </label>
          </div>
          <Field
            id={`project-${project.slug}-venue`}
            label="Venue"
            value={venue}
            onChange={setVenue}
            placeholder="Target venue"
            removable={Boolean(venue)}
            onRemove={() => setVenue("")}
          />
          <Field
            id={`project-${project.slug}-collaborators`}
            label="Collaborators"
            value={collaborators}
            onChange={setCollaborators}
            placeholder="Comma-separated names"
            removable={Boolean(collaborators)}
            onRemove={() => setCollaborators("")}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveForm} disabled={pending} className="btn-primary px-2.5 py-1 text-xs">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={cancel} className="btn-ghost px-2 py-1 text-xs">
              Cancel
            </button>
          </div>
      </div>
      <div
        className={cn("ob-card-face", editing ? "is-away absolute inset-0 overflow-hidden" : "relative")}
        inert={editing}
        aria-hidden={editing}
      >
          <div className="flex items-start justify-between gap-3">
            <Link href={`/p/${project.slug}/paper`} className="group min-w-0">
              <h2 className="truncate font-serif text-lg font-semibold transition-colors duration-ui group-hover:text-accent">
                <span className="mr-1.5">{project.icon ?? "🧪"}</span>
                {project.title}
              </h2>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <span className="chip text-[11px]">{STATUS_LABEL[project.status] ?? project.status}</span>
              <button
                type="button"
                onClick={() => setEditing(true)}
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
              onClick={() => setEditing(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-muted"
            >
              <Plus size={12} /> Add tagline
            </button>
          )}

          <div className="mt-3 text-xs text-muted">
            <span className="font-mono font-semibold text-ink">{todos}</span> open paper {todos === 1 ? "TODO" : "TODOs"}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5 text-[11px] text-faint">
            {project.venue ? <span className="truncate">{project.venue}</span> : <span>Created {formatDate(project.createdAt)}</span>}
            <span>Edited {formatDate(project.updatedAt)}</span>
          </div>

          <nav className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
            <Quick href={`/p/${project.slug}/paper`} icon={<BookOpenText size={13} />} label="Paper" />
            <Quick href={`/p/${project.slug}/mindmap`} icon={<Network size={13} />} label="Mindmap" />
            <Quick href={`/p/${project.slug}/wiki`} icon={<FileText size={13} />} label="Wiki" />
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
