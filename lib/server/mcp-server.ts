import { ProtocolError, Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server"
import packageJson from "@/package.json"

import { MCP_INSTRUCTIONS } from "@/lib/research/agent-guidance"
import { formatInboxPrefix } from "@/lib/research/agent-inbox-contract"
import { executeMcpTool, getMcpTool, listMcpTools } from "@/lib/research/mcp-command-registry"
import { registerMcpDiscovery } from "@/lib/research/mcp-discovery"
import { INBOX_MCP_EVENT_CAPABILITY, registerInboxMcpEvents } from "./mcp-events"

/** Domain operations retain their operation envelopes across SDK transports. */
export function createOpenbarMcpServer(actor: string, options: { events?: boolean } = { events: true }): Server {
  // The low-level SDK server preserves the existing JSON Schema tool catalog
  // and operation envelopes while owning protocol validation and cancellation.
  const server = new Server({ name: "OpenBar", version: packageJson.version }, {
    instructions: MCP_INSTRUCTIONS,
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {}, ...(options.events ? INBOX_MCP_EVENT_CAPABILITY : {}) },
  })

  server.setRequestHandler("tools/list", async () => ({
    tools: listMcpTools().map(({ name, title, description, inputSchema, annotations }) => ({
      name, title, description, inputSchema: inputSchema as Tool["inputSchema"], annotations,
    })),
  }))
  server.setRequestHandler("tools/call", async (request, context) => {
    const { name, arguments: args = {} } = request.params
    if (!getMcpTool(name)) throw new ProtocolError(-32602, `Unknown tool "${name}".`, { code: "invalid_arguments" })
    const result = await executeMcpTool(name, args, {
      actor,
      signal: context.mcpReq.signal,
    })
    const notification = result.notifications
    const prefix = notification ? "error" in notification ? notification.error : formatInboxPrefix(notification) : ""
    const { notifications: _notifications, ...operation } = result
    const compactStructuredNotifications = notification && !("error" in notification)
      ? { count: notification.count, hasMore: notification.hasMore, revision: notification.revision, notifications: notification.notifications }
      : notification
    return {
      content: [...(prefix ? [{ type: "text" as const, text: prefix }] : []), { type: "text", text: JSON.stringify(operation) }],
      structuredContent: compactStructuredNotifications ? { ...operation, notifications: compactStructuredNotifications } : operation,
      ...(result.ok ? {} : { isError: true }),
    } satisfies CallToolResult
  })
  registerMcpDiscovery(server, actor)
  if (options.events) registerInboxMcpEvents(server, actor)
  return server
}
