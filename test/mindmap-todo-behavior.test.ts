import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256Hex } from "../lib/mindmap/sha256";
import { availableTodoCandidates, boundTodoIds } from "../lib/research/map-todo-candidates";
import { isPrimaryMindmap, reconcileTodos } from "../lib/research/todo-map";
import type { Mindmap, MindmapNode } from "../lib/types";

const todos = [
  { id: "a", text: "A" },
  { id: "b", text: "B" },
  { id: "c", text: "C" },
];

const nodes = [
  { id: "root" },
  { id: "node-a", todoId: "a" },
  { id: "node-b", todoId: "b" },
];

test("available TODOs come from live map membership", () => {
  assert.deepEqual(availableTodoCandidates(todos, nodes).map((todo) => todo.id), ["c"]);
  assert.deepEqual(availableTodoCandidates(todos, [...nodes, { id: "node-c", todoId: "a" }]).map((todo) => todo.id), ["c"]);
});

test("relink excludes other bindings and ignores the selected broken card", () => {
  const broken = [...nodes, { id: "broken", todoId: "missing" }];
  assert.deepEqual(
    availableTodoCandidates(todos, broken, "broken").map((todo) => todo.id),
    ["c"],
  );
});

test("bound ids trim values and omit the excluded node", () => {
  assert.deepEqual(
    [...boundTodoIds([
      { id: "a", todoId: " alpha " },
      { id: "b", todoId: "beta" },
      { id: "c", todoId: "" },
    ], "b")],
    ["alpha"],
  );
});

test("map role is authoritative", () => {
  assert.equal(isPrimaryMindmap({ role: "draft" }), true);
  assert.equal(isPrimaryMindmap({ role: "planning" }), false);
  assert.equal(isPrimaryMindmap({ role: "planning", id: "draft" }), false);
  assert.equal(isPrimaryMindmap({ id: "draft" }), true);
  assert.equal(isPrimaryMindmap({ id: "transferability" }), false);
});

test("browser-safe mindmap hash matches SHA-256", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("removing a paper TODO leaves its card and descendants as missing source", () => {
  const map: Mindmap = {
    projectId: "demo",
    id: "draft",
    role: "draft",
    rootId: "root",
    title: "Demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [
      { id: "root", text: "Root", parentId: null } as MindmapNode,
      { id: "todo-card", text: "", parentId: "root", todoId: "gone" } as MindmapNode,
      { id: "child", text: "Keep this branch", parentId: "todo-card" } as MindmapNode,
    ],
  };
  const reconciliation = reconcileTodos(map, []);
  assert.deepEqual(map.nodes.map((node) => node.id), ["root", "todo-card", "child"]);
  assert.deepEqual(reconciliation.missing.map((item) => item.node.id), ["todo-card"]);
  assert.equal(reconciliation.missing[0]?.todoId, "gone");
});
