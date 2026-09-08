import {
  bearerMatches,
  hostnameOf,
  isLoopbackHost,
} from "./access-policy";
import {
  cloudflareAccessConfigured,
  cloudflareAccessJwtFromHeaders,
  identityAllowed,
  verifyCloudflareAccessJwt,
} from "./cloudflare-access";

export type McpAccessResult =
  | { ok: true; actor: string }
  | { ok: false; status: 401 | 503; message: string };

/**
 * MCP has a separate trust boundary from page requests. Browser same-origin,
 * public-demo, and local-access switches never grant MCP access by themselves.
 */
export async function authorizeMcpRequest(request: Request): Promise<McpAccessResult> {
  const configuredToken = process.env.OPENBARRY_ACCESS_TOKEN?.trim();
  if (configuredToken && bearerMatches(request.headers.get("authorization"), configuredToken)) {
    return { ok: true, actor: "access-token" };
  }

  if (cloudflareAccessConfigured()) {
    const identity = await verifyCloudflareAccessJwt(cloudflareAccessJwtFromHeaders(request.headers));
    if (identity && identityAllowed(identity)) {
      return { ok: true, actor: identity.email || identity.commonName || "cloudflare-access" };
    }
    return { ok: false, status: 401, message: "MCP requires a valid Cloudflare Access identity or bearer token." };
  }

  if (!configuredToken) {
    const host = hostnameOf(request.headers.get("x-forwarded-host") || request.headers.get("host") || "");
    const environment = process.env.NODE_ENV || "development";
    return {
      ok: false,
      status: 503,
      message: environment === "production"
        ? "MCP access is unavailable until OPENBARRY_ACCESS_TOKEN or Cloudflare Access is configured."
        : `MCP access is unavailable until OPENBARRY_ACCESS_TOKEN or Cloudflare Access is configured for ${isLoopbackHost(host) ? "this local server" : "this server"}.`,
    };
  }

  return { ok: false, status: 401, message: "MCP requires the configured bearer token." };
}
