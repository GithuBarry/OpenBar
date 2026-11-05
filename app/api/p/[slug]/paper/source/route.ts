import { getEditablePaperAction, persistSourceBundleAction } from "@/app/actions"
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access"
import { requestIsSameOrigin } from "@/lib/server/request-origin"

export const dynamic = "force-dynamic"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params
  try {
    return json({ paper: await getEditablePaperAction(slug) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not read the paper." }, error instanceof ProjectAccessError ? error.status : 500)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to save the paper." }, 403)
  const { slug } = await params
  try {
    await requireProjectAccess(slug)
    const source = await request.text()
    if (source.length > 10_000_000) return json({ error: "This paper exceeds the save size limit." }, 413)
    let input: { nextSource?: unknown; expectedBundleHash?: unknown; dryRun?: unknown }
    try { input = JSON.parse(source) }
    catch { return json({ error: "The paper save request is invalid." }, 400) }
    if (!input || typeof input.nextSource !== "string" || typeof input.expectedBundleHash !== "string"
      || !/^[a-f0-9]{64}$/i.test(input.expectedBundleHash)
      || (input.dryRun !== undefined && typeof input.dryRun !== "boolean")) {
      return json({ error: "The paper source and its saved revision are required." }, 400)
    }
    const result = await persistSourceBundleAction(slug, input.nextSource, input.expectedBundleHash, input.dryRun === true)
    return json(result, result.ok ? 200 : result.code === "stale_disk_state" || result.code === "conflict" ? 409 : 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save the paper." }, error instanceof ProjectAccessError ? error.status : 500)
  }
}
