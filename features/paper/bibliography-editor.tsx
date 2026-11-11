"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, LoaderCircle, X } from "lucide-react";
import { ChoiceButtons } from "@/components/choice-buttons";
import { Modal } from "@/components/modal";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { referenceFields, type BibEntry } from "@/lib/bibtex";
import { copyText } from "@/lib/copy-text";
import type { OperationResult } from "@/lib/research/operation-result";
import styles from "./bibliography-editor.module.css";

export type BibliographyFileDocument = {
  text: string;
  hash: string;
  entries: BibEntry[];
};

type FileDraft = BibliographyFileDocument & { draft: string };

export function BibliographyEditor({ open, onClose, paths, readOnly = false, readFile, saveFile }: {
  open: boolean;
  onClose: () => void;
  paths: string[];
  readOnly?: boolean;
  readFile: (path: string) => Promise<OperationResult<BibliographyFileDocument>>;
  saveFile: (path: string, text: string, expectedHash: string) => Promise<OperationResult<BibliographyFileDocument>>;
}) {
  const { setPendingWork } = useProjectWriteSession();
  const [selected, setSelected] = useState("");
  const path = paths.includes(selected) ? selected : paths[0] || "";
  const [mode, setMode] = useState<"reader" | "source">("reader");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<Record<string, FileDraft>>({});
  const filesRef = useRef(files);
  filesRef.current = files;
  const callbacks = useRef({ readFile, saveFile });
  callbacks.current = { readFile, saveFile };
  const loadVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ path: string; message: string; code: string }>();
  const [notice, setNotice] = useState("");
  const file = files[path];
  const dirty = Boolean(file && file.draft !== file.text);
  useEffect(() => {
    setPendingWork("bibliography", saving || Object.values(files).some(file => file.draft !== file.text));
    return () => setPendingWork("bibliography", false);
  }, [files, saving, setPendingWork]);

  const load = useCallback(async (filePath: string, replaceDraft = false) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setFailure(undefined);
    setNotice("");
    try {
      const result = await callbacks.current.readFile(filePath);
      if (version !== loadVersion.current) return;
      if (!result.ok) {
        setFailure({ path: filePath, message: result.message, code: result.code });
        return;
      }
      setFiles(current => {
        const cached = current[filePath];
        if (!replaceDraft && cached && cached.draft !== cached.text) return current;
        return { ...current, [filePath]: { ...result.value, draft: result.value.text } };
      });
    } catch (error) {
      if (version === loadVersion.current) setFailure({ path: filePath, message: error instanceof Error ? error.message : "Could not read this file.", code: "operation_failed" });
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !path) {
      loadVersion.current += 1;
      setLoading(false);
      return;
    }
    const cached = filesRef.current[path];
    if (!cached || cached.draft === cached.text) void load(path);
    else setLoading(false);
    return () => { loadVersion.current += 1; };
  }, [load, open, path]);

  const entries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (file?.entries || []).filter(entry => !search || [entry.key, entry.type, ...Object.values(entry.fields)].join(" ").toLowerCase().includes(search));
  }, [file?.entries, query]);

  async function save() {
    if (!file || !dirty || readOnly || saving || loading) return;
    const filePath = path;
    const draft = file.draft;
    setSaving(true);
    setFailure(undefined);
    setNotice("");
    try {
      const result = await callbacks.current.saveFile(filePath, draft, file.hash);
      if (!result.ok) {
        setFailure({ path: filePath, message: result.message, code: result.code });
        return;
      }
      setFiles(current => ({
        ...current,
        [filePath]: { ...result.value, draft: current[filePath]?.draft === draft ? result.value.text : current[filePath]?.draft ?? result.value.text },
      }));
      setNotice("Saved");
    } catch (error) {
      setFailure({ path: filePath, message: error instanceof Error ? error.message : "Could not save this file.", code: "operation_failed" });
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string) {
    try { await copyText(value); setNotice("Copied"); }
    catch { setNotice("Select the text to copy it."); }
  }

  const error = failure?.path === path ? failure : undefined;
  const conflict = error?.code === "stale_disk_state" || error?.code === "conflict";

  return <Modal open={open} onClose={onClose} busy={saving} title="Bibliography files" className={styles.modal}>
    <div className={styles.header}>
      <h2>Bibliography</h2>
      <button type="button" className="p-button p-button-borderless btn-ghost" aria-label="Close bibliography" disabled={saving} onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </div>
    <select className="p-field input text-sm" aria-label="Bibliography file" value={path} disabled={!paths.length || saving} onChange={event => { setSelected(event.target.value); setFailure(undefined); setNotice(""); setQuery(""); }}>
      {paths.length ? paths.map(filePath => <option key={filePath} value={filePath}>{filePath}</option>) : <option value="">No .bib files</option>}
    </select>
    <div className={styles.tools}>
      <ChoiceButtons<"reader" | "source"> label="Bibliography view" value={mode} options={[{ value: "reader", label: "Reader" }, { value: "source", label: "Source" }]} onChange={setMode} />
      {mode === "reader" && <input type="search" aria-label="Search bibliography" placeholder="Search references…" className="p-field input text-sm" value={query} onChange={event => setQuery(event.target.value)} />}
    </div>
    <div className={styles.body} aria-busy={loading}>
      {loading ? <p className={styles.empty} role="status"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Opening file…</p>
        : mode === "source" && file ? <textarea className={styles.source} aria-label="BibTeX file source" value={file.draft} readOnly={readOnly || saving} spellCheck={false} onChange={event => {
          const draft = event.target.value;
          setFiles(current => ({ ...current, [path]: { ...current[path], draft } }));
          setNotice("");
        }} />
          : <>
            {dirty && <p className={styles.saved}>Saved entries</p>}
            <ul className={styles.entries}>{entries.map(entry => {
              const fields = referenceFields(entry);
              return <li key={entry.key}>
                <strong>{fields.title}</strong>
                <div className={styles.details}>
                  <button type="button" className={styles.key} aria-label={`Copy citation key ${entry.key}`} onClick={() => void copy(entry.key)}><code>{entry.key}</code><Copy size={12} aria-hidden="true" /></button>
                  {fields.year && <span>{fields.year}</span>}
                  {fields.url && <a href={fields.url} target="_blank" rel="noreferrer">Open paper<ExternalLink size={12} aria-hidden="true" /></a>}
                </div>
                {fields.authors && <p>{fields.authors}</p>}
                {fields.venue && <p>{fields.venue}</p>}
              </li>;
            })}</ul>
            {!entries.length && <p className={styles.empty}>{path ? query ? "No matching references." : "No parsed entries." : "Add a .bib file to this project."}</p>}
          </>}
    </div>
    {error && <div className={styles.error}>
      <p role="alert">{error.message}</p>
      {conflict && <div className={styles.actions}>
        <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={() => file && void copy(file.draft)}>Copy edits</button>
        <button type="button" className="p-button p-button-default btn-outline text-xs" onClick={() => void load(path, true)}>Reload file</button>
      </div>}
    </div>}
    <div className={styles.footer}>
      <span role="status">{notice || (readOnly ? "Read only" : dirty ? "Unsaved edits" : "")}</span>
      <button type="button" className="p-button p-button-primary btn-primary text-xs" disabled={!dirty || readOnly || loading || saving} onClick={() => void save()}>{saving && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}{saving ? "Saving…" : "Save file"}</button>
    </div>
  </Modal>;
}
