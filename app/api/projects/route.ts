import { executeMcpTool } from "@/lib/research/mcp-command-registry"
import { agentHttp } from "@/lib/server/agent-http"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  return agentHttp(request, async actor => Response.json(await executeMcpTool("list_projects", {}, { actor })))
}
export const OPTIONS = GET
