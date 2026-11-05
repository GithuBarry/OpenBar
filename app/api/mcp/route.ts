import { randomUUID } from "node:crypto"
import {
  createMcpHandler,
  isLegacyRequest,
  isJSONRPCRequest,
  parseJSONRPCMessage,
  readRequestBody,
  SUPPORTED_PROTOCOL_VERSIONS,
  WebStandardStreamableHTTPServerTransport,
  type Server,
} from "@modelcontextprotocol/server"

import { agentOriginAllowed, agentCors } from "@/lib/server/agent-http"
import { authorizeMcpRequest } from "@/lib/server/mcp-access"
import { createOpenbarMcpServer } from "@/lib/server/mcp-server"
import { pruneMcpSessions, touchMcpSession, type McpSession } from "@/lib/server/mcp-sessions"

export const dynamic = "force-dynamic"

const MAX_REQUEST_BYTES = 4_000_000

type Session = McpSession & {
  server: Server
  transport: WebStandardStreamableHTTPServerTransport
  activeRequestIds: Set<string>
}
const sessions = new Map<string, Session>()
const modern = createMcpHandler(({ authInfo }) => createOpenbarMcpServer(authInfo!.clientId), {
  legacy: "reject",
  maxRequestBodySize: MAX_REQUEST_BYTES,
})

// Expiry also closes SDK protocol state, which aborts its in-flight handlers.
const expiryTimer = setInterval(() => { void pruneMcpSessions(sessions) }, 60_000)
expiryTimer.unref()

function errorResponse(message: string, code: string, status: number): Response {
  return Response.json({ error: message, code }, { status })
}

function policyError(id: string | number | null, message: string, status: number): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code: -32600, message } }, { status })
}

async function sessionRequest(session: Session, request: Request, parsedBody: unknown): Promise<Response> {
  let key: string | undefined
  try {
    const message = parseJSONRPCMessage(parsedBody)
    if (isJSONRPCRequest(message)) {
      key = `${typeof message.id}:${String(message.id)}`
      if (session.activeRequestIds.has(key)) return policyError(message.id, "This request ID is already executing.", 200)
    }
  } catch { /* The SDK transport produces the protocol validation response. */ }
  if (key) session.activeRequestIds.add(key)
  try {
    const headers = new Headers(request.headers)
    // This endpoint has always returned JSON to legacy callers. Adapt its
    // permissive Accept policy to the SDK transport's two-format requirement.
    headers.set("Accept", "application/json, text/event-stream")
    return await session.transport.handleRequest(new Request(request.url, { method: request.method, headers, signal: request.signal }), { parsedBody })
  } finally {
    if (key) session.activeRequestIds.delete(key)
  }
}

async function serveSession(request: Request, actor: string, parsedBody: unknown, existing?: Session): Promise<Response> {
  const protocolHeader = request.headers.get("mcp-protocol-version")
  if (protocolHeader && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolHeader)) {
    return errorResponse("Unsupported MCP-Protocol-Version.", "invalid_protocol", 400)
  }
  if (existing) {
    const negotiated = existing.server.getNegotiatedProtocolVersion()
    // OpenBar provides request/response tools and deliberately exposes this
    // surface through POST. The SDK owns per-request streaming and DELETE.
    if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST, DELETE, OPTIONS" } })
    const response = await sessionRequest(existing, request, parsedBody)
    if (negotiated) response.headers.set("MCP-Protocol-Version", negotiated)
    return request.method === "DELETE" && response.ok ? new Response(null, { status: 204 }) : response
  }
  if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST, DELETE, OPTIONS" } })
  if (request.method === "DELETE") return new Response(null, { status: 204 })

  const server = createOpenbarMcpServer(actor)
  const activeRequestIds = new Set<string>()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    onsessioninitialized: (id) => {
      sessions.set(id, { actor, lastSeen: Date.now(), server, transport, activeRequestIds, close: () => server.close() })
    },
  })
  server.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId)
  }
  await server.connect(transport)
  try {
    const response = await sessionRequest({ actor, lastSeen: Date.now(), server, transport, activeRequestIds, close: () => server.close() }, request, parsedBody)
    const protocol = server.getNegotiatedProtocolVersion()
    if (protocol) response.headers.set("MCP-Protocol-Version", protocol)
    // The transport creates a session before the SDK validates initialize.
    // Close failed handshakes and malformed opening messages immediately.
    if (!protocol) await server.close()
    return response
  } catch (error) {
    await server.close()
    throw error
  }
}

async function serveAuthenticated(request: Request, actor: string, session?: Session): Promise<Response> {
  let parsedBody: unknown
  if (request.method === "POST") {
    // The SDK bounds incoming bytes. OpenBar's single-message policy and
    // duplicate-id guard run before the transport allocates response streams.
    const body = await readRequestBody(request, MAX_REQUEST_BYTES)
    if (body.tooLarge) return errorResponse("MCP request is too large.", "request_too_large", 413)
    try { parsedBody = JSON.parse(body.text) }
    catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "MCP request must contain valid JSON." } }, { status: 400 }) }
    if (Array.isArray(parsedBody)) return policyError(null, "Send one JSON-RPC message per HTTP request.", 400)
  }
  if (await isLegacyRequest(request, parsedBody, { maxRequestBodySize: MAX_REQUEST_BYTES })) {
    // SDK classification preserves stateful 2025 clients alongside its
    // per-request modern handler. Both use the same domain server factory.
    return serveSession(request, actor, parsedBody, session)
  }
  return modern.fetch(request, { parsedBody, authInfo: { token: "", clientId: actor, scopes: [] } })
}

async function dispatch(request: Request): Promise<Response> {
  if (!agentOriginAllowed(request)) return errorResponse("Agent origin is outside OPENBARRY_AGENT_ORIGINS.", "origin_not_allowed", 403)
  let response: Response
  if (request.method === "OPTIONS") {
    response = new Response(null, { status: 204, headers: { Allow: "GET, POST, DELETE, OPTIONS" } })
  } else {
    const access = await authorizeMcpRequest(request)
    if (!access.ok) {
      response = errorResponse(access.message, "mcp_access_required", access.status)
    } else {
      await pruneMcpSessions(sessions)
      const sessionId = request.headers.get("mcp-session-id")?.trim()
      const session = sessionId ? sessions.get(sessionId) : undefined
      const protocol = request.headers.get("mcp-protocol-version")
      if (sessionId && !session) {
        response = errorResponse("Unknown or expired MCP session.", "invalid_session", 404)
      } else if (session && !touchMcpSession(session, access.actor)) {
        response = errorResponse("Session belongs to another identity.", "invalid_session", 403)
      } else if (session && protocol && session.server.getNegotiatedProtocolVersion() && protocol !== session.server.getNegotiatedProtocolVersion()) {
        response = errorResponse("Use the protocol negotiated for this session.", "invalid_protocol", 400)
      } else {
        response = await serveAuthenticated(request, access.actor, session)
      }
    }
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
