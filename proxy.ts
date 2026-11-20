import { NextResponse, type NextRequest } from "next/server";

import { isLoopbackHost } from "@/lib/server/access-policy";
import { isPublicDemoMode } from "@/lib/server/demo-mode";

/**
 * Next.js 16 proxy (replaces deprecated middleware.ts). When Cloudflare Access
 * is configured in production, require an Access JWT at the edge. Loopback and
 * /api/health stay reachable for local work and load-balancer probes. Origin
 * JWT verification still happens in requireWorkbenchAccess.
 */
function checkAccess(request: NextRequest) {
  if (isPublicDemoMode()) return NextResponse.next();
  // Authenticated agent routes verify their own bearer or Access identity.
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/mcp" || pathname === "/api/projects" || pathname === "/api/tools" || pathname.startsWith("/api/tools/")) return NextResponse.next();
  const configured = Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD);
  if (!configured || process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }
  const host = request.nextUrl.host;
  if (isLoopbackHost(host)) return NextResponse.next();
  const jwt = request.headers.get("cf-access-jwt-assertion") || request.cookies.get("CF_Authorization")?.value;
  if (!jwt) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}

export function proxy(request: NextRequest) {
  const response = checkAccess(request);
  const { pathname, search } = request.nextUrl;
  if (response.headers.get("x-middleware-next") !== "1" || !pathname.startsWith("/p/")) return response;

  const headers = new Headers(request.headers);
  if ((request.method === "GET" || request.method === "HEAD") && !headers.has("next-action")) {
    headers.set("x-openbar-project-url", pathname + search);
  } else {
    headers.delete("x-openbar-project-url");
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
