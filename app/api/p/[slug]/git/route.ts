import { commitAndPushProjectAction, getProjectGitStatusAction, pullProjectUpdatesAction, reconcileProjectPullAction } from "@/app/actions"
import { ProjectAccessError } from "@/lib/server/project-access"
import { requestIsSameOrigin } from "@/lib/server/request-origin"
import { ProjectWriteSessionError } from "@/lib/research/project-write-session"

export const dynamic = "force-dynamic"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function failure(error: unknown): Response {
  return json({ error: error instanceof Error ? error.message : "Git synchronization is unavailable.", ...(error instanceof ProjectWriteSessionError ? { code: error.code } : {}) }, error instanceof ProjectAccessError || error instanceof ProjectWriteSessionError ? error.status : 400)
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
    let input: { action?: unknown; message?: unknown; operationId?: unknown }
    try { input = JSON.parse(source) }
    catch { return json({ error: "The Git request is invalid." }, 400) }
    if (!input || typeof input !== "object" || (input.action !== "push" && input.action !== "pull" && input.action !== "reconcile-pull")
      || ((input.action === "pull" || input.action === "reconcile-pull") && (typeof input.operationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId)))
      || (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 2000))) {
      return json({ error: "Choose a valid Git synchronization action." }, 400)
    }
    const result = input.action === "pull"
      ? await pullProjectUpdatesAction(slug, input.operationId as string)
      : input.action === "reconcile-pull"
        ? await reconcileProjectPullAction(slug, input.operationId as string)
        : await commitAndPushProjectAction(slug, input.message as string | undefined)
    return json({ result })
  } catch (error) {
    return failure(error)
  }
}
