import { readAgentRequestBody } from "@/lib/server/agent-request-body";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { requestIsSameOrigin } from "@/lib/server/request-origin";
import { projectWriteSessionCredentialFromHeaders } from "@/lib/server/project-write-session-request";
import { projectContentDir } from "@/lib/store";
import { getHostResources } from "@/lib/server/host-resources";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import {
  PROJECT_WRITE_SESSION_HEADER,
  ProjectWriteSessionError,
  acquireProjectWriteSession,
  getProjectWriteSessionStatus,
  parseProjectWriteSessionCredential,
  releaseProjectWriteSession,
  renewProjectWriteSession,
  resumeProjectWriteSession,
} from "@/lib/research/project-write-session";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown): Response {
  if (error instanceof ProjectWriteSessionError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ProjectAccessError) {
    return json({ ok: false, code: "permission_denied", message: error.message }, error.status);
  }
  return json({ ok: false, code: "write_session_unavailable", message: "Writing access could not be verified. Keep your draft open and retry." }, 503);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  try {
    await requireProjectAccess(slug);
    const credential = request.headers.has(PROJECT_WRITE_SESSION_HEADER)
      ? projectWriteSessionCredentialFromHeaders(request.headers) : undefined;
    return json({ ok: true, status: getProjectWriteSessionStatus(projectContentDir(slug), credential),
      ...(!isPublicDemoMode() ? { hostResources: getHostResources() } : {}),
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return json({ ok: false, code: "permission_denied", message: "Open this project in OpenBar to manage writing access." }, 403);
  }
  const { slug } = await params;
  try {
    await requireProjectAccess(slug);
    let input: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(await readAgentRequestBody(request, 4096));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return json({ ok: false, code: "invalid_arguments", message: "A writing-session operation is required." }, 400);
      }
      input = value as Record<string, unknown>;
    } catch (error) {
      return json({ ok: false, code: "invalid_arguments", message: "The writing-session request is invalid." }, error instanceof RangeError ? 413 : 400);
    }
    if (input.label !== undefined && typeof input.label !== "string") {
      return json({ ok: false, code: "invalid_arguments", message: "The writing-session label must be text." }, 400);
    }
    if (input.action === "takeover" && input.expectedOwnerGeneration !== null && typeof input.expectedOwnerGeneration !== "string") {
      return json({ ok: false, code: "invalid_arguments", message: "Read the current editing session and supply its owner generation." }, 400);
    }
    const projectPath = projectContentDir(slug);
    const label = input.label as string | undefined;
    const result = input.action === "acquire" || input.action === "takeover"
      ? typeof input.sessionId === "string"
        ? await acquireProjectWriteSession(projectPath, { sessionId: input.sessionId, label, ...(input.action === "takeover" ? { expectedOwnerGeneration: input.expectedOwnerGeneration as string | null } : {}) })
        : null
      : input.action === "resume"
        ? await resumeProjectWriteSession(projectPath, parseProjectWriteSessionCredential(input.credential), label)
        : input.action === "heartbeat"
          ? await renewProjectWriteSession(projectPath, parseProjectWriteSessionCredential(input.credential))
          : input.action === "release"
            ? await releaseProjectWriteSession(projectPath, parseProjectWriteSessionCredential(input.credential))
            : null;
    return result
      ? json({ ...result, ...(!isPublicDemoMode() ? { hostResources: getHostResources() } : {}) }, result.ok ? 200 : 423)
      : json({ ok: false, code: "invalid_arguments", message: "Choose a supported writing-session operation." }, 400);
  } catch (error) { return failure(error); }
}
