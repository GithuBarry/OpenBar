import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { countMcpListeners } from "@/lib/server/mcp-listener-status";
import { ProjectAccessError, requireProjectAccess, requireWorkbenchAccess } from "@/lib/server/project-access";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const project = new URL(request.url).searchParams.get("project") ?? undefined;
  try {
    if (project === undefined) await requireWorkbenchAccess();
    else await requireProjectAccess(project);
    return Response.json({ listeners: isPublicDemoMode() ? 0 : countMcpListeners(project) }, { headers });
  } catch (error) {
    return Response.json({ error: "MCP listener status is unavailable." }, {
      status: error instanceof ProjectAccessError ? error.status : 500,
      headers,
    });
  }
}
