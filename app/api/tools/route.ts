import { listMcpTools } from "@/lib/research/mcp-command-registry"
import { agentHttp } from "@/lib/server/agent-http"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  return agentHttp(request, async () => Response.json({ tools: listMcpTools().map(({ execute: _execute, ...tool }) => tool) }))
}
export const OPTIONS = GET
