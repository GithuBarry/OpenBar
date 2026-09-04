import { timingSafeEqual } from "node:crypto";

export function hostnameOf(host: string): string {
  const value = host.trim();
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end >= 0 ? value.slice(1, end).toLowerCase() : value.toLowerCase();
  }
  if (value.split(":").length > 2) return value.toLowerCase();
  return (value.split(":")[0] || "").toLowerCase();
}

export function isLoopbackHost(host: string): boolean {
  const hostname = hostnameOf(host);
  if (hostname === "localhost" || hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = hostname.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  return [...ipv4.slice(1)].every((octet) => Number(octet) <= 255);
}

export function bearerMatches(authorization: string | null | undefined, expected: string): boolean {
  const match = (authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const actual = Buffer.from(match[1]!);
  const token = Buffer.from(expected);
  return actual.length === token.length && timingSafeEqual(actual, token);
}

function originMatchesHost(origin: string | null | undefined, host: string): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Development permits loopback access. Production local beta permits loopback
 * access with OPENBAR_LOCAL_ACCESS=1 while Cloudflare Access is disabled.
 * Bearer tokens and verified Cloudflare identities retain production access.
 * Origin/host remain request-context CSRF checks, not the sole trust signal.
 */
export function callerMayAccess(input: {
  host: string;
  origin: string | null;
  fetchSite: string | null;
  authorization: string | null;
  nodeEnv: string | undefined;
  token: string | undefined;
  cloudflareIdentity?: { email?: string } | null;
  cloudflareRequired?: boolean;
  publicDemo?: boolean;
  localAccess?: boolean;
}): boolean {
  if (input.token && bearerMatches(input.authorization, input.token)) return true;

  if (input.cloudflareRequired) {
    return Boolean(input.cloudflareIdentity);
  }

  if (input.publicDemo) return true;

  if (input.nodeEnv === "production") {
    return input.localAccess === true && isLoopbackHost(input.host);
  }

  // Browser request headers are caller-controlled. Production access uses a
  // bearer token, verified Access identity, or explicit loopback local access.
  const sameOrigin =
    input.fetchSite === "same-origin" || originMatchesHost(input.origin, input.host);
  if (sameOrigin) return true;

  if (input.nodeEnv !== "production" && isLoopbackHost(input.host)) return true;
  return false;
}
