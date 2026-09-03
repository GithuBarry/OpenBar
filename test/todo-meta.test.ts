import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMacroMatches, parseAnchorAttrs } from "../lib/marker-codec";
import { analyzePaper } from "../lib/research/paper-analysis";
import { composeObtodo, rewriteObtodo, rewriteObtodoText } from "../lib/todo-meta";

describe("TeX TODO annotations", () => {
  it("parses a TODO and assigns an id to a new one", () => {
    const tex = composeObtodo({ id: "eval-dense", text: "Run the dense-query baseline." });
    const analysis = analyzePaper(`\\section{Evaluation}\n${tex}\n`);
    assert.equal(analysis.todos.length, 1);
    assert.equal(analysis.todos[0]!.id, "eval-dense");
    const generated = composeObtodo({ text: "Write the opening motivation." });
    assert.ok(parseAnchorAttrs(findMacroMatches(generated, ["obtodo"])[0]!.attrs).id);
    assert.match(rewriteObtodoText(tex, "Run the dense-query baseline."), /id=eval-dense/);
  });

  it("round-trips unknown attributes while updating completion", () => {
    const source = "\\obtodo[id=t1, kind=advisor, owner=barry]{Ask about n=1000.}";
    const rewritten = rewriteObtodo(source, { completed: true });
    const attrs = parseAnchorAttrs(findMacroMatches(rewritten, ["obtodo"])[0]!.attrs);
    assert.equal(attrs.id, "t1");
    assert.equal(attrs.kind, "advisor");
    assert.equal(attrs.owner, "barry");
    assert.ok(attrs.completed);
    assert.match(rewritten, /Ask about n=1000\./);
  });

  it("preserves neighboring paper text during a TODO edit", () => {
    const source = "Ordinary prose stays.\n\\obtodo[id=keep]{Leave this.}\n\\obtodo[id=done]{Finish this.}\nMore prose.";
    const next = source.replace("\\obtodo[id=done]{Finish this.}", rewriteObtodo("\\obtodo[id=done]{Finish this.}", { completed: true }));
    assert.match(next, /Ordinary prose stays/);
    assert.match(next, /id=keep/);
    assert.match(next, /completed=/);
    assert.match(next, /More prose\.$/);
  });

  it("analyzes comments independently from TODOs", () => {
    const analysis = analyzePaper("\\section{Evaluation}\n\\obcomment[kind=result]{Dense queries look stronger.}\n");
    assert.equal(analysis.comments.length, 1);
    assert.equal(analysis.comments[0]!.attrs.kind, "result");
    assert.match(analysis.comments[0]!.text, /Dense queries/);
  });
});
