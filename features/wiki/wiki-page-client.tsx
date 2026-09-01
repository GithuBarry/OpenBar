"use client";

import { useEffect, useState, useTransition } from "react";
import { Edit3, LoaderCircle, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { patchWikiPageAction } from "@/app/actions";
import { documentWebMcpActions, sharedWebMcpActions } from "@/features/webmcp-actions";
import { isArtifactKind } from "@/lib/research/artifact-link";
import { safeUrl } from "@/lib/safe-url";
import type { ArtifactRef, WikiPage } from "@/lib/types";

import { useWikiWebMcp } from "./use-wiki-webmcp";
import { WikiView } from "./wiki-view";

function refsToText(refs: ArtifactRef[]): string {
  return refs.map((ref) => [ref.kind, ref.id, ref.label || "", ref.url || ""].join(" | ")).join("\n");
}

function parseRefs(source: string): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [rawKind, rawId, rawLabel, rawUrl, ...extra] = line.split("|").map((part) => part.trim());
    if (extra.length || !rawKind || !rawId || !isArtifactKind(rawKind)) {
      throw new Error(`Reference ${index + 1} needs “kind | id | optional label | optional URL”.`);
    }
    if (rawUrl && !safeUrl(rawUrl)) throw new Error(`Reference ${index + 1} has an invalid URL.`);
    const key = `${rawKind}:${rawId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      kind: rawKind,
      id: rawId,
      ...(rawLabel ? { label: rawLabel } : {}),
      ...(rawUrl ? { url: rawUrl } : {}),
    });
  }
  return refs;
}

export function WikiPageClient({ page, tex }: { page: WikiPage; tex: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(tex);
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary);
  const [tags, setTags] = useState(page.tags.join(", "));
  const [refs, setRefs] = useState(refsToText(page.refs));
  const [pinnedForAgents, setPinnedForAgents] = useState(Boolean(page.pinnedForAgents));
  const [htmlMode, setHtmlMode] = useState(page.htmlMode || "static");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useWikiWebMcp({
    project: page.projectId,
    kind: "wiki",
    documentId: page.slug,
    actions: documentWebMcpActions,
    sharedActions: sharedWebMcpActions,
    refresh: () => router.refresh(),
    navigate: (href) => router.push(href),
    current: () => ({
      kind: "wiki",
      href: `/p/${page.projectId}/wiki/${page.slug}`,
      pageId: page.slug,
    }),
  });

  useEffect(() => {
    if (editing) return;
    setBody(tex);
    setTitle(page.title);
    setSummary(page.summary);
    setTags(page.tags.join(", "));
    setRefs(refsToText(page.refs));
    setPinnedForAgents(Boolean(page.pinnedForAgents));
    setHtmlMode(page.htmlMode || "static");
  }, [editing, page, tex]);

  const cancel = () => {
    setBody(tex);
    setTitle(page.title);
    setSummary(page.summary);
    setTags(page.tags.join(", "));
    setRefs(refsToText(page.refs));
    setPinnedForAgents(Boolean(page.pinnedForAgents));
    setHtmlMode(page.htmlMode || "static");
    setError(null);
    setEditing(false);
  };

  const save = () => {
    if (!page.stateHash) {
      setError("This page needs a fresh load before it can be saved.");
      return;
    }
    let parsedRefs: ArtifactRef[];
    try {
      parsedRefs = parseRefs(refs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const parsedTags = Array.from(new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean)));
    if (!title.trim()) {
      setError("A wiki page needs a title.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await patchWikiPageAction(page.projectId, page.slug, page.stateHash!, body, {
          title: title.trim(),
          summary: summary.trim(),
          tags: parsedTags,
          refs: parsedRefs,
          pinnedForAgents,
          ...(page.format === "html" ? { htmlMode } : {}),
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && <span className="text-xs text-m-final">Saved</span>}
        {editing ? (
          <>
            <button type="button" className="btn-outline text-xs" title="Discard these changes" onClick={cancel} disabled={pending}>
              <X size={13} /> Cancel
            </button>
            <button type="button" className="btn-primary text-xs" title="Save the source and metadata together" onClick={save} disabled={pending}>
              {pending ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
          </>
        ) : (
          <button type="button" className="btn-outline text-xs" title="Edit this wiki page and its research metadata" onClick={() => setEditing(true)}>
            <Edit3 size={13} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <form
          className="space-y-3 rounded-xl border border-line bg-surface/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Title
              <input className="input mt-1 !w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="text-xs text-muted">
              Tags
              <input className="input mt-1 !w-full" value={tags} placeholder="methods, evaluation" onChange={(event) => setTags(event.target.value)} />
            </label>
          </div>
          <label className="block text-xs text-muted">
            Summary
            <textarea className="input mt-1 min-h-20 !w-full resize-y" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label className="block text-xs text-muted">
            References
            <textarea
              className="input mt-1 min-h-20 !w-full resize-y font-mono text-xs"
              rows={3}
              value={refs}
              placeholder="wiki-page | methods | Methods notes\nweb | https://example.org | Source | https://example.org"
              onChange={(event) => setRefs(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-faint">One reference per line: kind | id | optional label | optional URL.</span>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={pinnedForAgents} onChange={(event) => setPinnedForAgents(event.target.checked)} />
              Include in agent context
            </label>
            {page.format === "html" && (
              <label className="flex items-center gap-2 text-xs text-muted">
                HTML mode
                <select className="input h-8 !w-auto py-0 text-xs" value={htmlMode} onChange={(event) => setHtmlMode(event.target.value as "static" | "interactive")}>
                  <option value="static">Static</option>
                  <option value="interactive">Interactive</option>
                </select>
              </label>
            )}
          </div>
          <label className="block text-xs text-muted">
            {page.format === "html" ? "HTML source" : page.format === "markdown" ? "Markdown source" : "TeX source"}
            <textarea
              className="input mt-1 min-h-[28rem] !w-full resize-y font-mono text-xs leading-5"
              rows={18}
              value={body}
              spellCheck={false}
              onChange={(event) => setBody(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-faint">Source stays in its current format. Preview rendering updates after the atomic save.</span>
          </label>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        </form>
      ) : (
        <>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <WikiView page={page} tex={tex} />
        </>
      )}
    </div>
  );
}
