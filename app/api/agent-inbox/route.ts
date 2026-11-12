import { MCP_INPUTS } from '@/lib/research/command-inputs'
import { acknowledgeAgentInbox, readAgentInbox } from '@/lib/research/agent-inbox'
import { AGENT_INBOX_ACTOR_HEADER } from '@/lib/research/agent-inbox-contract'
import { failResult, okResult } from '@/lib/research/operation-result'
import { readAgentRequestBody } from '@/lib/server/agent-request-body'
import { ProjectAccessError, requireProjectAccess, requireWorkbenchAccess } from '@/lib/server/project-access'
import { requestIsSameOrigin } from '@/lib/server/request-origin'
import { assertPublicDemoProject, isPublicDemoMode } from '@/lib/server/demo-mode'
import { listProjects } from '@/lib/store'

export const dynamic = 'force-dynamic'

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function authorize(project?: string): Promise<string[] | undefined> {
  if (project) { await requireProjectAccess(project); return [project] }
  await requireWorkbenchAccess()
  if (isPublicDemoMode()) {
    return listProjects().filter(item => {
      try { assertPublicDemoProject(item.slug); return true } catch { return false }
    }).map(item => item.slug)
  }
}

function failure(error: unknown) {
  return json(failResult(error instanceof ProjectAccessError ? 'permission_denied' : 'operation_failed', error instanceof Error ? error.message : 'OpenBar inbox is unavailable.', false), error instanceof ProjectAccessError ? error.status : 503)
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const parsed = MCP_INPUTS.check_inbox.safeParse({
    ...(search.has('project') ? { project: search.get('project') } : {}),
    ...(search.has('limit') ? { limit: Number(search.get('limit')) } : {}),
    ...(search.has('includeAcknowledged') ? { includeAcknowledged: search.get('includeAcknowledged') === 'true' } : {}),
  })
  if (!parsed.success) return json(failResult('invalid_arguments', 'Choose a project and a limit from 1 to 50.', false), 400)
  try {
    const scope = await authorize(parsed.data.project)
    return json(okResult(readAgentInbox(parsed.data, scope)))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return json(failResult('permission_denied', 'Open OpenBar to handle its notifications.', false), 403)
  try {
    const parsed = MCP_INPUTS.acknowledge_inbox.safeParse(JSON.parse(await readAgentRequestBody(request, 16_384)))
    if (!parsed.success) return json(failResult('invalid_arguments', 'Provide the exact notification IDs from check_inbox.', false), 400)
    const scope = await authorize(parsed.data.project)
    const actor = request.headers.get(AGENT_INBOX_ACTOR_HEADER) === 'webmcp' ? 'webmcp' : 'human'
    return json(okResult(await acknowledgeAgentInbox(parsed.data, scope, actor)))
  } catch (error) { return failure(error) }
}
