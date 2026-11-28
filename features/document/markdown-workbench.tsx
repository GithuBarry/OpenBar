"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { applyProjectEditsAction, placeTodoOnMindmapAction, updateProjectAction } from "@/app/actions";
import { annotateMarkdownAction, openMarkdownAction, updateMarkdownNoteAction } from "@/app/markdown-actions";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { cleanMarkdownExport, markdownIndex, type MarkdownAnchor } from "@/lib/markdown-manuscript";
import { MarkdownSource } from "./markdown-source";
import { ManuscriptPreview } from "./manuscript-preview";
import { registerProjectFileEditor } from "@/features/project-files-bridge";
import { failResult, okResult } from "@/lib/research/operation-result";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";
import { downloadFile, exportIclrPost } from "./iclr-export";

type Snapshot = Awaited<ReturnType<typeof openMarkdownAction>>;
const button = "btn-ghost rounded px-2 py-1 text-sm disabled:opacity-50";
export function MarkdownWorkbench({ project, initial, primary, rootId }: {
  project: string; initial: Snapshot; primary: boolean; rootId?: string;
}) {
  const router = useRouter();
  const session = useProjectWriteSession();
  const file = initial.post.path;
  const key = `openbar:markdown:${project}:${file}`;
  const [base, setBase] = useState(initial.post);
  const [source, setSource] = useState(initial.post.source);
  const [notes, setNotes] = useState(initial.notes);
  const [cards, setCards] = useState(initial.cards);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<{ id: string; text: string }>();
  const [jump, setJump] = useState<{ at: number }>();
  const selection = useRef(0);
  const annotationPanel = useRef<HTMLDetailsElement>(null);
  const deferred = useDeferredValue(source);
  const index = useMemo(() => markdownIndex(deferred), [deferred]);
  const dirty = source !== base.source;
  const writable = hydrated && session.writable && !busy;
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.source === "string" && typeof draft.base?.source === "string" && draft.base.path === file
          && draft.source !== initial.post.source) {
          setSource(draft.source); setBase(draft.base);
          const stale = draft.base.hash !== initial.post.hash;
          setConflict(stale); setMessage(stale ? "Recovered draft. The saved file also changed." : "Recovered local draft.");
        }
      }
    } catch { setMessage("Local draft storage is unavailable."); }
    setHydrated(true);
    // Restore only on mount; server refreshes must not replace in-flight typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (dirty) localStorage.setItem(key, JSON.stringify({ base, source }));
      else localStorage.removeItem(key);
    } catch { if (dirty) setMessage("Browser recovery storage is full. Save or download the draft."); }
  }, [hydrated, dirty, base, source, key]);
  const setPending = session.setPendingWork;
  useEffect(() => { setPending(key, dirty || busy); return () => setPending(key, false); }, [key, setPending, dirty, busy]);
  const latest = useRef({ dirty, source, base });
  latest.current = { dirty, source, base };
  const refresh = useCallback(async () => {
    const current = latest.current;
    const next = await openMarkdownAction(project, file);
    if (running.current || current.base !== latest.current.base) return;
    setNotes(next.notes); setCards(next.cards);
    if (next.post.hash === current.base.hash) return;
    if (latest.current.dirty) { setConflict(true); setMessage("The saved file changed. Your draft is still here."); }
    else { setBase(next.post); setSource(next.post.source); setConflict(false); }
  }, [project, file]);
  useEffect(() => {
    const focus = () => { void refresh().catch(e => setMessage(String(e))); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  useEffect(() => registerProjectFileEditor(project, async (operation, writing) => {
    if (latest.current.dirty || running.current) return failResult("conflict", "Save the open Markdown draft before reading or editing project files.");
    const result = await operation();
    if (writing && result.ok) await refresh();
    return result;
  }), [project, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void (async () => {
      const context = await waitForModelContext(30_000, controller.signal);
      if (!context || controller.signal.aborted) return;
      const reg = await registerWebMcpToolsIndependent(context, [{
        name: "get_paper_state", title: "Read Markdown manuscript state",
        description: "Return the current Markdown file, headings, anchor IDs, and unsaved-draft status.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
        execute: () => { const p = latest.current; return okResult({ project, rootFile: file, format: "markdown", dirty: p.dirty,
          persistedHash: p.base.hash, ...markdownIndex(p.source) }); },
      }], controller.signal, "paper");
      release = reg.release; if (controller.signal.aborted) release();
    })();
    return () => { controller.abort(); release?.(); };
  }, [project, file]);
  useEffect(() => {
    const follow = () => {
      const id = location.hash.slice(1);
      const a = markdownIndex(latest.current.source).anchors.find(n => n.id === id);
      if (a) setJump({ at: a.from });
      else if (/^md-section-\d+$/.test(id)) {
        const h = markdownIndex(latest.current.source).headings.find(h => `md-section-${h.from}` === id);
        if (h) setJump({ at: h.from });
      }
    };
    if (hydrated) follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [hydrated]);
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try { await fn(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Operation failed"); }
    finally { running.current = false; setBusy(false); }
  }
  function save() {
    if (!writable || conflict) return;
    void run(async () => {
      const r = await applyProjectEditsAction(project, { edits: [{ path: file, content: source, expectedHash: base.hash }] });
      if (!r.ok) { if (r.code === "stale_disk_state") setConflict(true); throw new Error(r.message); }
      setBase({ path: file, source, hash: r.value.files[0]!.hash }); setMessage("Saved.");
    });
  }
  function addNote(kind: MarkdownAnchor["kind"]) {
    if (!writable || conflict || !noteText.trim()) return;
    void run(async () => {
      const result = await annotateMarkdownAction(project, { ...base, source }, selection.current, kind, noteText);
      setBase({ path: file, source: result.source, hash: result.hash }); setSource(result.source); setNoteText("");
      const updated = await openMarkdownAction(project, file);
      setCards(updated.cards); setNotes(updated.notes); setJump({ at: selection.current }); setMessage("Annotation saved.");
    });
  }
  const rawDownload = () => downloadFile(file.split("/").at(-1)!, new TextEncoder().encode(source), "text/markdown");
  const anchoredIds = new Set(index.anchors.map(n => n.id));
  return <div className="mx-auto flex min-h-full max-w-[110rem] flex-col gap-4 px-4 py-3 sm:px-6">
    <header aria-label="Manuscript controls" className="p-glass-sm sticky top-2 z-10 flex w-fit max-w-full flex-wrap items-center gap-2 self-center rounded-2xl px-3 py-1 shadow-sm">
      <strong>Markdown</strong><code className="text-sm">{file}</code>
      <button className={button} onClick={save} disabled={!writable || conflict || (!dirty && base.hash !== null)}>Save</button>
      {!session.writable && session.canRestore && <button className={button} onClick={session.restore}>Resume editing</button>}
      <details className="relative"><summary className={button}>File</summary>
      <div className="absolute right-0 z-20 flex w-52 flex-col rounded-xl border border-line bg-surface p-2 shadow-lg">
      <button className={button} onClick={() => void refresh().catch(e => setMessage(String(e)))} disabled={busy}>Refresh from disk</button>
      <button className={button} onClick={() => void run(async () => {
        if (!initial.projectHash) throw new Error("Reload project metadata.");
        await updateProjectAction(project, { markdownFile: primary ? "" : file, expectedHash: initial.projectHash });
        router.push(`/p/${project}/paper`); router.refresh();
      })} disabled={!writable || dirty || !base.hash}>{primary ? "Use TeX manuscript" : "Use as primary manuscript"}</button>
      <Link href={`/p/${project}/markdown`} className={button}>Open another file</Link>
      </div></details>
      <button className={button} aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>Export</button>
      <span role="status" className="text-sm text-muted">{message || (dirty ? "Unsaved draft" : session.accessMessage)}</span>
    </header>
    {exportOpen && <div className="flex flex-wrap items-center gap-3">
      <button className={button} onClick={() => downloadFile(file.split("/").at(-1)!, new TextEncoder().encode(cleanMarkdownExport(source)), "text/markdown")}>Download publication Markdown</button>
      {file.startsWith("_posts/2027-04-30-") && <button className={button} disabled={busy} onClick={() => void run(() => exportIclrPost(project, file, source))}>Download ICLR submission ZIP</button>}
      <a className="text-accent underline" href="https://iclr-blogposts.github.io/2027/submitting/">Official template preview instructions</a>
      {/^_posts\/2027-04-30-[a-z0-9-]+\.md$/.test(file) && <a className="text-accent underline" href="http://localhost:8080/2027/" target="_blank" rel="noreferrer">Open running Jekyll site ↗</a>}
    </div>}
    {conflict && <section className="rounded border border-line p-2"><b>Saved copy differs.</b>{" "}
      <button className={button} onClick={rawDownload}>Download my draft with IDs</button>
      <button className={button} onClick={() => void run(async () => {
        const next = await openMarkdownAction(project, file);
        setBase(next.post); setSource(next.post.source); setNotes(next.notes); setCards(next.cards); setConflict(false);
        setMessage("Loaded the saved copy.");
      })}>Discard draft and load saved copy</button>
    </section>}
    {writable && base.hash === null && !source && /^_posts\/2027-04-30-[a-z0-9-]+\.md$/.test(file) && <button className={`${button} self-start`} onClick={() => setSource(
      "---\nlayout: distill\ntitle: Your title\ndescription: Your abstract.\ndate: 2027-04-30\nfuture: true\nhtmlwidgets: true\nauthors:\n  - name: Anonymous\ntoc:\n  - name: Introduction\n---\n\n## Introduction\n\n"
    )}>Start with ICLR 2027 front matter</button>}
    <div className="grid min-h-0 gap-4 lg:grid-cols-2">
      <section aria-label="Draft preview" className="min-w-0 overflow-auto lg:max-h-[75vh]"><ManuscriptPreview source={deferred.slice(index.start)} project={project} file={file} note={id => {
        const a = index.anchors.find(n => n.id === id);
        return a && { label: notes.find(n => n.id === id)?.text ?? id, open: () => {
          if (annotationPanel.current) annotationPanel.current.open = true;
          setJump({ at: a.from });
        } };
      }} /></section>
      <section aria-label="Source editor" className="min-w-0 overflow-auto border border-line lg:max-h-[70vh]">
        <MarkdownSource source={source} readOnly={!writable} onChange={s => { setSource(s); setMessage(""); }} onSelection={at => { selection.current = at; }} onSave={save} jump={jump} />
      </section>
    </div>
    <details><summary>Outline ({index.headings.length})</summary><nav>{index.headings.map(h => <button className={button} key={h.from} onClick={() => setJump({ at: h.from })}>{h.title}</button>)}</nav></details>
    <details ref={annotationPanel} className="space-y-2 rounded-xl p-2"><summary>Annotations ({index.anchors.length})</summary>
      <div className="flex flex-wrap gap-2">
        <input className="input p-field grow" aria-label="Annotation text" placeholder="Place the cursor in the source, then write a TODO or comment" maxLength={4000} value={noteText} onChange={e => setNoteText(e.target.value)} />
        {(["todo", "comment"] as const).map(k => <button className={button} key={k} disabled={!writable || conflict || !noteText.trim()} onClick={() => addNote(k)}>Add {k === "todo" ? "TODO" : k}</button>)}
      </div>
      {index.anchors.map(a => {
        const n = notes.find(x => x.id === a.id && x.kind === a.kind);
        const card = cards.find(c => c.todoId === a.id);
        return <div key={a.from} className="flex flex-wrap items-center gap-2">
          <button className={button} onClick={() => setJump({ at: a.from })}>{a.kind === "todo" ? (n?.completed ? "Completed TODO" : "TODO") : "Comment"}</button>
          {n && editingNote?.id === n.id ? <form className="flex gap-2" onSubmit={e => {
            e.preventDefault(); void run(async () => {
              await updateMarkdownNoteAction(project, n, editingNote.text, n.completed);
              setNotes((await openMarkdownAction(project, file)).notes); setEditingNote(undefined);
            });
          }}><input aria-label="Edit annotation text" className="input p-field" value={editingNote.text} onChange={e => setEditingNote({ id: n.id, text: e.target.value })} />
            <button className={button} disabled={!writable}>Save note</button></form>
            : <button className={button} disabled={!writable || !n} onClick={() => n && setEditingNote({ id: n.id, text: n.text })}>{n?.text ?? `Missing record: ${a.id}`}</button>}
          {n?.kind === "todo" && <button className={button} disabled={!writable} onClick={() => void run(async () => {
            await updateMarkdownNoteAction(project, n, n.text, !n.completed); setNotes((await openMarkdownAction(project, file)).notes);
          })}>{n.completed ? "Reopen" : "Complete"}</button>}
          {index.anchors.filter(x => x.id === a.id).length > 1 && <span>Duplicate anchor</span>}
          {card ? <Link className="text-accent underline" href={`/p/${project}/mindmap#${card.id}`}>Open card</Link>
            : a.kind === "todo" && n && rootId && <button className={button} disabled={!writable} onClick={() => void run(async () => {
              const r = await placeTodoOnMindmapAction(project, a.id, rootId);
              if (!r.ok) throw new Error(r.message);
              setCards((await openMarkdownAction(project, file)).cards);
            })}>Place on Primary</button>}
        </div>;
      })}
      {notes.filter(n => n.post === file && !anchoredIds.has(n.id)).map(n => <div key={n.id}>Unanchored {n.kind}: {n.text} <code>{`<!--ob:${n.kind}:${n.id}-->`}</code></div>)}
    </details>
  </div>;
}
