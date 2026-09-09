import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveSections, stripSectionComments } from "../lib/tex-project/section-ranges";
import { replaceBundlePart, splitBundleSource } from "../lib/tex-project/source-bundle-format";
import { persistSourceBundle } from "../lib/tex-project/source-persist";
import { buildSourceBundle } from "../lib/tex-project/source-bundle";
import { buildSourceContextIndex } from "../lib/research/source-context";
import { previewTodoAtSection, relocateTodoInBundle } from "../lib/research/paper-todo-placement";
import { readTexPaper, patchPaperSection, patchPaperSections, setPaperSectionHeading, renamePaperSection, addPaperSection, removePaperSection, texPaths } from "../lib/tex-project/project";
import { parseEditorSections } from "../features/paper/tex-source";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbar-derived-sections-"));
try {
  const manuscript = path.join(root, "manuscript");
  fs.mkdirSync(manuscript, { recursive: true });
  const file = path.join(manuscript, "paper.tex");
  const initial = String.raw`\documentclass{article}
\title{Fixture}
\begin{document}
% OB-SECTION {"id":"old","title":"stale"}
\section[Short]{First \textbf{heading}}
\label{sec:first}
% OB-EDIT-BEGIN openbarry/markdown@1 id=old
Alpha
\obtodo[id=todo-a]{A}
% OB-EDIT-END id=old
\subsection{Repeated}
Beta
\section*{Repeated}
Gamma
\end{document}
`;
  fs.writeFileSync(file, initial);
  const before = readTexPaper(root, "fixture", "Fixture")!;
  fs.writeFileSync(file, stripSectionComments(initial));
  const paper = readTexPaper(root, "fixture", "Fixture")!;
  assert.deepEqual(paper.sections.map(s => [s.id, s.title, s.tex.trim()]), before.sections.map(s => [s.id, s.title, s.tex.trim()]));
  assert.equal(paper.sections.length, 3);
  const middle = paper.sections[1]!;
  patchPaperSection(root, middle.id, middle.hash, "Replaced middle.\n");
  let saved = fs.readFileSync(file, "utf8");
  assert.match(saved, /Alpha/);
  assert.match(saved, /Gamma/);
  assert.match(saved, /Replaced middle/);
  assert.match(saved, /\\end\{document\}/);
  assert.match(saved, /\\label\{sec:first\}/);
  assert.throws(() => patchPaperSection(root, middle.id, middle.hash, "stale"), /changed outside/);
  renamePaperSection(root, "Fixture", paper.sections[2]!.id, "Renamed");
  saved = fs.readFileSync(file, "utf8");
  assert.match(saved, /\\section\*\{Renamed\}/);
  let bundle = buildSourceBundle(manuscript);
  let context = buildSourceContextIndex(manuscript, undefined, bundle);
  assert.equal(context.sections.length, 3);
  assert(context.sections.every(s => s.editable));
  assert.equal(context.todos[0]!.sectionTitle, "First heading");
  const live = parseEditorSections(bundle.source, []);
  assert.deepEqual(live.sections.map(s => s.id), context.sections.map(s => s.id));
  const inserted = previewTodoAtSection(bundle.source, context.sections[1]!.id, "Insert here", undefined, "todo-b");
  assert(inserted.sectionFound, inserted.error);
  assert(inserted.source.indexOf("todo-b") < inserted.source.indexOf("\\section*{Renamed}"));
  const moved = relocateTodoInBundle(inserted.source, "todo-a", context.sections[2]!.id);
  assert(moved.targetFound, moved.error);
  assert(moved.source.indexOf("todo-a") > moved.source.indexOf("\\section*{Renamed}"));
  assert(moved.source.indexOf("todo-a") < moved.source.indexOf("\\end{document}"));
  const added = addPaperSection(root, "Fixture", { title: "Added", afterId: paper.sections[1]!.id });
  assert.equal(added.sections.length, 4);
  removePaperSection(root, "Fixture", added.sections.find(s => s.title === "Added")!.id);
  assert.equal(readTexPaper(root, "fixture", "Fixture")!.sections.length, 3);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /OB-SECTION|OB-EDIT/);
  assert.deepEqual(fs.readdirSync(manuscript, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name), ["paper.tex"]);
  let current = readTexPaper(root, "fixture", "Fixture")!;
  setPaperSectionHeading(root, "Fixture", current.sections[2]!.id, { appendix: true });
  assert.equal(readTexPaper(root, "fixture", "Fixture")!.sections[2]!.appendix, true);
  setPaperSectionHeading(root, "Fixture", current.sections[2]!.id, { appendix: false });
  assert.equal(Boolean(readTexPaper(root, "fixture", "Fixture")!.sections[2]!.appendix), false);
  current = readTexPaper(root, "fixture", "Fixture")!;
  patchPaperSections(root, [
    { id: current.sections[0]!.id, baseHash: current.sections[0]!.hash, tex: "Alpha updated\n\subsection{Inserted heading}\nExtra\n" },
    { id: current.sections[2]!.id, baseHash: current.sections[2]!.hash, tex: "Correct final target\n" },
  ]);
  assert.equal(readTexPaper(root, "fixture", "Fixture")!.sections.at(-1)!.tex.trim(), "Correct final target");
  fs.writeFileSync(file, String.raw`\documentclass{article}
\title{Includes}
\begin{document}
\section{Parent}
\input{child}
\section{Tail}
\end{document}
`);
  fs.writeFileSync(path.join(manuscript, "child.tex"), String.raw`\obtodo[id=inherited]{Inherited}
\subsection{Nested}
\input{grandchild}
`);
  fs.writeFileSync(path.join(manuscript, "grandchild.tex"), String.raw`\obtodo[id=nested]{Nested}`);
  context = buildSourceContextIndex(manuscript);
  assert.deepEqual(context.sections.map(s => s.title), ["Parent", "Nested", "Tail"]);
  assert.equal(context.todos.find(t => t.id === "inherited")!.sectionTitle, "Parent");
  assert.deepEqual(context.todos.find(t => t.id === "nested")!.headingPath, ["Parent", "Nested"]);
  assert.deepEqual(readTexPaper(root, "fixture", "Fixture")!.sections.map(s => s.title), ["Parent", "Nested", "Tail"]);
  // Model trimming leading, internal, and final blank lines in each visible file.
  for (const name of ["paper.tex", "child.tex", "grandchild.tex"]) {
    const target = path.join(manuscript, name);
    fs.writeFileSync(target, "\n\n" + fs.readFileSync(target, "utf8").replace(/\n/g, "\n\n") + "\n\n");
  }
  bundle = buildSourceBundle(manuscript);
  const beforeTrim = buildSourceContextIndex(manuscript);
  let trimmed = bundle.source;
  for (const part of splitBundleSource(bundle.source)) {
    const body = part.body.split("\n").filter(line => line.trim().length > 0).join("\n");
    trimmed = replaceBundlePart(trimmed, part.filePath, body);
  }
  assert.equal(splitBundleSource(trimmed).length, bundle.segments.length);
  const savedTrim = persistSourceBundle({ manuscriptDir: manuscript, nextSource: trimmed, expectedBundleHash: bundle.bundleHash });
  assert(savedTrim.ok, JSON.stringify(savedTrim));
  const afterTrim = buildSourceContextIndex(manuscript);
  assert.deepEqual(afterTrim.sections.map(s => [s.id, s.title]), beforeTrim.sections.map(s => [s.id, s.title]));
  assert.deepEqual(afterTrim.todos.map(t => [t.id, t.sectionId]), beforeTrim.todos.map(t => [t.id, t.sectionId]));
  assert.equal(fs.readFileSync(path.join(manuscript, "child.tex"), "utf8").includes("\n\n"), false);
  assert.equal(splitBundleSource(replaceBundlePart(trimmed, "child.tex", "")).length, bundle.segments.length);
  console.log("Blank-line trimming passed: file starts, internal blank lines, file endings, empty files, save/reload, section IDs, and TODO ownership.");
  const duplicates = deriveSections(String.raw`\section{Same}
A
\section{Same}
B`, "a/b.tex");
  assert.notEqual(duplicates[0]!.id, duplicates[1]!.id);
  assert.notEqual(duplicates[0]!.id, deriveSections("\\section{Same}", "a-b.tex")[0]!.id);
  const malformed = deriveSections("% \\section{Comment}\n\\section{Real}\n\\textbf{unfinished", "x.tex");
  assert.deepEqual(malformed.map(s => s.title), ["Real"]);
  console.log("Derived-section checks passed: metadata removal, duplicate titles, nested headings, live/saved IDs, rename, body edits, stale writes, TODO insertion/relocation, document ending, add/remove, zero added files.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
