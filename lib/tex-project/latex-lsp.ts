import "server-only";

import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createMessageConnection } from "vscode-jsonrpc/node";
import { splitBundleSource } from "./source-bundle-format";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5_000;
const MAX_FILES = 150;
let active = 0;

export async function latexLanguageServerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("texlab", ["--version"], { timeout: 2_000, maxBuffer: 4_096 });
    return true;
  } catch {
    return false;
  }
}

type Position = { line: number; character: number };
type TextEdit = { newText: string; range: { start: Position; end: Position } };
type LspCompletion = { label: string; detail?: string; insertTextFormat?: number; textEdit?: TextEdit; additionalTextEdits?: unknown[]; command?: unknown };

function safeRelativePath(file: string): boolean {
  return file.length > 0 && file.length <= 1024 && !file.includes("\\") && !file.includes("\0")
    && !path.posix.isAbsolute(file) && file.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function positionAt(text: string, offset: number): Position {
  const prefix = text.slice(0, offset);
  const newline = prefix.lastIndexOf("\n");
  return { line: prefix.split("\n").length - 1, character: prefix.length - newline - 1 };
}

function offsetAt(text: string, position: Position): number | undefined {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0) return;
  const lines = text.split("\n");
  if (position.line >= lines.length || position.character > lines[position.line]!.length) return;
  let offset = position.character;
  for (let i = 0; i < position.line; i++) offset += lines[i]!.length + 1;
  return offset;
}

/** Ask TexLab about an isolated snapshot of the current, unsaved source bundle. */
export async function latexCompletions(source: string, file: string, offset: number, signal: AbortSignal) {
  if (active >= 2) throw new Error("LaTeX assistance is busy. Try again shortly.");
  const parts = splitBundleSource(source);
  if (!parts.length || parts.length > MAX_FILES || !safeRelativePath(file)) throw new Error("Invalid manuscript source bundle.");
  const files = new Map<string, string>();
  for (const part of parts) {
    if (!safeRelativePath(part.filePath)) throw new Error("Invalid manuscript file path.");
    const previous = files.get(part.filePath);
    if (previous !== undefined && previous !== part.body) throw new Error("Repeated manuscript files have different live contents.");
    files.set(part.filePath, part.body);
  }
  const text = files.get(file);
  if (text === undefined || !Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error("Invalid manuscript position.");
  if (signal.aborted) throw new Error("LaTeX request cancelled.");
  active++;
  let directory: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let connection: ReturnType<typeof createMessageConnection> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let childClosed: Promise<void> | undefined;
  const stop = () => child?.kill("SIGKILL");
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "openbar-lsp-"));
    for (const [name, contents] of files) {
      const destination = path.join(directory, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, { mode: 0o600 });
    }
    if (signal.aborted) throw new Error("LaTeX request cancelled.");
    const spawned = spawn("texlab", [], { cwd: directory, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: directory, TMPDIR: directory }, stdio: ["pipe", "pipe", "ignore"] });
    child = spawned;
    childClosed = new Promise((resolve) => spawned.once("close", () => resolve()));
    const processError = new Promise<never>((_, reject) => spawned.once("error", reject));
    const ready = new Promise<void>((resolve) => spawned.once("spawn", resolve));
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => { stop(); reject(new Error("LaTeX request cancelled.")); };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      timer = setTimeout(() => { stop(); reject(new Error("LaTeX assistance timed out.")); }, TIMEOUT_MS);
    });
    await Promise.race([ready, processError, cancelled]);
    connection = createMessageConnection(spawned.stdout, spawned.stdin);
    connection.onRequest("workspace/configuration", (params: { items: unknown[] }) => params.items.map(() => ({ build: { onSave: false } })));
    connection.listen();
    const request = async () => {
      const uri = (name: string) => pathToFileURL(path.join(directory!, name)).toString();
      await connection!.sendRequest("initialize", { processId: process.pid, rootUri: pathToFileURL(`${directory}/`).toString(), workspaceFolders: null, capabilities: { workspace: { configuration: true }, textDocument: { completion: { completionItem: { snippetSupport: false } } } } });
      await connection!.sendNotification("initialized", {});
      for (const [name, body] of files) await connection!.sendNotification("textDocument/didOpen", { textDocument: { uri: uri(name), languageId: "latex", version: 1, text: body } });
      const result = await connection!.sendRequest("textDocument/completion", { textDocument: { uri: uri(file) }, position: positionAt(text, offset), context: { triggerKind: 1 } }) as { items?: LspCompletion[] } | LspCompletion[] | null;
      const items = Array.isArray(result) ? result : result?.items ?? [];
      return items.slice(0, 200).flatMap((item) => {
        if (typeof item.label !== "string" || item.insertTextFormat === 2 || item.additionalTextEdits?.length || item.command || !item.textEdit?.range) return [];
        const from = offsetAt(text, item.textEdit.range.start);
        const to = offsetAt(text, item.textEdit.range.end);
        if (from === undefined || to !== offset || from > to || typeof item.textEdit.newText !== "string") return [];
        return [{ label: item.label, detail: item.detail, insert: item.textEdit.newText, from, to }];
      });
    };
    return await Promise.race([request(), processError, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    connection?.dispose();
    stop();
    if (childClosed) await childClosed;
    if (directory) await rm(directory, { recursive: true, force: true });
    active--;
  }
}
