import type { Mindmap } from "@/lib/types"

export type MindmapRecoveryDraft = {
  version: 1
  project: string
  mapId: string
  baseHash: string
  savedAt: string
  mindmap: Mindmap
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
    return value
  } catch {
    return null
  }
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
