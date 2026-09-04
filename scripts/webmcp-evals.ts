#!/usr/bin/env npx tsx
/**
 * WebMCP contract evals: expected tools, arguments, and resulting state.
 *
 *   pnpm evals
 */

import { searchProjectContent, type ProjectState } from "../lib/research/project-state";
import { identityHolds, reconcileTodos, todoCounts, todosFromPaperState } from "../lib/research/todo-map";
import { analyzePaper } from "../lib/research/paper-analysis";
import { insertTodoAtSection } from "../lib/research/paper-todo-persist";
import { applyMindmapAction } from "../features/mindmap/mindmap-state";
import { ARTIFACT_KINDS } from "../lib/research/artifact-link";
import { composeObtodo } from "../lib/todo-meta";
import { createMindmapWebMcpHarness, executeMindmapWebMcpTool } from "../lib/research/webmcp-mindmap-contract";
import { createPaperWebMcpHarness, executePaperWebMcpTool } from "../lib/research/webmcp-paper-contract";
import { executePaperSourceTool } from "../lib/research/webmcp-source-contract";
import { okResult } from "../lib/research/operation-result";
import { serializeSectionMeta } from "../lib/tex-project/codec";
import { fileBanner } from "../lib/tex-project/source-bundle-format";
import * as tableAst from "../lib/tex-project/table-ast";
import * as tableFragments from "../lib/tex-project/table-fragments";
import type { Mindmap, MindmapNode } from "../lib/types";

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

function skip(name: string, reason: string) {
  console.log(`skip  ${name} — ${reason}`);
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

function asMindmap(host: ReturnType<typeof createMindmapWebMcpHarness>, id = host.snapshot.mapId): Mindmap {
  return {
    projectId: host.snapshot.project,
    id,
    rootId: host.snapshot.rootId,
    updatedAt: "2026-09-01T00:00:00.000Z",
    nodes: host.snapshot.nodes.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      text: item.text,
      todoId: item.todoId,
      refs: item.refs,
    })),
  };
}

function paperTodosFromSource(source: string) {
  return analyzePaper(source).todos;
}

function todoIdFromInsert(inserted: string): string {
  return /id=([A-Za-z0-9._-]+)/.exec(inserted)?.[1] || "";
}

const CREATED = "2026-08-20T15:00:00.000Z";
const SWEEP_DONE = "2026-08-31T18:00:00.000Z";
const SCALING_DONE = "2026-08-28T16:30:00.000Z";

function todo(id: string, text: string, completedAt?: string): string {
  return composeObtodo({
    id,
    text,
    createdAt: CREATED,
    updatedAt: completedAt || CREATED,
    completedAt,
    now: new Date(CREATED),
  });
}

const SECTION_TEX = {
  introduction: `${serializeSectionMeta({ id: "introduction", title: "Introduction", level: 2, order: 0, label: "sec-introduction" })}Learned retrievers report large gains.\n${todo("cv-transfer-check", "Run cv-transfer-check baseline.")}`,
  robustness: `${serializeSectionMeta({ id: "robustness", title: "Transfer Results", level: 2, order: 1, label: "sec-robustness" })}The robustness claim is that performance survives transfer behavior.\n${todo("sampling-sweep", "Run the 20n sampling sweep.", SWEEP_DONE)}\n${todo("second-model", "Rerun on a second model.")}`,
  results: `${serializeSectionMeta({ id: "results", title: "Main Results", level: 2, order: 2, label: "sec-results" })}Sample efficiency.\n${todo("scaling", "Run the scaling experiment.", SCALING_DONE)}\n${todo("ablation", "Ablate without retrieval.")}`,
};

function makePaper() {
  const host = createPaperWebMcpHarness({
    project: "command-v",
    title: "Command-V",
    sections: [
      { id: "introduction", title: "Introduction", tex: SECTION_TEX.introduction },
      { id: "robustness", title: "Transfer Results", tex: SECTION_TEX.robustness },
      { id: "results", title: "Main Results", tex: SECTION_TEX.results },
    ],
  });
  host.snapshot.source = host.snapshot.sections
    .map((section) => `${fileBanner(`sections/${section.id}.tex`)}${section.tex}\n`)
    .join("");
  return host;
}

const sharedNodes: Array<Pick<MindmapNode, "id" | "parentId" | "text" | "todoId" | "refs"> & { completed?: boolean }> = [
  { id: "root", parentId: null, text: "Command-V" },
  {
    id: "claim-robustness",
    parentId: "root",
    text: "Performance survives transfer behavior",
    refs: [{ kind: "paper-section" as const, id: "robustness", label: "Transfer Results" }],
  },
  { id: "todo-sweep", parentId: "claim-robustness", text: "", todoId: "sampling-sweep", completed: true },
  { id: "todo-second-model", parentId: "claim-robustness", text: "", todoId: "second-model", completed: false },
];

function makePrimary() {
  return createMindmapWebMcpHarness({ project: "command-v", nodes: sharedNodes });
}

function makeSecondary() {
  const host = createMindmapWebMcpHarness({
    project: "command-v",
    nodes: [
      { id: "root", parentId: null, text: "Planning" },
      { id: "alt", parentId: "root", text: "Second look" },
      { id: "todo-sweep-copy", parentId: "alt", text: "", todoId: "sampling-sweep", completed: true },
      { id: "idea", parentId: "alt", text: "Try a third model\nNeed a different architecture." },
    ],
  });
  host.snapshot.mapId = "planning";
  host.snapshot.title = "Planning";
  return host;
}

function wireConvert(map: ReturnType<typeof createMindmapWebMcpHarness>, paper: ReturnType<typeof createPaperWebMcpHarness>) {
  map.convertCardToTodo = async (id, sectionId) => {
    const card = map.snapshot.nodes.find((item) => item.id === id);
    if (!card) throw new Error("Unknown card.");
    const inserted = insertTodoAtSection(paper.snapshot.source, sectionId, card.text);
    paper.snapshot.source = inserted.source;
    paper.snapshot.revision += 1;
    card.todoId = inserted.id;
    card.text = "";
    map.snapshot.revision += 1;
    return okResult({
      todoId: inserted.id,
      mindmap: asMindmap(map, "planning"),
      local: { paper: "saved" as const, map: "saved" as const },
      remote: {
        status: "unconfigured" as const,
        message: "Harness remote sync is not configured.",
        retryable: false,
      },
    }, { revision: map.snapshot.revision });
  };
}

function wireSharedComplete(paper: ReturnType<typeof createPaperWebMcpHarness>, maps: Array<ReturnType<typeof createMindmapWebMcpHarness>>) {
  const complete = async (todoId: string) => {
    const result = await executePaperSourceTool(paper, "complete_todo", {
      id: todoId,
      expectedRevision: paper.snapshot.revision,
    });
    if (!result.ok) throw new Error(result.message);
    for (const map of maps) {
      for (const node of map.snapshot.nodes) {
        if (node.todoId === todoId) node.completed = true;
      }
    }
  };
  for (const map of maps) map.completeTodo = complete;
}

async function journeys() {
  const paper = makePaper();
  const map = makePrimary();
  const fixtureMap = asMindmap(map);
  const fixtureTodos = todosFromPaperState([
    { id: "cv-transfer-check", text: "Run cv-transfer-check baseline.", completed: false },
    { id: "sampling-sweep", text: "Run the 20n sampling sweep.", completed: true },
    { id: "second-model", text: "Rerun on a second model.", completed: false },
  ]);
  const rec = reconcileTodos(fixtureMap, fixtureTodos);
  const paperState = {
    outline: [
      { id: "introduction", title: "Introduction", level: 2, openTodos: 1 },
      { id: "robustness", title: "Transfer Results", level: 2, openTodos: 1 },
    ],
    todos: [
      {
        id: "cv-transfer-check",
        text: "Run cv-transfer-check baseline.",
        unplaced: true,
        primaryUnplaced: true,
        completed: false,
        href: "/p/command-v/paper#cv-transfer-check",
      },
    ],
    comments: [],
    rootFile: "paper.tex",
    revision: 1,
    title: "Command-V",
  } satisfies NonNullable<ProjectState["paper"]>;

  const searchHits = searchProjectContent({
    slug: "command-v",
    query: "transfer behavior",
    paper: paperState,
    paperSource: paper.snapshot.source,
    mindmaps: [fixtureMap],
  });
  check(
    "Where do we discuss transfer behavior? → search_project",
    searchHits.some((hit) => hit.kind === "paper" && /transfer/i.test(`${hit.title} ${hit.snippet}`)),
    JSON.stringify(searchHits.map((hit) => hit.href)),
  );
  check(
    "search hits include a navigable href",
    searchHits.some((hit) => hit.href.startsWith("/p/command-v/")),
  );

  const coverage = todoCounts(rec, "claim-robustness", fixtureMap);
  check("What remains for robustness? → get_mindmap coverage 1/2", coverage.complete === 1 && coverage.total === 2);

  const add = await executePaperSourceTool(paper, "add_todo", {
    from: paper.snapshot.source.length,
    to: paper.snapshot.source.length,
    text: "Add an experiment to test robustness.",
    expectedRevision: paper.snapshot.revision,
  });
  check("Add an experiment → add_todo", add.ok);
  const placed = await executeMindmapWebMcpTool(map, "place_todo_card", {
    todoId: "cv-transfer-check",
    parentId: "claim-robustness",
    expectedRevision: map.snapshot.revision,
  });
  check("then place_todo_card under robustness", placed.ok && map.snapshot.nodes.some((item) => item.todoId === "cv-transfer-check" && item.parentId === "claim-robustness"));

  const completed = await executePaperSourceTool(paper, "complete_todo", {
    id: "cv-transfer-check",
    expectedRevision: paper.snapshot.revision,
  });
  check("Mark the transfer check complete. → complete_todo", completed.ok);

  const read = await executePaperWebMcpTool(paper, "read_paper_section", { sectionId: "robustness" });
  check("read_paper_section before replace", read.ok);
  const replaced = await executePaperWebMcpTool(paper, "replace_paper_section", {
    sectionId: "robustness",
    expectedRevision: paper.snapshot.revision,
    tex: "transfer-query evaluation confirms the robustness claim on the first model.",
  });
  check("Update the result paragraph → replace_paper_section", replaced.ok);
  const compiled = await executePaperWebMcpTool(paper, "compile_paper", {});
  check("then compile_paper", compiled.ok);
}

async function sharedCompleteAcrossMaps() {
  const paper = makePaper();
  const primary = makePrimary();
  const secondary = makeSecondary();
  wireSharedComplete(paper, [primary, secondary]);
  const done = await executeMindmapWebMcpTool(primary, "complete_todo", { todoId: "second-model" });
  check("shared TODO complete: complete_todo on primary", done.ok);
  const todos = paperTodosFromSource(paper.snapshot.source);
  const recPrimary = reconcileTodos(asMindmap(primary, "draft"), todos);
  const recSecondary = reconcileTodos(asMindmap(secondary, "planning"), todos);
  const primaryCard = recPrimary.bound.find((item) => item.todo.id === "second-model");
  const secondaryCard = recSecondary.bound.find((item) => item.todo.id === "sampling-sweep");
  check(
    "shared TODO complete across maps",
    Boolean(primaryCard?.completed)
      && primary.snapshot.nodes.some((item) => item.todoId === "second-model" && item.completed)
      && secondary.snapshot.nodes.some((item) => item.todoId === "sampling-sweep")
      && todos.some((todo) => todo.id === "second-model" && Boolean(todo.completedAt || todo.attrs.completed)),
    `primary=${Boolean(primaryCard?.completed)} tex=${todos.find((todo) => todo.id === "second-model")?.attrs.completed || "open"}`,
  );
  check("completing does not drop the secondary binding", Boolean(secondaryCard));
}

async function secondaryMoveAndDelete() {
  const primary = makePrimary();
  const secondary = makeSecondary();
  const primaryBefore = JSON.stringify(primary.snapshot.nodes);
  const moved = await executeMindmapWebMcpTool(secondary, "move_mindmap_node", {
    id: "todo-sweep-copy",
    parentId: "root",
    expectedRevision: secondary.snapshot.revision,
  });
  check("secondary move: move_mindmap_node", moved.ok && secondary.snapshot.nodes.find((item) => item.id === "todo-sweep-copy")?.parentId === "root");
  check("secondary move leaves primary unchanged", JSON.stringify(primary.snapshot.nodes) === primaryBefore);

  const deleted = await executeMindmapWebMcpTool(secondary, "delete_mindmap_node", {
    id: "todo-sweep-copy",
    expectedRevision: secondary.snapshot.revision,
  });
  check("secondary delete: delete_mindmap_node", deleted.ok && !secondary.snapshot.nodes.some((item) => item.id === "todo-sweep-copy"));
  check(
    "secondary delete does not unplace primary",
    primary.snapshot.nodes.some((item) => item.todoId === "sampling-sweep"),
  );
}

async function primaryUnplace() {
  const paper = makePaper();
  const primary = makePrimary();
  const before = paperTodosFromSource(paper.snapshot.source);
  const unbound = applyMindmapAction(asMindmap(primary, "draft"), { type: "unbind-todo", id: "todo-second-model", text: "Rerun on a second model." });
  const rec = reconcileTodos(unbound.mindmap, before);
  check(
    "primary unplace: unbind-todo leaves TeX and Unplaced",
    rec.unplaced.some((item) => item.todo.id === "second-model")
      && !unbound.mindmap.nodes.some((item) => item.todoId === "second-model")
      && before.some((todo) => todo.id === "second-model")
      && identityHolds(rec),
  );

  const primaryDelete = makePrimary();
  const removed = await executeMindmapWebMcpTool(primaryDelete, "delete_mindmap_node", {
    id: "todo-second-model",
    expectedRevision: primaryDelete.snapshot.revision,
  });
  const afterDelete = reconcileTodos(asMindmap(primaryDelete, "draft"), paperTodosFromSource(paper.snapshot.source));
  check(
    "primary unplace: delete_mindmap_node without TeX delete",
    removed.ok && afterDelete.unplaced.some((item) => item.todo.id === "second-model"),
  );
}

async function makeTodoPrimaryUnplaced() {
  const paper = makePaper();
  const primary = makePrimary();
  const secondary = makeSecondary();
  const added = await executePaperSourceTool(paper, "add_todo", {
    from: paper.snapshot.source.length,
    to: paper.snapshot.source.length,
    text: "Make a new experiment.",
    expectedRevision: paper.snapshot.revision,
  });
  const inserted = added.ok && added.value && typeof added.value === "object" && "inserted" in added.value
    ? String((added.value as { inserted?: unknown }).inserted || "")
    : "";
  const newId = todoIdFromInsert(inserted);
  const recAfterAdd = reconcileTodos(asMindmap(primary, "draft"), paperTodosFromSource(paper.snapshot.source));
  check(
    "Make TODO → Primary Unplaced (add_todo)",
    added.ok && Boolean(newId) && recAfterAdd.unplaced.some((item) => item.todo.id === newId),
    newId || (added.ok ? "missing id" : "add_todo failed"),
  );

  wireConvert(secondary, paper);
  const converted = await executeMindmapWebMcpTool(secondary, "convert_card_to_todo", {
    id: "idea",
    sectionId: "introduction",
    expectedRevision: secondary.snapshot.revision,
  });
  const convertedId = converted.ok && converted.value && typeof converted.value === "object" && "todoId" in converted.value
    ? String((converted.value as { todoId?: unknown }).todoId || "")
    : "";
  const recPrimary = reconcileTodos(asMindmap(primary, "draft"), paperTodosFromSource(paper.snapshot.source));
  const secondaryBound = secondary.snapshot.nodes.some((item) => item.id === "idea" && item.todoId === convertedId);
  const primaryUnplaced = recPrimary.unplaced.some((item) => item.todo.id === convertedId);
  const sourceHasBody = paper.snapshot.source.includes("Need a different architecture");
  check(
    "Make TODO on secondary → Primary Unplaced",
    converted.ok
      && Boolean(convertedId)
      && secondaryBound
      && primaryUnplaced
      && sourceHasBody,
    converted.ok
      ? `todoId=${convertedId} secondaryBound=${secondaryBound} primaryUnplaced=${primaryUnplaced} sourceHasBody=${sourceHasBody} texIds=${recPrimary.texIds.join(",")}`
      : "convert_card_to_todo failed",
  );
}

function tableSource() {
  return [
    "\\begin{tabular}{ll}",
    "\\hline",
    "\\textbf{keep} & $x_{1}$ \\\\",
    "a & b \\\\",
    "\\hline",
    "\\end{tabular}",
  ].join("\n");
}

function antiFlattenOneCell() {
  const patch = pickFn(tableAst, [
    "patchTableCell",
    "replaceTableCell",
    "patchTabularCell",
    "replaceTabularCell",
    "setTableCell",
    "setTabularCell",
  ]) || pickFn(tableFragments, ["patchTableCell", "replaceTableCell", "patchTabularCell"]);
  if (!patch) {
    gap(
      "anti-flatten one cell",
      "No table cell patch export. Add patchTableCell (or replaceTabularCell) and keep \\textbf / math / rules in other cells.",
    );
    return;
  }
  try {
    const next = patch.fn(tableSource() as never, 0 as never, 1 as never, "patched" as never);
    const text = patchedSource(next);
    const failed = next && typeof next === "object" && "ok" in next && (next as { ok?: boolean }).ok === false;
    check(
      `anti-flatten one cell via ${patch.name}`,
      !failed && text.includes("\\textbf{keep}") && text.includes("patched") && text.includes("\\hline") && !text.includes("| keep |"),
      text.slice(0, 200),
    );
  } catch (error) {
    gap(`anti-flatten one cell (${patch.name})`, error instanceof Error ? error.message : String(error));
  }
}

function addRow() {
  const add = pickFn(tableAst, ["addTableRow", "insertTableRow", "addTabularRow", "insertTabularRow", "appendTableRow"])
    || pickFn(tableFragments, ["addTableRow", "insertTableRow", "addTabularRow"]);
  if (!add) {
    gap("add row", "No addTableRow / insertTabularRow export on table-ast or table-fragments.");
    return;
  }
  const before = tableAst.tabularCellsFromTex(
    tableSource().replace(/^\\begin\{tabular\}\{ll\}\n/, "").replace(/\n\\end\{tabular\}$/, ""),
  );
  try {
    const next = add.fn(tableSource() as never, ["c", "d"] as never);
    const text = patchedSource(next) || (typeof next === "string" ? next : JSON.stringify(next));
    const after = tableAst.tabularCellsFromTex(
      text.replace(/^\\begin\{tabular\}\{[^}]+\}\n/, "").replace(/\n\\end\{tabular\}$/, ""),
    );
    check(
      `add row via ${add.name}`,
      after.length === before.length + 1 && text.includes("\\textbf{keep}"),
      `rows ${before.length} → ${after.length}`,
    );
  } catch (error) {
    gap(`add row (${add.name})`, error instanceof Error ? error.message : String(error));
  }
}

async function commentRefIfReady() {
  const ready = ARTIFACT_KINDS.includes("paper-comment" as (typeof ARTIFACT_KINDS)[number]);
  if (!ready) {
    skip("comment ref", "paper-comment is not an ArtifactKind yet");
    return;
  }
  const map = makePrimary();
  const linked = await executeMindmapWebMcpTool(map, "patch_mindmap_node", {
    id: "claim-robustness",
    refs: [{ kind: "paper-comment", id: "c-transfer", label: "transfer queries look stronger." }],
    expectedRevision: map.snapshot.revision,
  });
  check(
    "comment ref: patch_mindmap_node paper-comment",
    linked.ok && (map.snapshot.nodes.find((item) => item.id === "claim-robustness")?.refs || [])
      .some((ref) => ref.kind === "paper-comment" && ref.id === "c-transfer"),
  );
}

async function main() {
  await journeys();
  await sharedCompleteAcrossMaps();
  await secondaryMoveAndDelete();
  await primaryUnplace();
  await makeTodoPrimaryUnplaced();
  antiFlattenOneCell();
  addRow();
  await commentRefIfReady();

  if (gaps.length) {
    console.error("\nGaps (import a pure function; evals will not reimplement app features):");
    for (const item of gaps) console.error(`- ${item}`);
  }
  if (failures.length) {
    console.error(`\n${failures.length} eval(s) failed.`);
    process.exit(1);
  }
  console.log("\nWebMCP evals passed.");
}

void main();
