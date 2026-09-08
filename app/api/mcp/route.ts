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
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};


const sessions = new Map<string, McpSession>();
const SUPPORTED_PROTOCOLS = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);

function headers(sessionId?: string): Headers {
  const result = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Link": '</agents>; rel="help", </llms.txt>; rel="alternate"; type="text/plain"',
  });
  if (sessionId) result.set("Mcp-Session-Id", sessionId);
  return result;
}

function json(body: unknown, status = 200, sessionId?: string): Response {
  const responseHeaders = headers(sessionId);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }, 200);
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

async function handleRpc(request: Request, value: unknown, actor: string, sessionId?: string): Promise<Response> {
  if (!isValidRequest(value)) return rpcError(null, -32600, "Invalid JSON-RPC request.");
  const id = value.id;
  const method = value.method as string;
  const params = value.params && typeof value.params === "object" ? value.params as Record<string, unknown> : {};
  if (id === undefined) {
    return new Response(null, { status: 202, headers: headers(sessionId) });
  }
  if (method === "ping") return json({ jsonrpc: "2.0", id: id ?? null, result: {} }, 200, sessionId);
  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-11-25";
    const nextSessionId = sessionId || randomUUID();
    sessions.set(nextSessionId, { actor, lastSeen: Date.now(), protocolVersion });
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
    if (!name) return rpcError(id, -32602, "tools/call requires params.name.", { code: "invalid_arguments" });
    const args = params.arguments === undefined ? {} : params.arguments;
    const contextRequestId = sessionId && (typeof id === "string" || typeof id === "number") ? `${sessionId}:${String(id)}` : undefined;
    const result = await executeMcpTool(name, args, { actor, requestId: contextRequestId, signal: request.signal });
    return mcpToolResult(result, id, sessionId);
  }
  const discovery = await discoveryRpc(method, params, actor);
  if (discovery) return json({ jsonrpc: "2.0", id: id ?? null, ...discovery }, 200, sessionId);
  return rpcError(id, -32601, `Method "${method}" is not supported by OpenBar MCP.`);
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
  const response = await handleRpc(request, body, session.session?.actor || access.actor, session.id);
  return response;
}

async function handleGet(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  return new Response(null, { status: 405, headers: { Allow: "POST, DELETE, OPTIONS" } });
}

async function handleDelete(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  pruneSessions();
  const { id, session } = sessionFrom(request);
  if (id && !session) return json({ error: "Unknown or expired MCP session.", code: "invalid_session" }, 404);
  if (session && session.actor !== access.actor) return json({ error: "Session belongs to another identity.", code: "invalid_session" }, 403);
  if (id) sessions.delete(id);
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
