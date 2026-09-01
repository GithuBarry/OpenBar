"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import { AnchoredPop } from "@/components/pop";
import { cn } from "@/lib/utils";

export type JumpBookmark = {
  title: string;
  slug: string;
  line: number;
  level: number;
};

export type StructureSection = {
  id: string;
  title: string;
  level: number;
  appendix?: boolean;
};

function headingPath(bookmarks: JumpBookmark[], activeIndex: number): JumpBookmark[] {
  const current = bookmarks[activeIndex];
  if (!current) return [];
  const byLevel = new Map<number, JumpBookmark>();
  for (let i = 0; i <= activeIndex; i++) {
    const heading = bookmarks[i]!;
    byLevel.set(heading.level, heading);
    for (const level of [...byLevel.keys()]) {
      if (level > heading.level) byLevel.delete(level);
    }
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, heading]) => heading);
}

export function JumpReel({
  bookmarks,
  activeSlug,
  onJump,
}: {
  bookmarks: JumpBookmark[];
  activeSlug: string;
  onJump: (bookmark: JumpBookmark) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeIndex = useMemo(() => {
    const index = bookmarks.findIndex((bookmark) => bookmark.slug === activeSlug);
    return index >= 0 ? index : 0;
  }, [activeSlug, bookmarks]);

  const path = useMemo(() => headingPath(bookmarks, activeIndex), [bookmarks, activeIndex]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bookmarks;
    return bookmarks.filter((bookmark) => bookmark.title.toLowerCase().includes(needle));
  }, [bookmarks, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  if (path.length === 0) return null;

  return (
    <div ref={rootRef} className="ob-jump">
      <button
        type="button"
        className="ob-jump-strip ob-press"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current location: ${path.map((crumb) => crumb.title).join(" / ")}`}
        title="Jump to section"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ob-jump-path">
          {path.map((crumb, index) => (
            <span key={crumb.slug} className="ob-jump-step">
              {index > 0 ? <span className="ob-jump-sep">/</span> : null}
              <span className={cn("ob-jump-crumb", index === path.length - 1 && "is-here")}>{crumb.title}</span>
            </span>
          ))}
        </span>
        <ChevronDown size={11} className="ob-jump-caret" />
      </button>

      <AnchoredPop open={open} anchorRef={rootRef} origin="tl" onDismiss={() => setOpen(false)} className="ob-jump-menu">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((value) => Math.min(filtered.length - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const bookmark = filtered[highlight];
              if (bookmark) {
                onJump(bookmark);
                setOpen(false);
              }
            }
          }}
          placeholder="Filter sections…"
          className="mb-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-none"
        />
        {filtered.map((bookmark, index) => (
          <button
            key={bookmark.slug}
            type="button"
            role="option"
            aria-selected={index === highlight}
            className={cn("ob-jump-option", index === highlight && "is-current")}
            style={{ paddingLeft: `${0.55 + Math.max(0, bookmark.level - 2) * 0.85}rem` }}
            onClick={() => {
              onJump(bookmark);
              setOpen(false);
            }}
          >
            {bookmark.title}
          </button>
        ))}
        {filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-faint">No matching sections.</div>}
      </AnchoredPop>
    </div>
  );
}

export function FileNavigator({
  files,
  onJump,
}: {
  files: Array<{ id: string; path: string; title: string }>;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  if (!files.length) return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-outline inline-flex h-7 shrink-0 items-center gap-1 px-2 text-[11px]"
        title="Jump to a manuscript file in this scroll"
        onClick={() => setOpen((value) => !value)}
      >
        Files
      </button>
      <AnchoredPop open={open} anchorRef={rootRef} origin="tl" onDismiss={() => setOpen(false)} className="ob-menu ob-menu-wide">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Include graph</div>
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            className="ob-menu-item font-mono text-xs"
            onClick={() => {
              onJump(file.id);
              setOpen(false);
            }}
          >
            {file.path}
            <span className="ml-2 font-sans text-faint">{file.title}</span>
          </button>
        ))}
      </AnchoredPop>
    </div>
  );
}

export function SectionMenu({
  sections,
  onJump,
  onRename,
  onSetLevel,
  onToggleAppendix,
  onAddAfter,
  onRemove,
}: {
  sections: StructureSection[];
  onJump?: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSetLevel: (id: string, level: number) => void;
  onToggleAppendix: (id: string) => void;
  onAddAfter: (id: string, title: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(sections[0]?.id || "");
  const [renameTitle, setRenameTitle] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const active = sections.find((section) => section.id === activeId) || sections[0];

  if (!active) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-outline inline-flex h-7 shrink-0 items-center gap-1 px-2 text-[11px]"
        title="Navigate or edit sections"
        onClick={() => {
          setOpen((value) => !value);
          setRenameTitle(active.title);
          setAddTitle("");
          setConfirmRemove(false);
        }}
      >
        <Settings2 size={11} />
        Sections
      </button>
      <AnchoredPop open={open} anchorRef={rootRef} origin="tl" onDismiss={() => setOpen(false)} className="ob-menu ob-menu-wide">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Document sections</div>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={cn("ob-menu-item text-xs", section.id === active.id && "bg-accent-soft text-accent")}
            onClick={() => {
              setActiveId(section.id);
              onJump?.(section.id);
              setOpen(false);
              setRenameTitle(section.title);
              setConfirmRemove(false);
            }}
          >
            {section.title}
            {section.appendix ? " · appendix" : ""}
          </button>
        ))}
        <div className="mt-1 space-y-2 border-t border-line px-2 py-2">
          <form
            className="flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (renameTitle.trim()) onRename(active.id, renameTitle.trim());
              setOpen(false);
            }}
          >
            <input value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} className="input h-7 flex-1 px-2 py-0 text-xs" />
            <button type="submit" className="btn-outline px-2 py-0.5 text-[11px]">Rename</button>
          </form>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" disabled={active.level <= 2} onClick={() => { onSetLevel(active.id, active.level - 1); setOpen(false); }}>Promote</button>
            <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" disabled={active.level >= 6} onClick={() => { onSetLevel(active.id, active.level + 1); setOpen(false); }}>Demote</button>
            <button type="button" className="btn-outline px-2 py-0.5 text-[11px]" onClick={() => { onToggleAppendix(active.id); setOpen(false); }}>
              {active.appendix ? "Main matter" : "Appendix"}
            </button>
          </div>
          <form
            className="flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (addTitle.trim()) onAddAfter(active.id, addTitle.trim());
              setOpen(false);
            }}
          >
            <input value={addTitle} onChange={(event) => setAddTitle(event.target.value)} placeholder="New section title" className="input h-7 flex-1 px-2 py-0 text-xs" />
            <button type="submit" className="btn-outline px-2 py-0.5 text-[11px]" disabled={!addTitle.trim()}>Add below</button>
          </form>
          {confirmRemove ? (
            <button
              type="button"
              className="btn-outline w-full px-2 py-0.5 text-[11px] text-danger"
              disabled={sections.length <= 1}
              onClick={() => { onRemove(active.id); setOpen(false); }}
            >
              Confirm remove “{active.title}”
            </button>
          ) : (
            <button type="button" className="btn-outline px-2 py-0.5 text-[11px] text-danger" disabled={sections.length <= 1} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
      </AnchoredPop>
    </div>
  );
}
