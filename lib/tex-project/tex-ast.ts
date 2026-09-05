/**
 * Parse TeX with unified-latex and expose small, React-free helpers for the
 * preview walker. Unknown/junk input must not throw.
 */

import type * as Ast from "@unified-latex/unified-latex-types";
import { match } from "@unified-latex/unified-latex-util-match";
import { parse } from "@unified-latex/unified-latex-util-parse";
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

type MacroSpec = { optional: number; mandatory: number; star: boolean };

/** xparse-style signatures passed to parse() when that overload exists. */
const PARSE_MACROS: Record<string, { signature: string }> = {
  caption: { signature: "o m" },
  cite: { signature: "o o m" },
  citep: { signature: "o o m" },
  citet: { signature: "o o m" },
  emph: { signature: "m" },
  href: { signature: "m m" },
  include: { signature: "m" },
  includegraphics: { signature: "o m" },
  input: { signature: "m" },
  label: { signature: "m" },
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

const ATTACH_SPECS: Record<string, MacroSpec> = {
  caption: { optional: 1, mandatory: 1, star: false },
  cite: { optional: 2, mandatory: 1, star: false },
  citep: { optional: 2, mandatory: 1, star: false },
  citet: { optional: 2, mandatory: 1, star: false },
  emph: { optional: 0, mandatory: 1, star: false },
  href: { optional: 0, mandatory: 2, star: false },
  include: { optional: 0, mandatory: 1, star: false },
  includegraphics: { optional: 1, mandatory: 1, star: false },
  input: { optional: 0, mandatory: 1, star: false },
  label: { optional: 0, mandatory: 1, star: false },
  obcite: { optional: 2, mandatory: 1, star: false },
  obclaim: { optional: 1, mandatory: 1, star: false },
  obcomment: { optional: 1, mandatory: 1, star: false },
  obevidence: { optional: 1, mandatory: 1, star: false },
  obmarker: { optional: 0, mandatory: 2, star: false },
  obtodo: { optional: 1, mandatory: 1, star: false },
  obpandocTable: { optional: 0, mandatory: 1, star: false },
  paragraph: { optional: 1, mandatory: 1, star: true },
  ref: { optional: 0, mandatory: 1, star: false },
  section: { optional: 1, mandatory: 1, star: true },
  shortstack: { optional: 0, mandatory: 1, star: false },
  subparagraph: { optional: 1, mandatory: 1, star: true },
  subsection: { optional: 1, mandatory: 1, star: true },
  subsubsection: { optional: 1, mandatory: 1, star: true },
  textbf: { optional: 0, mandatory: 1, star: false },
  textit: { optional: 0, mandatory: 1, star: false },
  textsc: { optional: 0, mandatory: 1, star: false },
  texttt: { optional: 0, mandatory: 1, star: false },
  title: { optional: 0, mandatory: 1, star: false },
  url: { optional: 0, mandatory: 1, star: false },
};

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

function isRoot(value: unknown): value is TexRoot {
  return isRecord(value) && value.type === "root" && Array.isArray(value.content);
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

function isGroup(node: unknown): node is { type: "group"; content: TexNode[] } {
  return isRecord(node) && node.type === "group" && Array.isArray(node.content);
}

function isComment(node: unknown): boolean {
  return isRecord(node) && node.type === "comment";
}

function isWhitespace(node: unknown): boolean {
  return isRecord(node) && node.type === "whitespace";
}

function asNodeList(value: unknown): TexNode[] {
  return Array.isArray(value) ? (value as TexNode[]) : [];
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

function skipTrivia(nodes: unknown[], start: number): number {
  let i = start;
  while (i < nodes.length && (isWhitespace(nodes[i]) || isComment(nodes[i]))) i += 1;
  return i;
}

function tryConsumeStar(nodes: unknown[], start: number): { arg: TexArg; next: number } | undefined {
  const i = skipTrivia(nodes, start);
  const node = nodes[i];
  if (!isRecord(node) || node.type !== "string" || node.content !== "*") return undefined;
  return {
    arg: { type: "argument", openMark: "", closeMark: "", content: [{ type: "string", content: "*" } as TexNode] },
    next: i + 1,
  };
}

function tryConsumeOptional(nodes: unknown[], start: number): { arg: TexArg; next: number } | undefined {
  const i = skipTrivia(nodes, start);
  const node = nodes[i];
  if (!isRecord(node) || node.type !== "string" || typeof node.content !== "string" || !node.content.startsWith("[")) {
    return undefined;
  }
  if (node.content.endsWith("]") && node.content.length >= 2) {
    const inner = node.content.slice(1, -1);
    return {
      arg: {
        type: "argument",
        openMark: "[",
        closeMark: "]",
        content: inner ? [{ type: "string", content: inner } as TexNode] : [],
      },
      next: i + 1,
    };
  }
  const inner: TexNode[] = [];
  const first = node.content.slice(1);
  if (first) inner.push({ type: "string", content: first } as TexNode);
  for (let j = i + 1; j < nodes.length; j += 1) {
    const cur = nodes[j];
    if (isRecord(cur) && cur.type === "string" && typeof cur.content === "string" && cur.content.includes("]")) {
      const idx = cur.content.indexOf("]");
      const before = cur.content.slice(0, idx);
      if (before) inner.push({ type: "string", content: before } as TexNode);
      return { arg: { type: "argument", openMark: "[", closeMark: "]", content: inner }, next: j + 1 };
    }
    inner.push(cur as TexNode);
  }
  return undefined;
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

function tryConsumeMandatory(nodes: unknown[], start: number): { arg: TexArg; next: number } | undefined {
  const i = skipTrivia(nodes, start);
  const node = nodes[i];
  if (isGroup(node)) {
    return {
      arg: { type: "argument", openMark: "{", closeMark: "}", content: asNodeList(node.content) },
      next: i + 1,
    };
  }
  return undefined;
}

function attachInArray(nodes: unknown[]): void {
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (isMacro(node)) {
      const spec = ATTACH_SPECS[node.content];
      if (spec && mandatoryCount(node) < spec.mandatory) {
        const args: TexArg[] = [...getArgs(node)];
        let cursor = i + 1;
        if (spec.star) {
          const star = tryConsumeStar(nodes, cursor);
          if (star) {
            args.push(star.arg);
            cursor = star.next;
          }
        }
        for (let n = 0; n < spec.optional; n += 1) {
          const opt = tryConsumeOptional(nodes, cursor);
          if (!opt) break;
          args.push(opt.arg);
          cursor = opt.next;
        }
        let gotMandatory = 0;
        for (let n = 0; n < spec.mandatory; n += 1) {
          const mand = tryConsumeMandatory(nodes, cursor);
          if (!mand) break;
          args.push(mand.arg);
          cursor = mand.next;
          gotMandatory += 1;
        }
        if (gotMandatory > 0 || args.length > getArgs(node).length) {
          (node as { args: TexArg[] }).args = args;
          nodes.splice(i + 1, cursor - (i + 1));
        }
      }
    }
    i += 1;
  }
}

function childArrays(node: unknown): TexNode[][] {
  const out: TexNode[][] = [];
  if (!isRecord(node)) return out;
  if (Array.isArray(node.content) && node.type !== "string" && node.type !== "comment" && node.type !== "verb" && node.type !== "verbatim_environment") {
    out.push(node.content as TexNode[]);
  }
  if (Array.isArray(node.args)) {
    for (const arg of node.args) {
      if (isRecord(arg) && Array.isArray(arg.content)) out.push(arg.content as TexNode[]);
    }
  }
  return out;
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

function attachCustomMacroArgs(root: TexRoot): void {
  const seen = new Set<unknown[]>();
  const walk = (nodes: unknown[]) => {
    if (seen.has(nodes)) return;
    seen.add(nodes);
    attachInArray(nodes);
    salvageObmarkerEscapedArg(nodes);
    for (const node of nodes) {
      for (const child of childArrays(node)) walk(child);
    }
  };
  walk(root.content);
}

function runParse(source: string): unknown {
  const parseFn = parse as (text: string, options?: { macros?: typeof PARSE_MACROS }) => unknown;
  try {
    return parseFn(source, { macros: PARSE_MACROS });
  } catch {
    return parseFn(source);
  }
}

function parsePreparedTex(prepared: string, original: string): TexRoot {
  try {
    let parsed: unknown = runParse(prepared);
    if (!isRoot(parsed)) {
      parsed = (parse as (text: string) => unknown)(prepared);
    }
    if (!isRoot(parsed)) return fallbackRoot(original);
    attachCustomMacroArgs(parsed);
    return parsed;
  } catch {
    try {
      const parsed = (parse as (text: string) => unknown)(prepared);
      if (!isRoot(parsed)) return fallbackRoot(original);
      attachCustomMacroArgs(parsed);
      return parsed;
    } catch {
      return fallbackRoot(original);
    }
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
    const isItem =
      isMacro(node) &&
      (node.content.replace(/\*$/, "") === "item" || (match.macro as (n: unknown, name?: string) => boolean)(node, "item"));
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

function walkAll(tree: unknown, visitNode: (node: unknown) => void): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (node == null || seen.has(node)) return;
    seen.add(node);
    visitNode(node);
    for (const child of childArrays(node)) {
      for (const item of child) walk(item);
    }
  };
  walk(tree);
}

export function findMacros(tree: unknown, name: string): TexMacro[] {
  const found: TexMacro[] = [];
  const seen = new Set<unknown>();
  const add = (node: unknown) => {
    if (!isMacro(node) || seen.has(node) || node.content.replace(/\*$/, "") !== name) return;
    seen.add(node);
    found.push(node);
  };
  try {
    visit(tree as never, add as never);
  } catch {
    // visit's signature varies across releases; walkAll is the source of truth.
  }
  walkAll(tree, add);
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
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return list.map(printNode).join("");
}

function printNode(node: unknown): string {
  if (!isRecord(node) || typeof node.type !== "string") return "";
  switch (node.type) {
    case "string":
      return typeof node.content === "string" ? node.content : "";
    case "whitespace":
      return " ";
    case "parbreak":
      return "\n\n";
    case "comment":
      return "";
    case "macro": {
      const name = typeof node.content === "string" ? node.content : "";
      const args = getArgs(node)
        .map((arg) => `${arg.openMark}${nodesToTex(arg.content)}${arg.closeMark}`)
        .join("");
      return `\\${name}${args}`;
    }
    case "environment": {
      const name = typeof node.env === "string" ? node.env : "";
      const args = getArgs(node)
        .map((arg) => `${arg.openMark}${nodesToTex(arg.content)}${arg.closeMark}`)
        .join("");
      return `\\begin{${name}}${args}${nodesToTex(node.content)}\\end{${name}}`;
    }
    case "group":
      return `{${nodesToTex(node.content)}}`;
    case "inlinemath":
      return `$${nodesToTex(node.content)}$`;
    case "displaymath":
      return `\\[${nodesToTex(node.content)}\\]`;
    case "verb": {
      const escape = typeof node.escape === "string" ? node.escape : "|";
      const body = typeof node.content === "string" ? node.content : "";
      return `\\verb${escape}${body}${escape}`;
    }
    case "verbatim_environment": {
      const name = typeof node.env === "string" ? node.env : "verbatim";
      const body = typeof node.content === "string" ? node.content : "";
      return `\\begin{${name}}${body}\\end{${name}}`;
    }
    case "root":
    case "argument":
      return nodesToTex(node.content);
    default:
      return Array.isArray(node.content) ? nodesToTex(node.content) : "";
  }
}
