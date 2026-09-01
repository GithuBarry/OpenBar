import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createOpenBarryMcpServer } from "@/mcp/server";
import {
  cloudflareAccessConfigured,
  cloudflareAccessJwtFromHeaders,
  verifyCloudflareAccessJwt,
} from "@/lib/server/cloudflare-access";
import { isLoopbackHost } from "@/lib/server/access-policy";
import { mcpRequestAuthorized } from "@/lib/server/mcp-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAllowedOrigin(origin: string, host: string | null): boolean {
  try {
    const url = new URL(origin);
    const configured = (process.env.OPENBARRY_MCP_ORIGINS || "")
      .split(",")
      .map((item) => item.trim().replace(/\/$/, ""))
      .filter(Boolean);
    if (configured.includes(url.origin)) return true;
    if (process.env.NODE_ENV !== "production" && isLoopbackHost(url.host)) {
      return true;
    }
    // Same-origin requests remain valid for a deployed app. A deployment can
    // narrow this further with OPENBARRY_MCP_ORIGINS.
    if (host && url.host.toLowerCase() === host.toLowerCase() && (url.protocol === "http:" || url.protocol === "https:")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const allowed = origin && isAllowedOrigin(origin, host) ? origin : undefined;

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
    Vary: "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(getCorsHeaders(request))) {
    headers.set(key, value);
  }
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonRpcError(status: number, message: string, request: Request) {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message,
      },
      id: null,
    },
    { status, headers: getCorsHeaders(request) },
  );
}

async function checkAuthorization(request: Request): Promise<boolean> {
  const cfRequired = cloudflareAccessConfigured();
  const identity = cfRequired
    ? await verifyCloudflareAccessJwt(cloudflareAccessJwtFromHeaders(request.headers))
    : null;
  return mcpRequestAuthorized({
    host: request.headers.get("host") || "",
    mcpToken: process.env.OPENBARRY_MCP_TOKEN?.trim() || undefined,
    authorization: request.headers.get("authorization"),
    nodeEnv: process.env.NODE_ENV,
    cloudflareRequired: cfRequired,
    cloudflareIdentity: identity,
  });
}

/** HTTP MCP has no unauthenticated tool allowlist. In-page tools live on PaperEditor. */
export const BROWSER_READ_ONLY_TOOLS = new Set<string>();

function securityHeaders(headers: Headers): Headers {
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return headers;
}

async function handleMcpRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(JSON.stringify({ error: "Forbidden: cross-site MCP request not allowed" }), {
      status: 403,
      headers: securityHeaders(new Headers({ "Content-Type": "application/json", ...getCorsHeaders(request) })),
    });
  }

  if (origin && !isAllowedOrigin(origin, host)) {
    return new Response(JSON.stringify({ error: "Forbidden: cross-origin request not allowed" }), {
      status: 403,
      headers: securityHeaders(new Headers({ "Content-Type": "application/json", ...getCorsHeaders(request) })),
    });
  }

  if (!(await checkAuthorization(request))) {
    return new Response(JSON.stringify({ error: "Unauthorized: invalid or missing MCP token" }), {
      status: 401,
      headers: securityHeaders(new Headers({ "Content-Type": "application/json", ...getCorsHeaders(request) })),
    });
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createOpenBarryMcpServer();

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response, request);
  } catch (error) {
    console.error("OpenBar MCP HTTP fatal:", error);
    return jsonRpcError(500, "Internal server error", request);
  }
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && !isAllowedOrigin(origin, host)) {
    return new Response(null, { status: 403, headers: securityHeaders(new Headers(getCorsHeaders(request))) });
  }
  return new Response(null, { status: 204, headers: securityHeaders(new Headers(getCorsHeaders(request))) });
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
