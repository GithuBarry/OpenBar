import assert from "node:assert/strict"
import { createMindmapSession, mindmapReducer } from "../features/mindmap/mindmap-state"
import { normalizeMindmap } from "../lib/mindmap/mindmap"
import { mindmapNodeSchema } from "../lib/schemas"
import type { Mindmap } from "../lib/types"

const initial: Mindmap = {
  projectId: "test", id: "draft", rootId: "root", role: "draft", updatedAt: new Date().toISOString(),
  nodes: [
    { id: "root", parentId: null, title: "Root", text: "Keep this text", refs: [{ kind: "paper-comment", id: "comment" }] },
    { id: "todo", parentId: "root", text: "", todoId: "paper-todo" },
  ],
}
let state = createMindmapSession(initial)
state = mindmapReducer(state, { type: "paste-images", id: "root", images: [
  { ref: { kind: "figure", id: "figures/a.png", label: "A.png" }, childId: "unused" },
  { ref: { kind: "figure", id: "figures/b.png", label: "B.png" }, childId: "child-b" },
] })
assert.equal(state.mindmap.nodes.find(n => n.id === "root")!.refs!.length, 2)
assert.equal(state.mindmap.nodes.find(n => n.id === "root")!.text, "Keep this text")
assert.equal(state.mindmap.nodes.find(n => n.id === "child-b")!.parentId, "root")
assert(state.mindmap.nodes.every(n => (n.refs || []).filter(r => r.kind === "figure").length <= 1))
const pasted = state.mindmap
state = mindmapReducer(state, { type: "undo" })
assert.deepEqual(state.mindmap.nodes, initial.nodes)
state = mindmapReducer(state, { type: "redo" })
assert.deepEqual(state.mindmap, pasted)
state = mindmapReducer(state, { type: "paste-images", id: "root", images: [
  { ref: { kind: "figure", id: "figures/c.png" }, childId: "child-c" },
] })
assert.equal(state.mindmap.nodes.find(n => n.id === "child-c")!.parentId, "root")
assert.equal(state.mindmap.nodes.find(n => n.id === "root")!.refs!.find(r => r.kind === "figure")!.id, "figures/a.png")
// Late upload results target the originally selected card even after selection changes.
state = mindmapReducer(state, { type: "select", id: "root" })
state = mindmapReducer(state, { type: "paste-images", id: "todo", images: [
  { ref: { kind: "figure", id: "figures/todo.png" }, childId: "unused-todo" },
] })
assert.equal(state.mindmap.nodes.find(n => n.id === "todo")!.todoId, "paper-todo")
assert.equal(state.selectedId, "root")
const todo = state.mindmap.nodes.find(n => n.id === "todo")!
state = mindmapReducer(state, { type: "patch-node", id: "todo", patch: { refs: todo.refs!.map(ref => ({ ...ref, imageWidth: 55 })) } })
assert.equal(normalizeMindmap(state.mindmap).nodes.find(n => n.id === "todo")!.refs![0]!.imageWidth, 55)
assert(mindmapNodeSchema.safeParse({ ...todo, refs: [{ kind: "figure", id: "a", imageWidth: 25 }] }).success)
assert.equal(mindmapNodeSchema.safeParse({ ...todo, refs: [{ kind: "figure", id: "a", imageWidth: 24 }] }).success, false)
assert.equal(mindmapNodeSchema.safeParse({ ...todo, refs: [{ kind: "figure", id: "a" }, { kind: "figure", id: "b" }] }).success, false)
const missingTarget = mindmapReducer(state, { type: "paste-images", id: "deleted", images: [{ ref: { kind: "figure", id: "a" }, childId: "orphan" }] })
assert.deepEqual(missingTarget.mindmap, state.mindmap)
console.log("PASS image paste targeting, child placement, undo/redo, TODO ownership, sizing persistence, and validation")
