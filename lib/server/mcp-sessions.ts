export type McpSession = { actor: string; lastSeen: number; protocolVersion: string }
export const MCP_SESSION_TTL_MS = 30 * 60_000

export function pruneMcpSessions(sessions: Map<string, McpSession>, now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (now - session.lastSeen >= MCP_SESSION_TTL_MS) sessions.delete(id)
  }
}

export function touchMcpSession(session: McpSession, actor: string, now = Date.now()): boolean {
  if (session.actor !== actor) return false
  session.lastSeen = now
  return true
}
