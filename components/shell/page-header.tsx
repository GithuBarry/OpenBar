"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Edit3, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveProjectAction } from "@/app/actions";
import type { Project } from "@/lib/types";
import { AgentReadyIndicator } from "@/components/shell/agent-ready";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";

export function PageHeader({
  title,
  subtitle,
  location,
  icon,
  actions,
  className,
  sticky = true,
  project,
  readOnlyProject = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  location?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
  project?: Project;
  readOnlyProject?: boolean;
}) {
  const router = useRouter();
  const { writable, setPendingWork } = useProjectWriteSession();
  const projectReadOnly = readOnlyProject || !writable;
  const [editing, setEditing] = useState(false);
  const [projectTitle, setProjectTitle] = useState(project?.title || "");
  const [projectTagline, setProjectTagline] = useState(project?.tagline || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setPendingWork("project-header", editing || saving);
    return () => setPendingWork("project-header", false);
  }, [editing, saving, setPendingWork]);

  useEffect(() => {
    setProjectTitle(project?.title || "");
    setProjectTagline(project?.tagline || "");
    setSaveError(null);
  }, [project]);

  const saveChanges = useCallback(async () => {
    if (!project) return;
    if (projectTitle.trim() === project.title && projectTagline.trim() === project.tagline) {
      setSaveError(null);
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveProjectAction({
        ...project,
        title: projectTitle.trim() || project.title,
        tagline: projectTagline.trim(),
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
      setEditing(false);
    } catch (err) {
      console.error("Failed to save project metadata", err);
      setSaveError(err instanceof Error ? err.message : "Could not save project metadata.");
    } finally {
      setSaving(false);
    }
  }, [project, projectTagline, projectTitle, router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveChanges();
    } else if (e.key === "Escape") {
      setProjectTitle(project?.title || "");
      setProjectTagline(project?.tagline || "");
      setSaveError(null);
      setEditing(false);
    }
  };

  return (
    <header
      className={cn(
        "ob-chrome-header z-10 flex items-center gap-3 px-6 py-3.5",
        sticky && "sticky top-0",
        className,
      )}
    >
      {icon && (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted">
          {icon}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {project && editing ? (
          <div className="flex flex-col gap-1.5 py-0.5">
            <input
              type="text"
              autoFocus
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Project title..."
              className="rounded border border-accent bg-surface px-2 py-1 text-sm font-semibold text-ink outline-none"
            />
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={projectTagline}
                onChange={(e) => setProjectTagline(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Project description / tagline..."
                className="flex-1 rounded border border-accent bg-surface px-2 py-0.5 text-xs text-muted outline-none"
              />
              {projectTagline && (
                <button
                  type="button"
                  onClick={() => setProjectTagline("")}
                  className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink"
                  title="Remove tagline"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {saveError && <p className="text-xs text-danger" role="alert">{saveError}</p>}
            <div className="flex items-center gap-2 pt-0.5 text-xs">
              <button
                type="button"
                onClick={saveChanges}
                disabled={saving}
                className="p-button p-button-primary btn-primary px-2.5 py-0.5 text-xs"
              >
                {saving ? "Saving…" : "Save (Enter)"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectTitle(project.title);
                  setProjectTagline(project.tagline);
                  setSaveError(null);
                  setEditing(false);
                }}
                className="p-button p-button-borderless btn-ghost px-2 py-0.5 text-xs text-muted"
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="flex items-center gap-2">
              <h1 className="ob-project-title ob-brand-font truncate text-base tracking-tight text-ink">
                {project ? projectTitle || project.title : title}
              </h1>
              {project && location && <span className="shrink-0 text-sm text-muted">/ {location}</span>}
              {project && !projectReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setSaveError(null);
                    setEditing(true);
                  }}
                  className="ob-project-edit shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Edit project details"
                  title="Edit project details"
                >
                  <Edit3 size={13} />
                </button>
              )}
              {saved && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-ok">
                  <Check size={12} /> Saved
                </span>
              )}
              {saving && <LoaderCircle size={12} className="animate-spin text-accent" />}
            </div>

            {(project ? projectTagline : subtitle) && (
              <p
                onClick={() => {
                  if (!project || projectReadOnly) return;
                  setSaveError(null);
                  setEditing(true);
                }}
                className={cn(
                  "hidden truncate text-xs text-muted sm:block",
                  project && !projectReadOnly && "cursor-pointer transition-colors hover:text-ink",
                )}
                title={project && !projectReadOnly ? "Click to edit description" : undefined}
              >
                {project ? projectTagline : subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <AgentReadyIndicator />
        {actions}
      </div>
    </header>
  );
}
