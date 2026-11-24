import type { Mindmap } from "@/lib/types"
import { reportBrowserConflict } from "@/lib/research/browser-conflict"
import { mindmapDiskHash } from "./mindmap"
import { findMindmapConflictNodeIds, rebaseSavedMindmap } from "./merge-saved"

function extractConflictHash(message: string): string | undefined {
  const match = message.match(/\bhash\s+([a-f0-9]{64})\b/i)
  return match?.[1]
}

/** Map writes use a stable URL so an open editor survives application updates. */
export async function saveBrowserMindmap(project: string, mindmap: Mindmap, expectedDiskHash: string, actor: "human" | "webmcp" = "human", base?: Mindmap): Promise<Mindmap> {
  let pending = mindmap
  let expected = expectedDiskHash
  let baseline = base
  const mapId = pending.id || "draft"
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`/api/p/${encodeURIComponent(project)}/mindmap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mindmap: pending, expectedDiskHash: expected, actor }),
    })
    let conflictSaved: Mindmap | undefined
    let conflictNodeIds: string[] | undefined
    if (response.status === 409 && baseline && attempt < 2
      && (baseline.diskHash || mindmapDiskHash(baseline)) === expected) {
      const saved = await loadBrowserMindmap(project, mapId)
      conflictSaved = saved
      const rebased = rebaseSavedMindmap(baseline, saved, pending)
      if (rebased) {
        if (rebased === saved) return saved
        pending = rebased
        baseline = saved
        expected = saved.diskHash || mindmapDiskHash(saved)
        continue
      }
      const nodeIds = findMindmapConflictNodeIds(baseline, saved, pending)
      if (nodeIds.length) conflictNodeIds = nodeIds
    }
    try {
      return await readMapResponse(response)
    } catch (error) {
      if (response.status === 409 && actor === "human") {
        const message = error instanceof Error ? error.message : "conflict: mindmap changed on disk. Reload before saving."
        reportBrowserConflict(project, {
          kind: "mindmap",
          code: "mindmap_conflict",
          mapId,
          message,
          expectedHash: expected,
          currentHash: conflictSaved?.diskHash || extractConflictHash(message),
          ...(conflictNodeIds?.length ? { nodeIds: conflictNodeIds } : {}),
        })
      }
      throw error
    }
  }
  const message = "The saved map keeps changing. Your draft remains in this tab."
  if (actor === "human") {
    reportBrowserConflict(project, {
      kind: "mindmap",
      code: "mindmap_conflict",
      mapId,
      message,
      expectedHash: expected,
    })
  }
  throw new Error(message)
}

export async function loadBrowserMindmap(project: string, mapId: string): Promise<Mindmap> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/mindmap?map=${encodeURIComponent(mapId)}`, { cache: "no-store" })
  return readMapResponse(response)
}

async function readMapResponse(response: Response): Promise<Mindmap> {
  const result = await response.json().catch(() => null) as { mindmap?: Mindmap; error?: string } | null
  if (response.ok && result?.mindmap) return result.mindmap
  if (response.status === 404 && !result?.error) throw new Error("OpenBar was updated while this page was open.")
  throw new Error(result?.error || "The map could not be saved. Your draft remains in this tab.")
}

export function isOutdatedMindmapPage(message: string): boolean {
  return /server action.*(?:not found|could not be found)|failed to find server action|older or newer deployment|OpenBar was updated while this page was open/i.test(message)
}
