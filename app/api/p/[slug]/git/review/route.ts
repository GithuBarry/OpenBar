import { finishProjectPullAction, prepareProjectPullAction } from "@/app/actions";
import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import { readAgentRequestBody } from "@/lib/server/agent-request-body";
import { redactSensitiveText } from "@/lib/server/git-url";
import { requestIsSameOrigin } from "@/lib/server/request-origin";
import { withBrowserProjectWriteSession } from "@/lib/server/project-write-session-request";
import { ProjectWriteSessionError } from "@/lib/research/project-write-session";
import { projectContentDir } from "@/lib/store";
import { finishOverleafPull, prepareOverleafPull } from "@/lib/tex-project/overleaf-git";
import type { OverleafConflictChoice } from "@/lib/tex-project/overleaf-git";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!requestIsSameOrigin(request)) return json({ error: "Open this project in OpenBar to review Git updates." }, 403);
  try {
    const { slug } = await params;
    await requireProjectAccess(slug);
    const sizeLimit = 10 * 1024 * 1024;
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > sizeLimit) return json({ error: "The Git review request exceeds the size limit." }, 413);
    let source: string;
    try { source = await readAgentRequestBody(request, sizeLimit); }
    catch (error) {
      return error instanceof RangeError
        ? json({ error: "The Git review request exceeds the size limit." }, 413)
        : json({ error: "The Git review request is invalid." }, 400);
    }
    let input: unknown;
    try { input = JSON.parse(source); }
    catch { return json({ error: "The Git review request is invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The Git review request is invalid." }, 400);
    const { action, token, choices, cancel, stream } = input as Record<string, unknown>;
    if (action === "prepare" && stream === true) {
      assertAdministrativeWriteAllowed("Review Git pull");
      const projectDir = projectContentDir(slug);
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stop = () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        request.signal.removeEventListener("abort", stop);
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: object) => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
            catch { stop(); }
          };
          request.signal.addEventListener("abort", stop, { once: true });
          if (request.signal.aborted) stop();
          send({ type: "started" });
          if (closed) return;
          heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
          void (async () => {
            try {
              await withBrowserProjectWriteSession(projectDir, async () => {
                const result = await prepareOverleafPull(projectDir, line => send({ type: "log", line }));
                if (result.ok) {
                  send({ type: "result", result });
                  if (closed) await finishOverleafPull(projectDir, result.review.token, [], true);
                } else send({ type: "error", message: redactSensitiveText(result.message) });
              }, request);
            } catch (error) {
              send({ type: "error", message: error instanceof Error ? redactSensitiveText(error.message) : "Git review is unavailable." });
            } finally {
              if (!closed) { stop(); controller.close(); }
              else stop();
            }
          })();
        },
        cancel() { stop(); },
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }
    if (action === "prepare") return json({ result: await prepareProjectPullAction(slug) });
    if (action !== "finish" || typeof token !== "string" || !Array.isArray(choices) || choices.length > 1000
      || (cancel !== undefined && typeof cancel !== "boolean")
      || choices.some((item) => !item || typeof item !== "object" || Array.isArray(item)
        || typeof item.path !== "string" || !["local", "remote", "merged"].includes(item.choice)
        || (item.choice === "merged" && (typeof item.text !== "string" || new TextEncoder().encode(item.text).byteLength > 1_000_000)))) {
      return json({ error: "The Git review request is invalid." }, 400);
    }
    return json({ result: await finishProjectPullAction(slug, token, choices as OverleafConflictChoice[], cancel === true) });
  } catch (error) {
    const message = error instanceof Error ? redactSensitiveText(error.message) : "Git review is unavailable.";
    return json({ error: message, ...(error instanceof ProjectWriteSessionError ? { code: error.code } : {}) }, error instanceof ProjectAccessError || error instanceof ProjectWriteSessionError ? error.status : 500);
  }
}
