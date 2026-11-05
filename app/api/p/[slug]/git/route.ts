import { commitAndPushProjectAction, getProjectGitStatusAction, pullProjectUpdatesAction } from "@/app/actions"
import { ProjectAccessError } from "@/lib/server/project-access"
import { requestIsSameOrigin } from "@/lib/server/request-origin"

export const dynamic = "force-dynamic"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function failure(error: unknown): Response {
  return json({ error: error instanceof Error ? error.message : "Git synchronization is unavailable." }, error instanceof ProjectAccessError ? error.status : 400)
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "true"
    return json({ status: await getProjectGitStatusAction(slug, refresh) })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to synchronize Git." }, 403)
  const { slug } = await params
  try {
    const source = await request.text()
    if (source.length > 4096) return json({ error: "The Git request exceeds the size limit." }, 413)
    let input: { action?: unknown; message?: unknown }
    try { input = JSON.parse(source) }
    catch { return json({ error: "The Git request is invalid." }, 400) }
    if (!input || typeof input !== "object" || (input.action !== "push" && input.action !== "pull")
      || (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 2000))) {
      return json({ error: "Choose a valid Git synchronization action." }, 400)
    }
    const result = input.action === "pull"
      ? await pullProjectUpdatesAction(slug)
      : await commitAndPushProjectAction(slug, input.message as string | undefined)
    return json({ result })
  } catch (error) {
    return failure(error)
  }
}
