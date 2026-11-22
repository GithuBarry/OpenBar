"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { Mindmap, MindmapNode } from "@/lib/types"
import type { MindmapRecoveryDraft } from "@/lib/mindmap/browser-recovery"
import { cardNotesText } from "@/lib/mindmap/caution"

type DiffKind = "added" | "removed" | "edited"

type CardDiff = {
  id: string
  kind: DiffKind
  label: string
  fields: string[]
  draftText: string
  savedText: string
}

function cardSnapshot(node?: MindmapNode, overrideText?: string): string {
  if (!node) return ""
  const notes = cardNotesText(node.caption, node.caution).trim()
  const main = overrideText ?? [node.title, node.text].filter(Boolean).join("\n")
  return [main.trim(), notes ? `Notes:\n${notes}` : ""].filter(Boolean).join("\n\n")
}

function changedFields(draftNode?: MindmapNode, savedNode?: MindmapNode, activeText?: string): string[] {
  if (!draftNode || !savedNode) return []
  const fields: string[] = []
  const draftMain = activeText ?? [draftNode.title, draftNode.text].filter(Boolean).join("\n")
  const savedMain = [savedNode.title, savedNode.text].filter(Boolean).join("\n")
  if (draftMain !== savedMain) fields.push("text")
  if (cardNotesText(draftNode.caption, draftNode.caution) !== cardNotesText(savedNode.caption, savedNode.caution)) fields.push("notes")
  if (draftNode.parentId !== savedNode.parentId) fields.push("position")
  if (JSON.stringify(draftNode.tags || []) !== JSON.stringify(savedNode.tags || [])) fields.push("labels")
  if (draftNode.priority !== savedNode.priority) fields.push("priority")
  if (draftNode.progress !== savedNode.progress) fields.push("progress")
  if (draftNode.color !== savedNode.color) fields.push("accent")
  if (draftNode.cardWidth !== savedNode.cardWidth) fields.push("width")
  if (draftNode.shape !== savedNode.shape || draftNode.contentFormat !== savedNode.contentFormat || draftNode.tableLayout !== savedNode.tableLayout) fields.push("format")
  if (Boolean(draftNode.agentDraft) !== Boolean(savedNode.agentDraft)) fields.push("draft state")
  if (JSON.stringify(draftNode.refs || []) !== JSON.stringify(savedNode.refs || [])) fields.push("links/images")
  if (JSON.stringify(draftNode.metadata || null) !== JSON.stringify(savedNode.metadata || null)) fields.push("properties")
  return fields
}

function lineDiff(beforeText: string, afterText: string): Array<{ type: "same" | "del" | "add"; line: string }> {
  const before = beforeText ? beforeText.split("\n") : []
  const after = afterText ? afterText.split("\n") : []
  const afterSet = new Set(after)
  const beforeSet = new Set(before)
  const out: Array<{ type: "same" | "del" | "add"; line: string }> = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push({ type: "same", line: before[i]! })
      i += 1
      j += 1
    } else if (i < before.length && !afterSet.has(before[i]!)) {
      out.push({ type: "del", line: before[i]! })
      i += 1
    } else if (j < after.length && !beforeSet.has(after[j]!)) {
      out.push({ type: "add", line: after[j]! })
      j += 1
    } else {
      if (i < before.length) { out.push({ type: "del", line: before[i]! }); i += 1 }
      if (j < after.length) { out.push({ type: "add", line: after[j]! }); j += 1 }
    }
  }
  return out
}

export function RecoveryCardReview({ draft, saved, todos, defaultOpen = false }: {
  draft: MindmapRecoveryDraft
  saved: Mindmap
  todos?: { id: string; title?: string; text: string }[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [selectedId, setSelectedId] = useState<string>("")

  const { diffs, mapChanges } = useMemo(() => {
    const browser = new Map(draft.mindmap.nodes.map(node => [node.id, node]))
    const current = new Map(saved.nodes.map(node => [node.id, node]))
    const todoById = new Map((todos || []).map(item => [item.id, item]))
    const allIds = [...new Set([
      ...(draft.activeCard ? [draft.activeCard.nodeId] : []),
      ...browser.keys(),
      ...current.keys(),
    ])]
    const items: CardDiff[] = []
    for (const id of allIds) {
      const bNode = browser.get(id)
      const sNode = current.get(id)
      const activeText = draft.activeCard?.nodeId === id ? draft.activeCard.text : undefined
      const todo = sNode?.todoId ? todoById.get(sNode.todoId) : undefined
      const savedOverride = todo ? [todo.title, todo.text].filter(Boolean).join("\n") : undefined
      if (bNode && !sNode) {
        items.push({
          id,
          kind: "added",
          label: (bNode.title || bNode.text || bNode.todoId || id).split("\n")[0]!.slice(0, 72),
          fields: ["new card"],
          draftText: cardSnapshot(bNode, activeText),
          savedText: "",
        })
      } else if (!bNode && sNode) {
        items.push({
          id,
          kind: "removed",
          label: (sNode.title || sNode.text || sNode.todoId || id).split("\n")[0]!.slice(0, 72),
          fields: ["deleted"],
          draftText: "",
          savedText: cardSnapshot(sNode, savedOverride),
        })
      } else if (bNode && sNode) {
        const effectiveDraftText = activeText !== undefined ? activeText : savedOverride
        const fields = changedFields(bNode, sNode, activeText !== undefined && activeText !== savedOverride ? activeText : undefined)
        if (fields.length > 0) {
          items.push({
            id,
            kind: "edited",
            label: (bNode.title || sNode.title || bNode.text || sNode.text || sNode.todoId || id).split("\n")[0]!.slice(0, 72),
            fields,
            draftText: cardSnapshot(bNode, effectiveDraftText),
            savedText: cardSnapshot(sNode, savedOverride),
          })
        }
      }
    }
    const meta: string[] = []
    if ((draft.mindmap.title || "") !== (saved.title || "")) meta.push(`map title: "${saved.title || ""}" → "${draft.mindmap.title || ""}"`)
    if ((draft.mindmap.cardWidthMode ?? "individual") !== (saved.cardWidthMode ?? "individual")) meta.push(`card widths: ${saved.cardWidthMode ?? "individual"} → ${draft.mindmap.cardWidthMode ?? "individual"}`)
    if ((draft.mindmap.fontSize || 12) !== (saved.fontSize || 12)) meta.push(`font size: ${saved.fontSize || 12}px → ${draft.mindmap.fontSize || 12}px`)
    return { diffs: items, mapChanges: meta }
  }, [draft, saved, todos])

  const counts = useMemo(() => ({
    edited: diffs.filter(d => d.kind === "edited").length,
    added: diffs.filter(d => d.kind === "added").length,
    removed: diffs.filter(d => d.kind === "removed").length,
  }), [diffs])

  const summaryParts = [
    counts.edited ? `${counts.edited} edited` : null,
    counts.added ? `${counts.added} added` : null,
    counts.removed ? `${counts.removed} removed` : null,
    ...mapChanges,
  ].filter(Boolean)

  const activeDiff = diffs.find(item => item.id === selectedId) || diffs[0]
  const lines = useMemo(
    () => (open && activeDiff ? lineDiff(activeDiff.savedText, activeDiff.draftText) : []),
    [open, activeDiff],
  )

  return (
    <div className="my-2.5 grid gap-2">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-left text-xs font-medium text-ink transition hover:bg-surface-3 cursor-pointer"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {open ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
          <span>{open ? "Hide differences" : "Show differences"}</span>
        </span>
        <span className="truncate text-[11px] font-normal text-muted">
          {summaryParts.length ? summaryParts.join(", ") : "No card text differences"}
        </span>
      </button>

      {open && (
        <div className="grid gap-2 rounded-[10px] border border-line bg-canvas/60 p-2.5">
          {diffs.length > 0 ? (
            <>
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Changed cards">
                {diffs.map(item => {
                  const selected = activeDiff?.id === item.id
                  const badgeClass = item.kind === "added"
                    ? "bg-ok/15 text-ok-text"
                    : item.kind === "removed"
                      ? "bg-danger/15 text-danger-text"
                      : "bg-accent/15 text-accent-text"
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setSelectedId(item.id)}
                      className={`flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-xs cursor-pointer transition ${selected ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
                        {item.kind === "edited" ? item.fields.slice(0, 2).join(", ") : item.kind}
                      </span>
                    </button>
                  )
                })}
              </div>

              {activeDiff && (
                <div className="grid gap-1 rounded-[10px] border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed">
                  <div className="flex items-center justify-between gap-2 border-b border-line pb-1 font-sans text-[11px] text-muted">
                    <span className="truncate font-semibold text-ink">{activeDiff.label}</span>
                    <span className="shrink-0">− saved / + draft</span>
                  </div>
                  <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words">
                    {lines.length > 0 ? lines.map((entry, idx) => (
                      <div
                        key={idx}
                        className={
                          entry.type === "add"
                            ? "rounded px-1.5 py-0.5 bg-ok/12 text-ink"
                            : entry.type === "del"
                              ? "rounded px-1.5 py-0.5 bg-danger/12 text-muted line-through"
                              : "px-1.5 py-0.5 text-muted"
                        }
                      >
                        <span className="mr-1.5 select-none opacity-65">
                          {entry.type === "add" ? "+" : entry.type === "del" ? "−" : " "}
                        </span>
                        {entry.line || " "}
                      </div>
                    )) : (
                      <p className="px-1.5 py-1 font-sans text-xs text-muted">
                        Metadata or visual fields changed ({activeDiff.fields.join(", ")}).
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="m-0 text-xs text-muted">
              {mapChanges.length
                ? `Only map settings changed (${mapChanges.join(", ")}).`
                : "Your browser draft matches the saved map's cards (only unsaved timestamp or selection state differs)."}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
