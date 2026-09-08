import assert from "node:assert/strict"
import { pruneMcpSessions, touchMcpSession, MCP_SESSION_TTL_MS, type McpSession } from "../lib/server/mcp-sessions"
import { readAgentRequestBody } from "../lib/server/agent-request-body"
import { agentOriginAllowed, agentHttp } from "../lib/server/agent-http"

async function main() {
  const session = { actor: "alice", lastSeen: 0, protocolVersion: "2025-11-25" }
  const sessions = new Map<string, McpSession>([["session", session]])
  assert(touchMcpSession(session, "alice", MCP_SESSION_TTL_MS - 1))
  pruneMcpSessions(sessions, MCP_SESSION_TTL_MS + 1)
  assert.equal(sessions.size, 1, "POST activity keeps a session alive")
  assert.equal(touchMcpSession(session, "bob", 2 * MCP_SESSION_TTL_MS), false)
  pruneMcpSessions(sessions, 2 * MCP_SESSION_TTL_MS)
  assert.equal(sessions.size, 0, "another identity cannot refresh the session")
  assert.equal(await readAgentRequestBody(new Request("http://localhost", { method: "POST", body: "你好" }), 6), "你好")
  await assert.rejects(readAgentRequestBody(new Request("http://localhost", { method: "POST", body: "你好" }), 5), RangeError)
  const prior = process.env.OPENBARRY_AGENT_ORIGINS
  process.env.OPENBARRY_AGENT_ORIGINS = "https://approved.example"
  try {
    const request = new Request("http://localhost:3000/api/tools", { method: "OPTIONS", headers: { Origin: "https://approved.example", Host: "openbar.example.ts.net", "X-Forwarded-Proto": "https" } })
    assert(agentOriginAllowed(request))
    const response = await agentHttp(request, async () => new Response())
    assert.equal(response.status, 204)
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://approved.example")
    assert.equal(agentOriginAllowed(new Request(request, { headers: { Origin: "https://other.example" } })), false)
  } finally {
    if (prior === undefined) delete process.env.OPENBARRY_AGENT_ORIGINS
    else process.env.OPENBARRY_AGENT_ORIGINS = prior
  }
  console.log("Agent transport checks passed: session activity, identity isolation, UTF-8 byte bounds, approved and rejected origins.")
}
void main()
