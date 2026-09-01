"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitBranch, PanelLeft, PanelLeftClose } from "lucide-react";

import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProjectSwitcher } from "./project-switcher";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";

const STORAGE_KEY = "ob-sidebar";

/**
 * Left rail on project pages. Hidden state is local to this browser
 * (localStorage) and defaults to closed on small screens.
 */
export function Sidebar({
  projects,
  activeSlug,
  workspaceName = "OpenBarry",
}: {
  projects: Project[];
  activeSlug?: string;
  workspaceName?: string;
}) {
  const active = projects.find((p) => p.slug === activeSlug);
  const base = active ? `/p/${active.slug}` : "";
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "0") setOpen(false);
    else if (stored === "1") setOpen(true);
    else setOpen(window.innerWidth >= 768);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  }, [open, ready]);

  const nav = active
    ? [
        { href: `${base}/paper`, label: "Draft", icon: "drafts" as const },
        { href: `${base}/mindmap`, label: "Mindmap", icon: "mindmap" as const },
        { href: `${base}/wiki`, label: "LLM Wiki", icon: "notes" as const },
      ]
    : [
        { href: "/", label: "All projects", icon: "overview" as const, exact: true },
      ];

  return (
    <>
      {ready && !open && (
        <button
          type="button"
          className="ob-press fixed left-2 top-3 z-30 grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-muted shadow-xs hover:text-ink"
          aria-label="Show sidebar"
          title="Show sidebar"
          onClick={() => setOpen(true)}
        >
          <PanelLeft size={16} />
        </button>
      )}
      <aside
        className={cn(
          "ob-sidebar h-screen w-[248px] shrink-0 flex-col",
          ready ? (open ? "flex" : "hidden") : "hidden md:flex",
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
              <GitBranch size={16} />
            </span>
            <span className="truncate">{workspaceName}</span>
          </Link>
          <button
            type="button"
            className="ob-press grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
            aria-label="Hide sidebar"
            title="Hide sidebar"
            onClick={() => setOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="px-3 pb-2">
          <ProjectSwitcher projects={projects} activeSlug={activeSlug} />
        </div>

        <SidebarNav items={nav} />

        <div className="mt-auto border-t border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-xs text-muted hover:text-ink">All projects</Link>
              <Link href="/about" className="text-xs text-muted hover:text-ink">About</Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
