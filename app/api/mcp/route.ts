import { agentOrigins } from "@/lib/server/agent-origins";
import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance";
import { randomUUID } from "node:crypto";

import { authorizeMcpRequest } from "@/lib/server/mcp-access";
import { executeMcpTool, listMcpTools } from "@/lib/research/mcp-command-registry";

export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

type McpSession = { actor: string; lastSeen: number };

const sessions = new Map<string, McpSession>();
const SUPPORTED_PROTOCOLS = new Set(["2025-03-26", "2025-06-18"]);

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
  return item.jsonrpc === "2.0" && typeof item.method === "string";
}

function sessionFrom(request: Request): { id?: string; session?: McpSession } {
  const id = request.headers.get("mcp-session-id")?.trim() || undefined;
  return { id, session: id ? sessions.get(id) : undefined };
}

function pruneSessions(): void {
  const threshold = Date.now() - 30 * 60_000;
  for (const [id, session] of sessions) if (session.lastSeen < threshold) sessions.delete(id);
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
  const text = JSON.stringify(result.ok ? result.value : result);
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text }],
      structuredContent: result.ok ? result.value : result,
      ...(result.ok ? {} : { isError: true }),
    },
  }, 200, sessionId);
}

async function handleRpc(request: Request, value: unknown, actor: string, sessionId?: string): Promise<Response> {
  if (!isValidRequest(value)) return rpcError(null, -32600, "Invalid JSON-RPC request.");
  const id = value.id;
  const method = value.method as string;
  const params = value.params && typeof value.params === "object" ? value.params as Record<string, unknown> : {};
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: headers(sessionId) });
  }
  if (method === "ping") return json({ jsonrpc: "2.0", id: id ?? null, result: {} }, 200, sessionId);
  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-03-26";
    const nextSessionId = sessionId || randomUUID();
    sessions.set(nextSessionId, { actor, lastSeen: Date.now() });
    return json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
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
    const contextRequestId = typeof id === "string" || typeof id === "number" ? `${sessionId || "stateless"}:${String(id)}` : undefined;
    const result = await executeMcpTool(name, args, { actor, requestId: contextRequestId, signal: request.signal });
    return mcpToolResult(result, id, sessionId);
  }
  if (method === "resources/list") return json({ jsonrpc: "2.0", id: id ?? null, result: { resources: [] } }, 200, sessionId);
  return rpcError(id, -32601, `Method "${method}" is not supported by OpenBar MCP.`);
}

async function handlePost(request: Request): Promise<Response> {
  pruneSessions();
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  const session = sessionFrom(request);
  if (session.id && !session.session && request.headers.get("mcp-session-id")) return json({ error: "Unknown or expired MCP session.", code: "invalid_session" }, 404);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4_000_000) return json({ error: "MCP request is too large.", code: "request_too_large" }, 413, session.id);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "MCP request must contain valid JSON.", code: "invalid_json" }, 400, session.id);
  }
  if (Array.isArray(body)) {
    const responses: unknown[] = [];
    for (const item of body) {
      const response = await handleRpc(request, item, session.session?.actor || access.actor, session.id);
      const text = await response.text();
      if (text) {
        try { responses.push(JSON.parse(text)); } catch { responses.push({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Invalid internal MCP response." } }); }
      }
    }
    return json(responses, 200, session.id);
  }
  const response = await handleRpc(request, body, session.session?.actor || access.actor, session.id);
  const nextSession = response.headers.get("mcp-session-id") || session.id;
  if (!nextSession) return response;
  const text = await response.text();
  return new Response(text, { status: response.status, headers: response.headers });
}

async function handleGet(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  const session = sessionFrom(request);
  if (!session.id || !session.session) return json({ error: "Mcp-Session-Id is required for the server event stream.", code: "invalid_session" }, 400);
  sessions.set(session.id, { ...session.session, lastSeen: Date.now() });
  const responseHeaders = headers(session.id);
  responseHeaders.set("Content-Type", "text/event-stream");
  responseHeaders.set("Connection", "keep-alive");
  return new Response(": OpenBar MCP stream ready\n\n", { headers: responseHeaders });
}

async function handleDelete(request: Request): Promise<Response> {
  const access = await authorizeMcpRequest(request);
  if (!access.ok) return json({ error: access.message, code: "mcp_access_required" }, access.status);
  const id = request.headers.get("mcp-session-id")?.trim();
  if (id) sessions.delete(id);
  return new Response(null, { status: 204, headers: headers(id || undefined) });
}

function allowedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestUrl = new URL(request.url);
  // Reverse proxies retain the public Host while Next uses its internal URL.
  const host = request.headers.get("host") || requestUrl.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || requestUrl.protocol.replace(":", "");
  const publicOrigin = `${protocol}://${host}`;
  return origin === publicOrigin || origin === requestUrl.origin || agentOrigins().includes(origin);
}

function withCors(request: Request, response: Response): Response {
  const nextHeaders = new Headers(response.headers);
  nextHeaders.append("Vary", "Origin");
  const origin = request.headers.get("origin");
  if (origin && allowedRequestOrigin(request)) {
    nextHeaders.set("Access-Control-Allow-Origin", origin);
    nextHeaders.set("Access-Control-Allow-Credentials", "true");
    nextHeaders.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    nextHeaders.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
    nextHeaders.set("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate");
  }
  return new Response(response.body, { status: response.status, headers: nextHeaders });
}

async function dispatch(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  if (!allowedRequestOrigin(request)) return json({ error: "Agent origin is outside OPENBARRY_AGENT_ORIGINS.", code: "origin_not_allowed" }, 403);
  return withCors(request, await handler(request));
}

export async function OPTIONS(request: Request): Promise<Response> {
  return dispatch(request, async () => new Response(null, { status: 204, headers: { Allow: "GET, POST, DELETE, OPTIONS", "Cache-Control": "no-store" } }));
}
export async function POST(request: Request) { return dispatch(request, handlePost); }
export async function GET(request: Request) { return dispatch(request, handleGet); }
export async function DELETE(request: Request) { return dispatch(request, handleDelete); }
