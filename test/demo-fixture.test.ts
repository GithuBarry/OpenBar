import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { analyzePaper } from "../lib/research/paper-analysis";
import { DEMO_PROJECT_SLUGS, resetDemoFixture, seedDemoFixture } from "../lib/research/demo-fixture";
import { identityHolds, reconcileTodos } from "../lib/research/todo-map";
import {
  DRAFT_MINDMAP_ID,
  readMindmapRecord,
  readTexPaper,
} from "../lib/tex-project/project";

test("published paper fixtures preserve real paper and Primary map state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbar-demo-"));
  const seeded = seedDemoFixture(root);
  assert.deepEqual(seeded.slugs, [...DEMO_PROJECT_SLUGS]);
  assert.deepEqual(seeded.created, [...DEMO_PROJECT_SLUGS]);

  for (const slug of DEMO_PROJECT_SLUGS) {
    const projectDir = path.join(root, "projects", slug);
    const paper = readTexPaper(projectDir, slug, slug);
    assert.ok(paper);
    if (!paper) continue;
    const analysis = analyzePaper(paper.source);
    const primary = readMindmapRecord(projectDir, DRAFT_MINDMAP_ID);
    assert.ok(primary);
    if (!primary) continue;

    const reconciliation = reconcileTodos(primary, analysis.todos);
    assert.equal(identityHolds(reconciliation), true);
    const primaryIds = new Set(primary.nodes.flatMap((node) => node.todoId ? [node.todoId] : []));
    assert.ok(analysis.todos.length > 0);
    assert.ok(analysis.todos.every((todo) => Boolean(todo.id && primaryIds.has(todo.id))));
    assert.ok(analysis.comments.some((comment) => comment.attrs.kind === "result"));
    assert.match(paper.source, /\\obtodo\[/);
  }
});

test("reset atomically restores both published paper projects", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbar-demo-reset-"));
  seedDemoFixture(root);
  const originals = new Map<string, string>();
  for (const slug of DEMO_PROJECT_SLUGS) {
    const projectFile = path.join(root, "projects", slug, "manuscript", "openbarry", "project.tex");
    originals.set(slug, fs.readFileSync(projectFile, "utf8"));
    fs.writeFileSync(projectFile, "broken");
  }
  assert.deepEqual(resetDemoFixture(root), { slugs: [...DEMO_PROJECT_SLUGS], reset: true });
  for (const slug of DEMO_PROJECT_SLUGS) {
    const projectFile = path.join(root, "projects", slug, "manuscript", "openbarry", "project.tex");
    assert.equal(fs.readFileSync(projectFile, "utf8"), originals.get(slug) || "");
  }
});
