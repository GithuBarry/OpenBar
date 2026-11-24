import { z } from "zod";
import { clearGitConflict, recordGitConflict } from "@/lib/research/git-conflict-events";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { requestIsSameOrigin } from "@/lib/server/request-origin";
import { projectContentDir } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

const conflictReportSchema = z.object({
  kind: z.enum(["mindmap", "paper"]),
  code: z.enum(["mindmap_conflict", "paper_conflict"]),
  message: z.string().trim().min(1).max(1000),
  mapId: z.string().regex(SAFE_SLUG).max(200).optional(),
  nodeIds: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  files: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  expectedHash: z.string().regex(SHA256_HEX).optional(),
  currentHash: z.string().regex(SHA256_HEX).optional(),
}).strict();

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function handleError(error: unknown): Response {
  if (error instanceof ProjectAccessError) return json({ ok: false, error: error.message }, error.status);
  return json({ ok: false, error: error instanceof Error ? error.message : "Conflict notification failed." }, 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ ok: false, error: "Cross-origin conflict notifications are not allowed." }, 403);
  const { slug } = await context.params;
  try {
    await requireProjectAccess(slug);
    assertAdministrativeWriteAllowed("Conflict notification");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json({ ok: false, error: "Conflict notification payload is too large." }, 413);
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(raw); }
    catch { return json({ ok: false, error: "Invalid conflict notification payload." }, 400); }
    const parsed = conflictReportSchema.safeParse(parsedJson);
    if (!parsed.success) return json({ ok: false, error: "Invalid conflict notification payload." }, 400);
    const data = parsed.data;
    if ((data.kind === "mindmap" && data.code !== "mindmap_conflict") || (data.kind === "paper" && data.code !== "paper_conflict")) {
      return json({ ok: false, error: "Conflict kind and code must match." }, 400);
    }
    const recorded = recordGitConflict(projectContentDir(slug), data);
    return json({ ok: true, id: recorded?.id ?? null });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ ok: false, error: "Cross-origin conflict updates are not allowed." }, 403);
  const { slug } = await context.params;
  try {
    await requireProjectAccess(slug);
    assertAdministrativeWriteAllowed("Conflict notification");
    const search = new URL(request.url).searchParams;
    const kind = search.get("kind");
    if (kind !== "mindmap" && kind !== "paper") return json({ ok: false, error: "Specify kind=mindmap or kind=paper." }, 400);
    const mapId = search.get("mapId") || undefined;
    if (mapId !== undefined && !SAFE_SLUG.test(mapId)) return json({ ok: false, error: "Invalid mapId." }, 400);
    const cleared = clearGitConflict(projectContentDir(slug), kind, mapId);
    return json({ ok: true, cleared });
  } catch (error) {
    return handleError(error);
  }
}
