#!/usr/bin/env node
/** SDK transport relay. Credentials stay in the environment, diagnostics in stderr. */
import { StreamableHTTPClientTransport, isInitializeRequest, isJSONRPCRequest } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const base = process.env.OPENBARRY_URL || 'http://127.0.0.1:3000'
const endpoint = new URL('/api/mcp', base)
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('Use HTTPS or loopback HTTP for OPENBARRY_URL.')
const token = process.env.OPENBARRY_ACCESS_TOKEN
if (!token) throw new Error('Set OPENBARRY_ACCESS_TOKEN before starting the bridge.')

const stdio = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4_000_000 })
const http = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
  fetch: async (url, init) => {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(init?.method === 'DELETE' ? 5000 : 360_000)]),
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
function report(error) { if (!closed) process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`) }
async function close() {
  if (closed) return
  closed = true
  if (http.sessionId) await http.terminateSession().catch(report)
  await Promise.allSettled([http.close(), stdio.close()])
}

stdio.onmessage = (message) => {
  const operation = initialized.then(() => http.send(message))
  if (isInitializeRequest(message)) initialized = operation.catch(() => {})
  void operation.catch(async (error) => {
    if (isJSONRPCRequest(message) && !closed) {
      await stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }).catch(report)
    } else report(error)
  })
}
http.onmessage = (message) => { void stdio.send(message).catch(report) }
stdio.onerror = report
http.onerror = report
stdio.onclose = () => { void close() }
http.onclose = () => { void close() }
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
await http.start()
await stdio.start()
