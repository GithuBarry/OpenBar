import { NextResponse } from "next/server";

import { consumeCelebrations, listPendingCelebrations, queueCelebration } from "@/lib/research/celebration";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { projectContentDir } from "@/lib/store";

export const dynamic = "force-dynamic";

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
    await requireProjectAccess(slug);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
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
