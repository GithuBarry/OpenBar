import { authorizeMcpRequest } from "./mcp-access"
import { agentOrigins } from "./agent-origins"

export function agentOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const url = new URL(request.url)
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1)
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host
  return origin === `${protocol}://${host}` || origin === url.origin || agentOrigins().includes(origin)
}

export function agentCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.append("Vary", "Origin")
  const origin = request.headers.get("origin")
  if (origin && agentOriginAllowed(request)) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Access-Control-Allow-Credentials", "true")
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID")
    headers.set("Access-Control-Expose-Headers", "Mcp-Protocol-Version, WWW-Authenticate")
  }
  return new Response(response.body, { status: response.status, headers })
}

export async function agentHttp(request: Request, run: (actor: string) => Promise<Response>): Promise<Response> {
  if (!agentOriginAllowed(request)) return Response.json({ ok: false, code: "origin_not_allowed", message: "Configure this origin in OPENBARRY_AGENT_ORIGINS." }, { status: 403 })
  if (request.method === "OPTIONS") return agentCors(request, new Response(null, { status: 204 }))
  const auth = await authorizeMcpRequest(request)
  if (!auth.ok) return agentCors(request, Response.json({ ok: false, code: "mcp_access_required", message: auth.message }, { status: auth.status, headers: auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="OpenBar"' } : {} }))
  return agentCors(request, await run(auth.actor))
}
