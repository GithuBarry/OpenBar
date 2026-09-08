import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { randomUUID } from 'node:crypto'

const base = process.env.OPENBARRY_URL || 'http://127.0.0.1:3000'
const token = process.env.OPENBARRY_ACCESS_TOKEN
assert(token, 'Set OPENBARRY_ACCESS_TOKEN')
const project = process.env.OB_SMOKE_SLUG || 'private-project-a'
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const checks = []
const client = new Client({ name: 'openbar-access-check', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', base), { requestInit: { headers } }))
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args })
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent)
  assert.equal(result.structuredContent.ok, !result.isError)
  return result.structuredContent
}
try {
  const catalog = await client.listTools()
  assert(catalog.tools.length >= 48)
  for (const [name, args] of [['list_projects', {}], ['list_mindmaps', { project }], ['get_project_state', { project, detail: 'full' }], ['get_source_bundle', { project, limit: 1000 }], ['get_paper_compile', { project }]]) {
    assert.equal((await call(name, args)).ok, true)
    checks.push(`${name}: SDK accepted structured result`)
  }
  const resources = await client.listResources()
  assert(resources.resources.some(r => r.uri === 'openbar://guide'))
  assert((await client.readResource({ uri: `openbar://projects/${project}/state` })).contents.length)
  assert((await client.listResourceTemplates()).resourceTemplates.length)
  assert((await client.listPrompts()).prompts.length)
  assert((await client.getPrompt({ name: 'start_project', arguments: { project } })).messages.length)
  checks.push('resources, templates, prompts and resource reads')
  const state = await call('get_project_state', { project, detail: 'full' })
  if (state.value.skills.length) assert.equal((await call('read_project_skill', { project, id: state.value.skills[0].id })).ok, true)
  const bad = await call('get_project_state', { project, extra: true })
  assert.equal(bad.code, 'invalid_arguments')
  const map = await call('get_mindmap', { project, mapId: 'draft' })
  const conflict = await call('rename_mindmap', { project, mapId: 'draft', title: map.value.title, expectedRevision: map.value.revision, expectedDiskHash: '0'.repeat(64) })
  assert.equal(conflict.code, 'stale_disk_state')
  const sourceConflict = await call('replace_source_range', { project, from: 0, to: 0, text: '', expectedBundleHash: '0'.repeat(64), dryRun: true })
  assert.equal(sourceConflict.code, 'stale_disk_state')
  checks.push('invalid argument rejection and stale map/source protection')
  // Explicit opt-in runs a reversible scratch skill creation, update and deletion.
  if (process.env.OB_SMOKE_WRITES === '1') {
    const id = `agent-access-check-${randomUUID()}`
    let hash
    try {
      const created = await call('write_project_skill', { project, id, body: 'Temporary agent access check.' })
      assert(created.ok, JSON.stringify(created))
      hash = created.value.hash
      const read = await call('read_project_skill', { project, id })
      assert.match(read.value.body, /Temporary agent access check/)
      const stale = await call('write_project_skill', { project, id, body: 'Stale update', expectedHash: '0'.repeat(64) })
      assert.equal(stale.code, 'stale_disk_state')
      const updated = await call('write_project_skill', { project, id, body: 'Updated temporary check.', expectedHash: hash })
      assert(updated.ok)
      hash = updated.value.hash
      checks.push('scratch skill create/read/update and stale-hash conflict')
    } finally {
      if (hash) assert.equal((await call('delete_project_skill', { project, id, expectedHash: hash })).ok, true)
    }
    assert.equal((await call('read_project_skill', { project, id })).ok, false)
    checks.push('scratch skill deletion verified')
  }
} finally { await client.close() }
for (const [path, init, expected] of [
  ['/api/projects', { headers }, 200], ['/api/tools', { headers }, 200], ['/openapi.json', {}, 200],
  ['/api/tools/get_project_state', { method: 'POST', headers, body: JSON.stringify({ project }) }, 200],
  ['/api/tools', {}, 401],
  ['/api/mcp', { method: 'POST', headers: { ...headers, 'MCP-Protocol-Version': 'invalid' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }, 400],
  ['/api/mcp', { headers }, 405],
  ['/api/mcp', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } }, 403],
  ['/api/tools', { method: 'OPTIONS', headers: { Origin: base } }, 204],
]) {
  const response = await fetch(new URL(path, base), init)
  assert.equal(response.status, expected, `${path}: ${await response.text()}`)
  if (expected === 401) assert.match(response.headers.get('www-authenticate'), /Bearer/)
  checks.push(`${path}: ${expected}`)
}
const stdio = new Client({ name: 'openbar-stdio-check', version: '1' })
try {
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp-stdio.mjs'], env: { ...process.env, OPENBARRY_URL: base, OPENBARRY_ACCESS_TOKEN: token }, stderr: 'pipe' }))
  const result = await stdio.callTool({ name: 'list_projects', arguments: {} })
  assert.equal(result.structuredContent.ok, true)
  checks.push('stdio client initialization and project discovery')
} finally { await stdio.close() }
console.log(JSON.stringify({ ok: true, base, checks }, null, 2))
