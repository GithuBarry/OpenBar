"use client";

import Link from "next/link";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, Check, ChevronDown, ChevronsUpDown } from "lucide-react";

import { MenuSurface } from "@/components/pop";
import { CreateProjectButton } from "@/components/project/create-project";
import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProjectSwitcher({
  projects,
  activeSlug,
  allowCreate = true,
}: {
  projects: Project[];
  activeSlug?: string;
  allowCreate?: boolean;
}) {
  const active = projects.find((p) => p.slug === activeSlug);
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const archivedProjects = projects.filter((project) => project.archivedAt);
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  return (
    <DropdownMenu.Root onOpenChange={(open) => { if (!open) setArchiveExpanded(false); }}>
      <DropdownMenu.Trigger asChild>
      <button
        type="button"
        aria-label="Choose project"
        className="ob-press flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-3"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-base">
          {active?.icon ?? "🧪"}
        </span>
        <span className="flex-1 truncate font-semibold">
          {active ? active.title : "All projects"}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-faint" />
      </button>
      </DropdownMenu.Trigger>

      <MenuSurface align="start" className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto p-1.5">
        {activeProjects.map((project) => <ProjectItem key={project.slug} project={project} activeSlug={activeSlug} />)}
        {archivedProjects.length > 0 && (
          <>
            <DropdownMenu.Separator className="my-1 border-t border-line" />
            <DropdownMenu.Item
              className="ob-menu-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted"
              aria-expanded={archiveExpanded}
              onSelect={(event) => { event.preventDefault(); setArchiveExpanded((expanded) => !expanded); }}
            >
              <Archive size={16} aria-hidden="true" />
              <span className="flex-1">Archived ({archivedProjects.length})</span>
              <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", archiveExpanded && "rotate-180")} />
            </DropdownMenu.Item>
            {archiveExpanded && archivedProjects.map((project) => <ProjectItem key={project.slug} project={project} activeSlug={activeSlug} />)}
          </>
        )}
        {allowCreate && (
          <div className="mt-1 border-t border-line pt-1">
            <CreateProjectButton compact trigger={<DropdownMenu.Item className="ob-menu-item text-sm" onSelect={event => event.preventDefault()}>New project</DropdownMenu.Item>} />
          </div>
        )}
      </MenuSurface>
    </DropdownMenu.Root>
  );
}

function ProjectItem({ project, activeSlug }: { project: Project; activeSlug?: string }) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={`/p/${project.slug}`}
        aria-current={project.slug === activeSlug ? "page" : undefined}
        className={cn(
          "ob-menu-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors",
          project.slug === activeSlug ? "bg-accent/10 text-ink" : "text-ink",
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-base">
          {project.icon ?? "🧪"}
        </span>
        <span className="flex-1 truncate">{project.title}</span>
        {project.slug === activeSlug && <Check size={14} className="text-accent" />}
      </Link>
    </DropdownMenu.Item>
  );
}
