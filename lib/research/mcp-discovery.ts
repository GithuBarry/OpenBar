import { AGENT_GUIDANCE } from "./agent-guidance"
import { executeMcpTool } from "./mcp-command-registry"
import { listProjects } from "@/lib/store"

const guideUri = "openbar://guide"
const templates = [
  { uriTemplate: "openbar://projects/{project}/state", name: "project-state", description: "Saved project context, instructions, paper and map identities.", mimeType: "application/json" },
  { uriTemplate: "openbar://projects/{project}/source", name: "paper-source", description: "Bounded manuscript source and hashes.", mimeType: "application/json" },
  { uriTemplate: "openbar://projects/{project}/skills/{id}", name: "project-skill", description: "Project, workspace or bundled skill.", mimeType: "application/json" },
]

export async function discoveryRpc(method: string, params: Record<string, unknown>, actor: string): Promise<Record<string, unknown> | null> {
  if (method === "resources/list") return { result: { resources: [
    { uri: guideUri, name: "agent-guide", mimeType: "text/plain", description: "OpenBar agent instructions" },
    ...listProjects().map(project => ({ uri: `openbar://projects/${encodeURIComponent(project.slug)}/state`, name: project.slug, description: project.title, mimeType: "application/json" })),
  ] } }
  if (method === "resources/templates/list") return { result: { resourceTemplates: templates } }
  if (method === "resources/read") {
    const uri = String(params.uri || "")
    if (uri === guideUri) return { result: { contents: [{ uri, mimeType: "text/plain", text: AGENT_GUIDANCE }] } }
    const match = uri.match(/^openbar:\/\/projects\/([^/]+)\/(state|source|skills\/([^/]+))$/)
    if (!match) return { error: { code: -32002, message: "Unknown OpenBar resource URI." } }
    let project: string, id: string | undefined
    try { project = decodeURIComponent(match[1]); id = match[3] ? decodeURIComponent(match[3]) : undefined }
    catch { return { error: { code: -32602, message: "Malformed resource URI." } } }
    const name = match[2] === "state" ? "get_project_state" : match[2] === "source" ? "get_source_bundle" : "read_project_skill"
    const result = await executeMcpTool(name, { project, ...(id ? { id } : {}) }, { actor })
    if (!result.ok) return { error: { code: -32002, message: result.message, data: result } }
    return { result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result) }] } }
  }
  if (method === "prompts/list") return { result: { prompts: [{ name: "start_project", description: "Orient an agent in an OpenBar paper repository.", arguments: [{ name: "project", description: "Project slug", required: true }] }] } }
  if (method === "prompts/get") {
    const args = params.arguments as Record<string, unknown> | undefined
    if (params.name !== "start_project" || typeof args?.project !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.project)) return { error: { code: -32602, message: "Use start_project with a project slug." } }
    return { result: { description: "OpenBar project orientation", messages: [{ role: "user", content: { type: "text", text: `Call get_project_state with ${JSON.stringify({ project: args.project })} for current project identities and available instructions and skills. Tool descriptions and schemas describe each operation.` } }] } }
  }
  return null
}
