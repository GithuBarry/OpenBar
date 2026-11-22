#!/usr/bin/env node
/** SDK transport relay. Credentials stay in the environment, diagnostics in stderr. */
import { StreamableHTTPClientTransport, isInitializeRequest, isJSONRPCRequest } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const base = process.env.OPENBAR_URL || 'http://127.0.0.1:3000'
const endpoint = new URL('/api/mcp', base)
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('Use HTTPS or loopback HTTP for OPENBAR_URL.')
const token = process.env.OPENBAR_ACCESS_TOKEN
if (!token) throw new Error('Set OPENBAR_ACCESS_TOKEN before starting the bridge.')

const stdio = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4_000_000 })
const http = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
  fetch: async (url, init) => {
    let eventName
    if (typeof init?.body === 'string') {
      try {
        const message = JSON.parse(init.body)
        if (message.method === 'events/stream' && typeof message.params?.name === 'string') eventName = message.params.name
      } catch { /* The SDK validates protocol bodies. */ }
    }
    const headers = new Headers(init?.headers)
    if (eventName) headers.set('Mcp-Name', /^[\x20-\x7e]+$/.test(eventName) ? eventName : `=?base64?${Buffer.from(eventName).toString('base64')}?=`)
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), ...(eventName ? [] : [AbortSignal.timeout(init?.method === 'DELETE' ? 5000 : 360_000)])]),
    })
    // The server exposes the SDK-negotiated version on HTTP responses. This
    // keeps relay framing and initialization payload parsing inside the SDK.
    const protocol = response.headers.get('mcp-protocol-version')
    if (protocol) http.setProtocolVersion(protocol)
    return response
  },
})

let closed = false
let initialized = Promise.resolve()
const eventStreams = new Map()
function report(error) { if (!closed) process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`) }
async function close() {
  if (closed) return
  closed = true
  for (const controller of eventStreams.values()) controller.abort()
  eventStreams.clear()
  if (http.sessionId) await http.terminateSession().catch(report)
  await Promise.allSettled([http.close(), stdio.close()])
}

stdio.onmessage = (message) => {
  if (message.method === 'notifications/cancelled' && eventStreams.has(message.params?.requestId)) {
    eventStreams.get(message.params.requestId).abort()
    eventStreams.delete(message.params.requestId)
    return
  }
  let controller
  if (isJSONRPCRequest(message) && message.method === 'events/stream') {
    if (eventStreams.has(message.id)) {
      void stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'An event stream already uses this request ID.' } }).catch(report)
      return
    }
    controller = new AbortController()
    eventStreams.set(message.id, controller)
  }
  const operation = initialized.then(() => http.send(message, controller ? { requestSignal: controller.signal } : undefined))
  if (isInitializeRequest(message)) initialized = operation.catch(() => {})
  void operation.catch(async (error) => {
    if (controller?.signal.aborted) return
    if (controller) eventStreams.delete(message.id)
    if (isJSONRPCRequest(message) && !closed) {
      await stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }).catch(report)
    } else report(error)
  })
}
http.onmessage = (message) => {
  if ('id' in message && !('method' in message)) eventStreams.delete(message.id)
  void stdio.send(message).catch(report)
}
stdio.onerror = report
http.onerror = report
stdio.onclose = () => { void close() }
http.onclose = () => { void close() }
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
await http.start()
await stdio.start()
