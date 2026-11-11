"use client";

import { Edit3,LoaderCircle,Save,Trash2,X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState,useTransition } from "react";

import { deleteWikiPageAction,patchWikiPageAction,renameWikiPageAction } from "@/app/actions";
import type { WikiPage } from "@/lib/types";
import { WikiView,wikiBacklinks } from "./wiki-view";

export function WikiPageClient({ page, pages = [] }: { page: WikiPage; pages?: WikiPage[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(page.body);
  const [title, setTitle] = useState(page.title);
  const [tags, setTags] = useState((page.tags || []).join(", "));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const backlinks = wikiBacklinks(pages, page.slug);

  useEffect(() => {
    if (editing) return;
    setBody(page.body);
    setTitle(page.title);
    setTags((page.tags || []).join(", "));
  }, [editing, page]);

  const cancel = () => {
    setBody(page.body);
    setTitle(page.title);
    setTags((page.tags || []).join(", "));
    setError(null);
    setEditing(false);
  };

  const save = () => {
    if (!page.stateHash) {
      setError("This page needs a fresh load before it can be saved.");
      return;
    }
    if (!title.trim()) {
      setError("A wiki page needs a title.");
      return;
    }
    const parsedTags = Array.from(new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean)));
    setError(null);
    startTransition(async () => {
      try {
        await patchWikiPageAction(page.projectId, page.slug, page.stateHash!, body, {
          title: title.trim(),
          tags: parsedTags,
        });
        setEditing(false);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2_500);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not save this wiki page.");
      }
    });
  };

  const rename = () => {
    const next = window.prompt("New slug", page.slug)?.trim();
    if (!next || next === page.slug) return;
    startTransition(async () => {
      try {
        if (!page.stateHash) throw new Error("This page needs a fresh load before it can be renamed.");
        const renamed = await renameWikiPageAction(page.projectId, page.slug, next, page.stateHash);
        router.replace(`/p/${page.projectId}/wiki/${renamed.slug}`);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not rename this wiki page.");
      }
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this wiki page?")) return;
    startTransition(async () => {
      try {
        if (!page.stateHash) throw new Error("This page needs a fresh load before it can be deleted.");
        await deleteWikiPageAction(page.projectId, page.slug, page.stateHash);
        router.push(`/p/${page.projectId}/wiki`);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not delete this wiki page.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-muted" role="status">Read-only supporting notes</span>
        {saved && <span className="text-xs text-ok">Saved</span>}
        {editing ? (
          <>
            <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={cancel} disabled={pending}>
              <X size={13} /> Cancel
            </button>
            <button type="button" className="p-button p-button-primary btn-primary text-xs" onClick={save} disabled={pending}>
              {pending ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </>
        ) : (
          <>
            <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={rename} disabled title="Wiki editing is currently unavailable">Rename</button>
            <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={remove} disabled title="Wiki editing is currently unavailable">
              <Trash2 size={13} /> Delete
            </button>
            <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={() => setEditing(true)} disabled title="Wiki editing is currently unavailable">
              <Edit3 size={13} /> Edit
            </button>
          </>
        )}
      </div>

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="block text-xs text-muted">
            Title
            <input className="p-field input mt-1 !w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block text-xs text-muted">
            Markdown
            <textarea
              className="p-field input mt-1 min-h-[28rem] !w-full resize-y font-mono text-xs leading-5"
              rows={18}
              value={body}
              spellCheck={false}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-xs text-muted">Details</summary>
            <label className="mt-2 block text-xs text-muted">
              Tags
              <input className="p-field input mt-1 !w-full" value={tags} placeholder="methods, evaluation" onChange={(event) => setTags(event.target.value)} />
            </label>
          </details>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        </form>
      ) : (
        <>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <WikiView page={page} />
        </>
      )}

      <section className="border-t border-line pt-4">
        <h2 className="text-sm font-semibold">Backlinks</h2>
        {backlinks.length === 0 ? (
          <p className="mt-1 text-xs text-faint">No other wiki pages link here.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {backlinks.map((item) => (
              <li key={item.slug}>
                <Link className="text-accent hover:underline" href={`/p/${page.projectId}/wiki/${item.slug}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
