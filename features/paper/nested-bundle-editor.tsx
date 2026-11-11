"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";

import { Transaction } from "@codemirror/state";

import {
  lookupBundlePartFrom,
  replaceBundlePart,
  sliceRootByIncludes,
  splitBundleSource,
  type ClientSourceSegment,
} from "@/lib/tex-project/source-bundle-format";
import styles from "./nested-bundle-editor.module.css";
import { cn } from "@/lib/utils";

import { TexCodeMirror, type TexCodeMirrorHandle, type TexDocChange, type TexFocusContext } from "./tex-codemirror";
import { accumulateHeadingCounts } from "./tex-source";
import { PaperFindReplace } from "./paper-find-replace";

type NestedItem = {
  kind: "file";
  key: string;
  filePath: string;
  text: string;
  headingCounts: Map<string, number>;
  virtualFrom: number;
  virtualTo: number;
  localFrom: number;
  localTo: number;
  showLabel: boolean;
  lineOffset: number;
  includedFile?: string;
  ancestors: string[];
  scopes: string[];
  includedScope?: string;
};

function buildNestedItems(source: string): NestedItem[] {
  const parts = splitBundleSource(source);
  if (!parts.length) return [];
  const items: NestedItem[] = [];
  const counts = new Map<string, number>();
  const addFile = (part: ReturnType<typeof splitBundleSource>[number], ancestry: Set<string>, showLabel: boolean, scopes: string[] = []) => {
    const slices = sliceRootByIncludes(part.body);
    let emitted = false;
    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index]!;
      const seed = new Map(counts);
      if (slice.kind === "tex") {
        if (slice.text.length) {
          items.push({
            kind: "file",
            key: `file:${[...ancestry].join(":")}:${part.filePath}:text:${index}`,
            filePath: part.filePath,
            text: part.body.slice(slice.from, slice.to),
            headingCounts: seed,
            virtualFrom: part.bodyFrom + slice.from,
            virtualTo: part.bodyFrom + slice.to,
            localFrom: slice.from,
            localTo: slice.to,
            showLabel: showLabel || emitted,
            lineOffset: part.body.slice(0, slice.from).split("\n").length - 1,
            ancestors: [...ancestry],
            scopes,
          });
          emitted = true;
        }
        accumulateHeadingCounts(slice.text, counts);
        continue;
      }
      const child = lookupBundlePartFrom(parts, slice.raw, part.filePath);
      if (child && !ancestry.has(child.filePath)) {
        const includedScope = `${scopes.at(-1) || ""}/${part.filePath}:${index}`;
        items.push({ kind: "file", key: `include:${[...ancestry].join(":")}:${index}`, filePath: part.filePath,
          text: part.body.slice(slice.from, slice.to), headingCounts: seed,
          virtualFrom: part.bodyFrom + slice.from, virtualTo: part.bodyFrom + slice.to,
          localFrom: slice.from, localTo: slice.to, showLabel: false, includedFile: child.filePath,
          ancestors: [...ancestry],
          scopes, includedScope,
          lineOffset: part.body.slice(0, slice.from).split("\n").length - 1 });
        addFile(child, new Set([...ancestry, child.filePath]), false, [...scopes, includedScope]);
        emitted = true;
        continue;
      }
      // Keep an unresolved or cyclic include editable in its owning file so
      // the one-scroll view never hides source that the graph could not enter.
      items.push({
        kind: "file",
        key: `file:${[...ancestry].join(":")}:${part.filePath}:include:${index}`,
        filePath: part.filePath,
        text: part.body.slice(slice.from, slice.to),
        headingCounts: seed,
        virtualFrom: part.bodyFrom + slice.from,
        virtualTo: part.bodyFrom + slice.to,
        localFrom: slice.from,
        localTo: slice.to,
        showLabel: true,
        lineOffset: part.body.slice(0, slice.from).split("\n").length - 1,
        ancestors: [...ancestry],
        scopes,
      });
      emitted = true;
    }
    if (!emitted) {
      items.push({
        kind: "file",
        key: `file:${[...ancestry].join(":")}:${part.filePath}:empty`,
        filePath: part.filePath,
        text: "",
        headingCounts: new Map(counts),
        virtualFrom: part.bodyFrom,
        virtualTo: part.bodyFrom,
        localFrom: 0,
        localTo: 0,
        showLabel: true,
        lineOffset: 0,
        ancestors: [...ancestry],
        scopes,
      });
    }
  };
  const root = parts[0]!;
  addFile(root, new Set([root.filePath]), true);
  const joined: NestedItem[] = [];
  for (const item of items) {
    const previous = joined.at(-1);
    if (previous?.kind === "file" && item.kind === "file" && !previous.includedFile && !item.includedFile && previous.filePath === item.filePath
      && previous.virtualTo === item.virtualFrom && previous.localTo === item.localFrom) {
      previous.text += item.text;
      previous.virtualTo = item.virtualTo;
      previous.localTo = item.localTo;
    } else {
      joined.push(item);
    }
  }
  const occurrences = new Map<string, number>();
  for (const item of joined) {
    const count = occurrences.get(item.key) ?? 0;
    occurrences.set(item.key, count + 1);
    item.key += `:occurrence:${count}`;
  }
  return joined;
}

function replaceFileSlice(source: string, filePath: string, localFrom: number, localTo: number, nextText: string): string {
  const parts = splitBundleSource(source);
  const part = parts.find((item) => item.filePath === filePath);
  if (!part) return source;
  const nextBody = `${part.body.slice(0, localFrom)}${nextText}${part.body.slice(localTo)}`;
  return replaceBundlePart(source, filePath, nextBody);
}

function localFocusContext(
  item: Extract<NestedItem, { kind: "file" }>,
  context: TexFocusContext | null | undefined,
): TexFocusContext | null {
  if (!context || context.to <= item.virtualFrom || context.from >= item.virtualTo) return null;
  return {
    from: Math.max(0, context.from - item.virtualFrom),
    to: Math.min(item.text.length, Math.max(0, context.to - item.virtualFrom)),
    beforeLines: context.beforeLines,
    afterLines: context.afterLines,
  };
}

export const NestedBundleEditor = forwardRef<TexCodeMirrorHandle, {
  project: string;
  rootFile: string;
  segments: Pick<ClientSourceSegment, "filePath" | "editable">[];
  value: string;
  valueRevision: number;
  currentRevision: () => number;
  readOnly?: boolean;
  citationKeys?: string[];
  onDocChanges: (changes: TexDocChange[], length: number) => void;
  onScroll?: () => void;
  manualScrollMeasurement?: boolean;
  onReadyProgress?: (ready: number, total: number, filePath?: string) => void;
  placeholder?: string;
  className?: string;
  focusContext?: TexFocusContext | null;
}>(function NestedBundleEditor({ project, rootFile, segments, value, valueRevision, currentRevision, readOnly = false, citationKeys = [], onDocChanges, onScroll, manualScrollMeasurement = true, onReadyProgress, placeholder, className, focusContext = null }, ref) {
  const [lspStatus, setLspStatus] = useState<"checking" | "available" | "missing" | "demo">("checking");
  const lspAvailable = lspStatus === "available";
  useEffect(() => {
    const controller = new AbortController();
    setLspStatus("checking");
    fetch(`/api/p/${encodeURIComponent(project)}/paper/language`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { available: false })
      .then((result: unknown) => {
        if (!result || typeof result !== "object") return setLspStatus("missing");
        if ("available" in result && result.available === true) return setLspStatus("available");
        setLspStatus("reason" in result && result.reason === "demo" ? "demo" : "missing");
      })
      .catch(() => { if (!controller.signal.aborted) setLspStatus("missing"); });
    return () => controller.abort();
  }, [project]);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(value);
  const [live, setLive] = useState(value);
  const [find, setFind] = useState<{ file: string; selection: string }>();
  const findInputRef = useRef<HTMLInputElement>(null);
  const foldStorageKey = `openbar:paper-file-folds:v1:${encodeURIComponent(project)}:${encodeURIComponent(rootFile)}`;
  const foldStorageKeyRef = useRef(foldStorageKey);
  foldStorageKeyRef.current = foldStorageKey;
  const [foldedFiles, setFoldedFiles] = useState<Set<string>>(() => new Set());
  const [hoveredScope, setHoveredScope] = useState<{ key: string; depth: number }>();
  const [focusedScope, setFocusedScope] = useState<{ key: string; depth: number }>();
  const activeScope = hoveredScope ?? focusedScope;
  const foldedFilesRef = useRef(foldedFiles);
  useLayoutEffect(() => {
    let stored: unknown;
    try { stored = JSON.parse(window.localStorage.getItem(foldStorageKey) || "[]"); } catch { /* Use the expanded view when storage is unavailable. */ }
    const next = new Set<string>(Array.isArray(stored) ? stored.filter((file): file is string => typeof file === "string" && file !== rootFile) : []);
    foldedFilesRef.current = next;
    setFoldedFiles(next);
  }, [foldStorageKey, rootFile]);
  const updateFoldedFiles = useCallback((next: Set<string>) => {
    foldedFilesRef.current = next;
    setFoldedFiles(next);
    try { window.localStorage.setItem(foldStorageKeyRef.current, JSON.stringify([...next].sort())); } catch { /* Keep the current tab's view preference. */ }
  }, []);
  const toggleFile = (filePath: string) => {
    const next = new Set(foldedFilesRef.current);
    if (!next.delete(filePath)) next.add(filePath);
    updateFoldedFiles(next);
  };
  useLayoutEffect(() => {
    // A newer keystroke can arrive between the parent render and this effect.
    if (valueRevision !== currentRevision()) return;
    sourceRef.current = value;
    setLive(value);
  }, [value, valueRevision, currentRevision]);
  const onChangeRef = useRef(onDocChanges);
  onChangeRef.current = onDocChanges;
  const handlesRef = useRef(new Map<string, TexCodeMirrorHandle>());
  const focusedKeyRef = useRef<string | null>(null);
  const itemsCacheRef = useRef<{ source: string; items: NestedItem[] } | null>(null);
  const items = useMemo(() => {
    if (itemsCacheRef.current?.source === live) return itemsCacheRef.current.items;
    const nextItems = buildNestedItems(live);
    itemsCacheRef.current = { source: live, items: nextItems };
    return nextItems;
  }, [live]);
  const itemsRef = useRef(items);
  if (live === sourceRef.current) itemsRef.current = items;
  const readyKeysRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    for (const handle of handlesRef.current.values()) {
      const view = handle.getView();
      if (view?.dom.getClientRects().length) view.requestMeasure();
    }
    onScroll?.();
  }, [foldedFiles, onScroll]);
  const reportReady = (key: string) => {
    readyKeysRef.current.add(key);
    const keys = itemsRef.current.length
      ? itemsRef.current.filter((item) => item.text.length || item.showLabel).map((item) => item.key)
      : ["pane"];
    onReadyProgress?.(keys.filter((itemKey) => readyKeysRef.current.has(itemKey)).length, keys.length,
      itemsRef.current.find((item) => item.key === key)?.filePath);
  };

  const focusedHandle = () => {
    const key = focusedKeyRef.current;
    return (key && handlesRef.current.get(key)) || handlesRef.current.values().next().value || null;
  };

  const slotForVirtual = (from: number) => {
    const files = itemsRef.current.filter((item): item is Extract<NestedItem, { kind: "file" }> => item.kind === "file");
    const hits = files.filter((item) => from >= item.virtualFrom && from <= item.virtualTo);
    return hits.at(-1) || files.find((item) => from < item.virtualFrom) || files[0];
  };

  const revealSlot = (slot: NestedItem, afterReveal?: () => void) => {
    const next = new Set(foldedFilesRef.current);
    const changed = slot.ancestors.map(file => next.delete(file)).some(Boolean);
    const reveal = () => {
      const boundary = scrollerRef.current?.querySelector<HTMLDetailsElement>(`details[data-ob-nested-key="${CSS.escape(slot.key)}"]`);
      if (boundary) boundary.open = true;
      handlesRef.current.get(slot.key)?.getView()?.requestMeasure();
      afterReveal?.();
    };
    if (changed) {
      updateFoldedFiles(next);
      requestAnimationFrame(reveal);
    } else reveal();
  };

  const revealFocused = () => {
    const key = focusedKeyRef.current;
    const slot = itemsRef.current.find(item => item.key === key);
    if (slot) revealSlot(slot, () => { if (key) handlesRef.current.get(key)?.focus(); });
    else focusedHandle()?.focus();
  };

  const bindHandle = (key: string) => (handle: TexCodeMirrorHandle | null) => {
    if (handle) handlesRef.current.set(key, handle);
    else handlesRef.current.delete(key);
  };

  const revealRange: TexCodeMirrorHandle["revealRange"] = (from, to, options) => {
    const slot = slotForVirtual(from);
    if (!slot) {
      const fallback = handlesRef.current.get("pane");
      if (fallback) fallback.revealRange(from, to, options);
      else options?.onDone?.();
      return;
    }
    revealSlot(slot, () => {
      const handle = handlesRef.current.get(slot.key);
      const view = handle?.getView();
      const scroller = scrollerRef.current;
      if (!handle || !view || !scroller || (options?.isCurrent && !options.isCurrent())) { options?.onDone?.(); return; }
      const localFrom = Math.max(0, Math.min(view.state.doc.length, from - slot.virtualFrom));
      handle.revealRange(localFrom, Math.max(0, to - slot.virtualFrom), { ...options, scrollContainer: scroller });
    });
  };

  const commit = (next: string) => {
    if (readOnlyRef.current) return;
    const previous = sourceRef.current;
    if (previous === next) return;
    let from = 0;
    while (from < previous.length && from < next.length && previous[from] === next[from]) from += 1;
    let to = previous.length, end = next.length;
    while (to > from && end > from && previous[to - 1] === next[end - 1]) { to -= 1; end -= 1; }
    sourceRef.current = next;
    itemsRef.current = buildNestedItems(next);
    itemsCacheRef.current = { source: next, items: itemsRef.current };
    setLive(next);
    onChangeRef.current([{ from, to, insert: next.slice(from, end) }], next.length);
  };

  const applyVirtualChange = useCallback((from: number, to: number, insert: string): boolean => {
    if (readOnlyRef.current) return false;
    if (from === 0 && to === sourceRef.current.length) { commit(insert); return true; }
    const start = slotForVirtual(from);
    const end = slotForVirtual(Math.max(from, to - 1));
    if (start && end && start.key === end.key) {
      const handle = handlesRef.current.get(start.key);
      const view = handle?.getView();
      if (view) {
        if (view.state.doc.toString() !== start.text) return false;
        const localFrom = Math.max(0, from - start.virtualFrom);
        const localTo = Math.max(localFrom, to - start.virtualFrom);
        const sel = view.state.selection.main;
        const intersects = sel.to >= localFrom && sel.from <= localTo;
        const hadFocus = view.hasFocus;
        revealSlot(start, () => { if (hadFocus || intersects) view.focus(); });
        view.dispatch({
          changes: { from: localFrom, to: Math.min(localTo, view.state.doc.length), insert },
          ...(intersects ? { selection: { anchor: localFrom + insert.length }, scrollIntoView: true } : {}),
          annotations: [Transaction.addToHistory.of(true)],
        });
        if (hadFocus || intersects) view.focus();
        return true;
      }
    }
    // A preview selection crossing an include edge has no single owning file.
    // Leave the source unchanged until a transaction operation can describe
    // the multi-file edit explicitly.
    return false;
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => {
      revealFocused();
    },
    getScroller: () => scrollerRef.current ?? focusedHandle()?.getScroller() ?? null,
    getView: () => focusedHandle()?.getView() ?? null,
    getSelection: () => focusedHandle()?.getSelection() ?? null,
    setSelection: (from, to) => {
      const slot = slotForVirtual(from);
      if (!slot) return;
      revealSlot(slot, () => {
        handlesRef.current.get(slot.key)?.setSelection(Math.max(0, from - slot.virtualFrom), Math.max(0, to - slot.virtualFrom));
        scrollerRef.current
          ?.querySelector(`[data-ob-nested-key="${CSS.escape(slot.key)}"]`)
          ?.scrollIntoView({ block: "start" });
      });
    },
    revealRange,
    surround: (open, close, placeholderText) => {
      revealFocused();
      focusedHandle()?.surround(open, close, placeholderText);
    },
    format: (syntax, kind) => { revealFocused(); return focusedHandle()?.format(syntax, kind) ?? false; },
    insertAtCursor: (text, asBlock) => {
      revealFocused();
      focusedHandle()?.insertAtCursor(text, asBlock);
    },
    getLiveSource: () => sourceRef.current,
    getVirtualSelection: () => {
      const key = focusedKeyRef.current;
      const slot = itemsRef.current.find((item) => item.key === key) || itemsRef.current[0];
      const local = focusedHandle()?.getSelection() ?? null;
      if (!slot || !local) return local;
      return { from: slot.virtualFrom + local.from, to: slot.virtualFrom + local.to };
    },
    applyVirtualChange,
  }), [applyVirtualChange]);

  const closeFind = () => {
    setFind(undefined);
    focusedHandle()?.focus();
  };

  return <div data-ob-paper-editor data-find-open={Boolean(find)} className={cn(styles.workspace, className)}
    onKeyDownCapture={event => {
      if (event.key === "Escape" && find) {
        event.preventDefault();
        event.stopPropagation();
        closeFind();
      }
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (find) {
        findInputRef.current?.focus();
        findInputRef.current?.select();
        return;
      }
      const owner = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ob-nested-key]") : null;
      const key = owner?.dataset.obNestedKey ?? focusedKeyRef.current;
      const view = (key ? handlesRef.current.get(key) : focusedHandle())?.getView();
      const range = view?.state.selection.main;
      const selection = view && range ? view.state.sliceDoc(range.from, range.to) : "";
      const slot = itemsRef.current.find(item => item.key === key);
      setFind({ file: slot?.filePath ?? rootFile, selection: selection.includes("\n") ? "" : selection });
    }}>
    {find && <PaperFindReplace
      source={live}
      rootFile={rootFile}
      segments={segments}
      openedFile={find.file}
      selectedText={find.selection}
      readOnly={readOnly}
      inputRef={findInputRef}
      onReveal={revealRange}
      onEdit={(before, after) => {
        if (readOnlyRef.current || before !== sourceRef.current) return false;
        const prior = splitBundleSource(before);
        const next = splitBundleSource(after);
        if (prior.length !== next.length || prior.some((part, index) => part.filePath !== next[index]?.filePath)) return false;
        commit(after);
        return true;
      }}
      onClose={closeFind}
    />}
    {!items.length ? (
      <TexCodeMirror
        ref={(handle) => bindHandle("pane")(handle)}
        onReady={() => reportReady("pane")}
        value={live}
        readOnly={readOnly}
        nativeSearch={false}
        onChange={commit}
        onScroll={onScroll}
        onFocus={() => {
          focusedKeyRef.current = "pane";
        }}
        placeholder={placeholder}
        focusContext={focusContext}
      />
    ) : (
    <div
      ref={scrollerRef}
      data-ob-scroll="paper-editor"
      className={styles.editor}
      onScroll={() => {
        if (manualScrollMeasurement) for (const handle of handlesRef.current.values()) handle.getView()?.requestMeasure();
        onScroll?.();
      }}
    >
      {items.map((item) => {
        if (!item.text.length && !item.showLabel) return null;
        const hidden = item.ancestors.some(file => foldedFiles.has(file));
        const depth = Math.min(8, item.ancestors.length - 1);
        const guide = activeScope && (item.scopes.includes(activeScope.key) || item.includedScope === activeScope.key);
        const scopeStyle = { "--file-depth": depth, "--guide-depth": activeScope?.depth ?? 0 } as CSSProperties;
        const editor = (
          <TexCodeMirror
            ref={bindHandle(item.key)}
            onReady={() => reportReady(item.key)}
            variant="nested"
            nativeSearch={false}
            readOnly={readOnly}
            lineOffset={item.lineOffset}
            value={item.text}
            isValueCurrent={() => itemsRef.current.find((entry) => entry.key === item.key)?.text === item.text}
            getCompletionContext={() => ({ source: sourceRef.current, citationKeys })}
            getLspContext={() => ({ project, source: sourceRef.current, file: item.filePath, fileFrom: item.localFrom, available: lspAvailable })}
            headingCounts={item.headingCounts}
            placeholder={placeholder}
            onFocus={() => {
              focusedKeyRef.current = item.key;
            }}
            focusContext={localFocusContext(item, focusContext)}
            onChange={(text) => {
              const current = itemsRef.current.find((entry) => entry.key === item.key);
              if (current) commit(replaceFileSlice(
                sourceRef.current, current.filePath, current.localFrom, current.localTo,
                text,
              ));
            }}
          />
        );
        if (item.includedFile) {
          const expanded = !foldedFiles.has(item.includedFile);
          return (
            <div key={item.key} hidden={hidden} style={scopeStyle} className={cn(styles.includeBoundary, guide && styles.ancestryGuide)}
              onPointerEnter={() => setHoveredScope({ key: item.includedScope!, depth })}
              onPointerLeave={() => setHoveredScope(current => current?.key === item.includedScope ? undefined : current)}
              onFocus={() => setFocusedScope({ key: item.includedScope!, depth })}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedScope(current => current?.key === item.includedScope ? undefined : current); }}>
              <button type="button" className={styles.fileToggle} aria-expanded={expanded}
                title={`${expanded ? "Collapse" : "Expand"} ${item.includedFile}`}
                onClick={() => toggleFile(item.includedFile!)}>
                <code>{item.includedFile}</code>
              </button>
              <details data-ob-nested-key={item.key} data-ob-file={item.filePath} data-ob-line-start={item.lineOffset + 1} className={styles.includeLine}
                onToggle={(event) => { if (event.currentTarget.open) handlesRef.current.get(item.key)?.getView()?.requestMeasure(); }}>
                <summary aria-label={`Include line in ${item.filePath}:${item.lineOffset + 1}`} title={`Show include line in ${item.filePath}:${item.lineOffset + 1}`}>Source</summary>
                <div className={styles.includeSource}>{editor}</div>
              </details>
            </div>
          );
        }
        return (
          <div key={item.key} hidden={hidden} style={scopeStyle} data-ob-file={item.filePath} data-ob-line-start={item.lineOffset + 1} data-ob-source-from={item.virtualFrom} data-ob-source-to={item.virtualTo} data-ob-nested-key={item.key} className={cn("ob-nested-tex-slice", item.showLabel && "ob-nested-tex-card", guide && styles.ancestryGuide)}>
            {item.showLabel && (
              <div className="ob-nested-tex-card-label">
                <code>{item.filePath}</code>
              </div>
            )}
            {editor}
          </div>
        );
      })}
    </div>
    )}
  </div>;
});

NestedBundleEditor.displayName = "NestedBundleEditor";
