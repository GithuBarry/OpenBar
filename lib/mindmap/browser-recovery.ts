import type { Mindmap, MindmapNode } from "@/lib/types"
import { CARD_NOTE_FIELDS, type CardNoteField } from "./caution"
import { mindmapDiskHash } from "./mindmap"

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
  /** Original versions of locally edited cards. Older drafts have no baseline. */
  baseCards?: MindmapNode[]
  baseContentHash?: string
  /** Uncommitted editor text stays separate from the durable map and TeX. */
  activeCard?: MindmapCardRecoveryDraft
}

function sameCard(left: MindmapNode | undefined, right: MindmapNode | undefined): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

export function editedCardBaselines(saved: Mindmap, local: Mindmap): MindmapNode[] {
  const localCards = new Map(local.nodes.map(node => [node.id, node]))
  return saved.nodes.filter(node => !sameCard(node, localCards.get(node.id)))
}

// Reads may migrate old references in memory while diskHash still identifies the original file.
const contentHashes = new WeakMap<Mindmap, string>()
export function recoveryBaseContentHash(map: Mindmap): string {
  let hash = contentHashes.get(map)
  if (!hash) {
    hash = mindmapDiskHash(map)
    contentHashes.set(map, hash)
  }
  return hash
}

/** Restore onto the current revision only when every affected card is proven safe. */
export function recoverableMindmapDraft(draft: MindmapRecoveryDraft, saved: Mindmap, savedHash: string, paperHash?: string): MindmapRecoveryDraft | null {
  if (saved.projectId !== draft.project || (saved.id || "draft") !== draft.mapId) return null
  const active = draft.activeCard
  if (active?.baseNode.todoId && active.text !== active.baseText && (!active.paperSourceHash || active.paperSourceHash !== paperHash)) return null
  if (draft.baseHash === savedHash) return draft
  if ((saved.diskHash || mindmapDiskHash(saved)) !== savedHash) return null
  const originals = new Map(draft.baseCards?.map(node => [node.id, node]))
  if (!draft.baseCards && active) originals.set(active.nodeId, active.baseNode)
  const original = { ...draft.mindmap, nodes: draft.mindmap.nodes.map(node => originals.get(node.id) || node) }
  // A hash mismatch also captures a local add, deletion, or map-level edit.
  try {
    if (mindmapDiskHash(original) !== (draft.baseContentHash ?? draft.baseHash)) return null
  } catch { return null }
  const latest = new Map(saved.nodes.map(node => [node.id, node]))
  const edits = new Map<string, MindmapNode>()
  for (const local of draft.mindmap.nodes) {
    const base = originals.get(local.id) || local
    if (local.parentId !== base.parentId || local.order !== base.order || local.todoId !== base.todoId) return null
    if (local.todoId && (local.text || local.title)) return null
    if (!sameCard(local, base) || local.id === active?.nodeId) {
      if (!sameCard(latest.get(local.id), base)) return null
      edits.set(local.id, local)
    }
  }
  return { ...draft, baseHash: savedHash, mindmap: { ...saved, nodes: saved.nodes.map(node => edits.get(node.id) || node) } }
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
    if (value.baseCards && (!Array.isArray(value.baseCards) || value.baseCards.length > 2_000
      || !value.baseCards.every(node => node && typeof node.id === "string" && typeof node.text === "string"))) return null
    if (value.baseContentHash !== undefined && !/^[a-f0-9]{64}$/i.test(value.baseContentHash)) return null
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
    let source = JSON.stringify(draft)
    try { storage.setItem(key, source) }
    catch (error) {
      if (!draft.baseCards) throw error
      // Prioritize the user's complete draft when the comparison baseline exceeds the tab's quota.
      source = JSON.stringify({ ...draft, baseCards: undefined })
      storage.setItem(key, source)
    }
    return storage.getItem(key) === source
  } catch {
    return false
  }
}
