"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { FastTooltip } from "@/components/fast-tooltip";
import styles from "./sidebar.module.css";
import { Home, PanelLeft, PanelLeftClose, LockKeyhole, LockKeyholeOpen } from "lucide-react";

import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkspaceMark } from "@/components/workspace-mark";
import { ProjectSwitcher } from "./project-switcher";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { ResetDemoButton } from "@/components/demo/reset-demo-button";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { SleepZzz } from "@/components/save-sync-status";
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
  viewOnly = false,
}: {
  projects: Project[];
  activeSlug?: string;
  workspaceName?: string;
  workspaceTagline?: string;
  publicDemo?: boolean;
  viewOnly?: boolean;
}) {
  const active = projects.find((p) => p.slug === activeSlug);
  const base = active ? `/p/${active.slug}` : "";
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const { writable, canRelease, release, restore, canRestore, sleeping, accessMessage } = useProjectWriteSession();

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1023px)");
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
    if (next !== open && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const captured = new Map<string, DOMRect>();
      for (const el of document.querySelectorAll<HTMLElement>("[data-sidebar-flip]")) {
        const key = el.dataset.sidebarFlip;
        if (!key) continue;
        const target = key === "logo" ? el.querySelector<HTMLElement>(".ob-workspace-mark-tile") || el : el;
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) captured.set(key, rect);
      }
      flipRectsRef.current = captured;
    }
    setOpen(next);
    if (!window.matchMedia("(max-width: 1023px)").matches) {
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* The sidebar still works without persistent storage. */ }
    }
  };

  useLayoutEffect(() => {
    const firstRects = flipRectsRef.current;
    if (!firstRects || !firstRects.size) return;
    flipRectsRef.current = null;
    const moves: Array<{ target: HTMLElement; dx: number; dy: number; midX: number; midY: number; sx: number; sy: number }> = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-sidebar-flip]")) {
      const key = el.dataset.sidebarFlip;
      if (!key) continue;
      const first = firstRects.get(key);
      if (!first) continue;
      const target = key === "logo" ? el.querySelector<HTMLElement>(".ob-workspace-mark-tile") || el : el;
      const last = target.getBoundingClientRect();
      if (last.width === 0 || last.height === 0) continue;
      const dx = first.left + first.width / 2 - (last.left + last.width / 2);
      const dy = first.top + first.height / 2 - (last.top + last.height / 2);
      const sx = key === "logo" ? first.width / last.width : 1;
      const sy = key === "logo" ? first.height / last.height : 1;
      const dist = Math.hypot(dx, dy);
      if (dist < 1.5 && Math.abs(sx - 1) < 0.02) continue;
      // Only apply a subtle curve on diagonal travel; axis-aligned moves stay strictly on their axis.
      const diagonal = Math.min(Math.abs(dx), Math.abs(dy));
      const bow = diagonal > 12 ? Math.min(8, diagonal * 0.14) : 0;
      const nx = dist > 0 ? dy / dist : 0;
      const ny = dist > 0 ? -dx / dist : 0;
      const midX = dx * 0.5 + nx * bow;
      const midY = dy * 0.5 + ny * bow;
      // Hold at starting position & size through the layout/reflow frame.
      target.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
      moves.push({ target, dx, dy, midX, midY, sx, sy });
    }
    if (!moves.length) return;
    const frame = requestAnimationFrame(() => {
      for (const { target, dx, dy, midX, midY, sx, sy } of moves) {
        const midSx = (sx + 1) * 0.5;
        const midSy = (sy + 1) * 0.5;
        target.style.transform = "";
        target.animate(
          [
            { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`, offset: 0 },
            { transform: `translate3d(${midX}px, ${midY}px, 0) scale(${midSx}, ${midSy})`, offset: 0.5 },
            { transform: "translate3d(0, 0, 0) scale(1, 1)", offset: 1 },
          ],
          { duration: 340, easing: "cubic-bezier(0.35, 0, 0.2, 1)" },
        );
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const { target } of moves) target.style.transform = "";
    };
  }, [open]);

  const nav = active
    ? [
        { href: `${base}/paper`, label: "Paper", icon: "drafts" as const },
        { href: `${base}/mindmap`, label: "Mindmap", icon: "mindmap" as const },
        ...(!publicDemo && !viewOnly ? [{ href: `${base}/markdown`, label: "Markdown", icon: "notes" as const, group: "more" as const }] : []),
        { href: `${base}/wiki`, label: "Wiki", icon: "notes" as const },
        ...(!publicDemo && !viewOnly ? [{ href: `${base}/instructions`, label: "Instructions", icon: "instructions" as const, group: "more" as const }] : []),
      ]
    : [
        { href: "/", label: "All projects", icon: "overview" as const, exact: true },
      ];

  const content = <>
        <div className="flex min-h-16 items-center gap-2 px-3 py-3">
          <div data-sidebar-flip="logo" className="min-w-0 flex-1">
            <WorkspaceMark
              name={workspaceName}
              tagline={workspaceTagline}
              compactTagline="Serving Draft"
              compact
              className="min-w-0"
            />
          </div>
          <FastTooltip label="Hide sidebar"><button
            type="button"
            data-sidebar-flip="toggle"
            className="ob-press grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
            aria-label="Hide sidebar"
            onClick={() => changeOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button></FastTooltip>
        </div>

        <div className="px-3 pb-2">
          <ProjectSwitcher projects={projects} activeSlug={activeSlug} allowCreate={!publicDemo && !viewOnly} expanded={open} />
        </div>

        <SidebarNav items={nav} />

        <div className="mt-auto border-t border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 whitespace-nowrap">
              <Link href="/" className="text-xs text-muted hover:text-ink">All projects</Link>
              <Link href="/about" className="text-xs text-muted hover:text-ink">About</Link>
            </div>
            <div className="flex shrink-0 items-center gap-2">{!viewOnly && <span data-sidebar-flip="agent" className="inline-flex"><AgentReadyIndicator /></span>}<ThemeToggle compact /></div>
          </div>
          {publicDemo && activeSlug && <div className="mt-3"><ResetDemoButton slug={activeSlug} /></div>}
          {!publicDemo && writable && <button type="button" className="mt-3 text-xs text-muted disabled:opacity-50" disabled={!canRelease} onClick={() => { void release(); }}>Release editing access</button>}
          {viewOnly && <p className="mt-3 text-xs text-muted" role="status">View only</p>}
          {!publicDemo && !viewOnly && !writable && <div className="mt-3 text-xs text-muted"><button type="button" className="text-accent disabled:opacity-50" disabled={!canRestore} onClick={restore}>Restore editing access</button>{!canRestore && <span className="block mt-1" role="status">{accessMessage}</span>}</div>}
        </div>
  </>;
  return (
    <Dialog.Root open={narrow && open} onOpenChange={changeOpen}>
      {(!open || narrow) && (
        <nav className={cn("p-glass-sm", styles.collapsedRail)} aria-label="Project navigation">
          <FastTooltip label="All projects"><Link href="/" aria-label={`${workspaceName} home`} data-sidebar-flip="logo" className={styles.collapsedLogo}><span className={styles.collapsedLogoMark}><WorkspaceMark compact /></span><span className={styles.collapsedLogoHome} aria-hidden="true"><Home size={18} /></span></Link></FastTooltip>
          {active && <ProjectSwitcher projects={projects} activeSlug={activeSlug} allowCreate={!publicDemo && !viewOnly} compact />}
          <FastTooltip label="Show sidebar"><Dialog.Trigger asChild><button type="button" data-sidebar-flip="toggle" aria-label="Show sidebar" onClick={() => changeOpen(true)}><PanelLeft size={18} aria-hidden="true" /></button></Dialog.Trigger></FastTooltip>
          {active && <SidebarNav items={nav} compact />}
          {!publicDemo && writable && <FastTooltip label={canRelease ? "Release editing access" : "Finish saving before releasing editing access"}><button type="button" aria-label="Release editing access" disabled={!canRelease} onClick={() => { void release(); }}><LockKeyholeOpen size={18} /></button></FastTooltip>}
          {!publicDemo && !viewOnly && !writable && <FastTooltip label={canRestore ? "Restore editing access" : accessMessage}><button type="button" aria-label="Restore editing access" disabled={!canRestore} onClick={restore}>{sleeping ? <SleepZzz size={18} /> : <LockKeyhole size={18} />}</button></FastTooltip>}
          <div className="mt-auto">{viewOnly ? <FastTooltip label="View only"><span aria-label="View only"><LockKeyhole size={18} /></span></FastTooltip> : <span data-sidebar-flip="agent" className="inline-flex"><AgentReadyIndicator /></span>}</div>
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
