import type { Mindmap } from "@/lib/types"

/** Map writes use a stable URL so an open editor survives application updates. */
export async function saveBrowserMindmap(project: string, mindmap: Mindmap, expectedDiskHash: string, actor: "human" | "webmcp" = "human"): Promise<Mindmap> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/mindmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mindmap, expectedDiskHash, actor }),
  })
  return readMapResponse(response)
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
