import { useState } from "react"
import type { Mindmap, MindmapNode } from "@/lib/types"
import type { MindmapRecoveryDraft } from "@/lib/mindmap/browser-recovery"
import { cardNotesText } from "@/lib/mindmap/caution"

function reviewText(node?: MindmapNode, editorText?: string) {
  if (!node) return "Card absent from this version."
  const notes = cardNotesText(node.caption, node.caution)
  return [editorText ?? [node.title, node.text].filter(Boolean).join("\n"), notes && `Notes\n${notes}`]
    .filter(Boolean).join("\n\n") || (node.todoId ? `Paper TODO: ${node.todoId}` : "Empty card")
}

export function RecoveryCardReview({ draft, saved, todos }: {
  draft: MindmapRecoveryDraft
  saved: Mindmap
  todos?: { id: string; title?: string; text: string }[]
}) {
  const [selected, setSelected] = useState("")
  const [open, setOpen] = useState(false)
  const browser = new Map(draft.mindmap.nodes.map(node => [node.id, node]))
  const current = new Map(saved.nodes.map(node => [node.id, node]))
  const activeIds = draft.activeCard ? [draft.activeCard.nodeId] : []
  const ids = open ? [...new Set([...activeIds, ...(draft.baseCards || []).map(node => node.id),
    ...browser.keys(), ...current.keys()])]
    .filter(id => id === draft.activeCard?.nodeId || JSON.stringify(browser.get(id)) !== JSON.stringify(current.get(id))) : []
  const id = ids.includes(selected) ? selected : ids[0]
  const todoId = current.get(id)?.todoId
  const todo = todoId && todos?.find(item => item.id === todoId)
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Compare browser and saved cards</summary>
    {id ? <>
      <select aria-label="Card to review" value={id} onChange={event => setSelected(event.target.value)}
        style={{ maxWidth: "100%" }}>
        {ids.map(key => {
          const node = browser.get(key) || current.get(key)
          return <option key={key} value={key}>{(node?.title || node?.text || node?.todoId || key).slice(0, 80)}</option>
        })}
      </select>
      <label>Browser draft<textarea readOnly rows={3} style={{ display: "block", width: "100%" }}
        value={reviewText(browser.get(id), draft.activeCard?.nodeId === id ? draft.activeCard.text : undefined)} /></label>
      <label>Saved map<textarea readOnly rows={3} style={{ display: "block", width: "100%" }}
        value={reviewText(current.get(id), todo ? [todo.title, todo.text].filter(Boolean).join("\n") : undefined)} /></label>
    </> : <p>Download the draft to review its map settings.</p>}
  </details>
}
