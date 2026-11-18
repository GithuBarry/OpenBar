import type { Mindmap, MindmapNode } from "@/lib/types"
import { CARD_NOTE_FIELDS, type CardNoteField } from "./caution"

export type MindmapCardRecoveryDraft = {
  nodeId: string
  text: string
  contentFormat?: MindmapNode["contentFormat"]
  selection?: { from: number; to: number }
  baseText: string
  baseNode: MindmapNode
  paperSourceHash?: string
  noteFields: CardNoteField[]
}

export type MindmapRecoveryDraft = {
  version: 1
  project: string
  mapId: string
  baseHash: string
  savedAt: string
  mindmap: Mindmap
  /** Uncommitted editor text stays separate from the durable map and TeX. */
  activeCard?: MindmapCardRecoveryDraft
}

export function mindmapRecoveryKey(project: string, mapId: string): string {
  return `openbar:mindmap-recovery:v1:${encodeURIComponent(project)}:${encodeURIComponent(mapId)}`
}

/** Session storage isolates concurrent tabs while surviving a full refresh. */
export function readMindmapRecovery(storage: Pick<Storage, "getItem">, project: string, mapId: string): MindmapRecoveryDraft | null {
  try {
    const value = JSON.parse(storage.getItem(mindmapRecoveryKey(project, mapId)) || "null") as MindmapRecoveryDraft | null
    if (!value || value.version !== 1 || value.project !== project || value.mapId !== mapId
      || !/^[a-f0-9]{64}$/i.test(value.baseHash) || !Number.isFinite(Date.parse(value.savedAt))
      || value.mindmap?.projectId !== project || (value.mindmap.id || "draft") !== mapId
      || !Array.isArray(value.mindmap.nodes) || value.mindmap.nodes.length === 0
      || value.mindmap.nodes.length > 2_000 || typeof value.mindmap.rootId !== "string"
      || !value.mindmap.nodes.every(node => node && typeof node.id === "string" && typeof node.text === "string"
        && (node.parentId === null || typeof node.parentId === "string"))) return null
    const active = value.activeCard
    if (active && (typeof active.nodeId !== "string" || typeof active.text !== "string"
      || typeof active.baseText !== "string" || active.baseNode?.id !== active.nodeId
      || typeof active.baseNode.text !== "string"
      || !value.mindmap.nodes.some(node => node.id === active.nodeId)
      || !Array.isArray(active.noteFields) || active.noteFields.some(field => !CARD_NOTE_FIELDS.includes(field))
      || (active.contentFormat !== undefined && !["plain", "markdown", "tex", "html"].includes(active.contentFormat))
      || (active.paperSourceHash !== undefined && !/^[a-f0-9]{64}$/i.test(active.paperSourceHash))
      || (active.selection && (!Number.isInteger(active.selection.from) || !Number.isInteger(active.selection.to)
        || active.selection.from < 0 || active.selection.to < active.selection.from || active.selection.to > active.text.length)))) return null
    return value
  } catch {
    return null
  }
}

export function hasMindmapCardRecoveryChanges(draft: MindmapRecoveryDraft): boolean {
  const active = draft.activeCard
  if (!active) return false
  if (active.text !== active.baseText || active.contentFormat !== (active.baseNode.contentFormat || "plain")) return true
  const node = draft.mindmap.nodes.find(node => node.id === active.nodeId)
  return active.noteFields.some(field => field === "caption"
    ? node?.caption !== active.baseNode.caption
    : node?.caution?.[field] !== active.baseNode.caution?.[field])
}

export function writeMindmapRecovery(storage: Pick<Storage, "setItem" | "getItem">, draft: MindmapRecoveryDraft): boolean {
  try {
    const key = mindmapRecoveryKey(draft.project, draft.mapId)
    const source = JSON.stringify(draft)
    storage.setItem(key, source)
    return storage.getItem(key) === source
  } catch {
    return false
  }
}
