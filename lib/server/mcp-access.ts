import { bearerMatches, isLoopbackHost } from "@/lib/server/access-policy";
import { identityAllowed, type CloudflareIdentity } from "@/lib/server/cloudflare-access";

/**
 * HTTP MCP authorization. Bearer `OPENBARRY_MCP_TOKEN` always wins.
 * When Cloudflare Access is configured, a verified JWT (including service-token
 * `common_name`) is also enough. Production without either stays closed.
 */
export function mcpRequestAuthorized(input: {
  host: string;
  mcpToken: string | undefined;
  authorization: string | null;
  nodeEnv: string | undefined;
  cloudflareRequired: boolean;
  cloudflareIdentity: CloudflareIdentity | null;
}): boolean {
  if (input.mcpToken && bearerMatches(input.authorization, input.mcpToken)) return true;
  if (input.cloudflareRequired) {
    return Boolean(input.cloudflareIdentity && identityAllowed(input.cloudflareIdentity));
  }
  if (input.mcpToken) return false;
  if (input.nodeEnv === "production") return false;
  return isLoopbackHost(input.host);
}
