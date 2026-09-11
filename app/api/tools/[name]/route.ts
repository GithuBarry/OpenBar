import { readAgentRequestBody } from "@/lib/server/agent-request-body"
import { executeMcpTool, getMcpTool, isUnsupportedHeadlessViewPreferenceTool, unsupportedHeadlessViewPreferenceResult } from "@/lib/research/mcp-command-registry"
import { agentHttp } from "@/lib/server/agent-http"
export const dynamic = "force-dynamic"
export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  return agentHttp(request, async actor => {
    const { name } = await context.params
    if (isUnsupportedHeadlessViewPreferenceTool(name)) {
      return Response.json(unsupportedHeadlessViewPreferenceResult(name), { status: 422 })
    }
    if (!getMcpTool(name)) return Response.json({ ok: false, code: "invalid_path", message: "Unknown tool." }, { status: 404 })
    let args: unknown
    try { args = JSON.parse(await readAgentRequestBody(request)) } catch (error) {
      return Response.json({ ok: false, code: error instanceof RangeError ? "request_too_large" : "invalid_json" }, { status: error instanceof RangeError ? 413 : 400 })
    }
    const result = await executeMcpTool(name, args, { actor, signal: request.signal })
    return Response.json(result, { status: result.ok ? 200 : result.code === "stale_disk_state" || result.code === "conflict" ? 409 : 422 })
  })
}
export async function OPTIONS(request: Request) { return agentHttp(request, async () => new Response(null, { status: 204 })) }
