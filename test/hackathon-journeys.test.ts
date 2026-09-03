import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyMindmapAction } from "../features/mindmap/mindmap-state";
import { normalizeMindmapLabels } from "../lib/mindmap/node-metadata";
import { availableTodoCandidates } from "../lib/research/map-todo-candidates";
import { applySourceOperation } from "../lib/research/operation-service";
import { reconcileTodos, todosFromPaperState } from "../lib/research/todo-map";
import { isComplexTableSource, patchSectionTableCell } from "../lib/tex-project/table-fragments";
import { findMacroMatches, parseAnchorAttrs } from "../lib/marker-codec";
import type { Mindmap } from "../lib/types";

function map(id: string, nodes: Mindmap["nodes"]): Mindmap {
  return {
    projectId: "command-v",
    id,
    role: id === "draft" ? "draft" : "planning",
    rootId: "root",
    title: id === "draft" ? "Command-V" : "Transferability",
    updatedAt: "2026-09-02T00:00:00.000Z",
    nodes,
  };
}

describe("approved research journeys", () => {
  it("keeps a TODO branch after its TeX source disappears", () => {
    const primary = map("draft", [
      { id: "root", parentId: null, text: "Command-V" },
      { id: "todo", parentId: "root", todoId: "cv-refusal-eval", text: "" },
      { id: "child", parentId: "todo", text: "Keep the ASR plot context." },
    ]);
    const reconciliation = reconcileTodos(primary, []);
    assert.deepEqual(primary.nodes.map((node) => node.id), ["root", "todo", "child"]);
    assert.deepEqual(reconciliation.missing.map((item) => item.todoId), ["cv-refusal-eval"]);
  });

  it("allows one published-paper TODO to be reused once per map", () => {
    const todos = todosFromPaperState([{ id: "cv-refusal-eval", text: "Plot refusal ASR.", completed: false }]);
    const primary = map("draft", [{ id: "root", parentId: null, text: "Command-V" }, { id: "card", parentId: "root", todoId: todos[0]!.id!, text: "" }]);
    const secondary = map("planning", [{ id: "root", parentId: null, text: "Transferability" }, { id: "card", parentId: "root", todoId: todos[0]!.id!, text: "" }]);
    assert.equal(reconcileTodos(primary, todos).warnings.length, 0);
    assert.equal(reconcileTodos(secondary, todos).warnings.length, 0);
  });

  it("keeps secondary movement local and offers TODOs from the live map", () => {
    const primary = map("draft", [{ id: "root", parentId: null, text: "Command-V" }, { id: "method", parentId: "root", text: "Method" }, { id: "card", parentId: "method", todoId: "cv-refusal-eval", text: "" }]);
    const secondary = map("planning", [{ id: "root", parentId: null, text: "Transferability" }, { id: "branch", parentId: "root", text: "Transfer" }, { id: "other", parentId: "branch", todoId: "cv-lima-profiles", text: "" }]);
    const before = JSON.stringify(primary.nodes);
    const moved = applyMindmapAction(secondary, { type: "reparent", id: "other", parentId: "root" });
    assert.equal(moved.mindmap.nodes.find((node) => node.id === "other")?.parentId, "root");
    assert.equal(JSON.stringify(primary.nodes), before);
    assert.deepEqual(
      availableTodoCandidates([
        { id: "cv-refusal-eval", text: "Plot refusal ASR." },
        { id: "cv-lima-profiles", text: "Capture profiles." },
        { id: "cv-converters", text: "Time converters." },
      ], secondary.nodes).map((todo) => todo.id), ["cv-refusal-eval", "cv-converters"]);
  });

  it("uses one label normalizer for authored map labels", () => {
    assert.deepEqual(normalizeMindmapLabels([" Eval ", "eval", "Method", "", "method"]), ["Eval", "Method"]);
  });

  it("keeps simple table patches bounded and refuses complex tables", () => {
    const simple = [
      "\\begin{tabular}{ll}",
      "A & B \\\\",
      "C & \\obmarker{todo}{result} \\\\",
      "\\end{tabular}",
    ].join("\n");
    assert.equal(isComplexTableSource(simple), false);
    const patched = patchSectionTableCell(simple, 0, 0, 0, "patched");
    assert.equal(patched.ok, true);
    if (patched.ok) {
      assert.match(patched.tex, /patched/);
      assert.match(patched.tex, /B/);
      assert.match(patched.tex, /\\obmarker\{todo\}\{result\}/);
    }

    const complex = "\\begin{tabular}{ll}\n\\multicolumn{2}{c}{Result} \\\\\n\\end{tabular}";
    assert.equal(isComplexTableSource(complex), true);
    assert.deepEqual(patchSectionTableCell(complex, 0, 0, 0, "patched"), { ok: false, reason: "complex" });
  });

  it("round-trips a free-form comment kind through the source operation", () => {
    const applied = applySourceOperation("Before.\nAfter.", {
      type: "add_comment",
      from: 0,
      to: 0,
      kind: "reviewer-question",
      text: "Check the transfer condition.",
      id: "transfer-condition",
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    const comment = findMacroMatches(applied.value.source, ["obcomment"])[0];
    assert.ok(comment);
    assert.equal(parseAnchorAttrs(comment.attrs).kind, "reviewer-question");
    assert.match(comment.body, /transfer condition/);
  });
});
