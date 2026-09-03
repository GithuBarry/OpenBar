import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPaperSummary,
  deriveRecentActivity,
  getProjectState,
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
      { id: "introduction", title: "Introduction", level: 2, order: 0, label: "sec-introduction", file: "/tmp/introduction.tex", tex: "Motivation.", hash: "1" },
      { id: "evaluation", title: "Evaluation", level: 2, order: 1, label: "sec-evaluation", file: "/tmp/evaluation.tex", tex: "eval", hash: "2" },
    ],
  };
  return { paper, source };
}

describe("project state", () => {
  it("builds paper locations for TODOs and comments", () => {
    const { paper, source } = fixturePaper();
    const summary = buildPaperSummary(SLUG, paper, analyzePaper(source), { rootFile: "paper.tex", revision: 0, bundleHash: "h" }, "/tmp");
    assert.deepEqual(summary.outline.map((item) => item.id), ["introduction", "evaluation"]);
    assert.equal(summary.todos[0]!.id, "dense-baseline");
    assert.equal(summary.todos[0]!.sectionId, "evaluation");
    assert.equal(summary.comments[0]!.kind, "result");
    assert.equal(typeof summary.comments[0]!.sourceStart, "number");
  });

  it("derives recent map activity without changing map data", () => {
    const { paper, source } = fixturePaper();
    const summary = buildPaperSummary(SLUG, paper, analyzePaper(source), { rootFile: "paper.tex", revision: 0 }, "/tmp");
    const map = {
      projectId: SLUG,
      id: "draft",
      title: "Research map",
      rootId: "root",
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "root", text: "Reconstruction", parentId: null, updatedAt: new Date().toISOString() },
      ],
    };
    const recent = deriveRecentActivity({ slug: SLUG, outline: summary.outline, mindmaps: [map], paperTodos: analyzePaper(source).todos });
    assert.ok(recent.some((item) => item.kind === "card" && item.mapId === "draft"));
  });
});

describe("search and navigation", () => {
  it("finds paper and mindmap results with navigable links", () => {
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
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: "root", text: "Reconstruction", parentId: null },
          { id: "dense-query", text: "Dense queries", parentId: "root" },
        ],
      }],
    });
    assert.ok(results.some((hit) => hit.kind === "todo" && hit.id.includes("dense-baseline")));
    assert.ok(results.some((hit) => hit.kind === "mindmap_node" && hit.id.includes("dense-query")));
    assert.ok(results.some((hit) => hit.href.includes("/paper")));
  });

  it("parses and resolves project navigation", () => {
    const parsed = parseProjectHref("/p/dp-reconstruction/paper#evaluation");
    assert.equal(parsed?.slug, SLUG);
    assert.equal(parsed?.kind, "paper");
    assert.equal(parsed?.hash, "evaluation");
    const live = getProjectState(SLUG);
    const section = live?.paper?.outline.find((item) => item.title === "Evaluation");
    const todo = live?.paper?.todos.find((item) => item.id === "dense-baseline");
    assert.ok(section);
    assert.ok(todo);
    assert.equal(resolveProjectNavigation(SLUG, { id: `paper:section:${section.id}` })?.href, todo.sectionId
      ? `/p/${SLUG}/paper#${section.id}`
      : undefined);
    assert.equal(resolveProjectNavigation(SLUG, { id: `paper:todo:${todo.id}` })?.href, `/p/${SLUG}/paper#${todo.id}`);
    assert.equal(resolveProjectNavigation(SLUG, { id: "mindmap:draft" })?.href, `/p/${SLUG}/mindmap`);
    assert.equal(resolveProjectNavigation(SLUG, { id: "paper:section:unknown" }), null);
  });
});
