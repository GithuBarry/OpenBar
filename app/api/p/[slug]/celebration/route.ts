import { NextResponse } from "next/server";

import { consumeCelebrations, listPendingCelebrations, queueCelebration } from "@/lib/research/celebration";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { requestIsSameOrigin } from "@/lib/server/request-origin";
import { projectContentDir } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_CELEBRATION_BODY_BYTES = 4096;

function handleError(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Celebration request failed." }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    await requireProjectAccess(slug);
    return NextResponse.json({ ok: true, pending: listPendingCelebrations(projectContentDir(slug)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    if (!requestIsSameOrigin(request)) {
      return NextResponse.json({ ok: false, error: "Cross-origin celebration requests are not allowed." }, { status: 403 });
    }
    await requireProjectAccess(slug);
    assertAdministrativeWriteAllowed("Celebration actions");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_CELEBRATION_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "Celebration payload is too large." }, { status: 413 });
    }
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = null; }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid celebration payload." }, { status: 400 });
    }
    const dir = projectContentDir(slug);
    if (body.action === "consume" && Array.isArray(body.ids)) {
      const consumed = consumeCelebrations(dir, body.ids.filter((id): id is string => typeof id === "string"));
      return NextResponse.json({ ok: true, consumed });
    }
    if (body.action === "trigger" && typeof body.reason === "string" && body.reason.trim()) {
      const event = queueCelebration(dir, {
        reason: body.reason,
        scope: body.scope === "card" ? "card" : "screen",
        emoji: typeof body.emoji === "string" ? body.emoji : undefined,
        mapId: typeof body.mapId === "string" ? body.mapId : undefined,
        nodeId: typeof body.nodeId === "string" ? body.nodeId : undefined,
      });
      return NextResponse.json({ ok: true, event });
    }
    return NextResponse.json({ ok: false, error: "Unsupported celebration action." }, { status: 400 });
  } catch (error) {
    return handleError(error);
  }
}
