import { saveMindmapAction } from "@/app/actions"
import { getMindmap } from "@/lib/store"
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access"
import { requestIsSameOrigin } from "@/lib/server/request-origin"
import { ProjectWriteSessionError } from "@/lib/research/project-write-session"
import type { Mindmap } from "@/lib/types"

export const dynamic = "force-dynamic"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params
  try {
    await requireProjectAccess(slug)
    const mapId = new URL(request.url).searchParams.get("map") || "draft"
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mapId)) return json({ error: "Invalid map identity." }, 400)
    const mindmap = getMindmap(slug, mapId)
    return mindmap ? json({ mindmap }) : json({ error: "The saved map is unavailable." }, 404)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not read the saved map." }, error instanceof ProjectAccessError ? error.status : 500)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to save the map." }, 403)
  const { slug } = await params
  try {
    await requireProjectAccess(slug)
    const source = await request.text()
    if (source.length > 10_000_000) return json({ error: "This map exceeds the save size limit." }, 413)
    let input: { mindmap?: Mindmap; expectedDiskHash?: string; actor?: "human" | "webmcp" }
    try { input = JSON.parse(source) }
    catch { return json({ error: "The map save request is invalid." }, 400) }
    if (!input?.mindmap || typeof input.mindmap !== "object" || !Array.isArray(input.mindmap.nodes)
      || typeof input.expectedDiskHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.expectedDiskHash)) {
      return json({ error: "The map and its saved revision are required." }, 400)
    }
    if (input.actor !== undefined && input.actor !== "human" && input.actor !== "webmcp") return json({ error: "Invalid edit source." }, 400)
    const mindmap = await saveMindmapAction(slug, input.mindmap, input.expectedDiskHash, input.actor)
    return json({ mindmap })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the map."
    return json({ error: message, ...(error instanceof ProjectWriteSessionError ? { code: error.code } : {}) }, error instanceof ProjectAccessError || error instanceof ProjectWriteSessionError ? error.status : /conflict|changed on disk/i.test(message) ? 409 : 400)
  }
}
