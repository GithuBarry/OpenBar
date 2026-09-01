"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { Transaction } from "@codemirror/state";

import {
  lookupBundlePartFrom,
  replaceBundlePart,
  sliceRootByIncludes,
  splitBundleSource,
} from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";

import { TexCodeMirror, type TexCodeMirrorHandle } from "./tex-codemirror";
import { accumulateHeadingCounts } from "./tex-source";

type NestedItem =
  | {
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
  }
  | {
    kind: "label";
    key: string;
    filePath: string;
    label: string;
    virtualFrom: number;
    virtualTo: number;
  };

function buildNestedItems(source: string): NestedItem[] {
  const parts = splitBundleSource(source);
  if (!parts.length) return [];
  const items: NestedItem[] = [];
  const counts = new Map<string, number>();
  const addFile = (part: ReturnType<typeof splitBundleSource>[number], ancestry: Set<string>, showLabel: boolean) => {
    if (showLabel) {
      items.push({
        kind: "label",
        key: `label:${part.filePath}`,
        filePath: part.filePath,
        label: part.filePath,
        virtualFrom: part.bodyFrom,
        virtualTo: part.bodyTo,
      });
    }
    const slices = sliceRootByIncludes(part.body);
    let emitted = false;
    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index]!;
      const seed = new Map(counts);
      if (slice.kind === "tex") {
        if (slice.text.length) {
          items.push({
            kind: "file",
            key: `file:${part.filePath}:text:${index}`,
            filePath: part.filePath,
            text: slice.text,
            headingCounts: seed,
            virtualFrom: part.bodyFrom + slice.from,
            virtualTo: part.bodyFrom + slice.to,
            localFrom: slice.from,
            localTo: slice.to,
            showLabel: false,
          });
          emitted = true;
        }
        accumulateHeadingCounts(slice.text, counts);
        continue;
      }
      const child = lookupBundlePartFrom(parts, slice.raw, part.filePath);
      if (child && !ancestry.has(child.filePath)) {
        addFile(child, new Set([...ancestry, child.filePath]), true);
        emitted = true;
        continue;
      }
      // Keep an unresolved or cyclic include editable in its owning file so
      // the one-scroll view never hides source that the graph could not enter.
      items.push({
        kind: "file",
        key: `file:${part.filePath}:include:${index}`,
        filePath: part.filePath,
        text: slice.line,
        headingCounts: seed,
        virtualFrom: part.bodyFrom + slice.from,
        virtualTo: part.bodyFrom + slice.to,
        localFrom: slice.from,
        localTo: slice.to,
        showLabel: false,
      });
      emitted = true;
    }
    if (showLabel && !emitted) {
      items.push({
        kind: "file",
        key: `file:${part.filePath}:empty`,
        filePath: part.filePath,
        text: "",
        headingCounts: new Map(counts),
        virtualFrom: part.bodyFrom,
        virtualTo: part.bodyFrom,
        localFrom: 0,
        localTo: 0,
        showLabel: false,
      });
    }
  };
  const root = parts[0]!;
  addFile(root, new Set([root.filePath]), false);
  return items;
}

function replaceFileSlice(source: string, filePath: string, localFrom: number, localTo: number, nextText: string): string {
  const parts = splitBundleSource(source);
  const part = parts.find((item) => item.filePath === filePath);
  if (!part) return source;
  const nextBody = `${part.body.slice(0, localFrom)}${nextText}${part.body.slice(localTo)}`;
  return replaceBundlePart(source, filePath, nextBody);
}

export const NestedBundleEditor = forwardRef<TexCodeMirrorHandle, {
  value: string;
  onChange: (value: string) => void;
  onScroll?: () => void;
  placeholder?: string;
  className?: string;
}>(function NestedBundleEditor({ value, onChange, onScroll, placeholder, className }, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(value);
  sourceRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlesRef = useRef(new Map<string, TexCodeMirrorHandle>());
  const focusedKeyRef = useRef<string | null>(null);
  const items = useMemo(() => buildNestedItems(value), [value]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const focusedHandle = () => {
    const key = focusedKeyRef.current;
    return (key && handlesRef.current.get(key)) || handlesRef.current.values().next().value || null;
  };

  const slotForVirtual = (from: number) => {
    const files = itemsRef.current.filter((item): item is Extract<NestedItem, { kind: "file" }> => item.kind === "file");
    const hits = files.filter((item) => from >= item.virtualFrom && from <= item.virtualTo);
    return hits.at(-1) || files.find((item) => from < item.virtualFrom) || files[0];
  };

  const bindHandle = (key: string) => (handle: TexCodeMirrorHandle | null) => {
    if (handle) handlesRef.current.set(key, handle);
    else handlesRef.current.delete(key);
  };

  const commit = (next: string) => {
    sourceRef.current = next;
    onChangeRef.current(next);
  };

  const applyVirtualChange = useCallback((from: number, to: number, insert: string): boolean => {
    const start = slotForVirtual(from);
    const end = slotForVirtual(Math.max(from, to - 1));
    if (start && end && start.key === end.key) {
      const handle = handlesRef.current.get(start.key);
      const view = handle?.getView();
      if (view) {
        const localFrom = Math.max(0, from - start.virtualFrom);
        const localTo = Math.max(localFrom, to - start.virtualFrom);
        const sel = view.state.selection.main;
        const intersects = sel.to >= localFrom && sel.from <= localTo;
        const hadFocus = view.hasFocus;
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
      focusedHandle()?.focus();
    },
    getScroller: () => scrollerRef.current,
    getView: () => focusedHandle()?.getView() ?? null,
    getSelection: () => focusedHandle()?.getSelection() ?? null,
    setSelection: (from, to) => {
      const slot = slotForVirtual(from);
      if (!slot) return;
      const handle = handlesRef.current.get(slot.key);
      handle?.setSelection(Math.max(0, from - slot.virtualFrom), Math.max(0, to - slot.virtualFrom));
      scrollerRef.current
        ?.querySelector(`[data-ob-nested-key="${CSS.escape(slot.key)}"]`)
        ?.scrollIntoView({ block: "start" });
    },
    surround: (open, close, placeholderText) => {
      focusedHandle()?.surround(open, close, placeholderText);
    },
    insertAtCursor: (text, asBlock) => {
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

  if (!items.length) {
    return (
      <TexCodeMirror
        ref={(handle) => bindHandle("pane")(handle)}
        value={value}
        onChange={onChange}
        onScroll={onScroll}
        onFocus={() => {
          focusedKeyRef.current = "pane";
        }}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div
      ref={scrollerRef}
      data-ob-scroll="paper-editor"
      className={cn("ob-nested-bundle", className)}
      onScroll={() => {
        for (const handle of handlesRef.current.values()) handle.getView()?.requestMeasure();
        onScroll?.();
      }}
    >
      {items.map((item) => {
        if (item.kind === "label") {
          return (
            <div key={item.key} data-ob-nested-key={item.key} className="ob-nested-tex-card-label">
              <span>\input</span>
              <code>{item.label}</code>
            </div>
          );
        }
        if (!item.text.length && !item.showLabel) return null;
        return (
          <div key={item.key} data-ob-nested-key={item.key} className={cn("ob-nested-tex-slice", item.showLabel && "ob-nested-tex-card")}>
            {item.showLabel && (
              <div className="ob-nested-tex-card-label">
                <span>\input</span>
                <code>{item.filePath}</code>
              </div>
            )}
            <TexCodeMirror
              ref={bindHandle(item.key)}
              variant="nested"
              value={item.text}
              headingCounts={item.headingCounts}
              placeholder={placeholder}
              onFocus={() => {
                focusedKeyRef.current = item.key;
              }}
              onChange={(text) => commit(replaceFileSlice(sourceRef.current, item.filePath, item.localFrom, item.localTo, text))}
            />
          </div>
        );
      })}
    </div>
  );
});

NestedBundleEditor.displayName = "NestedBundleEditor";
