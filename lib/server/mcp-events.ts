import { ProtocolError, readRequestBody, SUBSCRIPTION_ID_META_KEY, type Server, type ServerContext } from "@modelcontextprotocol/server"
import { z } from "zod"
import { readInboxEvents, watchInboxEvents } from "@/lib/research/agent-inbox-events"
import { getProjectMetadata } from "@/lib/store"
import { isPublicDemoMode, publicDemoSlugs } from "./demo-mode"
import { authorizeMcpRequest } from "./mcp-access"

export const INBOX_MCP_EVENT = "openbar.inbox.mention"
export const MCP_MAX_REQUEST_BODY_SIZE = 4_000_000
const EXTENSION = "io.modelcontextprotocol/events"
const DEFAULT_HEARTBEAT_MS = 15_000
const MAX_STREAMS = 64
const MAX_ACTOR_STREAMS = 16
let activeStreams = 0
const actorStreams = new Map<string, number>()
const metadata = z.record(z.string(), z.unknown()).optional()
const streamParams = z.object({
  name: z.string().min(1).max(200),
  arguments: z.object({ project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200) }).strict(),
  cursor: z.string().max(256).nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  heartbeatMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  _meta: metadata,
}).strict()

export const INBOX_MCP_EVENT_CAPABILITY = { extensions: { [EXTENSION]: { listChanged: false } } }

function projectScope(project: string): readonly string[] | undefined {
  const scope = isPublicDemoMode() ? publicDemoSlugs() : undefined
  if ((scope && !scope.includes(project)) || !getProjectMetadata(project)) {
    throw new ProtocolError(-32024, "Forbidden", { reason: "Project access is unavailable." })
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

async function streamInbox(params: z.infer<typeof streamParams>, context: ServerContext, actor: string) {
  if (params.name !== INBOX_MCP_EVENT) throw new ProtocolError(-32023, "NotFound", { kind: "event" })
  const project = params.arguments.project
  projectScope(project)
  const release = reserveStream(actor)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.mcpReq.signal, controller.signal])
  const _meta = { [SUBSCRIPTION_ID_META_KEY]: context.mcpReq.id }
  const heartbeatMs = Math.max(1000, Math.min(30_000, params.heartbeatMs ?? DEFAULT_HEARTBEAT_MS))
  const oldest = params.maxAgeMs === undefined ? -Infinity : Date.now() - params.maxAgeMs
  let cursor = params.cursor ?? undefined
  let stopWatching = () => {}
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
    return projectScope(project)
  }
  const read = (scope: readonly string[] | undefined) => {
    try { return readInboxEvents(project, cursor, scope) }
    catch (error) {
      if (error instanceof RangeError) throw new ProtocolError(-32602, "Invalid cursor for this project inbox.")
      throw error
    }
  }
  const prepare = (batch: ReturnType<typeof readInboxEvents>) => {
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
      const { project, mapId, nodeId, href, priority } = event
      await notify("notifications/events/event", {
        eventId: event.id, name: INBOX_MCP_EVENT, timestamp: event.createdAt,
        data: { project, mapId, nodeId, href, ...(priority ? { priority } : {}) }, cursor: event.cursor,
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
        await notify("notifications/events/error", { error: { code: -32603, message: "Inbox update unavailable. Call check_inbox to retry." } }).catch(() => controller.abort())
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
    stopWatching = watchInboxEvents(project, flush, signal, scope)
    const initial = prepare(read(scope))
    cursor = initial.startCursor
    await notify("notifications/events/active", { cursor, truncated: initial.reset, heartbeatMs })
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
    throw new ProtocolError(-32603, "Inbox events unavailable. Call check_inbox to retry.")
  } finally {
    controller.abort()
    if (timer) clearInterval(timer)
    stopWatching()
    release()
  }
}

export function registerInboxMcpEvents(server: Server, actor: string): void {
  server.setRequestHandler("events/list", { params: z.object({ cursor: z.string().optional(), _meta: metadata }).strict().default({}) }, async params => {
    if (params.cursor !== undefined) throw new ProtocolError(-32602, "The event catalog has one page. Omit cursor.")
    return { resultType: "complete", events: [{
      name: INBOX_MCP_EVENT,
      description: "A saved human @agent or @stat request changed in this project's inbox. Read check_inbox for current context and acknowledge exact notification IDs after handling.",
      delivery: ["push"],
      inputSchema: { type: "object", properties: { project: { type: "string", description: "An accessible OpenBar project slug." } }, required: ["project"], additionalProperties: false },
      payloadSchema: { type: "object", properties: {
        project: { type: "string" }, mapId: { type: "string" }, nodeId: { type: "string" }, href: { type: "string" }, priority: { type: "string", enum: ["fast-tracked"] },
      }, required: ["project", "mapId", "nodeId", "href"], additionalProperties: false },
    }] }
  })
  server.setRequestHandler("events/stream", { params: streamParams }, (params, context) => streamInbox(params, context, actor))
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
