/**
 * Parse TeX with unified-latex and expose small, React-free helpers for the
 * preview walker. Unknown/junk input must not throw.
 */

import type * as Ast from "@unified-latex/unified-latex-types";
import { getParser } from "@unified-latex/unified-latex-util-parse";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import { visit } from "@unified-latex/unified-latex-util-visit";

export type TexRoot = Ast.Root;
export type TexNode = Ast.Node;
export type TexMacro = Ast.Macro;
export type TexEnvironment = Ast.Environment;

type TexArg = {
  type: "argument";
  openMark: string;
  closeMark: string;
  content: TexNode[];
};

type ItemGroup = {
  label: TexNode[] | undefined;
  body: TexNode[];
};

/** Configure custom signatures through the library parser. */
const PARSE_MACROS: Record<string, { signature: string }> = {
  caption: { signature: "o m" },
  cite: { signature: "o o m" },
  citep: { signature: "o o m" },
  citet: { signature: "o o m" },
  emph: { signature: "m" },
  footnote: { signature: "o m" },
  href: { signature: "o m m" },
  include: { signature: "m" },
  includegraphics: { signature: "o m" },
  input: { signature: "m" },
  label: { signature: "m" },
  multirow: { signature: "o m o m o m" },
  multicolumn: { signature: "m m m" },
  obcite: { signature: "o o m" },
  obclaim: { signature: "o m" },
  obcomment: { signature: "o m" },
  obevidence: { signature: "o m" },
  obmarker: { signature: "m m" },
  obtodo: { signature: "o m" },
  obpandocTable: { signature: "m" },
  paragraph: { signature: "s o m" },
  ref: { signature: "m" },
  section: { signature: "s o m" },
  shortstack: { signature: "m" },
  subparagraph: { signature: "s o m" },
  subsection: { signature: "s o m" },
  subsubsection: { signature: "s o m" },
  textbf: { signature: "m" },
  textit: { signature: "m" },
  textsc: { signature: "m" },
  texttt: { signature: "m" },
  title: { signature: "m" },
  url: { signature: "m" },
};

const parser = getParser({ macros: PARSE_MACROS });

/**
 * The editor preview accepts the common prose spelling `100%` even though
 * TeX treats an unescaped percent as the start of a comment. Work on a
 * parser-only copy so the live source keeps its exact spelling. The lint
 * surface still tells authors to write `\%` when they need compiler parity.
 */
function protectProsePercents(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char !== "%") {
      out += char;
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
    const previous = source[index - 1] || "";
    if (backslashes % 2 === 0 && /\d/.test(previous)) out += "\\%";
    else out += char;
  }
  return out;
}

function fallbackRoot(source: string): TexRoot {
  const content: TexNode[] = source ? [{ type: "string", content: source } as TexNode] : [];
  return { type: "root", content } as TexRoot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMacro(node: unknown): node is TexMacro {
  return isRecord(node) && node.type === "macro" && typeof node.content === "string";
}

export function isEnvironment(node: unknown): node is TexEnvironment {
  return isRecord(node) && node.type === "environment" && typeof node.env === "string" && Array.isArray(node.content);
}

function getArgs(node: unknown): TexArg[] {
  if (!isRecord(node) || !Array.isArray(node.args)) return [];
  const args: TexArg[] = [];
  for (const raw of node.args) {
    if (!isRecord(raw) || !Array.isArray(raw.content)) continue;
    args.push({
      type: "argument",
      openMark: typeof raw.openMark === "string" ? raw.openMark : "{",
      closeMark: typeof raw.closeMark === "string" ? raw.closeMark : "}",
      content: raw.content as TexNode[],
    });
  }
  return args;
}

function mandatoryCount(node: unknown): number {
  return getArgs(node).filter((arg) => arg.openMark === "{").length;
}

function isBraceMacro(node: unknown, brace: "{" | "}"): boolean {
  return isMacro(node) && node.content === brace;
}

/**
 * unified-latex turns `\{` / `\}` into macros named `{` / `}`, not a group.
 * Treat `\{` … `\}` as a `{…}` mandatory argument so `\obmarker{todo}\{body\}`
 * attaches the same way as `\obmarker{todo}{body}`.
 */
function tryConsumeEscapedGroup(nodes: unknown[], start: number): { arg: TexArg; next: number } | undefined {
  if (!isBraceMacro(nodes[start], "{")) return undefined;
  const inner: TexNode[] = [];
  let depth = 1;
  for (let j = start + 1; j < nodes.length; j += 1) {
    const cur = nodes[j];
    if (isBraceMacro(cur, "{")) {
      depth += 1;
      inner.push(cur as TexNode);
      continue;
    }
    if (isBraceMacro(cur, "}")) {
      depth -= 1;
      if (depth === 0) {
        return {
          arg: { type: "argument", openMark: "{", closeMark: "}", content: inner },
          next: j + 1,
        };
      }
      inner.push(cur as TexNode);
      continue;
    }
    inner.push(cur as TexNode);
  }
  return undefined;
}

/**
 * If `\obmarker` still has only one `{` arg after attach (unified-latex ate
 * `\{` as a single-token arg or left the body as siblings), pull in the
 * following escaped group.
 */
function salvageObmarkerEscapedArg(nodes: unknown[]): void {
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (isMacro(node) && node.content.replace(/\*$/, "") === "obmarker" && mandatoryCount(node) === 1) {
      const escaped = tryConsumeEscapedGroup(nodes, i + 1);
      if (escaped) {
        (node as { args: TexArg[] }).args = [...getArgs(node), escaped.arg];
        nodes.splice(i + 1, escaped.next - (i + 1));
      }
    }
    i += 1;
  }
}

function recoverEscapedMarkers(root: TexRoot): void {
  visit(root, salvageObmarkerEscapedArg, { includeArrays: true, test: Array.isArray });
}

function parsePreparedTex(prepared: string, original: string): TexRoot {
  try {
    const parsed = parser.parse(prepared);
    recoverEscapedMarkers(parsed);
    return parsed;
  } catch {
    return fallbackRoot(original);
  }
}

/** Parse with offsets that point into the original source. */
export function parseTex(source: string): TexRoot {
  return parsePreparedTex(source, source);
}

/** Parse a preview-only copy that keeps common prose percentages visible. */
export function parseTexForDisplay(source: string): TexRoot {
  return parsePreparedTex(protectProsePercents(source), source);
}

export function macroName(node: unknown): string | undefined {
  if (!isMacro(node)) return undefined;
  return node.content.replace(/\*$/, "");
}

export function envName(node: unknown): string | undefined {
  if (!isEnvironment(node)) return undefined;
  return node.env;
}

export function optionalArg(node: unknown): TexNode[] | undefined {
  const arg = getArgs(node).find((item) => item.openMark === "[");
  return arg?.content;
}

export function mandatoryArgs(node: unknown): TexNode[][] {
  return getArgs(node).filter((item) => item.openMark === "{").map((item) => item.content);
}

export function splitItems(nodes: readonly unknown[]): ItemGroup[] {
  const items: ItemGroup[] = [];
  let current: ItemGroup | undefined;
  for (const node of nodes) {
    const isItem = isMacro(node) && node.content.replace(/\*$/, "") === "item";
    if (isItem) {
      current = { label: optionalArg(node), body: [...itemBodyNodes(node)] };
      items.push(current);
      continue;
    }
    current?.body.push(node as TexNode);
  }
  return items;
}

function itemBodyNodes(node: unknown): TexNode[] {
  const args = getArgs(node).filter((arg) => arg.openMark !== "[");
  for (let i = args.length - 1; i >= 0; i--) {
    const content = args[i]!.content;
    if (content.some((child) => isRecord(child) && child.type !== "whitespace" && child.type !== "parbreak" && child.type !== "comment")) {
      return content;
    }
  }
  return [];
}

export function findMacros(tree: unknown, name: string): TexMacro[] {
  const found: TexMacro[] = [];
  if (tree == null) return found;
  visit(tree as Ast.Ast, (node) => {
    if (node.content.replace(/\*$/, "") === name) found.push(node);
  }, { test: isMacro });
  return found;
}

export function nodesToPlainText(nodes: unknown): string {
  if (nodes == null) return "";
  const list = Array.isArray(nodes) ? nodes : [nodes];
  let out = "";
  for (const node of list) {
    if (!isRecord(node) || typeof node.type !== "string") continue;
    switch (node.type) {
      case "string":
      case "verb":
      case "verbatim_environment":
        if (typeof node.content === "string") out += node.content;
        break;
      case "whitespace":
        out += " ";
        break;
      case "parbreak":
        out += "\n\n";
        break;
      case "comment":
        break;
      case "macro": {
        const name = typeof node.content === "string" ? node.content : "";
        if (name === "%") {
          out += "%";
          break;
        }
        const mapped = CHAR_MACROS[name];
        if (mapped != null) {
          out += mapped;
          break;
        }
        for (const arg of getArgs(node)) {
          if (arg.openMark === "{") out += nodesToPlainText(arg.content);
        }
        break;
      }
      case "environment":
      case "group":
      case "inlinemath":
      case "displaymath":
      case "root":
      case "argument":
        out += nodesToPlainText(node.content);
        break;
      default:
        if (Array.isArray(node.content)) out += nodesToPlainText(node.content);
        break;
    }
  }
  return out;
}

const CHAR_MACROS: Record<string, string> = {
  "%": "%",
  "&": "&",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  " ": " ",
  ",": "\u2009",
  ldots: "…",
  dots: "…",
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "<",
  textgreater: ">",
  pm: "±",
  checkmark: "✓",
  times: "×",
};

export function nodesToTex(nodes: unknown): string {
  if (nodes == null) return "";
  return printRaw(nodes as Ast.Ast);
}
