import { NextResponse, type NextRequest } from "next/server";

import { isLoopbackHost } from "@/lib/server/access-policy";

/**
 * Next.js 16 proxy (replaces deprecated middleware.ts). When Cloudflare Access
 * is configured in production, require an Access JWT at the edge. Loopback and
 * /api/health stay reachable for local work and load-balancer probes. Origin
 * JWT verification still happens in requireWorkbenchAccess.
 */
export function proxy(request: NextRequest) {
  const configured = Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD);
  if (!configured || process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (isLoopbackHost(host)) return NextResponse.next();
  const jwt = request.headers.get("cf-access-jwt-assertion") || request.cookies.get("CF_Authorization")?.value;
  if (!jwt) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
