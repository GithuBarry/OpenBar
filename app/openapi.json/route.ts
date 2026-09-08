import { listMcpTools } from "@/lib/research/mcp-command-registry"
export const dynamic = "force-dynamic"
export function GET() {
  return Response.json({
    openapi: "3.1.0", info: { title: "OpenBar agent API", version: "1.0.0", description: "Saved-state tools shared with MCP. Responses use {ok,value} or {ok:false,code,message,retryable}." },
    servers: [{ url: "/" }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths: Object.fromEntries(listMcpTools().map(tool => [`/api/tools/${tool.name}`, { post: {
      operationId: tool.name, summary: tool.title, description: tool.description,
      requestBody: { required: true, content: { "application/json": { schema: tool.inputSchema } } },
      responses: { "200": { description: "Operation succeeded", content: { "application/json": { schema: { type: "object", properties: { ok: { const: true }, value: {} }, required: ["ok", "value"] } } } }, "401": { description: "Bearer authentication required" }, "409": { description: "Refresh current state and revision" }, "422": { description: "Operation error with code and message" } },
    } }])),
  }, { headers: { "Cache-Control": "no-store" } })
}
