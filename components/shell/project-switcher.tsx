"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown } from "lucide-react";

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

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
      <button
        type="button"
        aria-label="Choose project"
        className="ob-press flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-3"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-base">
          {active?.icon ?? "🧪"}
        </span>
        <span className="flex-1 truncate font-medium">
          {active ? active.title : "All projects"}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-faint" />
      </button>
      </DropdownMenu.Trigger>

      <MenuSurface align="start" className="w-64 p-1.5">
        {projects.map((p) => (
          <DropdownMenu.Item asChild key={p.slug}>
          <Link
            href={`/p/${p.slug}`}
            aria-current={p.slug === activeSlug ? "page" : undefined}
            className={cn(
              "ob-menu-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
              p.slug === activeSlug ? "bg-accent/10 text-accent font-semibold" : "text-ink",
            )}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-base">
              {p.icon ?? "🧪"}
            </span>
            <span className="flex-1 truncate">{p.title}</span>
            {p.slug === activeSlug && <Check size={14} className="text-accent" />}
          </Link>
          </DropdownMenu.Item>
        ))}
        {allowCreate && (
          <div className="mt-1 border-t border-line pt-1">
            <CreateProjectButton compact trigger={<DropdownMenu.Item className="ob-menu-item text-sm" onSelect={event => event.preventDefault()}>New project</DropdownMenu.Item>} />
          </div>
        )}
      </MenuSurface>
    </DropdownMenu.Root>
  );
}
