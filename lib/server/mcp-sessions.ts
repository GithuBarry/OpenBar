export type McpSession = {
  actor: string
  lastSeen: number
  close: () => Promise<void>
}

export const MCP_SESSION_TTL_MS = 30 * 60_000

/** Session identity and idle policy belong to OpenBar, wire state to the SDK. */
export async function pruneMcpSessions<T extends McpSession>(sessions: Map<string, T>, now = Date.now()): Promise<void> {
  const closing: Promise<void>[] = []
  for (const [id, session] of sessions) {
    if (now - session.lastSeen >= MCP_SESSION_TTL_MS) {
      sessions.delete(id)
      closing.push(session.close())
    }
  }
  await Promise.allSettled(closing)
}

export function touchMcpSession(session: McpSession, actor: string, now = Date.now()): boolean {
  if (session.actor !== actor) return false
  session.lastSeen = now
  return true
}
