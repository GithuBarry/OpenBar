#!/usr/bin/env node
/** Newline JSON-RPC bridge. Credentials stay in the environment, diagnostics in stderr. */
import readline from 'node:readline'
const base = process.env.OPENBARRY_URL || 'http://127.0.0.1:3000'
const endpoint = new URL('/api/mcp', base)
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('Use HTTPS or loopback HTTP for OPENBARRY_URL.')
const token = process.env.OPENBARRY_ACCESS_TOKEN
if (!token) throw new Error('Set OPENBARRY_ACCESS_TOKEN before starting the bridge.')
let session, protocol
async function send(message) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  if (session) headers['Mcp-Session-Id'] = session
  if (protocol) headers['MCP-Protocol-Version'] = protocol
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(360_000), redirect: 'error' })
  const body = await response.text()
  if (!response.ok) throw new Error(`OpenBar HTTP ${response.status}: ${body.slice(0, 500)}`)
  if (response.headers.get('mcp-session-id')) session = response.headers.get('mcp-session-id')
  if (!body) return
  const result = JSON.parse(body)
  if (message.method === 'initialize') protocol = result.result?.protocolVersion
  process.stdout.write(JSON.stringify(result) + '\n')
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  let message
  try {
    if (line.length > 4_000_000) throw new Error('Message exceeds 4 MB.')
    message = JSON.parse(line)
    await send(message)
  } catch (error) {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }) + '\n')
    else process.stderr.write(error.message + '\n')
  }
}
if (session) await fetch(endpoint, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Mcp-Session-Id': session }, signal: AbortSignal.timeout(5000) }).catch(() => {})
