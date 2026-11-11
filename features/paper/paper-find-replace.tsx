"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { SearchQuery } from "@codemirror/search";
import { Text } from "@codemirror/state";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { splitBundleSource, type ClientSourceSegment } from "@/lib/tex-project/source-bundle-format";
import styles from "./nested-bundle-editor.module.css";

type SourceFile = { filePath: string; body: string; bodyFrom: number };
type Match = { file: SourceFile; from: number; to: number; capture?: RegExpExecArray };

function replacementText(value: string, capture?: RegExpExecArray): string {
  if (!capture) return value;
  return value.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return capture[0];
    if (key.startsWith("<")) return capture.groups ? capture.groups[key.slice(1, -1)] ?? "" : token;
    const index = Number(key);
    if (index > 0 && index < capture.length) return capture[index] ?? "";
    const first = Number(key[0]);
    return key.length === 2 && first > 0 && first < capture.length ? (capture[first] ?? "") + key[1] : token;
  });
}

function replaceMatches(source: string, matches: Match[], replacement: string): string {
  const changes = new Map<string, Match[]>();
  for (const match of matches) {
    const path = match.file.filePath;
    const inFile = changes.get(path);
    if (inFile) inFile.push(match);
    else changes.set(path, [match]);
  }
  const replaceBody = (file: SourceFile) => {
    const edits = changes.get(file.filePath);
    if (!edits) return file.body;
    const chunks: string[] = [];
    let from = 0;
    for (const match of edits) {
      chunks.push(file.body.slice(from, match.from), replacementText(replacement, match.capture));
      from = match.to;
    }
    chunks.push(file.body.slice(from));
    return chunks.join("");
  };
  const parts = splitBundleSource(source);
  if (!parts.length) return replaceBody(matches[0]!.file);
  return parts.map(part => {
    const body = replaceBody(part);
    const separator = body && !body.endsWith("\n") ? "\n" : "";
    return source.slice(part.bannerFrom, part.bodyFrom) + body + separator;
  }).join("");
}

export function PaperFindReplace({
  source, rootFile, segments, openedFile, selectedText, readOnly, inputRef, onReveal, onEdit, onClose,
}: {
  source: string;
  rootFile: string;
  segments: Pick<ClientSourceSegment, "filePath" | "editable">[];
  openedFile: string;
  selectedText: string;
  readOnly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onReveal: (from: number, to: number) => void;
  onEdit: (before: string, after: string) => boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState(openedFile);
  const [find, setFind] = useState(selectedText);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [active, setActive] = useState<{ filePath: string; from: number; to?: number }>();
  const [undo, setUndo] = useState<{ before: string; after: string }>();
  const [message, setMessage] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [inputRef]);

  const files = useMemo(() => {
    const parts = splitBundleSource(source);
    if (!parts.length) return [{ filePath: rootFile, body: source, bodyFrom: 0 }];
    const readOnlyPaths = new Set(segments.filter(file => !file.editable).map(file => file.filePath));
    const unique = new Map<string, SourceFile>();
    for (const part of parts) {
      if (!readOnlyPaths.has(part.filePath) && !unique.has(part.filePath)) unique.set(part.filePath, part);
    }
    return [...unique.values()];
  }, [source, rootFile, segments]);
  const scopedFile = files.find(file => file.filePath === scope);
  const query = useMemo(() => new SearchQuery({ search: find, regexp, wholeWord, caseSensitive, literal: true }), [find, regexp, wholeWord, caseSensitive]);
  const results = useMemo(() => {
    const matches: Match[] = [];
    const paths = new Set<string>();
    if (!query.valid) return { matches, paths };
    for (const file of scope ? scopedFile ? [scopedFile] : [] : files) {
      const cursor = query.getCursor(Text.of(file.body.split("\n")));
      for (let hit = cursor.next(); !hit.done; hit = cursor.next()) {
        if ("precise" in hit.value && hit.value.precise === false) continue;
        const { from, to } = hit.value;
        const capture = "match" in hit.value ? hit.value.match as RegExpExecArray : undefined;
        matches.push({ file, from, to, capture });
        paths.add(file.filePath);
      }
    }
    return { matches, paths };
  }, [files, query, scope, scopedFile]);
  const { matches, paths } = results;
  const index = active?.to === undefined ? -1 : matches.findIndex(match => match.file.filePath === active.filePath && match.from === active.from && match.to === active.to);
  const current = matches[index];
  const where = current && `${current.file.filePath}:${current.file.body.slice(0, current.from).split("\n").length}`;
  const undoAvailable = undo && source === undo.after && !readOnly;
  let resultLabel = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
  if (current) resultLabel = `${index + 1} of ${resultLabel}`;
  if (!scope) resultLabel += ` in ${paths.size} ${paths.size === 1 ? "file" : "files"}`;
  if (!find) resultLabel = "Enter text to find.";
  else if (!query.valid) resultLabel = "Invalid regular expression.";
  if (scope && !scopedFile) resultLabel = "Choose an available source file.";

  function navigate(direction: 1 | -1) {
    if (!matches.length) return;
    let nextIndex = index + direction;
    if (index < 0) {
      nextIndex = direction === 1 ? 0 : matches.length - 1;
      if (active) {
        for (let i = nextIndex; i >= 0 && i < matches.length; i += direction) {
          const match = matches[i]!;
          if (match.file.filePath === active.filePath && (direction === 1 ? match.from >= active.from : match.from < active.from)) {
            nextIndex = i;
            break;
          }
        }
      }
    }
    const match = matches[(nextIndex + matches.length) % matches.length]!;
    setActive({ filePath: match.file.filePath, from: match.from, to: match.to });
    onReveal(match.file.bodyFrom + match.from, match.file.bodyFrom + match.to);
    setMessage("");
  }

  function replace(all: boolean) {
    const edits = all ? matches : current ? [current] : [];
    if (!edits.length || readOnly) return;
    const after = replaceMatches(source, edits, replacement);
    if (after === source) { setMessage("The replacement matches the existing text."); return; }
    if (!onEdit(source, after)) {
      setMessage("The source changed or the replacement affects a file boundary. Check the matches and try again.");
      return;
    }
    setUndo({ before: source, after });
    setActive(!all && current
      ? { filePath: current.file.filePath, from: current.from + replacementText(replacement, current.capture).length }
      : undefined);
    setMessage(all ? `Replaced ${edits.length} in ${paths.size} ${paths.size === 1 ? "file" : "files"}.` : `Replaced in ${current!.file.filePath}.`);
  }

  function resetMatch() { setActive(undefined); setMessage(""); }
  const button = "p-button p-button-default btn-outline";

  return <section className={styles.findPanel} aria-label="Find and replace in paper source">
    <div className={styles.findRow}>
      <label className={styles.findScope}>
        <span>Search in</span>
        <select aria-label="Search in" value={scope} onChange={event => { setScope(event.target.value); resetMatch(); }}>
          <option value="">All manuscript files ({files.length})</option>
          {scope && !scopedFile && <option value={scope}>{scope} · unavailable</option>}
          {files.map(file => <option key={file.filePath} value={file.filePath}>
            {file.filePath === openedFile ? `Current file · ${file.filePath}` : file.filePath}
          </option>)}
        </select>
      </label>
      <button type="button" className={button} aria-label="Close find and replace" onClick={onClose}><X size={14} /></button>
    </div>
    <div className={styles.findRow}>
      <input ref={inputRef} className="p-field input" aria-label="Find" placeholder="Find in source" value={find}
        onChange={event => { setFind(event.target.value); resetMatch(); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }} />
      <button type="button" className={button} aria-label="Previous match" disabled={!matches.length} onClick={() => navigate(-1)}><ChevronUp size={14} /></button>
      <button type="button" className={button} aria-label="Next match" disabled={!matches.length} onClick={() => navigate(1)}><ChevronDown size={14} /></button>
    </div>
    <div className={styles.findOptions}>
      <label><input type="checkbox" checked={caseSensitive} onChange={event => { setCaseSensitive(event.target.checked); resetMatch(); }} /> Match case</label>
      <label><input type="checkbox" checked={wholeWord} onChange={event => { setWholeWord(event.target.checked); resetMatch(); }} /> Whole word</label>
      <label><input type="checkbox" checked={regexp} onChange={event => { setRegexp(event.target.checked); resetMatch(); }} /> Regex</label>
    </div>
    {!readOnly && <div className={styles.findRow}>
      <input className="p-field input" aria-label="Replace with" placeholder="Replace with" value={replacement}
        onChange={event => { setReplacement(event.target.value); setMessage(""); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); replace(false); } }} />
      <button type="button" className={button} disabled={!current} onClick={() => replace(false)}>Replace</button>
      <button type="button" className={button} disabled={!matches.length} onClick={() => replace(true)}>Replace all</button>
    </div>}
    <div className={styles.findStatus}>
      <span role="status">
        {message || resultLabel}
        {where && <> · <code title={where}>{where}</code></>}
      </span>
      {undoAvailable && <button type="button" className={button} onClick={() => {
        if (!onEdit(undo.after, undo.before)) return;
        setUndo(undefined);
        setActive(undefined);
        setMessage("Replacement undone.");
      }}>Undo</button>}
    </div>
  </section>;
}
