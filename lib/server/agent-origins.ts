/** Explicit trusted origins for browser-based agent clients. */
export function agentOrigins(): string[] {
  const origins = new Set<string>();
  for (const candidate of (process.env.OPENBARRY_AGENT_ORIGINS || "").split(/[\s,]+/)) {
    if (!candidate) continue;
    const url = new URL(candidate);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("OPENBARRY_AGENT_ORIGINS must contain HTTPS origins or loopback HTTP origins, separated by commas.");
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export function agentPermissionsPolicy(): string {
  return `tools=(self${agentOrigins().map((origin) => ` "${origin}"`).join("")})`;
}
