"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { FastTooltip } from "@/components/fast-tooltip";
import styles from "./sidebar.module.css";
import { PanelLeft, PanelLeftClose, LockKeyhole, LockKeyholeOpen } from "lucide-react";

import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkspaceMark } from "@/components/workspace-mark";
import { ProjectSwitcher } from "./project-switcher";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { ResetDemoButton } from "@/components/demo/reset-demo-button";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { AgentReadyIndicator } from "./agent-ready";

const STORAGE_KEY = "ob-sidebar";

/**
 * Left rail on project pages. Hidden state is local to this browser
 * (localStorage) and defaults to closed.
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
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const { writable, canRelease, release, restore, canRestore, accessMessage } = useProjectWriteSession();

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px)");
    const applyViewport = () => {
      let desktopOpen = false;
      try { desktopOpen = window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* The collapsed rail remains available. */ }
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
        { href: `${base}/wiki`, label: "Wiki", icon: "notes" as const },
        ...(!publicDemo ? [{ href: `${base}/instructions`, label: "Instructions", icon: "instructions" as const, group: "more" as const }] : []),
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
            <div className="flex items-center gap-2"><AgentReadyIndicator /><ThemeToggle /></div>
          </div>
          {publicDemo && activeSlug && <div className="mt-3"><ResetDemoButton slug={activeSlug} /></div>}
          {!publicDemo && writable && <button type="button" className="mt-3 text-xs text-muted disabled:opacity-50" disabled={!canRelease} onClick={() => { void release(); }}>Release editing access</button>}
          {!publicDemo && !writable && <div className="mt-3 text-xs text-muted"><button type="button" className="text-accent disabled:opacity-50" disabled={!canRestore} onClick={restore}>Restore editing access</button>{!canRestore && <span className="block mt-1" role="status">{accessMessage}</span>}</div>}
        </div>
  </>;
  return (
    <Dialog.Root open={narrow && open} onOpenChange={changeOpen}>
      {(!open || narrow) && (
        <nav className={cn("p-glass-sm", styles.collapsedRail)} aria-label="Project navigation">
          <FastTooltip label="All projects"><Link href="/" aria-label={`${workspaceName} home`} className={styles.collapsedLogo}><WorkspaceMark compact /></Link></FastTooltip>
          <FastTooltip label="Show sidebar"><Dialog.Trigger asChild><button type="button" aria-label="Show sidebar" onClick={() => changeOpen(true)}><PanelLeft size={18} aria-hidden="true" /></button></Dialog.Trigger></FastTooltip>
          {active && <SidebarNav items={nav} compact />}
          {!publicDemo && writable && <FastTooltip label={canRelease ? "Release editing access" : "Finish saving before releasing editing access"}><button type="button" aria-label="Release editing access" disabled={!canRelease} onClick={() => { void release(); }}><LockKeyholeOpen size={18} /></button></FastTooltip>}
          {!publicDemo && !writable && <FastTooltip label={canRestore ? "Restore editing access" : accessMessage}><button type="button" aria-label="Restore editing access" title={canRestore ? "Restore editing access" : accessMessage} disabled={!canRestore} onClick={restore}><LockKeyhole size={18} /></button></FastTooltip>}
          <div className="mt-auto"><AgentReadyIndicator /></div>
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
