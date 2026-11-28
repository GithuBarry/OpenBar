import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { texPaths } from "@/lib/tex-project/project";
import { maskTexLiterals } from "@/lib/tex-project/tex-literals";
import { applySourceOperation } from "./operation-service";
import { insertMarkdownAnchor, MARKDOWN_MANUSCRIPT_PATH, type MarkdownAnchor } from "@/lib/markdown-manuscript";
import { readProjectFiles } from "./project-files";
import type { ProjectFilesEditInput } from "./project-files-contract";
import { analyzePaper } from "./paper-analysis";
import { serializeAnchorAttrs } from "@/lib/marker-codec";
import { escapeTexText } from "@/lib/tex-project/tex-encode";
import { todoIsComplete } from "@/lib/todo-meta";

export type ManuscriptFile = { path: string; source: string; hash: string | null };
export type ManuscriptNote = { id: string; kind: MarkdownAnchor["kind"]; text: string; completed?: boolean; post?: string };
export function readManuscriptFile(root: string, file: string): ManuscriptFile {
  const r = readProjectFiles(root, { paths: [file], maxBytes: 2_000_000 });
  if (!r.ok) throw new Error(r.message);
  const e = r.value.entries[0];
  if (e?.kind !== "file" || e.path !== file || !e.hash || typeof e.content !== "string" || e.truncated || e.encoding !== "utf8")
    throw new Error("Choose a complete UTF-8 file under 2 MB inside this project.");
  return { path: file, source: e.content, hash: e.hash };
}

const notesName = "openbar-blog-notes.tex";
function paperFiles(root: string) {
  const paths = texPaths(root);
  const notesPath = path.relative(root, path.join(paths.manuscriptDir, notesName)).split(path.sep).join("/");
  return { texPath: path.relative(root, paths.paperFile).split(path.sep).join("/"), notesPath };
}

export function readMarkdownNotes(root: string): ManuscriptNote[] {
  const { notesPath } = paperFiles(root);
  if (!existsSync(path.join(root, notesPath))) return [];
  const analysis = analyzePaper(readManuscriptFile(root, notesPath).source);
  return [...analysis.todos.flatMap(t => t.id ? [{ kind: "todo" as const, id: t.id, text: t.text, completed: todoIsComplete(t.attrs), post: t.attrs.post }] : []),
    ...analysis.comments.flatMap(c => c.id ? [{ kind: "comment" as const, id: c.id, text: c.text, post: c.attrs.post }] : [])];
}

export function prepareNoteChange(root: string, id: string, expectedText: string, expectedCompleted: boolean | undefined, text: string, completed?: boolean) {
  const { notesPath } = paperFiles(root);
  const file = readManuscriptFile(root, notesPath);
  const { todos, comments } = analyzePaper(file.source);
  const todo = todos.find(t => t.id === id), comment = comments.find(c => c.id === id);
  const note = todo ?? comment;
  if (!note || note.text !== expectedText || (todo && todoIsComplete(todo.attrs) !== expectedCompleted))
    throw new Error("The annotation changed. Refresh before editing it.");
  if (!text.trim() || text.length > 4000) throw new Error("Enter a note of up to 4,000 characters.");
  const changed = todo ? applySourceOperation(file.source, { type: "update_todo", id, ...(text !== expectedText ? { text } : {}), completed }) : undefined;
  if (changed && !changed.ok) throw new Error(changed.message);
  const content = changed?.value.source ?? file.source.slice(0, note.start) + `\\obcomment[${serializeAnchorAttrs(comment!.attrs)}]{${escapeTexText(text)}}` + file.source.slice(note.end);
  return { path: notesPath, expectedHash: file.hash, content };
}

const header = "% OpenBar Markdown annotations. The post stores only their IDs.\n";
/** Prepare a single guarded multi-file transaction. No private text goes in the post. */
export function prepareMarkdownAnnotation(root: string, post: ManuscriptFile, at: number, kind: MarkdownAnchor["kind"], text: string) {
  if (!MARKDOWN_MANUSCRIPT_PATH.test(post.path) || !["todo", "comment"].includes(kind) || !text.trim() || text.length > 4000)
    throw new Error("Choose a Markdown file and enter a note of up to 4,000 characters.");
  const id = `md-${randomUUID()}`;
  const source = insertMarkdownAnchor(post.source, at, kind, id);
  const { texPath, notesPath } = paperFiles(root);
  const notes = existsSync(path.join(root, notesPath)) ? readManuscriptFile(root, notesPath) : { path: notesPath, source: header, hash: null };
  if (!notes.source.startsWith(header)) throw new Error(`An unrelated file already uses ${notesPath}.`);
  const tex = readManuscriptFile(root, texPath);
  const masked = maskTexLiterals(tex.source);
  const include = `\\input{${notesName}}`;
  const operation = { type: kind === "todo" ? "add_todo" as const : "add_comment" as const, id, text, from: 0, to: 0 };
  const record = applySourceOperation("", operation);
  if (!record.ok) throw new Error(record.message);
  const edits: ProjectFilesEditInput["edits"] = [
    { path: post.path, content: source, expectedHash: post.hash },
    { path: notesPath, content: notes.source + record.value.source.replace("[", `[post=${post.path},`) + "\n", expectedHash: notes.hash },
  ];
  if (!masked.includes(include)) {
    const end = /\\end\s*\{document\}/.exec(masked);
    if (!end) throw new Error("The private annotation include needs a valid paper root.");
    edits.push({ path: tex.path, expectedHash: tex.hash, content: tex.source.slice(0, end.index) + include + "\n" + tex.source.slice(end.index) });
  }
  return { edits, source, id };
}
