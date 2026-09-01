/**
 * Cloudflare Access JWT validation at the origin.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type CloudflareIdentity = {
  email?: string;
  groups?: string[];
  commonName?: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function cloudflareAccessConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD);
}

function certsUrl(): string {
  const team = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${team}/cdn-cgi/access/certs`;
}

function issuer(): string {
  const team = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${team}`;
}

function jwks() {
  const url = certsUrl();
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const set = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, set);
  return set;
}

export async function verifyCloudflareAccessJwt(token: string | null | undefined): Promise<CloudflareIdentity | null> {
  if (!cloudflareAccessConfigured() || !token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: issuer(),
      audience: process.env.CLOUDFLARE_ACCESS_AUD,
    });
    return identityFromPayload(payload);
  } catch {
    return null;
  }
}

export function identityFromPayload(payload: JWTPayload): CloudflareIdentity {
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const commonName = typeof payload.common_name === "string" ? payload.common_name : undefined;
  const groups = Array.isArray(payload.groups) ? payload.groups.filter((item): item is string => typeof item === "string") : undefined;
  return { email, groups, commonName };
}

export function identityAllowed(identity: CloudflareIdentity): boolean {
  const emails = (process.env.CLOUDFLARE_ACCESS_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const groups = (process.env.CLOUDFLARE_ACCESS_GROUPS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const serviceTokens = (process.env.CLOUDFLARE_ACCESS_SERVICE_TOKENS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (serviceTokens.length && identity.commonName && serviceTokens.includes(identity.commonName)) return true;
  if (emails.length && identity.email && emails.includes(identity.email.toLowerCase())) return true;
  if (groups.length && identity.groups?.some((group) => groups.includes(group))) return true;
  if (!emails.length && !groups.length && !serviceTokens.length) return true;
  return false;
}

export function cloudflareAccessJwtFromHeaders(headers: { get(name: string): string | null }): string | null {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (assertion) return assertion;
  const cookie = headers.get("cookie") || "";
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1] || null;
  }
}

export function accessHealthStatus(): {
  cloudflareAccess: boolean;
  issuerConfigured: boolean;
  serviceTokensConfigured: boolean;
} {
  return {
    cloudflareAccess: cloudflareAccessConfigured(),
    issuerConfigured: Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN),
    serviceTokensConfigured: Boolean(process.env.CLOUDFLARE_ACCESS_SERVICE_TOKENS),
  };
}
