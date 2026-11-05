import { getEditableTexPaper, projectContentDir } from "@/lib/store"
import { getPaperCompileStatus, requestPaperCompile } from "@/lib/tex-project/compile"
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access"
import { requestIsSameOrigin } from "@/lib/server/request-origin"

export const dynamic = "force-dynamic"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params
  try {
    await requireProjectAccess(slug)
    return json({ compile: getPaperCompileStatus(projectContentDir(slug)) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not check the PDF." }, error instanceof ProjectAccessError ? error.status : 500)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to compile the paper." }, 403)
  const { slug } = await params
  try {
    await requireProjectAccess(slug)
    if (!getEditableTexPaper(slug)) return json({ error: "This project has no TeX paper." }, 404)
    return json({ compile: requestPaperCompile(projectContentDir(slug)) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not compile the PDF." }, error instanceof ProjectAccessError ? error.status : 500)
  }
}
