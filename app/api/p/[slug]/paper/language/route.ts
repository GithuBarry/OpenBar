import { readRequestBody } from "@modelcontextprotocol/server";
import { getEditableTexPaper } from "@/lib/store";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { requestIsSameOrigin } from "@/lib/server/request-origin";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { latexCompletions, latexLanguageServerAvailable } from "@/lib/tex-project/latex-lsp";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireProjectAccess((await params).slug);
    if (isPublicDemoMode()) return json({ available: false, reason: "demo" });
    return json({ available: await latexLanguageServerAvailable(), reason: "missing" });
  } catch (error) {
    return json({ available: false }, error instanceof ProjectAccessError ? error.status : 500);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to use LaTeX assistance." }, 403);
  if (isPublicDemoMode()) return json({ error: "LaTeX language assistance is unavailable in the shared demo." }, 403);
  try {
    const { slug } = await params;
    await requireProjectAccess(slug);
    if (!getEditableTexPaper(slug)) return json({ error: "This project has no TeX paper." }, 404);
    const body = await readRequestBody(request, 2_000_000);
    if (body.tooLarge) return json({ error: "Manuscript snapshot is too large for LaTeX assistance." }, 413);
    let input: unknown;
    try { input = JSON.parse(body.text); } catch { return json({ error: "Invalid request." }, 400); }
    if (!input || typeof input !== "object") return json({ error: "Invalid request." }, 400);
    const { source, file, offset } = input as Record<string, unknown>;
    if (typeof source !== "string" || typeof file !== "string" || typeof offset !== "number") return json({ error: "Invalid request." }, 400);
    return json({ items: await latexCompletions(source, file, offset, request.signal) });
  } catch (error) {
    if (error instanceof ProjectAccessError) return json({ error: error.message }, error.status);
    return json({ error: "LaTeX assistance is unavailable for this request." }, 503);
  }
}
