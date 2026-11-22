import { createMcpHandler } from "@modelcontextprotocol/server"

import { agentOriginAllowed, agentCors } from "@/lib/server/agent-http"
import { authorizeMcpRequest } from "@/lib/server/mcp-access"
import { createOpenbarMcpServer } from "@/lib/server/mcp-server"
import { inboxEventHeaderError, MCP_MAX_REQUEST_BODY_SIZE } from "@/lib/server/mcp-events"

export const dynamic = "force-dynamic"

const handler = createMcpHandler(({ authInfo, era }) => createOpenbarMcpServer(authInfo!.clientId, { events: era === "modern" }), {
  maxRequestBodySize: MCP_MAX_REQUEST_BODY_SIZE,
})

async function dispatch(request: Request): Promise<Response> {
  if (!agentOriginAllowed(request)) return Response.json({ error: "Agent origin is outside OPENBAR_AGENT_ORIGINS.", code: "origin_not_allowed" }, { status: 403 })
  let response: Response
  if (request.method === "OPTIONS") {
    response = new Response(null, { status: 204, headers: { Allow: "GET, POST, DELETE, OPTIONS" } })
  } else {
    const access = await authorizeMcpRequest(request)
    response = access.ok
      ? await inboxEventHeaderError(request) || await handler.fetch(request, { authInfo: { token: "", clientId: access.actor, scopes: [] } })
      : Response.json({ error: access.message, code: "mcp_access_required" }, { status: access.status })
  }
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Link", '</agents>; rel="help", </llms-deployment.txt>; rel="help"; type="text/plain", </llms.txt>; rel="alternate"; type="text/plain"')
  if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="OpenBar"')
  return agentCors(request, response)
}

export const OPTIONS = dispatch
export const POST = dispatch
export const GET = dispatch
export const DELETE = dispatch
