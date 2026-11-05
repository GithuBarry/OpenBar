"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { FastTooltip } from "@/components/fast-tooltip";
import styles from "./sidebar.module.css";
import { BookOpenText, Network, PanelLeft, PanelLeftClose } from "lucide-react";

import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkspaceMark } from "@/components/workspace-mark";
import { ProjectSwitcher } from "./project-switcher";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { ResetDemoButton } from "@/components/demo/reset-demo-button";

const STORAGE_KEY = "ob-sidebar";

/**
 * Left rail on project pages. Hidden state is local to this browser
 * (localStorage) and defaults to closed on small screens.
 */
export function Sidebar({
  projects,
  activeSlug,
  workspaceName = "OpenBar",
  workspaceTagline = "Pouring the perfect draft.",
  publicDemo = false,
}: {
  projects: Project[];
  activeSlug?: string;
  workspaceName?: string;
  workspaceTagline?: string;
  publicDemo?: boolean;
}) {
  const active = projects.find((p) => p.slug === activeSlug);
  const base = active ? `/p/${active.slug}` : "";
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px)");
    const applyViewport = () => {
      let desktopOpen = true;
      try { desktopOpen = window.localStorage.getItem(STORAGE_KEY) !== "0"; } catch { /* Keep navigation available when storage is restricted. */ }
      setNarrow(narrow.matches);
      setOpen(narrow.matches ? false : desktopOpen);
      setReady(true);
    };
    applyViewport();
    narrow.addEventListener("change", applyViewport);
    return () => narrow.removeEventListener("change", applyViewport);
  }, []);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!window.matchMedia("(max-width: 767px)").matches) {
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* The sidebar still works without persistent storage. */ }
    }
  };

  const nav = active
    ? [
        { href: `${base}/paper`, label: "Paper", icon: "drafts" as const },
        { href: `${base}/mindmap`, label: "Mindmap", icon: "mindmap" as const },
        ...(!publicDemo ? [{ href: `${base}/instructions`, label: "Instructions", icon: "overview" as const, group: "more" as const }] : []),
      ]
    : [
        { href: "/", label: "All projects", icon: "overview" as const, exact: true },
      ];

  const content = <>
        <div className="flex min-h-16 items-center gap-2 px-3 py-3">
          <WorkspaceMark
            name={workspaceName}
            tagline={workspaceTagline}
            compactTagline="Serving Draft"
            compact
            className="min-w-0 flex-1"
          />
          <FastTooltip label="Hide sidebar"><button
            type="button"
            className="ob-press grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
            aria-label="Hide sidebar"
            onClick={() => changeOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button></FastTooltip>
        </div>

        <div className="px-3 pb-2">
          <ProjectSwitcher projects={projects} activeSlug={activeSlug} allowCreate={!publicDemo} />
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
          {publicDemo && activeSlug && <div className="mt-3"><ResetDemoButton slug={activeSlug} /></div>}
        </div>
  </>;
  return (
    <Dialog.Root open={narrow && open} onOpenChange={changeOpen}>
      {ready && (!open || narrow) && (
        <nav className={styles.collapsedRail} aria-label="Project navigation">
          <FastTooltip label="Show sidebar"><Dialog.Trigger asChild><button type="button" aria-label="Show sidebar" onClick={() => changeOpen(true)}><PanelLeft size={18} aria-hidden="true" /></button></Dialog.Trigger></FastTooltip>
          {active && <>
            <FastTooltip label="Paper"><Link href={`${base}/paper`} aria-label="Paper"><BookOpenText size={18} aria-hidden="true" /></Link></FastTooltip>
            <FastTooltip label="Mindmap"><Link href={`${base}/mindmap`} aria-label="Mindmap"><Network size={18} aria-hidden="true" /></Link></FastTooltip>
          </>}
        </nav>
      )}
      {narrow ? (
        <Dialog.Portal>
          <Dialog.Overlay className={styles.backdrop} />
          <Dialog.Content className={cn("p-sidebar p-sidebar-medium ob-sidebar", styles.sidebar, styles.open)} aria-describedby={undefined}
            onClickCapture={(event) => { if ((event.target as HTMLElement).closest("a")) changeOpen(false); }}>
            <Dialog.Title className="sr-only">Project navigation</Dialog.Title>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      ) : (
        <aside className={cn("p-sidebar p-sidebar-medium ob-sidebar", styles.sidebar, ready ? (open ? styles.open : styles.closed) : styles.initial)}>
          {content}
        </aside>
      )}
    </Dialog.Root>
  );
}
