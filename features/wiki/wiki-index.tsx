"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpenText, Database, FileText, Link2, LoaderCircle, Plus, Sparkles } from "lucide-react";

import { saveWikiAction } from "@/app/actions";
import { WikiPage } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export function WikiIndex({ slug, pages }: { slug: string; pages: WikiPage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const pageSlug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
    try {
      await saveWikiAction({
        projectId: slug,
        slug: pageSlug,
        title: title.trim(),
        summary: "",
        body: "Replace this page with sourced notes.",
        tags: [],
        refs: [],
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

  const sorted = [...pages].sort((a, b) => Number(b.pinnedForAgents ?? false) - Number(a.pinnedForAgents ?? false) || a.title.localeCompare(b.title));
  const pinned = sorted.filter((page) => page.pinnedForAgents);
  const rest = sorted.filter((page) => !page.pinnedForAgents);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        {open ? (
          <form onSubmit={(event) => void onCreate(event)} className="flex items-center gap-2">
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Page title"
              className="input h-8 w-56 text-sm"
            />
            <button type="submit" className="btn-primary text-xs" disabled={saving || !title.trim()}>
              {saving ? <LoaderCircle size={12} className="animate-spin" /> : "Create"}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="btn-outline text-xs" onClick={() => setOpen(true)}>
            <Plus size={12} /> New page
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {!pages.length && !open && (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-sm text-faint">No wiki pages yet.</div>
      )}
      {pinned.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={14} className="text-accent" /> Agent-pinned memory</h2>
          <div className="wiki-grid">
            {pinned.map((page) => <WikiCard key={page.slug} slug={slug} page={page} strong />)}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><BookOpenText size={14} className="text-accent" /> Supporting pages</h2>
          <div className="wiki-grid">
            {rest.map((page) => <WikiCard key={page.slug} slug={slug} page={page} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function WikiCard({ slug, page, strong = false }: { slug: string; page: WikiPage; strong?: boolean }) {
  return (
    <Link href={`/p/${slug}/wiki/${page.slug}`} className={strong ? "wiki-card wiki-card-strong" : "wiki-card"}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 font-medium">{page.title}</div>
          {page.summary && <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted">{page.summary}</p>}
        </div>
        {iconFor(page.slug)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {page.refs.length > 0 && <span className="chip text-[10px]"><Link2 size={9} /> {page.refs.length} refs</span>}
        {page.tags.slice(0, 3).map((tag) => <span key={tag} className="chip text-[10px]">#{tag}</span>)}
        <span>created {relativeTime(page.createdAt)}</span>
        <span>updated {relativeTime(page.updatedAt)}</span>
      </div>
    </Link>
  );
}

function iconFor(slug: string) {
  if (slug.includes("artifact") || slug.includes("evidence")) return <Database size={17} className="shrink-0 text-accent" />;
  return <FileText size={17} className="shrink-0 text-muted" />;
}
