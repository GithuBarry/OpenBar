"use client";

import katex from "katex";
import React, { useMemo, type ReactElement, type ReactNode } from "react";

import { headingOccurrenceKey, texHeadingLevel } from "@/features/paper/heading-keys";
import { referenceFields, refId, type BibEntry } from "@/lib/bibtex";
import { parseAnchorAttrs, resolveAssetUrl } from "@/lib/marker-codec";
import { safeUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import {
  envName,
  findMacros,
  isEnvironment,
  isMacro,
  mandatoryArgs,
  nodesToPlainText,
  nodesToTex,
  optionalArg,
  parseTexForDisplay,
  splitItems,
  type TexEnvironment,
  type TexNode,
  type TexRoot,
} from "@/lib/tex-project/tex-ast";

const HEADING_MACROS = new Set(["title", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]);
const CITE_MACROS = new Set(["cite", "citep", "citet", "citealp", "citeauthor", "autocite", "parencite", "textcite", "obcite"]);
const LIST_ENVS = new Set(["enumerate", "itemize"]);
const FIGURE_ENVS = new Set(["figure", "figure*"]);
const TABLE_ENVS = new Set(["table", "table*"]);
const MATH_ENVS = new Set(["equation", "equation*", "align", "align*", "displaymath", "gather", "gather*"]);
const QUOTE_ENVS = new Set(["quote", "quotation"]);
const RULE_MACROS = new Set(["hline", "toprule", "midrule", "bottomrule", "cline", "cmidrule", "addlinespace"]);
const SILENT_MACROS = new Set([
  "input",
  "include",
  "begin",
  "end",
  "addcontentsline",
  "addlinespace",
  "appendix",
  "author",
  "bfseries",
  "bigskip",
  "bottomrule",
  "centering",
  "clearpage",
  "cline",
  "cmidrule",
  "columnwidth",
  "date",
  "documentclass",
  "enspace",
  "fill",
  "footnotesize",
  "fussy",
  "hfill",
  "hline",
  "hspace",
  "hskip",
  "huge",
  "Huge",
  "itshape",
  "large",
  "Large",
  "LARGE",
  "leavevmode",
  "linewidth",
  "maketitle",
  "makeatletter",
  "makeatother",
  "medskip",
  "midrule",
  "newcommand",
  "newpage",
  "noindent",
  "nolinenumbers",
  "normalsize",
  "pagestyle",
  "par",
  "protect",
  "providecommand",
  "quad",
  "qquad",
  "relax",
  "renewcommand",
  "RequirePackage",
  "scriptsize",
  "setlength",
  "sloppy",
  "small",
  "smallskip",
  "tableofcontents",
  "textwidth",
  "thispagestyle",
  "tiny",
  "toprule",
  "usepackage",
  "vfill",
  "vspace",
  "vskip",
]);
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
  dagger: "†",
  ddagger: "‡",
};

type WalkContext = {
  headingCounts: Map<string, number>;
  assetBaseUrl: string | undefined;
  bibByKey: Map<string, BibEntry>;
  bibByLower: Map<string, BibEntry>;
  citeOrder: string[];
  citeNum: Map<string, number>;
  seq: number;
  nextKey: () => string;
};

function createWalkContext(bibliography: BibEntry[] | undefined, assetBaseUrl: string | undefined): WalkContext {
  const bibByKey = new Map<string, BibEntry>();
  const bibByLower = new Map<string, BibEntry>();
  for (const entry of bibliography ?? []) {
    bibByKey.set(entry.key, entry);
    const lower = entry.key.toLowerCase();
    if (!bibByLower.has(lower)) bibByLower.set(lower, entry);
  }
  const ctx: WalkContext = {
    headingCounts: new Map(),
    assetBaseUrl,
    bibByKey,
    bibByLower,
    citeOrder: [],
    citeNum: new Map(),
    seq: 0,
    nextKey: () => {
      ctx.seq += 1;
      return `t${ctx.seq}`;
    },
  };
  return ctx;
}

function lookupBib(ctx: WalkContext, key: string): BibEntry | undefined {
  return ctx.bibByKey.get(key) ?? ctx.bibByLower.get(key.toLowerCase());
}

function nodeType(node: unknown): string {
  return typeof node === "object" && node !== null && "type" in node && typeof (node as { type: unknown }).type === "string"
    ? (node as { type: string }).type
    : "";
}

function nodeContent(node: unknown): unknown {
  return typeof node === "object" && node !== null && "content" in node ? (node as { content: unknown }).content : undefined;
}

function isParbreak(node: unknown): boolean {
  return nodeType(node) === "parbreak";
}

function isComment(node: unknown): boolean {
  return nodeType(node) === "comment";
}

function isWhitespace(node: unknown): boolean {
  return nodeType(node) === "whitespace";
}

function isTrivia(node: unknown): boolean {
  if (isComment(node) || isWhitespace(node) || isParbreak(node)) return true;
  return nodeType(node) === "string" && !String(nodeContent(node) ?? "").trim();
}

function isDisplayMath(node: unknown): boolean {
  const type = nodeType(node);
  return type === "displaymath" || type === "displayMath";
}

function isInlineMath(node: unknown): boolean {
  const type = nodeType(node);
  return type === "inlinemath" || type === "inlineMath";
}

function isGroup(node: unknown): node is TexNode & { content: TexNode[] } {
  return nodeType(node) === "group" && Array.isArray(nodeContent(node));
}

function isGeneratedMacro(name: string): boolean {
  return name === "input" || name === "include";
}

function isBlockNode(node: unknown): boolean {
  if (isDisplayMath(node) || nodeType(node) === "verbatim_environment") return true;
  if (isEnvironment(node)) return true;
  const name = isMacro(node) ? (node.content || "").replace(/\*$/, "") : "";
  if (HEADING_MACROS.has(name)) return true;
  if (name === "includegraphics" || name === "caption") return true;
  if (isGeneratedMacro(name)) return true;
  if (name === "\\" || name === "newline" || name === "linebreak") return false;
  return false;
}

function isSilentMacro(node: unknown): boolean {
  if (!isMacro(node)) return false;
  const name = node.content.replace(/\*$/, "");
  return SILENT_MACROS.has(name) || RULE_MACROS.has(name);
}

function onlyTrivia(nodes: readonly unknown[]): boolean {
  return nodes.every((node) => isTrivia(node) || isSilentMacro(node));
}

function hasBlockChild(nodes: readonly unknown[]): boolean {
  return nodes.some((node) => isBlockNode(node) || isParbreak(node));
}

function TodoInline({ children }: { children: ReactNode }) {
  return (
    <span className="ob-todo-inline" title="TODO">
      {children}
    </span>
  );
}

function CommentInline({ children }: { children: ReactNode }) {
  return (
    <span className="ob-comment-inline" title="Comment">
      {children}
    </span>
  );
}

function PreviewHeading({
  headingKey,
  level,
  labelId,
  children,
}: {
  headingKey: string;
  level: number;
  labelId?: string;
  children: ReactNode;
}) {
  const clamped = Math.min(Math.max(level, 1), 6);
  const Tag = `h${clamped}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={`ob-pv-h-${headingKey}`} data-ob-heading-key={headingKey} className="ob-pv-heading scroll-mt-6">
      {children}
      {labelId ? <span id={labelId} /> : null}
    </Tag>
  );
}

function MathView({ tex, display, k }: { tex: string; display: boolean; k: string }) {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false });
    if (display) {
      return <div key={k} className="my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return <span key={k} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return (
      <code key={k} className="ob-tex-unknown text-faint">
        {display ? `\\[${tex}\\]` : `$${tex}$`}
      </code>
    );
  }
}

function UnknownTex({ spelling, k }: { spelling: string; k: string }) {
  return (
    <code key={k} className="ob-tex-unknown text-faint">
      {spelling}
    </code>
  );
}

function consumeFollowingLabel(nodes: readonly TexNode[], start: number): { id: string | undefined; consumed: number } {
  let i = start;
  while (i < nodes.length && (isWhitespace(nodes[i]) || isComment(nodes[i]))) i += 1;
  const node = nodes[i];
  if (isMacro(node) && node.content.replace(/\*$/, "") === "label") {
    const id = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
    return { id: id || undefined, consumed: i + 1 - start };
  }
  return { id: undefined, consumed: 0 };
}

function renderProseString(text: string, ctx: WalkContext): ReactNode[] {
  const out: ReactNode[] = [];
  const markerRe = /\{\?\s*(notfinal|placeholder|verify|cite|citation-needed|todo)\b\s*:?\s*([^}]*)\}/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const body = (match[2] || match[1] || "").trim();
    out.push(
      <span key={ctx.nextKey()} className="ob-marker-inline" title={match[1] || "marker"}>
        {body}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function citeKeys(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((key) => key.replace(/^[@$]/, "").trim())
    .filter(Boolean);
}

function renderCite(node: unknown, ctx: WalkContext): ReactNode {
  const keys = citeKeys(nodesToPlainText(mandatoryArgs(node)[0] ?? []));
  const locator = nodesToPlainText(optionalArg(node) ?? []).trim();
  const inner = keys.map((key) => {
    const entry = lookupBib(ctx, key);
    if (!entry) {
      return (
        <span key={ctx.nextKey()} className="ob-cite-missing" title={`unknown key: ${key}`}>
          ?
        </span>
      );
    }
    const canon = entry.key;
    let num = ctx.citeNum.get(canon);
    if (num == null) {
      ctx.citeOrder.push(canon);
      num = ctx.citeOrder.length;
      ctx.citeNum.set(canon, num);
    }
    return (
      <a key={ctx.nextKey()} className="ob-cite" href={`#${refId(canon)}`}>
        <span className="ob-cite-num">{num}</span>
      </a>
    );
  });
  const parts: ReactNode[] = [];
  inner.forEach((nodeInner, index) => {
    if (index > 0) parts.push(", ");
    parts.push(nodeInner);
  });
  return (
    <span key={ctx.nextKey()} title={locator || undefined}>
      [{parts}]
    </span>
  );
}

function renderMacro(node: unknown, ctx: WalkContext): ReactNode {
  const name = (isMacro(node) ? node.content : "").replace(/\*$/, "");
  if (!name) return null;
  if (SILENT_MACROS.has(name) || RULE_MACROS.has(name)) return null;
  if (CHAR_MACROS[name] != null) return CHAR_MACROS[name];
  if (name === "textbf") return <strong key={ctx.nextKey()}>{renderInline(mandatoryArgs(node)[0] ?? [], ctx)}</strong>;
  if (name === "emph" || name === "textit") return <em key={ctx.nextKey()}>{renderInline(mandatoryArgs(node)[0] ?? [], ctx)}</em>;
  if (name === "texttt") return <code key={ctx.nextKey()}>{renderInline(mandatoryArgs(node)[0] ?? [], ctx)}</code>;
  if (name === "textsc") {
    return (
      <span key={ctx.nextKey()} className="ob-small-caps">
        {renderInline(mandatoryArgs(node)[0] ?? [], ctx)}
      </span>
    );
  }
  if (name === "href") {
    const url = safeUrl(nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim());
    const labelNodes = mandatoryArgs(node)[1] ?? mandatoryArgs(node)[0] ?? [];
    if (!url) return <span key={ctx.nextKey()}>{renderInline(labelNodes, ctx)}</span>;
    return (
      <a key={ctx.nextKey()} href={url} target="_blank" rel="noreferrer">
        {renderInline(labelNodes, ctx)}
      </a>
    );
  }
  if (name === "url") {
    const raw = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
    const url = safeUrl(raw);
    if (!url) return <span key={ctx.nextKey()}>{raw}</span>;
    return (
      <a key={ctx.nextKey()} href={url} target="_blank" rel="noreferrer">
        {raw}
      </a>
    );
  }
  if (name === "obtodo") {
    return <TodoInline key={ctx.nextKey()}>{renderInline(mandatoryArgs(node)[0] ?? [], ctx)}</TodoInline>;
  }
  if (name === "obcomment") {
    return <CommentInline key={ctx.nextKey()}>{renderInline(mandatoryArgs(node)[0] ?? [], ctx)}</CommentInline>;
  }
  if (name === "obmarker") {
    return (
      <span key={ctx.nextKey()} className="ob-marker-inline">
        {renderInline(mandatoryArgs(node)[1] ?? mandatoryArgs(node)[0] ?? [], ctx)}
      </span>
    );
  }
  if (CITE_MACROS.has(name)) return renderCite(node, ctx);
  if (name === "ref" || name === "cref" || name === "Cref" || name === "autoref") {
    const id = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
    return (
      <a key={ctx.nextKey()} href={`#${id}`}>
        {id}
      </a>
    );
  }
  if (name === "label") {
    const id = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
    return id ? <span key={ctx.nextKey()} id={id} /> : null;
  }
  if (name === "\\" || name === "newline" || name === "linebreak") return <br key={ctx.nextKey()} />;
  if (isGeneratedMacro(name)) {
    return (
      <code key={ctx.nextKey()} className="text-muted">
        {nodesToTex(node)}
      </code>
    );
  }
  if (HEADING_MACROS.has(name)) return renderHeadingMacro(node, ctx);
  if (name === "includegraphics") return renderIncludeGraphics(node, ctx);
  if (name === "caption") {
    return (
      <figcaption key={ctx.nextKey()} className="mt-3 max-w-2xl text-xs text-muted leading-relaxed font-sans">
        {renderInline(mandatoryArgs(node)[0] ?? [], ctx)}
      </figcaption>
    );
  }
  if (name === "footnote") {
    return (
      <span key={ctx.nextKey()} className="text-sm text-muted">
        {" ("}
        {renderInline(mandatoryArgs(node)[0] ?? [], ctx)}
        {")"}
      </span>
    );
  }
  return <UnknownTex key={ctx.nextKey()} k={ctx.nextKey()} spelling={nodesToTex(node)} />;
}

function renderHeadingMacro(node: unknown, ctx: WalkContext, labelId?: string): ReactNode {
  const name = (isMacro(node) ? node.content : "section").replace(/\*$/, "");
  const titleNodes = mandatoryArgs(node)[0] ?? [];
  if (name === "title") {
    return (
      <h1 key={ctx.nextKey()} className="ob-pv-title scroll-mt-6">
        {renderInline(titleNodes, ctx)}
      </h1>
    );
  }
  const titleText = nodesToPlainText(titleNodes).trim();
  const headingKey = headingOccurrenceKey(texHeadingLevel(name), titleText, ctx.headingCounts);
  return (
    <PreviewHeading key={ctx.nextKey()} headingKey={headingKey} level={texHeadingLevel(name)} labelId={labelId}>
      {renderInline(titleNodes, ctx)}
    </PreviewHeading>
  );
}

function renderIncludeGraphics(node: unknown, ctx: WalkContext): ReactNode {
  const path = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
  const opts = nodesToPlainText(optionalArg(node) ?? []);
  const page = /(?:^|,)\s*page\s*=\s*(\d+)/.exec(opts)?.[1];
  const src = resolveAssetUrl(path, ctx.assetBaseUrl);
  const href = page && src ? `${src}#page=${page}` : src;
  const isPdf = src?.toLowerCase().endsWith(".pdf");
  if (!href) return <UnknownTex key={ctx.nextKey()} k={ctx.nextKey()} spelling={nodesToTex(node)} />;
  if (isPdf) {
    return (
      <div key={ctx.nextKey()} className="flex w-full max-w-2xl flex-col items-center gap-1">
        <object
          aria-label="Embedded PDF figure"
          className="pointer-events-none h-80 w-full rounded-lg border border-line/60 bg-white"
          data={href}
          type="application/pdf"
        >
          <p className="p-4 text-xs text-muted">Embedded PDF figure</p>
        </object>
        <a href={href} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
          Open PDF figure in a new tab
        </a>
      </div>
    );
  }
  return <img key={ctx.nextKey()} src={href} alt="" className="max-h-[500px] w-auto max-w-full rounded-lg object-contain" />;
}

function renderFigure(node: TexEnvironment, ctx: WalkContext): ReactNode {
  const graphics = findMacros(node, "includegraphics");
  const caption = findMacros(node, "caption")[0];
  const label = nodesToPlainText(mandatoryArgs(findMacros(node, "label")[0])[0] ?? []).trim();
  return (
    <figure
      key={ctx.nextKey()}
      id={label || undefined}
      className="my-6 flex flex-col items-center justify-center rounded-xl border border-line bg-surface p-4 text-center shadow-xs"
    >
      {graphics.length ? graphics.map((graphic) => renderIncludeGraphics(graphic, ctx)) : renderFlow(node.content, ctx)}
      {caption ? (
        <figcaption className="mt-3 max-w-2xl text-xs text-muted leading-relaxed font-sans">
          {renderInline(mandatoryArgs(caption)[0] ?? [], ctx)}
        </figcaption>
      ) : null}
    </figure>
  );
}

function isRowBreak(node: unknown): boolean {
  if (!isMacro(node)) return false;
  return node.content === "\\" || node.content === "cr" || node.content === "tabularnewline";
}

function isCellBreak(node: unknown): boolean {
  if (nodeType(node) === "string" && nodeContent(node) === "&") return true;
  if (nodeType(node) === "alignmentTab" || nodeType(node) === "alignmenttab") return true;
  return isMacro(node) && node.content === "&";
}

function isRuleMacro(node: unknown): boolean {
  return isMacro(node) && RULE_MACROS.has(node.content.replace(/\*$/, ""));
}

function splitTabularRows(nodes: readonly TexNode[]): TexNode[][] {
  const rows: TexNode[][] = [];
  let current: TexNode[] = [];
  const pushRow = () => {
    const cells = current.filter((node) => !isRuleMacro(node) && !isWhitespace(node) && !isComment(node) && !isParbreak(node));
    if (cells.length) rows.push(current.filter((node) => !isRuleMacro(node)));
    current = [];
  };
  for (const node of nodes) {
    if (isRowBreak(node)) {
      pushRow();
      continue;
    }
    current.push(node);
  }
  pushRow();
  return rows;
}

function splitRowCells(nodes: readonly TexNode[]): TexNode[][] {
  const cells: TexNode[][] = [];
  let current: TexNode[] = [];
  const push = () => {
    cells.push(current);
    current = [];
  };
  for (const node of nodes) {
    if (isCellBreak(node)) {
      push();
      continue;
    }
    if (isRuleMacro(node) || isParbreak(node) || isComment(node)) continue;
    current.push(node);
  }
  push();
  return cells;
}

function renderTabular(node: TexEnvironment, ctx: WalkContext): ReactNode {
  const spec = nodesToPlainText(mandatoryArgs(node)[0] ?? []);
  const aligns: Array<"left" | "center" | "right"> = [];
  for (const ch of spec) {
    if (ch === "l") aligns.push("left");
    else if (ch === "c") aligns.push("center");
    else if (ch === "r") aligns.push("right");
  }
  const rows = splitTabularRows(node.content).map(splitRowCells).filter((row) => row.some((cell) => nodesToPlainText(cell).trim() || cell.some((n) => isMacro(n) || isInlineMath(n))));
  return (
    <div key={ctx.nextKey()} className="ob-table-wrapper my-4 w-full overflow-x-auto rounded-lg border border-line/60 bg-surface">
      <table className="min-w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={ctx.nextKey()}>
              {row.map((cell, cellIndex) => (
                <td key={ctx.nextKey()} style={aligns[cellIndex] ? { textAlign: aligns[cellIndex] } : undefined}>
                  {renderInline(cell, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderList(node: TexEnvironment, ctx: WalkContext): ReactNode {
  const Tag = node.env === "enumerate" ? "ol" : "ul";
  const items = splitItems(node.content);
  return (
    <Tag key={ctx.nextKey()}>
      {items.map((item) => (
        <li key={ctx.nextKey()}>
          {item.label?.length ? <span className="mr-1 font-semibold">{renderInline(item.label, ctx)} </span> : null}
          {hasBlockChild(item.body) ? renderFlow(item.body, ctx) : renderInline(item.body, ctx)}
        </li>
      ))}
    </Tag>
  );
}

function renderEnvironment(node: TexEnvironment, ctx: WalkContext): ReactNode {
  const name = node.env;
  if (name === "document") return <div key={ctx.nextKey()}>{renderFlow(node.content, ctx)}</div>;
  if (LIST_ENVS.has(name)) return renderList(node, ctx);
  if (FIGURE_ENVS.has(name)) return renderFigure(node, ctx);
  if (name === "tabular") return renderTabular(node, ctx);
  if (TABLE_ENVS.has(name)) {
    const tabular = node.content.find((child) => envName(child) === "tabular");
    const caption = findMacros(node, "caption")[0];
    const label = nodesToPlainText(mandatoryArgs(findMacros(node, "label")[0])[0] ?? []).trim();
    return (
      <figure key={ctx.nextKey()} id={label || undefined} className="my-6">
        {isEnvironment(tabular) ? renderTabular(tabular, ctx) : renderFlow(node.content, ctx)}
        {caption ? (
          <figcaption className="mt-3 text-xs text-muted leading-relaxed font-sans">{renderInline(mandatoryArgs(caption)[0] ?? [], ctx)}</figcaption>
        ) : null}
      </figure>
    );
  }
  if (MATH_ENVS.has(name)) {
    return <MathView key={ctx.nextKey()} k={ctx.nextKey()} tex={nodesToTex(node.content)} display />;
  }
  if (name === "math") {
    return <MathView key={ctx.nextKey()} k={ctx.nextKey()} tex={nodesToTex(node.content)} display={false} />;
  }
  if (name === "center") {
    return (
      <div key={ctx.nextKey()} className="text-center">
        {renderFlow(node.content, ctx)}
      </div>
    );
  }
  if (name === "abstract") {
    return (
      <div key={ctx.nextKey()} className="ob-abstract">
        {renderFlow(node.content, ctx)}
      </div>
    );
  }
  if (QUOTE_ENVS.has(name)) return <blockquote key={ctx.nextKey()}>{renderFlow(node.content, ctx)}</blockquote>;
  return (
    <div key={ctx.nextKey()} className="my-2">
      <code className="ob-tex-unknown text-faint">{`\\begin{${name}}`}</code>
      {renderFlow(node.content, ctx)}
      <code className="ob-tex-unknown text-faint">{`\\end{${name}}`}</code>
    </div>
  );
}

function renderInline(nodes: readonly unknown[], ctx: WalkContext): ReactNode[] {
  const out: ReactNode[] = [];
  for (const node of nodes) {
    const type = nodeType(node);
    if (!type || type === "comment") continue;
    if (type === "string") {
      out.push(...renderProseString(String(nodeContent(node) ?? ""), ctx));
      continue;
    }
    if (type === "whitespace") {
      out.push(" ");
      continue;
    }
    if (type === "parbreak") {
      out.push(" ");
      continue;
    }
    if (isInlineMath(node)) {
      out.push(<MathView key={ctx.nextKey()} k={ctx.nextKey()} tex={nodesToTex(nodeContent(node))} display={false} />);
      continue;
    }
    if (isDisplayMath(node)) {
      out.push(<MathView key={ctx.nextKey()} k={ctx.nextKey()} tex={nodesToTex(nodeContent(node))} display />);
      continue;
    }
    if (isGroup(node)) {
      out.push(...renderInline(node.content, ctx));
      continue;
    }
    if (isMacro(node)) {
      out.push(renderMacro(node, ctx));
      continue;
    }
    if (isEnvironment(node)) {
      out.push(renderEnvironment(node, ctx));
      continue;
    }
    if (type === "verb" || type === "verbatim_environment") {
      out.push(<code key={ctx.nextKey()}>{String(nodeContent(node) ?? "")}</code>);
      continue;
    }
    if (Array.isArray(nodeContent(node))) out.push(...renderInline(nodeContent(node) as TexNode[], ctx));
  }
  return out;
}

function renderParagraph(nodes: TexNode[], ctx: WalkContext): ReactNode {
  return <p key={ctx.nextKey()}>{renderInline(nodes, ctx)}</p>;
}

function renderFlow(nodes: readonly TexNode[], ctx: WalkContext): ReactNode[] {
  type Para = { nodes: TexNode[] };
  type Block = { node: TexNode; labelId?: string };
  const segments: Array<{ kind: "para"; para: Para } | { kind: "block"; block: Block }> = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;
    if (isComment(node)) {
      i += 1;
      continue;
    }
    if (isParbreak(node) || (isWhitespace(node) && segments.length === 0)) {
      i += 1;
      continue;
    }
    if (isBlockNode(node)) {
      let labelId: string | undefined;
      let consumed = 1;
      if (isMacro(node) && HEADING_MACROS.has(node.content.replace(/\*$/, ""))) {
        const following = consumeFollowingLabel(nodes, i + 1);
        labelId = following.id;
        consumed += following.consumed;
      }
      segments.push({ kind: "block", block: { node, labelId } });
      i += consumed;
      continue;
    }
    const buf: TexNode[] = [];
    while (i < nodes.length && !isBlockNode(nodes[i]!) && !isParbreak(nodes[i]!)) {
      if (!isComment(nodes[i])) buf.push(nodes[i]!);
      i += 1;
    }
    if (isParbreak(nodes[i])) i += 1;
    if (!onlyTrivia(buf)) segments.push({ kind: "para", para: { nodes: buf } });
  }

  const out: ReactNode[] = [];
  let s = 0;
  while (s < segments.length) {
    const segment = segments[s]!;
    if (segment.kind === "block") {
      const { node, labelId } = segment.block;
      if (isMacro(node) && HEADING_MACROS.has(node.content.replace(/\*$/, ""))) {
        out.push(renderHeadingMacro(node, ctx, labelId));
      } else {
        out.push(renderBlock(node, ctx));
      }
      s += 1;
      continue;
    }
    out.push(renderParagraph(segment.para.nodes, ctx));
    s += 1;
  }
  return out;
}

function renderBlock(node: TexNode, ctx: WalkContext): ReactNode {
  if (isDisplayMath(node)) {
    return <MathView key={ctx.nextKey()} k={ctx.nextKey()} tex={nodesToTex(nodeContent(node))} display />;
  }
  if (isEnvironment(node)) return renderEnvironment(node, ctx);
  if (isMacro(node)) return renderMacro(node, ctx);
  if (nodeType(node) === "verbatim_environment") {
    return (
      <pre key={ctx.nextKey()}>
        <code>{String(nodeContent(node) ?? "")}</code>
      </pre>
    );
  }
  return <UnknownTex key={ctx.nextKey()} k={ctx.nextKey()} spelling={nodesToTex(node)} />;
}

function ReferencesBlock({ headingKey, refs }: { headingKey: string; refs: BibEntry[] }) {
  if (!refs.length) return null;
  return (
    <section className="ob-references">
      <h2 id={`ob-pv-h-${headingKey}`} data-ob-heading-key={headingKey} className="ob-pv-heading scroll-mt-6">
        References
      </h2>
      <ol className="ob-refs">
        {refs.map((entry, index) => (
          <li key={entry.key} id={refId(entry.key)}>
            <span className="ob-ref-num">{index + 1}</span>
            <ReferenceText entry={entry} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReferenceText({ entry }: { entry: BibEntry }) {
  if (entry.html) {
    return <span className="ob-ref-csl" dangerouslySetInnerHTML={{ __html: entry.html }} />;
  }
  const fields = referenceFields(entry);
  return (
    <span>
      {fields.authors ? `${fields.authors.replace(/\.$/, "")}. ` : null}
      {fields.title}.
      {fields.venue || fields.year ? " " : null}
      {fields.venue ? <em>{fields.venue}</em> : null}
      {fields.venue && fields.year ? ", " : null}
      {fields.year ? `${fields.year}.` : fields.venue ? "." : null}
      {fields.url ? (
        <>
          {" "}
          <a className="ob-ref-link" href={fields.url} target="_blank" rel="noreferrer">
            link
          </a>
        </>
      ) : null}
    </span>
  );
}

function isBibliographyInput(node: unknown): boolean {
  if (!isMacro(node)) return false;
  const name = node.content.replace(/\*$/, "");
  if (name !== "input" && name !== "bibliography") return false;
  const path = nodesToPlainText(mandatoryArgs(node)[0] ?? []).replace(/\.tex$/i, "").replace(/\\/g, "/").trim();
  return name === "bibliography" || /(^|\/)references$/.test(path);
}

function renderDocument(ast: TexRoot, bibliography: BibEntry[] | undefined, assetBaseUrl: string | undefined) {
  const ctx = createWalkContext(bibliography, assetBaseUrl);
  const nodes = ast.content;
  const bibAt = nodes.findIndex(isBibliographyInput);
  const before = bibAt < 0 ? nodes : nodes.slice(0, bibAt);
  const after = bibAt < 0 ? [] : nodes.slice(bibAt + 1);
  const mainBody = renderFlow(before, ctx);
  const rest = renderFlow(after, ctx);
  const refs = ctx.citeOrder
    .map((key) => ctx.bibByKey.get(key))
    .filter((entry): entry is BibEntry => Boolean(entry));
  const referencesKey = headingOccurrenceKey(2, "References", ctx.headingCounts);
  return (
    <>
      {mainBody}
      <ReferencesBlock headingKey={referencesKey} refs={refs} />
      {rest}
    </>
  );
}

export function TexDocument(props: {
  source: string;
  bibliography?: BibEntry[];
  assetBaseUrl?: string;
  className?: string;
}): ReactElement {
  const { source, bibliography, assetBaseUrl, className } = props;
  const ast = useMemo(() => parseTexForDisplay(source), [source]);
  const tree = useMemo(() => {
    try {
      return renderDocument(ast, bibliography, assetBaseUrl);
    } catch {
      return <pre>{source}</pre>;
    }
  }, [ast, bibliography, assetBaseUrl, source]);

  return <div className={cn("prose-ob", className)}>{tree}</div>;
}
