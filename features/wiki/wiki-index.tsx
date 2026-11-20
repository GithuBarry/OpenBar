"use client";

import { FileText,LoaderCircle,Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { saveWikiAction } from "@/app/actions";
import { WikiPage } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

function snippet(body: string): string {
  const paragraph = body.replace(/^#+\s.*$/m, "").trim().split(/\n\n+/)[0] || "";
  return paragraph.replace(/[#*_`]/g, "").trim().slice(0, 220);
}

export function WikiIndex({ slug, pages }: { slug: string; pages: WikiPage[] }) {
  const router = useRouter();
  const { writable } = useProjectWriteSession();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const baseSlug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
    const existingSlugs = new Set(pages.map((page) => page.slug));
    let pageSlug = baseSlug;
    let suffix = 2;
    while (existingSlugs.has(pageSlug)) {
      pageSlug = `${baseSlug}-${suffix++}`;
    }
    try {
      await saveWikiAction({
        projectId: slug,
        slug: pageSlug,
        title: title.trim(),
        body: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setTitle("");
      setOpen(false);
      router.push(`/p/${slug}/wiki/${pageSlug}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the wiki page.");
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...pages]
    .filter((page) => {
      const hay = `${page.title}\n${page.body}`.toLowerCase();
      return !query.trim() || hay.includes(query.trim().toLowerCase());
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pages.length > 0 && (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages"
            className="p-field input h-8 min-w-0 !w-full flex-1 sm:!w-56 sm:flex-none text-sm"
            aria-label="Search wiki pages"
          />
        )}
        {open ? (
          <form onSubmit={(event) => void onCreate(event)} className="flex items-center gap-2">
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Page title"
              className="p-field input h-8 w-56 text-sm"
            />
            <button type="submit" className="p-button p-button-primary btn-primary text-xs" disabled={saving || !title.trim()}>
              {saving ? <LoaderCircle size={12} className="animate-spin" /> : "Create"}
            </button>
            <button type="button" className="p-button p-button-borderless btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="p-button p-button-default btn-outline text-xs" disabled={!writable} onClick={() => setOpen(true)} title={writable ? "Create a wiki note or experiment log" : "Resume editing to create a wiki page"}>
            <Plus size={12} /> New page
          </button>
        )}
      </div>
      <p className="text-xs text-muted" role="status">
        Supporting lab notes, experiment logs, and protocols. Actionable manuscript work belongs in paper TODOs.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      {!pages.length && !open && (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-sm text-faint">
          Optional supporting notes. Actionable work belongs in paper TODOs.
        </div>
      )}
      {pages.length > 0 && sorted.length === 0 && (
        <p className="text-sm text-faint">No pages match that search.</p>
      )}
      {sorted.length > 0 && (
        <div className="wiki-grid">
          {sorted.map((page) => (
            <Link key={page.slug} href={`/p/${slug}/wiki/${page.slug}`} className="wiki-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="line-clamp-2 font-medium">{page.title}</div>
                  {snippet(page.body) && <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted">{snippet(page.body)}</p>}
                </div>
                <FileText size={17} className="shrink-0 text-muted" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                {(page.tags || []).slice(0, 3).map((tag) => <span key={tag} className="chip text-[10px]">#{tag}</span>)}
                <span>updated {relativeTime(page.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
