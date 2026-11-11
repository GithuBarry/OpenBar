"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { previewBibtexImportAction } from "@/app/actions";
import { Modal } from "@/components/modal";
import type { BibEntry, BibliographyImportResult } from "@/lib/bibtex";
import type { OperationResult } from "@/lib/research/operation-result";

export function BibtexImport({ project, onClose, onImport }: {
  project: string;
  onClose: () => void;
  onImport: (bibtex: string, hash: string, cite: boolean) => Promise<OperationResult<BibliographyImportResult>>;
}) {
  const [bibtex, setBibtex] = useState("");
  const [preview, setPreview] = useState<OperationResult<{ entries: BibEntry[]; hash: string }> | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setError(null);
    setChecking(Boolean(bibtex.trim()));
    if (!bibtex.trim()) return;
    const timer = window.setTimeout(() => {
      void previewBibtexImportAction(project, bibtex).then(result => {
        if (current) setPreview(result);
      }).catch(cause => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not check this BibTeX. Try again.");
      }).finally(() => { if (current) setChecking(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [bibtex, project]);

  const add = async (cite: boolean) => {
    if (!preview?.ok || checking || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onImport(bibtex, preview.value.hash, cite);
      if (result.ok) onClose();
      else setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this reference. Try again.");
    } finally { setBusy(false); }
  };

  return <Modal open onClose={onClose} title="Paste BibTeX" busy={busy} className="w-[36rem]">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display text-xl text-ink">Paste BibTeX</h2>
      <button type="button" className="p-button p-button-ghost btn-ghost p-1" aria-label="Close" disabled={busy} onClick={onClose}><X size={16} /></button>
    </div>
    <p className="mt-2 text-sm text-muted">Google Scholar → Cite → BibTeX → copy, then paste below.</p>
    <label className="sr-only" htmlFor="paper-bibtex-input">BibTeX reference</label>
    <textarea id="paper-bibtex-input" value={bibtex} onChange={event => { setPreview(null); setBibtex(event.target.value); }} disabled={busy}
      rows={9} maxLength={200_000} spellCheck={false} placeholder={'@article{citationKey,\n  title={Paper title},\n  author={Author},\n  year={2026}\n}'}
      className="mt-4 w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-xs text-ink outline-none focus:border-accent" />
    <div className="mt-3 text-sm" aria-live="polite">
      {checking && <p className="flex items-center gap-2 text-muted"><LoaderCircle size={14} className="animate-spin" />Checking reference…</p>}
      {preview?.ok && <ul className="max-h-36 space-y-2 overflow-y-auto">{preview.value.entries.map(entry => <li key={entry.key}>
        <span className="font-mono text-xs text-accent">{entry.key}</span>
        <span className="ml-2 text-ink">{entry.fields.title || "Untitled reference"}</span>
      </li>)}</ul>}
      {(error || (preview && !preview.ok && preview.message)) && <p role="alert" className="text-danger">{error || (preview && !preview.ok ? preview.message : "")}</p>}
    </div>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className="p-button p-button-ghost btn-ghost text-xs" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="p-button p-button-default btn-outline text-xs" disabled={busy || checking || !preview?.ok} onClick={() => void add(false)}>Add reference</button>
      <button type="button" className="p-button p-button-primary btn-primary text-xs" disabled={busy || checking || !preview?.ok} onClick={() => void add(true)}>
        {busy && <LoaderCircle size={14} className="animate-spin" />}Add and cite
      </button>
    </div>
  </Modal>;
}
