import { ProtocolError, readRequestBody, SUBSCRIPTION_ID_META_KEY, type Server, type ServerContext } from "@modelcontextprotocol/server"
import { z } from "zod"
import { readInboxEvents, watchInboxEvents, type InboxEventItem, type InboxEventTarget } from "@/lib/research/agent-inbox-events"
import { readGitConflictEvents, watchGitConflictEvents, type GitConflictEventItem } from "@/lib/research/git-conflict-events"
import { getProjectMetadata } from "@/lib/store"
import { isPublicDemoMode, publicDemoSlugs } from "./demo-mode"
import { authorizeMcpRequest } from "./mcp-access"
import { trackMcpListener } from "./mcp-listener-status"

export const INBOX_MCP_EVENT = "openbar.inbox.mention"
export const GIT_CONFLICT_MCP_EVENT = "openbar.git.conflict"
export const MCP_MAX_REQUEST_BODY_SIZE = 4_000_000
const EXTENSION = "io.modelcontextprotocol/events"
const DEFAULT_HEARTBEAT_MS = 15_000
const MAX_STREAMS = 128
const MAX_ACTOR_STREAMS = 32
let activeStreams = 0
const actorStreams = new Map<string, number>()
const metadata = z.record(z.string(), z.unknown()).optional()
const projectSlug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200)
const streamParams = z.object({
  name: z.string().min(1).max(200),
  arguments: z.object({
    project: projectSlug.optional(),
    projects: z.array(projectSlug).min(1).max(64).optional(),
  }).strict().default({}),
  cursor: z.string().max(16_384).nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  heartbeatMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  _meta: metadata,
}).strict()

export const INBOX_MCP_EVENT_CAPABILITY = { extensions: { [EXTENSION]: { listChanged: false } } }

const TARGET_INPUT_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "Watch one accessible OpenBar project slug. Omit both project and projects to watch all accessible projects." },
    projects: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64, description: "Watch a specific list of accessible OpenBar project slugs." },
  },
  additionalProperties: false,
}

type StreamEventBase = { id: string; createdAt: string; cursor: string }
type StreamAdapter<T extends StreamEventBase> = {
  name: string
  read: (target: InboxEventTarget, cursor: string | undefined, scope: readonly string[] | undefined) => { cursor: string; events: T[]; reset: boolean }
  watch: (target: InboxEventTarget, onChange: () => void, signal: AbortSignal, scope: readonly string[] | undefined) => () => void
  formatData: (event: T) => Record<string, unknown>
  invalidCursorMessage: string
  errorMessage: string
  unavailableMessage: string
}

const INBOX_ADAPTER: StreamAdapter<InboxEventItem> = {
  name: INBOX_MCP_EVENT,
  read: readInboxEvents,
  watch: watchInboxEvents,
  formatData: ({ project, mapId, nodeId, href, priority }) => ({ project, mapId, nodeId, href, ...(priority ? { priority } : {}) }),
  invalidCursorMessage: "Invalid cursor for this inbox watch.",
  errorMessage: "Inbox update unavailable. Call check_inbox to retry.",
  unavailableMessage: "Inbox events unavailable. Call check_inbox to retry.",
}

const GIT_CONFLICT_ADAPTER: StreamAdapter<GitConflictEventItem> = {
  name: GIT_CONFLICT_MCP_EVENT,
  read: readGitConflictEvents,
  watch: watchGitConflictEvents,
  formatData: ({ id: _id, createdAt: _createdAt, cursor: _cursor, ...data }) => data,
  invalidCursorMessage: "Invalid cursor for this conflict watch.",
  errorMessage: "Conflict update unavailable. Call sync_project or get_project_state to inspect.",
  unavailableMessage: "Conflict events unavailable. Call sync_project or get_project_state to inspect.",
}

function resolveTarget(args: z.infer<typeof streamParams>["arguments"]): InboxEventTarget {
  if (args.project !== undefined && args.projects !== undefined) {
    throw new ProtocolError(-32602, "Pass either project or projects, or omit both to watch all accessible projects.")
  }
  if (args.project !== undefined) return { kind: "single", project: args.project }
  if (args.projects !== undefined) return { kind: "subset", projects: [...new Set(args.projects)].sort() }
  return { kind: "all" }
}

function targetScope(target: InboxEventTarget): readonly string[] | undefined {
  const scope = isPublicDemoMode() ? publicDemoSlugs() : undefined
  const required = typeof target === "string" ? [target] : target.kind === "single" ? [target.project] : target.kind === "subset" ? target.projects : []
  for (const project of required) {
    if ((scope && !scope.includes(project)) || !getProjectMetadata(project)) {
      throw new ProtocolError(-32024, "Forbidden", { reason: "Project access is unavailable." })
    }
  }
  return scope
}

function reserveStream(actor: string): () => void {
  const actorCount = actorStreams.get(actor) || 0
  if (activeStreams >= MAX_STREAMS || actorCount >= MAX_ACTOR_STREAMS) {
    throw new ProtocolError(-32025, "ResourceExhausted", { limit: "subscriptions", max: actorCount >= MAX_ACTOR_STREAMS ? MAX_ACTOR_STREAMS : MAX_STREAMS })
  }
  activeStreams++
  actorStreams.set(actor, actorCount + 1)
  return () => {
    activeStreams--
    const remaining = (actorStreams.get(actor) || 1) - 1
    if (remaining) actorStreams.set(actor, remaining)
    else actorStreams.delete(actor)
  }
}

async function streamWithAdapter<T extends StreamEventBase>(
  adapter: StreamAdapter<T>,
  params: z.infer<typeof streamParams>,
  context: ServerContext,
  actor: string,
) {
  const target = resolveTarget(params.arguments)
  targetScope(target)
  const release = reserveStream(actor)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.mcpReq.signal, controller.signal])
  const _meta = { [SUBSCRIPTION_ID_META_KEY]: context.mcpReq.id }
  const heartbeatMs = Math.max(1000, Math.min(30_000, params.heartbeatMs ?? DEFAULT_HEARTBEAT_MS))
  const oldest = params.maxAgeMs === undefined ? -Infinity : Date.now() - params.maxAgeMs
  let cursor = params.cursor ?? undefined
  let stopWatching = () => {}
  let untrackListener = () => {}
  let timer: ReturnType<typeof setInterval> | undefined
  let ready = false
  let pending = false
  let heartbeatDue = false
  let processing: Promise<void> | undefined
  const done = new Promise<void>(resolve => {
    if (signal.aborted) resolve()
    else signal.addEventListener("abort", () => resolve(), { once: true })
  })
  const notify = async (method: string, payload: Record<string, unknown>) => {
    if (signal.aborted) return
    await context.mcpReq.notify({ method, params: { ...payload, _meta } })
  }
  const authorize = async () => {
    if (context.http?.req) {
      const access = await authorizeMcpRequest(context.http.req)
      if (!access.ok || access.actor !== actor) throw new ProtocolError(-32024, "Forbidden", { reason: "MCP access has expired or changed." })
    }
    return targetScope(target)
  }
  const read = (scope: readonly string[] | undefined) => {
    try { return adapter.read(target, cursor, scope) }
    catch (error) {
      if (error instanceof RangeError) throw new ProtocolError(-32602, adapter.invalidCursorMessage)
      throw error
    }
  }
  const prepare = (batch: ReturnType<typeof read>) => {
    let prefix = 0
    while (prefix < batch.events.length && Date.parse(batch.events[prefix].createdAt) < oldest) prefix++
    const events = batch.events.filter(event => Date.parse(event.createdAt) >= oldest)
    return { ...batch, events, reset: batch.reset || events.length < batch.events.length,
      startCursor: prefix ? batch.events[prefix - 1].cursor : batch.reset || !batch.events.length ? batch.cursor : cursor,
    }
  }
  const deliver = async (batch: ReturnType<typeof prepare>) => {
    if (batch.reset) {
      cursor = batch.startCursor
      await notify("notifications/events/active", { cursor, truncated: true, heartbeatMs })
    }
    for (const event of batch.events) {
      if (signal.aborted) return
      await notify("notifications/events/event", {
        eventId: event.id, name: adapter.name, timestamp: event.createdAt,
        data: adapter.formatData(event), cursor: event.cursor,
      })
      cursor = event.cursor
    }
    cursor = batch.cursor
  }
  const flush = () => {
    pending = true
    if (!ready || processing || signal.aborted) return
    processing = (async () => {
      while (pending && !signal.aborted) {
        pending = false
        const scope = await authorize()
        if (signal.aborted) break
        await deliver(prepare(read(scope)))
        if (heartbeatDue && !signal.aborted) {
          heartbeatDue = false
          await notify("notifications/events/heartbeat", { cursor })
        }
      }
    })().catch(async error => {
      if (signal.aborted) return
      if (error instanceof ProtocolError && error.code === -32024) {
        await notify("notifications/events/terminated", { error: { code: -32024, message: "Forbidden" } }).catch(() => {})
        controller.abort()
      } else {
        await notify("notifications/events/error", { error: { code: -32603, message: adapter.errorMessage } }).catch(() => controller.abort())
      }
    }).finally(() => {
      processing = undefined
      if (pending && !signal.aborted) flush()
    })
  }
  try {
    const scope = await authorize()
    if (signal.aborted) return { resultType: "complete" as const, _meta }
    // Register before reading so a write between the baseline and listen stays visible.
    stopWatching = adapter.watch(target, flush, signal, scope)
    const initial = prepare(read(scope))
    cursor = initial.startCursor
    await notify("notifications/events/active", { cursor, truncated: initial.reset, heartbeatMs })
    if (!signal.aborted) untrackListener = trackMcpListener({ target, scope, signal })
    await deliver({ ...initial, reset: false })
    ready = true
    flush()
    timer = setInterval(() => {
      heartbeatDue = true
      flush()
    }, heartbeatMs)
    timer.unref?.()
    await done
    return { resultType: "complete" as const, _meta }
  } catch (error) {
    if (error instanceof ProtocolError) throw error
    throw new ProtocolError(-32603, adapter.unavailableMessage)
  } finally {
    controller.abort()
    untrackListener()
    if (timer) clearInterval(timer)
    stopWatching()
    release()
  }
}

async function streamEvent(params: z.infer<typeof streamParams>, context: ServerContext, actor: string) {
  if (params.name === INBOX_MCP_EVENT) return streamWithAdapter(INBOX_ADAPTER, params, context, actor)
  if (params.name === GIT_CONFLICT_MCP_EVENT) return streamWithAdapter(GIT_CONFLICT_ADAPTER, params, context, actor)
  throw new ProtocolError(-32023, "NotFound", { kind: "event" })
}

export function registerInboxMcpEvents(server: Server, actor: string): void {
  server.setRequestHandler("events/list", { params: z.object({ cursor: z.string().optional(), _meta: metadata }).strict().default({}) }, async params => {
    if (params.cursor !== undefined) throw new ProtocolError(-32602, "The event catalog has one page. Omit cursor.")
    return { resultType: "complete", events: [
      {
        name: INBOX_MCP_EVENT,
        description: "A saved human @agent or @stat request changed in an OpenBar inbox. Pass { project } for one project, { projects: [...] } for specific projects, or {} to watch all accessible projects. Read check_inbox for current context and acknowledge exact notification IDs after handling.",
        delivery: ["push"],
        inputSchema: TARGET_INPUT_SCHEMA,
        payloadSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            mapId: { type: "string" },
            nodeId: { type: "string" },
            href: { type: "string" },
            priority: { type: "string", enum: ["fast-tracked"] },
          },
          required: ["project", "mapId", "nodeId", "href"],
          additionalProperties: false,
        },
      },
      {
        name: GIT_CONFLICT_MCP_EVENT,
        description: "A Git synchronization conflict or saved-file conflict (mindmap or paper) occurred in an OpenBar project. Pass { project } for one project, { projects: [...] } for specific projects, or {} to watch all accessible projects. Inspect the conflict and resolve it if confident nothing will be lost; otherwise summarize what conflicted and wait for the human to tell you what to do.",
        delivery: ["push"],
        inputSchema: TARGET_INPUT_SCHEMA,
        payloadSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            kind: { type: "string", enum: ["git", "mindmap", "paper"] },
            code: { type: "string" },
            message: { type: "string" },
            guidance: { type: "string" },
            href: { type: "string" },
            mapId: { type: "string" },
            nodeIds: { type: "array", items: { type: "string" } },
            files: { type: "array", items: { type: "string" } },
            branch: { type: "string" },
            ahead: { type: "integer" },
            behind: { type: "integer" },
            localCommit: { type: "string" },
            remoteCommit: { type: "string" },
            expectedHash: { type: "string" },
            currentHash: { type: "string" },
          },
          required: ["project", "kind", "code", "message", "guidance", "href"],
          additionalProperties: false,
        },
      },
    ] }
  })
  server.setRequestHandler("events/stream", { params: streamParams }, (params, context) => streamEvent(params, context, actor))
}

/** The SDK's core-only name-header table delegates this extension gate to us. */
export async function inboxEventHeaderError(request: Request): Promise<Response | undefined> {
  if (request.method !== "POST" || request.headers.get("mcp-method") !== "events/stream") return
  try {
    const body = await readRequestBody(request.clone() as unknown as Parameters<typeof readRequestBody>[0], MCP_MAX_REQUEST_BODY_SIZE)
    if (body.tooLarge) return
    const message = JSON.parse(body.text)
    if (message?.method !== "events/stream" || typeof message.params?.name !== "string") return
    const name = message.params.name
    const header = request.headers.get("mcp-name")
    if (header === name || header === `=?base64?${Buffer.from(name).toString("base64")}?=`) return
    return Response.json({ jsonrpc: "2.0", id: typeof message.id === "string" || typeof message.id === "number" ? message.id : null,
      error: { code: -32020, message: "HeaderMismatch", data: { header: "Mcp-Name" } },
    }, { status: 400 })
  } catch { /* The SDK handles malformed or unreadable requests. */ }
}
