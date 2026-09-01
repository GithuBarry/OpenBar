import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeObtodo, rewriteObtodo, rewriteObtodoText } from "../lib/todo-meta";
import { findMacroMatches, parseAnchorAttrs } from "../lib/marker-codec";
import { analyzePaper } from "../lib/research/paper-analysis";

describe("TeX TODO annotations", () => {
  it("parses a TODO", () => {
    const tex = composeObtodo({ id: "eval-dense", text: "Run the dense-query baseline." });
    const analysis = analyzePaper(`\\section{Evaluation}\n${tex}\n`);
    assert.equal(analysis.todos.length, 1);
    assert.equal(analysis.todos[0]!.id, "eval-dense");
    assert.equal(analysis.todos[0]!.text, "Run the dense-query baseline.");
  });

  it("round-trips unknown attributes", () => {
    const source = "\\obtodo[id=t1, kind=advisor, owner=barry]{Ask about n=1000.}";
    const rewritten = rewriteObtodo(source, { status: "in_progress" });
    const attrs = parseAnchorAttrs(findMacroMatches(rewritten, ["obtodo"])[0]!.attrs);
    assert.equal(attrs.id, "t1");
    assert.equal(attrs.kind, "advisor");
    assert.equal(attrs.owner, "barry");
    assert.equal(attrs.status, "in_progress");
    assert.match(rewritten, /Ask about n=1000\./);
  });

  it("completing a TODO only rewrites that macro", () => {
    const around = "Ordinary prose stays.\n\\obtodo[id=keep]{Leave this.}\n";
    const target = "\\obtodo[id=done]{Finish this.}";
    const source = `${around}${target}\nMore prose.`;
    const next = `${around}${rewriteObtodo(target, { status: "done" })}\nMore prose.`;
    assert.match(next, /Ordinary prose stays/);
    assert.match(next, /id=keep/);
    assert.match(next, /status=done/);
    assert.equal(next.indexOf("More prose."), next.lastIndexOf("More prose."));
  });

  it("comment attributes round-trip through analysis", () => {
    const source = "\\section{Evaluation}\n\\obcomment[kind=result]{Dense queries look stronger.}\n";
    const analysis = analyzePaper(source);
    assert.equal(analysis.comments.length, 1);
    assert.equal(analysis.comments[0]!.attrs.kind, "result");
    assert.match(analysis.comments[0]!.text, /Dense queries/);
  });

  it("malformed annotation degrades safely", () => {
    const source = "\\section{Intro}\n\\obtodo{unclosed\nOrdinary text.";
    const analysis = analyzePaper(source);
    assert.ok(Array.isArray(analysis.todos));
    assert.ok(analysis.outline.some((heading) => heading.title.includes("Intro")));
  });

  it("new TODOs get a generated id", () => {
    const tex = composeObtodo({ text: "Write the opening motivation." });
    const attrs = parseAnchorAttrs(findMacroMatches(tex, ["obtodo"])[0]!.attrs);
    assert.ok(attrs.id);
    assert.equal(rewriteObtodoText(tex, "Write the opening motivation."), tex);
  });
});
