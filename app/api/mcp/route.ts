import { agentOriginAllowed, agentCors } from "@/lib/server/agent-http";
import { readAgentRequestBody } from "@/lib/server/agent-request-body";
import { pruneMcpSessions, touchMcpSession, type McpSession } from "@/lib/server/mcp-sessions";
import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance";
import { randomUUID } from "node:crypto";
import { discoveryRpc } from "@/lib/research/mcp-discovery";

import { authorizeMcpRequest } from "@/lib/server/mcp-access";
import { executeMcpTool, listMcpTools } from "@/lib/research/mcp-command-registry";

export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number;
  method?: unknown;
  params?: unknown;
};


const sessions = new Map<string, McpSession>();
const SUPPORTED_PROTOCOLS = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);

function headers(sessionId?: string): Headers {
  const result = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Link": '</agents>; rel="help", </llms-deployment.txt>; rel="help"; type="text/plain", </llms.txt>; rel="alternate"; type="text/plain"',
  });
  if (sessionId) result.set("Mcp-Session-Id", sessionId);
  return result;
}

function json(body: unknown, status = 200, sessionId?: string): Response {
  const responseHeaders = headers(sessionId);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown, sessionId?: string): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }, 200, sessionId);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requestKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

function isValidRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as JsonRpcRequest;
  return item.jsonrpc === "2.0" && typeof item.method === "string" && (item.id === undefined || typeof item.id === "string" || (typeof item.id === "number" && Number.isFinite(item.id)));
}

function sessionFrom(request: Request): { id?: string; session?: McpSession } {
  const id = request.headers.get("mcp-session-id")?.trim() || undefined;
  return { id, session: id ? sessions.get(id) : undefined };
}

function pruneSessions(): void {
  pruneMcpSessions(sessions);
}

function toolList() {
  return listMcpTools().map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

function mcpToolResult(result: { ok: boolean; value?: unknown; [key: string]: unknown }, id: string | number | null | undefined, sessionId?: string): Response {
  const text = JSON.stringify(result);
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text }],
      structuredContent: result,
      ...(result.ok ? {} : { isError: true }),
    },
  }, 200, sessionId);
}

async function handleRpc(value: unknown, actor: string, sessionId?: string): Promise<Response> {
  if (!isValidRequest(value)) return rpcError(null, -32600, "Invalid JSON-RPC request.", undefined, sessionId);
  const id = value.id;
  const method = value.method as string;
  if (value.params !== undefined && !isObject(value.params)) return rpcError(id, -32602, "params must be an object.", undefined, sessionId);
  const params = isObject(value.params) ? value.params : {};
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (id === undefined) {
    if (method === "notifications/cancelled" && session) {
      const cancelledId = params.requestId;
      if (typeof cancelledId === "string" || typeof cancelledId === "number") session.requests?.get(requestKey(cancelledId))?.abort();
    }
    return new Response(null, { status: 202, headers: headers(sessionId) });
  }
  if (method === "ping") return json({ jsonrpc: "2.0", id: id ?? null, result: {} }, 200, sessionId);
  if (method === "initialize") {
    if (session) return rpcError(id, -32600, "This session is already initialized.", undefined, sessionId);
    if (typeof params.protocolVersion !== "string" || !isObject(params.capabilities) || !isObject(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
      return rpcError(id, -32602, "initialize requires protocolVersion, capabilities, and clientInfo with name and version.");
    }
    const requested = params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-11-25";
    const nextSessionId = sessionId || randomUUID();
    sessions.set(nextSessionId, { actor, lastSeen: Date.now(), protocolVersion, requests: new Map() });
    return json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
        serverInfo: { name: "OpenBar", version: "0.1.0" },
        instructions: AGENT_GUIDANCE,
      },
    }, 200, nextSessionId);
  }
  if (method === "tools/list") {
    return json({ jsonrpc: "2.0", id: id ?? null, result: { tools: toolList() } }, 200, sessionId);
  }
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!name || !listMcpTools().some((tool) => tool.name === name)) return rpcError(id, -32602, name ? `Unknown tool "${name}".` : "tools/call requires params.name.", { code: "invalid_arguments" }, sessionId);
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isObject(args)) return rpcError(id, -32602, "tools/call arguments must be an object.", { code: "invalid_arguments" }, sessionId);
    const key = requestKey(id);
    if (session?.requests?.has(key)) return rpcError(id, -32600, "This request ID is already executing.", undefined, sessionId);
    const controller = new AbortController();
    session?.requests?.set(key, controller);
    try {
      const result = await executeMcpTool(name, args, { actor, requestId: sessionId ? `${sessionId}:${key}` : undefined, signal: controller.signal });
      return mcpToolResult(result, id, sessionId);
    } finally {
      session?.requests?.delete(key);
    }
  }
  const discovery = await discoveryRpc(method, params, actor);
  if (discovery) return json({ jsonrpc: "2.0", id: id ?? null, ...discovery }, 200, sessionId);
  return rpcError(id, -32601, `Method "${method}" is not supported by OpenBar MCP.`, undefined, sessionId);
}

async function handlePost(request: Request): Promise<Response> {
  pruneSessions();
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  const session = sessionFrom(request);
  if (session.session && !touchMcpSession(session.session, access.actor)) return json({ error: "Session belongs to another identity.", code: "invalid_session" }, 403);
  if (session.id && !session.session && request.headers.get("mcp-session-id")) return json({ error: "Unknown or expired MCP session.", code: "invalid_session" }, 404);
  let body: unknown;
  try {
    const raw = await readAgentRequestBody(request);
    if (raw.length > 4_000_000) return json({ error: "MCP request is too large.", code: "request_too_large" }, 413, session.id);
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message, code: "request_too_large" }, 413, session.id);
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "MCP request must contain valid JSON." } }, 400, session.id);
  }
  if (Array.isArray(body)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send one JSON-RPC message per HTTP request." } }, 400);
  if (isObject(body) && typeof body.method === "string" && body.method !== "initialize" && !session.session) return json({ error: "Initialize a session before sending MCP messages.", code: "session_required" }, 400);
  if (isObject(body) && body.jsonrpc === "2.0" && body.method === undefined && (typeof body.id === "string" || typeof body.id === "number") && (("result" in body) !== ("error" in body))) {
    return new Response(null, { status: 202, headers: headers(session.id) });
  }
  const response = await handleRpc(body, session.session?.actor || access.actor, session.id);
  return response;
}

async function handleGet(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  pruneSessions();
  const { id, session } = sessionFrom(request);
  if (id && !session) return json({ error: "Unknown or expired MCP session.", code: "invalid_session" }, 404);
  if (session && !touchMcpSession(session, access.actor)) return json({ error: "Session belongs to another identity.", code: "invalid_session" }, 403);
  return new Response(null, { status: 405, headers: { Allow: "POST, DELETE, OPTIONS" } });
}

async function handleDelete(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  pruneSessions();
  const { id, session } = sessionFrom(request);
  if (id && !session) return json({ error: "Unknown or expired MCP session.", code: "invalid_session" }, 404);
  if (session && session.actor !== access.actor) return json({ error: "Session belongs to another identity.", code: "invalid_session" }, 403);
  if (id) {
    for (const controller of session?.requests?.values() || []) controller.abort();
    sessions.delete(id);
  }
  return new Response(null, { status: 204, headers: headers(id || undefined) });
}

async function dispatch(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  if (!agentOriginAllowed(request)) return json({ error: "Agent origin is outside OPENBARRY_AGENT_ORIGINS.", code: "origin_not_allowed" }, 403);
  const protocol = request.headers.get("mcp-protocol-version");
  if (protocol && !SUPPORTED_PROTOCOLS.has(protocol)) return agentCors(request, json({ error: "Unsupported MCP-Protocol-Version.", code: "invalid_protocol" }, 400));
  const currentSession = sessionFrom(request).session;
  if (protocol && currentSession && currentSession.protocolVersion !== protocol) return agentCors(request, json({ error: "Use the protocol negotiated for this session.", code: "invalid_protocol" }, 400));
  const response = await handler(request);
  const negotiated = sessions.get(response.headers.get("mcp-session-id") || "")?.protocolVersion;
  if (negotiated) response.headers.set("MCP-Protocol-Version", negotiated);
  if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="OpenBar"');
  return agentCors(request, response);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return dispatch(request, async () => new Response(null, { status: 204, headers: { Allow: "GET, POST, DELETE, OPTIONS", "Cache-Control": "no-store" } }));
}
export async function POST(request: Request) { return dispatch(request, handlePost); }
export async function GET(request: Request) { return dispatch(request, handleGet); }
export async function DELETE(request: Request) { return dispatch(request, handleDelete); }
