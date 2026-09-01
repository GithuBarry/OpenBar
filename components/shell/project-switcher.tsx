"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Pop } from "@/components/pop";
import { CreateProjectButton } from "@/components/project/create-project";
import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<Project["status"], string> = {
  active: "bg-ok",
  incubating: "bg-m-hypo",
  submitted: "bg-accent",
  paused: "bg-warn",
  archived: "bg-faint",
};

export function ProjectSwitcher({
  projects,
  activeSlug,
}: {
  projects: Project[];
  activeSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = projects.find((p) => p.slug === activeSlug);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <Pop open={open} origin="tl" className="absolute left-0 right-0 top-full z-50 mt-1.5 p-1.5">
        {projects.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => {
              setOpen(false);
              router.push(`/p/${p.slug}`);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2",
              p.slug === activeSlug ? "bg-accent/10 text-accent font-semibold" : "text-ink",
            )}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface text-base">
              {p.icon ?? <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[p.status])} />}
            </span>
            <span className="flex-1 truncate">{p.title}</span>
            {p.slug === activeSlug && <Check size={14} className="text-accent" />}
          </button>
        ))}
        <div className="mt-1 border-t border-line pt-1">
          <CreateProjectButton compact className="w-full [&>button]:w-full [&>button]:justify-center" />
        </div>
      </Pop>
    </div>
  );
}
