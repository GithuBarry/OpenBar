import { ProtocolError, ResourceNotFoundError, type Server } from "@modelcontextprotocol/server"

import { AGENT_GUIDANCE } from "./agent-guidance"
import { executeMcpTool } from "./mcp-command-registry"
import { listProjects } from "@/lib/store"

const guideUri = "openbar://guide"
const templates = [
  { uriTemplate: "openbar://projects/{project}/state", name: "project-state", description: "Saved project context, instructions, paper and map identities.", mimeType: "application/json" },
  { uriTemplate: "openbar://projects/{project}/source", name: "paper-source", description: "Bounded manuscript source and hashes.", mimeType: "application/json" },
  { uriTemplate: "openbar://projects/{project}/skills/{id}", name: "project-skill", description: "Project, workspace or bundled skill.", mimeType: "application/json" },
]

/** Register optional orientation resources and prompts through the SDK. */
export function registerMcpDiscovery(server: Server, actor: string): void {
  server.setRequestHandler("resources/list", async () => ({ resources: [
    { uri: guideUri, name: "agent-guide", mimeType: "text/plain", description: "OpenBar agent instructions" },
    ...listProjects().map(project => ({ uri: `openbar://projects/${encodeURIComponent(project.slug)}/state`, name: project.slug, description: project.title, mimeType: "application/json" })),
  ] }))
  server.setRequestHandler("resources/templates/list", async () => ({ resourceTemplates: templates }))
  server.setRequestHandler("resources/read", async ({ params: { uri } }, context) => {
    if (uri === guideUri) return { contents: [{ uri, mimeType: "text/plain", text: AGENT_GUIDANCE }] }
    const match = uri.match(/^openbar:\/\/projects\/([^/]+)\/(state|source|skills\/([^/]+))$/)
    if (!match) throw new ResourceNotFoundError(uri, "Unknown OpenBar resource URI.")
    let project: string, id: string | undefined
    try {
      project = decodeURIComponent(match[1])
      id = match[3] ? decodeURIComponent(match[3]) : undefined
    } catch { throw new ProtocolError(-32602, "Malformed resource URI.") }
    const name = match[2] === "state" ? "get_project_state" : match[2] === "source" ? "get_source_bundle" : "read_project_skill"
    const result = await executeMcpTool(name, { project, ...(id ? { id } : {}) }, { actor, signal: context.mcpReq.signal })
    if (!result.ok) throw new ProtocolError(-32002, result.message, result)
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result) }] }
  })
  server.setRequestHandler("prompts/list", async () => ({ prompts: [{
    name: "start_project", description: "Orient an agent in an OpenBar paper repository.",
    arguments: [{ name: "project", description: "Project slug", required: true }],
  }] }))
  server.setRequestHandler("prompts/get", async ({ params: { name, arguments: args } }) => {
    if (name !== "start_project" || typeof args?.project !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.project)) {
      throw new ProtocolError(-32602, "Use start_project with a project slug.")
    }
    return {
      description: "OpenBar project orientation",
      messages: [{ role: "user", content: { type: "text", text: `Call get_project_state with ${JSON.stringify({ project: args.project })} for current project identities and available instructions and skills. Tool descriptions and schemas describe each operation.` } }],
    }
  })
}
