import assert from "node:assert/strict"
import { applyMindmapAction, createMindmapSession, mindmapReducer } from "../features/mindmap/mindmap-state"
import { normalizeMindmap } from "../lib/mindmap/mindmap"
import { mindmapNodeSchema } from "../lib/schemas"
import { createMindmapWebMcpHarness, executeMindmapWebMcpTool } from "../lib/research/webmcp-mindmap-contract"
import type { Mindmap } from "../lib/types"

async function main() {
  const initial: Mindmap = { projectId: "fixture", id: "draft", role: "draft", rootId: "root", updatedAt: new Date().toISOString(), nodes: [{ id: "root", parentId: null, text: "Root" }] }
  const human = applyMindmapAction(initial, { type: "add-node", parentId: "root", id: "human" }).mindmap.nodes[1]
  assert.equal(human.title, "")
  assert.equal(human.text, "")
  assert.equal(human.agentDraft, undefined)
  let state = createMindmapSession(initial)
  state = mindmapReducer(state, { type: "add-node", parentId: "root", id: "agent", title: "A proposal", agentDraft: true })
  state = mindmapReducer(state, { type: "patch-node", id: "agent", patch: { title: "Updated proposal" } })
  assert.equal(state.mindmap.nodes[1].agentDraft, true)
  assert.equal(mindmapNodeSchema.parse(normalizeMindmap(state.mindmap).nodes[1]).agentDraft, true)
  state = mindmapReducer(state, { type: "patch-node", id: "agent", patch: { agentDraft: undefined } })
  assert.equal(normalizeMindmap(state.mindmap).nodes[1].agentDraft, undefined)
  state = mindmapReducer(state, { type: "undo" })
  assert.equal(state.mindmap.nodes[1].agentDraft, true)
  const migrated = normalizeMindmap({ ...initial, nodes: [...initial.nodes, { id: "legacy", parentId: "root", text: "Existing note", shape: "note" }] }).nodes[1]
  assert.equal(migrated.shape, "leaf")
  assert.equal(migrated.agentDraft, true)
  const harness = createMindmapWebMcpHarness({ nodes: [{ id: "root", parentId: null, text: "Root" }] })
  const added = await executeMindmapWebMcpTool(harness, "add_mindmap_node", { parentId: "root", expectedRevision: harness.snapshot.revision })
  assert(added.ok)
  const card = harness.snapshot.nodes[1]
  assert.equal(card.agentDraft, true)
  assert.equal(card.title, "")
  harness.snapshot.editingBlocked = true
  const frozen = JSON.stringify(harness.snapshot.nodes)
  const blocked = await executeMindmapWebMcpTool(harness, "patch_mindmap_node", { id: card.id, title: "Blocked edit", expectedRevision: harness.snapshot.revision })
  assert(!blocked.ok)
  assert.equal(blocked.code, "remote_conflict")
  assert.equal(JSON.stringify(harness.snapshot.nodes), frozen)
  assert((await executeMindmapWebMcpTool(harness, "get_mindmap", {})).ok)
  console.log("PASS empty human cards, persistent agent drafts, explicit acceptance, undo, retired Note migration, and conflict-blocked agent edits with readable maps")
}
void main()
