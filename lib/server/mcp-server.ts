import { ProtocolError, Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server"

import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance"
import { executeMcpTool, getMcpTool, listMcpTools } from "@/lib/research/mcp-command-registry"
import { registerMcpDiscovery } from "@/lib/research/mcp-discovery"

/** Domain operations retain their operation envelopes across SDK transports. */
export function createOpenbarMcpServer(actor: string): Server {
  // The low-level SDK server preserves the existing JSON Schema tool catalog
  // and operation envelopes while owning protocol validation and cancellation.
  const server = new Server({ name: "OpenBar", version: "0.1.0" }, {
    instructions: AGENT_GUIDANCE,
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
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
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      ...(result.ok ? {} : { isError: true }),
    } satisfies CallToolResult
  })
  registerMcpDiscovery(server, actor)
  return server
}
