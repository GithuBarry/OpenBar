import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPaperSummary,
  deriveRecentActivity,
  parseProjectHref,
  resolveProjectNavigation,
  searchProjectContent,
} from "../lib/research/project-state";
import { analyzePaper } from "../lib/research/paper-analysis";
import type { TexPaper } from "../lib/tex-project/project";

const SLUG = "dp-reconstruction";

function fixturePaper(): { paper: TexPaper; source: string } {
  const source = [
    "\\title{Reconstruction}",
    "\\section{Introduction}",
    "Motivation.",
    "\\section{Evaluation}",
    "\\obtodo[id=dense-baseline]{Run dense-query baseline}",
    "\\obcomment[kind=result]{Dense queries seem much stronger than one-hot.}",
    "one-hot reconstruction is weaker.",
  ].join("\n");
  const paper: TexPaper = {
    projectId: SLUG,
    title: "Reconstruction",
    source,
    sourceHash: "abc",
    sections: [
      { id: "introduction", title: "Introduction", level: 2, order: 0, label: "sec-introduction", file: "/tmp/sections/introduction.tex", tex: "Motivation.", hash: "1" },
      { id: "evaluation", title: "Evaluation", level: 2, order: 1, label: "sec-evaluation", file: "/tmp/sections/evaluation.tex", tex: "eval", hash: "2" },
    ],
  };
  return { paper, source };
}

describe("project state", () => {
  it("builds an outline and TODO locations from a fixture paper", () => {
    const { paper, source } = fixturePaper();
    const summary = buildPaperSummary(
      SLUG,
      paper,
      analyzePaper(source),
      { rootFile: "paper.tex", revision: 0, bundleHash: "h" },
      "/tmp",
    );
    assert.deepEqual(summary.outline.map((item) => item.id), ["introduction", "evaluation"]);
    assert.equal(summary.todos.length, 1);
    assert.equal(summary.todos[0]!.id, "dense-baseline");
    assert.equal(summary.todos[0]!.sectionId, "evaluation");
    assert.equal(summary.comments[0]!.kind, "result");
  });

  it("derives recent annotation activity without mutating the map", () => {
    const { paper, source } = fixturePaper();
    const summary = buildPaperSummary(SLUG, paper, analyzePaper(source), { rootFile: "paper.tex", revision: 0 }, "/tmp");
    const recent = deriveRecentActivity({ slug: SLUG, outline: summary.outline, todos: summary.todos, comments: summary.comments });
    assert.ok(recent.some((item) => item.kind === "annotation"));
  });

  it("completed TODOs leave the open overlay without a saved map", () => {
    const { paper, source } = fixturePaper();
    const open = buildPaperSummary(SLUG, paper, analyzePaper(source), { rootFile: "paper.tex", revision: 0 }, "/tmp");
    assert.equal(open.todos.filter((todo) => todo.status !== "done").length, 1);
    const nextSource = source.replace(
      "\\obtodo[id=dense-baseline]{Run dense-query baseline}",
      "\\obtodo[id=dense-baseline, status=done]{Run dense-query baseline}",
    );
    const closed = buildPaperSummary(SLUG, paper, analyzePaper(nextSource), { rootFile: "paper.tex", revision: 0 }, "/tmp");
    assert.equal(closed.todos.filter((todo) => todo.status !== "done").length, 0);
    assert.equal(closed.todos[0]!.status, "done");
  });
});

describe("search and navigation", () => {
  it("finds a section, TODO, and mindmap node", () => {
    const { paper, source } = fixturePaper();
    const summary = buildPaperSummary(SLUG, paper, analyzePaper(source), { rootFile: "paper.tex", revision: 0 }, "/tmp");
    const results = searchProjectContent({
      slug: SLUG,
      query: "dense",
      paper: summary,
      paperSource: source,
      mindmaps: [{
        projectId: SLUG,
        id: "draft",
        title: "Research map",
        rootId: "root",
        updatedAt: "2026-09-01T00:00:00.000Z",
        nodes: [
          { id: "root", text: "Reconstruction", parentId: null },
          { id: "dense-query", text: "Dense queries", parentId: "root" },
        ],
      }],
    });
    assert.ok(results.some((hit) => hit.kind === "todo" && hit.id.includes("dense-baseline")));
    assert.ok(results.some((hit) => hit.kind === "mindmap_node" && hit.id.includes("dense-query")));
    assert.ok(results.some((hit) => hit.href.includes("/paper")));
    const sections = searchProjectContent({
      slug: SLUG,
      query: "Evaluation",
      paper: summary,
      paperSource: source,
      mindmaps: [],
    });
    assert.ok(sections.some((hit) => hit.kind === "paper" && hit.id === "paper:section:evaluation"));
  });

  it("parses and resolves navigation locations", () => {
    const parsed = parseProjectHref("/p/dp-reconstruction/paper#evaluation");
    assert.equal(parsed?.slug, SLUG);
    assert.equal(parsed?.kind, "paper");
    assert.equal(parsed?.hash, "evaluation");
    const href = resolveProjectNavigation(SLUG, { id: "paper:section:evaluation" });
    assert.equal(href?.href, "/p/dp-reconstruction/paper#evaluation");
    const todo = resolveProjectNavigation(SLUG, { id: "paper:todo:dense-baseline" });
    assert.equal(todo?.href, "/p/dp-reconstruction/paper#dense-baseline");
    const node = resolveProjectNavigation(SLUG, { id: "mindmap:draft:node:dense-query" });
    assert.equal(node?.href, "/p/dp-reconstruction/mindmap#dense-query");
  });
});
