#!/usr/bin/env npx tsx
/**
 * Domain invariants for paper TODOs, maps, comments, tables, and search.
 * Imports production functions only. Missing exports are reported as gaps.
 *
 *   pnpm check:domain
 */

import { analyzePaper } from "../lib/research/paper-analysis";
import {
  buildPaperSummary,
  searchProjectContent,
  type ProjectState,
} from "../lib/research/project-state";
import {
  findPrimaryMindmap,
  identityHolds,
  isPrimaryMindmap,
  reconcileTodos,
  todoCounts,
  todosFromPaperState,
} from "../lib/research/todo-map";
import { artifactHref } from "../lib/research/artifact-link";
import { composeObtodo } from "../lib/todo-meta";
import * as tableAst from "../lib/tex-project/table-ast";
import * as tableFragments from "../lib/tex-project/table-fragments";
import { lintBrokenTex } from "../lib/tex-project/tex-lint";
import type { Mindmap, MindmapNode } from "../lib/types";
import type { TexPaper } from "../lib/tex-project/project";

const failures: string[] = [];
const gaps: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failures.push(name);
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function gap(name: string, detail: string) {
  gaps.push(`${name}: ${detail}`);
  check(name, false, detail);
}

function pickFn(mod: object, names: string[]): { name: string; fn: (...args: never[]) => unknown } | undefined {
  const record = mod as Record<string, unknown>;
  for (const name of names) {
    if (typeof record[name] === "function") return { name, fn: record[name] as (...args: never[]) => unknown };
  }
  return undefined;
}

function patchedSource(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "source" in result) return String((result as { source: unknown }).source || "");
  return "";
}

function node(spec: Omit<MindmapNode, "text"> & { text?: string }): MindmapNode {
  return { text: spec.todoId ? "" : (spec.text || spec.id), ...spec };
}

function map(id: string, nodes: MindmapNode[]): Mindmap {
  return {
    projectId: "private-project-a",
    id,
    role: id === "draft" || id === "mindmap" ? "draft" : "planning",
    rootId: "root",
    updatedAt: "2026-09-01T00:00:00.000Z",
    nodes,
  };
}

const paperTodos = todosFromPaperState([
  { id: "cv-transfer-check", text: "Run cv-transfer-check baseline.", completed: false },
  { id: "sampling-sweep", text: "Run the 20n sampling sweep.", completed: true },
  { id: "second-model", text: "Rerun on a second model.", completed: false },
]);

const primaryNodes: MindmapNode[] = [
  node({ id: "root", parentId: null, text: "Private Project A" }),
  node({
    id: "claim-robustness",
    parentId: "root",
    text: "Performance survives transfer behavior",
    refs: [{ kind: "paper-section", id: "robustness", label: "Transfer Results" }],
  }),
  node({ id: "todo-sweep", parentId: "claim-robustness", todoId: "sampling-sweep" }),
  node({ id: "todo-second-model", parentId: "claim-robustness", todoId: "second-model" }),
];

const primary = map("draft", primaryNodes);
const secondary = map("planning", [
  node({ id: "root", parentId: null, text: "Planning" }),
  node({ id: "alt", parentId: "root", text: "Second look" }),
  node({ id: "todo-sweep-copy", parentId: "alt", todoId: "sampling-sweep" }),
  node({ id: "todo-transfer-copy", parentId: "alt", todoId: "cv-transfer-check" }),
]);

function commentSourcePaper() {
  const source = [
    "\\title{Private Project A}",
    "\\section{Transfer Results}",
    "Performance survives transfer behavior.",
    composeObtodo({
      id: "sampling-sweep",
      text: "Run the 20n sampling sweep.",
      createdAt: "2026-08-20T15:00:00.000Z",
      completedAt: "2026-08-31T18:00:00.000Z",
      now: new Date("2026-08-20T15:00:00.000Z"),
    }),
    composeObtodo({
      id: "second-model",
      text: "Rerun on a second model.",
      createdAt: "2026-08-20T15:00:00.000Z",
      now: new Date("2026-08-20T15:00:00.000Z"),
    }),
    composeObtodo({
      id: "cv-transfer-check",
      text: "Run cv-transfer-check baseline.",
      createdAt: "2026-08-20T15:00:00.000Z",
      now: new Date("2026-08-20T15:00:00.000Z"),
    }),
    "\\obcomment[id=c-transfer, kind=result]{transfer queries look stronger.}",
  ].join("\n");
  const paper: TexPaper = {
    projectId: "private-project-a",
    title: "Private Project A",
    source,
    sourceHash: "h",
    sections: [
      {
        id: "robustness",
        title: "Transfer Results",
        level: 2,
        order: 0,
        label: "sec-robustness",
        file: "/tmp/sections/robustness.tex",
        tex: "body",
        hash: "1",
      },
    ],
  };
  return { source, paper, analysis: analyzePaper(source) };
}

function runReconcileAndPrimaryCoverage() {
  const rec = reconcileTodos(primary, paperTodos);
  check("reconcileTodos identity holds on the primary fixture", identityHolds(rec));
  check(
    "Unplaced is TeX ids minus primary bound ids",
    rec.unplaced.map((item) => item.todo.id).join() === "cv-transfer-check"
      && rec.bound.map((item) => item.todo.id).sort().join() === "sampling-sweep,second-model",
    `bound=${rec.boundIds.join(",")} unplaced=${rec.unplaced.map((item) => item.todo.id).join(",")}`,
  );
  const coverage = todoCounts(rec, "claim-robustness", primary);
  check("branch TODO count is 1/2", coverage.complete === 1 && coverage.total === 2);

  check("draft map is primary", isPrimaryMindmap(primary) && findPrimaryMindmap([secondary, primary])?.id === "draft");
  const secondaryRec = reconcileTodos(secondary, paperTodos);
  check(
    "primary coverage ignores secondary bindings",
    rec.unplaced.length === 1 && secondaryRec.unplaced.map((item) => item.todo.id).join() === "second-model",
  );
}

function runTodoIdUniqueness() {
  const duplicate = map("draft", [
    ...primaryNodes,
    node({ id: "dup", parentId: "claim-robustness", todoId: "second-model" }),
  ]);
  const dupRec = reconcileTodos(duplicate, paperTodos);
  check(
    "one todoId per map: duplicate binding is a warning",
    dupRec.warnings.some((warning) => warning.kind === "duplicate-binding" && warning.todoId === "second-model")
      && !identityHolds(dupRec),
  );

  const recA = reconcileTodos(primary, paperTodos);
  const recB = reconcileTodos(secondary, paperTodos);
  check(
    "same todoId on two maps is OK",
    recA.bound.some((item) => item.todo.id === "sampling-sweep")
      && recB.bound.some((item) => item.todo.id === "sampling-sweep")
      && !recA.warnings.some((warning) => warning.kind === "duplicate-binding")
      && !recB.warnings.some((warning) => warning.kind === "duplicate-binding"),
  );
}

function runCommentIdsAndHref() {
  const { source, paper, analysis } = commentSourcePaper();
  const note = analysis.comments.find((item) => item.macro === "obcomment");
  check("analyzePaper keeps \\obcomment[id=…]", note?.id === "c-transfer" || note?.attrs.id === "c-transfer");

  const summary = buildPaperSummary(
    "private-project-a",
    paper,
    analysis,
    { rootFile: "paper.tex", revision: 1, bundleHash: "h" },
    "/tmp",
  );
  const row = summary.comments[0] as { id?: string; href: string; text: string; kind?: string };
  if (!row) {
    gap("comment ids", "buildPaperSummary dropped \\obcomment");
    gap("paper-comment href", "no comment row to href");
    return { summary, source };
  }
  if (row.id === "c-transfer") {
    check("comment ids surface on project state", true);
  } else {
    gap(
      "comment ids",
      "ProjectStateComment has no id (TeX attrs.id=c-transfer is not copied). Need a stable comment id on the summary row.",
    );
  }

  const expectedHref = artifactHref("private-project-a", { kind: "paper-comment", id: "c-transfer" });
  check("artifactHref(paper-comment) is /paper#c-transfer", expectedHref.endsWith("/paper#c-transfer"));
  if (row.href.includes("c-transfer")) {
    check("paper-comment href uses the comment id", true);
  } else {
    gap(
      "paper-comment href",
      `buildPaperSummary href is ${row.href}; artifactHref is ${expectedHref}. Wire comment.href to paper-comment once the summary copies the id.`,
    );
  }
  return { summary, source };
}

function runSearchLabels(summary: NonNullable<ProjectState["paper"]>, source: string) {
  const hits = searchProjectContent({
    slug: "private-project-a",
    query: "transfer behavior",
    paper: summary,
    paperSource: source,
    mindmaps: [primary, secondary],
  });
  const paperHit = hits.find((hit) => hit.kind === "paper" && /transfer/i.test(`${hit.title} ${hit.snippet}`));
  const todoHits = searchProjectContent({
    slug: "private-project-a",
    query: "20n sampling",
    paper: summary,
    paperSource: source,
    mindmaps: [primary],
  });
  const commentHits = searchProjectContent({
    slug: "private-project-a",
    query: "look stronger",
    paper: summary,
    paperSource: source,
    mindmaps: [primary],
  });
  const todoHit = todoHits.find((hit) => hit.kind === "todo");
  const commentHit = commentHits.find((hit) => hit.kind === "comment");

  check("search labels: section hits keep the heading title", Boolean(paperHit?.title) && paperHit!.href.startsWith("/p/private-project-a/"));
  check(
    "search labels: TODO hits use the todo id and text",
    todoHit?.id === "paper:todo:sampling-sweep" && Boolean(todoHit.title) && /sampling/i.test(todoHit.snippet),
    todoHit ? `${todoHit.id} title=${todoHit.title}` : "no todo hit",
  );
  if (!commentHit) {
    gap("search labels: comment hit", "search_project did not return a comment hit for the comment body");
    return;
  }
  check(
    "search labels: comment hit has a title",
    Boolean(commentHit.title) && Boolean(commentHit.href),
    `${commentHit.id} title=${commentHit.title}`,
  );
}

function runTableCellPatch() {
  const patch = pickFn(tableAst, [
    "patchTableCell",
    "replaceTableCell",
    "patchTabularCell",
    "replaceTabularCell",
    "setTableCell",
    "setTabularCell",
  ]) || pickFn(tableFragments, [
    "patchTableCell",
    "replaceTableCell",
    "patchTabularCell",
    "replaceTabularCell",
  ]);
  if (!patch) {
    gap(
      "table cell patch",
      "No exported patchTableCell / replaceTabularCell / setTableCell on lib/tex-project/table-ast.ts or table-fragments.ts. tabularCellsFromTex is parse-only.",
    );
    return;
  }
  const source = [
    "\\begin{tabular}{ll}",
    "\\hline",
    "\\textbf{keep} & $x_{1}$ \\\\",
    "a & b \\\\",
    "\\hline",
    "\\end{tabular}",
  ].join("\n");
  try {
    const next = patch.fn(source as never, 0 as never, 1 as never, "patched" as never);
    const text = patchedSource(next);
    const failed = next && typeof next === "object" && "ok" in next && (next as { ok?: boolean }).ok === false;
    check(
      `table cell patch via ${patch.name} does not flatten neighbor cells`,
      !failed && text.includes("\\textbf{keep}") && text.includes("patched") && text.includes("\\hline") && !text.includes("| keep |"),
      text.slice(0, 180),
    );
  } catch (error) {
    gap(`table cell patch (${patch.name})`, error instanceof Error ? error.message : String(error));
  }
}

function runBrokenTexLint() {
  const smashed = [
    "\\newcommand{\\metricdifferent}{\\textsc{",
    "\\newcommand{\\remotebg}{gray!10}",
    "\\maketitleDifferent",
  ].join("\n");
  const codes = new Set(lintBrokenTex(smashed).map((item) => item.code));
  check("lintBrokenTex flags unclosed \\textsc and glued \\maketitle", codes.has("unclosed-group") && codes.has("glued-maketitle"));
  check("lintBrokenTex is quiet on balanced preamble", lintBrokenTex("\\newcommand{\\metricdifferent}{\\textsc{Different}}\n\\maketitle\n").length === 0);
}

function main() {
  runReconcileAndPrimaryCoverage();
  runTodoIdUniqueness();
  const comments = runCommentIdsAndHref();
  if (comments) runSearchLabels(comments.summary, comments.source);
  runTableCellPatch();
  runBrokenTexLint();

  if (gaps.length) {
    console.error("\nGaps (import a pure function or surface the field; this script will not reimplement app features):");
    for (const item of gaps) console.error(`- ${item}`);
  }
  if (failures.length) {
    console.error(`\n${failures.length} domain check(s) failed.`);
    process.exit(1);
  }
  console.log("\nDomain checks passed.");
}

void main();
