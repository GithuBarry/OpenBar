/**
 * Single TeX → HTML preview pipeline. Runs in a worker: no React, no DOMPurify.
 * Unknown or malformed regions become source blocks instead of a second engine.
 */

import { unified } from "unified";
import { unifiedLatexToHast } from "@unified-latex/unified-latex-to-hast";
import { htmlLike } from "@unified-latex/unified-latex-util-html-like";
import { getArgsContent } from "@unified-latex/unified-latex-util-arguments";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import type { Macro, Node } from "@unified-latex/unified-latex-types";
import { toHtml } from "hast-util-to-html";
import katex from "katex";

import { headingOccurrenceKey, texHeadingLevel } from "@/features/paper/heading-keys";
import { commentKindAppearance } from "@/lib/comment-kinds";
import { parseAnchorAttrs } from "@/lib/marker-codec";
import { todoIsComplete } from "@/lib/todo-meta";
import { resolveAssetUrl } from "@/lib/marker-codec";
import { formatReference, refId, type BibEntry } from "@/lib/bibtex";
import { extractPreviewMacroBindings } from "./pandoc-macros";
import { inlineBundleIncludesMapped } from "./source-bundle-format";
import { parseTexForDisplay, type TexRoot } from "./tex-ast";
import { headingInvocation } from "./section-ranges";
import { maskTexLiterals } from "./tex-literals";

export type PreviewBlock =
  | {
    key: string;
    hash: string;
    kind: "html" | "source";
    html: string;
    headingKey?: string;
    sourceFrom?: number;
    sourceTo?: number;
    diagnostic?: string;
  }
  | {
    key: string;
    hash: string;
    kind: "figure";
    src: string;
    page?: number;
    caption?: string;
    headingKey?: string;
    sourceFrom?: number;
    sourceTo?: number;
  };

export type PreviewResult = {
  blocks: PreviewBlock[];
  headingKeys: string[];
  diagnostics: Array<{ severity: "error" | "warning" | "info"; message: string }>;
};

export type PreviewHtmlOptions = {
  bibliography?: BibEntry[];
  assetBaseUrl?: string;
};

type HastPreviewOptions = PreviewHtmlOptions;

type CiteState = {
  order: string[];
  num: Map<string, number>;
};

type HastElement = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
  value?: string;
};

function argNodes(node: Macro, index: number): Node[] {
  return getArgsContent(node)[index] || [];
}

function lastArg(node: Macro): Node[] {
  const args = getArgsContent(node);
  return args[args.length - 1] || [];
}

function str(content: string): Node {
  return { type: "string", content } as Node;
}

function silent(): Node {
  return htmlLike({ tag: "span", attributes: { className: "ob-tex-silent" }, content: [] });
}

function texLabelId(label: string): string {
  return `ob-tex-label-${encodeURIComponent(label.trim())}`;
}

function citeKeys(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((key) => key.trim().replace(/^[@$]/, ""))
    .filter(Boolean);
}

function isBibliographyPath(raw: string): boolean {
  const path = raw.replace(/\.tex$/i, "").replace(/\\/g, "/").trim();
  return /(^|\/)references$/.test(path);
}

function walkHast(node: unknown, visit: (element: HastElement) => void): void {
  if (!node || typeof node !== "object") return;
  const element = node as HastElement;
  if (element.type === "element") visit(element);
  if (Array.isArray(element.children)) {
    for (const child of element.children) walkHast(child, visit);
  }
}

function pruneEmptyTableRows(node: unknown, insideTable = false): void {
  if (!node || typeof node !== "object") return;
  const element = node as HastElement;
  const inTable = insideTable || element.tagName === "table";
  if (!Array.isArray(element.children)) return;
  if (inTable) {
    element.children = element.children.filter((child) => {
      const row = child as HastElement;
      return row?.tagName !== "tr" || Boolean(row.children?.length);
    });
  }
  for (const child of element.children) pruneEmptyTableRows(child, inTable);
}

/** Promote TeX spanning-cell metadata onto the containing HTML table cells. */
function hydrateTableSpans(hast: unknown): void {
  walkHast(hast, table => {
    if (table.tagName !== "table") return;
    const rows: HastElement[] = [];
    for (const child of table.children || []) {
      const element = child as HastElement;
      if (element.tagName === "tr") rows.push(element);
      else if (["thead", "tbody", "tfoot"].includes(element.tagName || "")) {
        rows.push(...(element.children || []).filter(row => (row as HastElement).tagName === "tr") as HastElement[]);
      }
    }
    const occupiedUntil = new Map<number, number>();
    rows.forEach((row, rowIndex) => {
      let column = 0;
      row.children = (row.children || []).filter(child => {
        const cell = child as HastElement;
        if (cell.tagName !== "td" && cell.tagName !== "th") return true;
        // TeX retains an empty & placeholder under a multirow cell.
        if ((occupiedUntil.get(column) || 0) > rowIndex && emptyTablePlaceholder(cell)) {
          column += 1;
          return false;
        }
        let rowSpan = 1;
        let colSpan = 1;
        walkHast(cell, element => {
          const rows = Number(attr(element, "data-ob-rowspan"));
          const columns = Number(attr(element, "data-ob-colspan"));
          if (Number.isInteger(rows) && rows > 1) rowSpan = Math.min(rows, 1000);
          if (Number.isInteger(columns) && columns > 1) colSpan = Math.min(columns, 1000);
        });
        if (rowSpan > 1) {
          rowSpan = Math.min(rowSpan, rows.length - rowIndex);
          cell.properties = { ...cell.properties, rowSpan };
          for (let offset = 0; offset < colSpan; offset += 1) occupiedUntil.set(column + offset, rowIndex + rowSpan);
        }
        if (colSpan > 1) cell.properties = { ...cell.properties, colSpan };
        column += colSpan;
        return true;
      });
    });
  });
}

function emptyTablePlaceholder(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const element = node as HastElement;
  if (element.type === "text") return !element.value?.trim();
  if (element.type === "comment") return true;
  if (element.type !== "element") return false;
  if (element.tagName !== "td" && element.tagName !== "th"
    && (element.tagName !== "span" || classOf(element) !== "ob-tex-silent")) return false;
  return (element.children || []).every(emptyTablePlaceholder);
}

function attr(element: HastElement, name: string): string {
  const props = element.properties || {};
  const camel = name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  const value = props[name] ?? props[camel];
  return value == null ? "" : String(value);
}

function classOf(element: HastElement): string {
  const value = element.properties?.className;
  if (Array.isArray(value)) return value.map(String).join(" ");
  return String(value || "");
}

function patchBibliographyPlaceholders(hast: unknown, keys: string[], headingKey: string): void {
  let found = false;
  walkHast(hast, (element) => {
    if (!classOf(element).includes("ob-hast-bib")) return;
    found = true;
    element.properties = {
      ...element.properties,
      className: "ob-hast-bib",
      dataCiteKeys: keys.join(","),
      dataObHeadingKey: headingKey,
    };
  });
  if (found || keys.length === 0) return;
  const root = hast as HastElement;
  if (!Array.isArray(root.children)) return;
  root.children.push({
    type: "element",
    tagName: "div",
    properties: {
      className: "ob-hast-bib",
      dataCiteKeys: keys.join(","),
      dataObHeadingKey: headingKey,
    },
    children: [],
  });
}

const SILENT_HAST_MACROS = [
  "newcommand",
  "renewcommand",
  "providecommand",
  "date",
  "xspace",
  "newline",
  "author",
  "pagestyle",
  "thispagestyle",
  "tableofcontents",
  "newpage",
  "clearpage",
  "noindent",
  "centering",
  "vspace",
  "hspace",
  "smallskip",
  "medskip",
  "bigskip",
  "setlength",
  "geometry",
  "hypersetup",
  "makeatletter",
  "makeatother",
  "bibliographystyle",
  "label",
  "PassOptionsToPackage",
  "RequirePackage",
  "addlinespace",
  "bottomrule",
  "cline",
  "cmidrule",
  "hline",
  "midrule",
  "toprule",
];

const TEXT_MACRO_VALUES = {
  "%": "%",
  "&": "&",
  "$": "$",
  "#": "#",
  "_": "_",
  "{": "{",
  "}": "}",
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "<",
  textgreater: ">",
  ldots: "…",
  dots: "…",
  pm: "±",
  checkmark: "✓",
  times: "×",
  dagger: "†",
  ddagger: "‡",
} as const;

function buildReplacements(
  options: HastPreviewOptions,
  cites: CiteState,
  headingCounts: Map<string, number>,
  previewSource: string,
) {
  const bibliography = options.bibliography || [];
  const bibByKey = new Map(bibliography.map((entry) => [entry.key.toLowerCase(), entry]));

  const heading = (command: string) => (node: Macro) => {
    const titleNodes = lastArg(node);
    // Child macros have already become HTML by this stage. Navigation uses
    // the original heading argument shared with the source editor.
    const offset = node.position?.start.offset;
    const invocation = typeof offset === "number" ? headingInvocation(previewSource, offset) : null;
    const titleText = invocation
      ? previewSource.slice(invocation.titleFrom, invocation.titleTo).trim()
      : printRaw(titleNodes).trim();
    const level = texHeadingLevel(command);
    if (command === "title") {
      return htmlLike({
        tag: "h1",
        attributes: { className: "ob-pv-title scroll-mt-6" },
        content: titleNodes,
      });
    }
    const headingKey = headingOccurrenceKey(level, titleText, headingCounts);
    return htmlLike({
      tag: `h${Math.min(6, Math.max(1, level))}`,
      attributes: {
        id: `ob-pv-h-${headingKey}`,
        className: "ob-pv-heading scroll-mt-6",
        "data-ob-heading-key": headingKey,
      },
      content: titleNodes,
    });
  };

  const cite = (node: Macro) => {
    const keys = citeKeys(printRaw(lastArg(node)));
    const chips: Node[] = [];
    for (const key of keys) {
      const canon = key.toLowerCase();
      if (!bibByKey.has(canon) && bibliography.length) {
        chips.push(htmlLike({
          tag: "span",
          attributes: { className: "ob-cite-missing", title: `unknown key: ${key}` },
          content: [str("?")],
        }));
        continue;
      }
      let num = cites.num.get(canon);
      if (!num) {
        cites.order.push(canon);
        num = cites.order.length;
        cites.num.set(canon, num);
      }
      chips.push(htmlLike({
        tag: "a",
        attributes: { className: "ob-cite", href: `#${refId(canon)}`, "data-cite-key": bibByKey.get(canon)?.key || key, "aria-label": `Reference ${num}: ${bibByKey.get(canon)?.fields.title || key}` },
        content: [htmlLike({
          tag: "span",
          attributes: { className: "ob-cite-num" },
          content: [str(String(num))],
        })],
      }));
    }
    return htmlLike({ tag: "span", attributes: { className: "ob-cite-group" }, content: chips });
  };

  const includegraphics = (node: Macro) => {
    const args = getArgsContent(node);
    const imagePath = printRaw(args[args.length - 1] || []).trim();
    const optionArg = node.args?.find((arg) => arg.openMark === "[");
    const opts = optionArg ? printRaw(optionArg.content) : "";
    const page = /(?:^|,)\s*page\s*=\s*(\d+)/.exec(opts)?.[1];
    const src = resolveAssetUrl(imagePath, options.assetBaseUrl);
    const href = page && src ? `${src}#page=${page}` : src;
    if (!href) {
      return htmlLike({
        tag: "code",
        attributes: { className: "ob-tex-unknown" },
        content: [str(printRaw(node))],
      });
    }
    if (href.toLowerCase().includes(".pdf")) {
      return htmlLike({
        tag: "object",
        attributes: {
          className: "pointer-events-none h-80 w-full max-w-2xl rounded-lg border border-line/60 bg-white",
          data: href,
          type: "application/pdf",
        },
        content: [],
      });
    }
    const svg = /\.svg($|[?#])/i.test(href);
    return htmlLike({
      tag: "img",
      attributes: {
        src: href,
        alt: "",
        className: svg
          ? "ob-isolated-svg max-h-[500px] w-auto max-w-full rounded-lg object-contain"
          : "max-h-[500px] w-auto max-w-full rounded-lg object-contain",
        referrerpolicy: "no-referrer",
        loading: "lazy",
      },
      content: [],
    });
  };

  const inputLike = (node: Macro) => {
    const raw = printRaw(lastArg(node));
    if (isBibliographyPath(raw)) {
      return htmlLike({
        tag: "div",
        attributes: { className: "ob-hast-bib" },
        content: [],
      });
    }
    return silent();
  };

  const replacements: Record<string, (node: Macro) => Node> = {
    obclaim: (node: Macro) => htmlLike({ tag: "span", attributes: {
      className: "ob-claim-inline", tabIndex: "0", role: "button", "aria-haspopup": "dialog",
      "data-ob-annotation": "Claim", "data-annotation-source": printRaw(node),
    }, content: lastArg(node) }),
    obevidence: (node: Macro) => htmlLike({ tag: "span", attributes: { className: "ob-evidence-inline" }, content: lastArg(node) }),
    obcomment: (node: Macro) => {
      const kind = parseAnchorAttrs(printRaw(argNodes(node, 0))).kind;
      const appearance = commentKindAppearance(kind);
      return htmlLike({ tag: "span", attributes: {
        className: `ob-comment-inline ob-comment-tone-${appearance.tone}`,
        tabIndex: "0", role: "button", "aria-haspopup": "dialog",
        "data-ob-annotation": appearance.label, "data-annotation-source": printRaw(node),
        "data-comment-kind": appearance.label,
      }, content: lastArg(node) });
    },
    obtodo: (node: Macro) => {
      const attrs = parseAnchorAttrs(printRaw(argNodes(node, 0)));
      const completed = todoIsComplete(attrs);
      return htmlLike({ tag: "span", attributes: {
        className: "ob-todo-inline", "data-completed": String(completed),
      }, content: [
        htmlLike({ tag: "input", attributes: {
          type: "checkbox", className: "ob-todo-checkbox", "data-ob-todo-id": attrs.id || "",
          "aria-label": `TODO completed${attrs.title ? `: ${attrs.title}` : ""}`,
          disabled: "disabled", ...(completed ? { checked: "checked" } : {}),
        }, content: [] }),
        htmlLike({ tag: "span", attributes: { className: "ob-todo-text" }, content: lastArg(node) }),
      ] });
    },
    obmarker: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { className: `ob-marker-${printRaw(argNodes(node, 0)).replace(/[^a-z0-9-]/gi, "") || "note"}` },
      content: lastArg(node),
    }),
    title: heading("title"),
    section: heading("section"),
    subsection: heading("subsection"),
    subsubsection: heading("subsubsection"),
    paragraph: heading("paragraph"),
    subparagraph: heading("subparagraph"),
    cite,
    citep: cite,
    citet: cite,
    citealp: cite,
    citeauthor: cite,
    autocite: cite,
    parencite: cite,
    textcite: cite,
    obcite: cite,
    label: (node: Macro) => htmlLike({
      tag: "span", attributes: { id: texLabelId(printRaw(lastArg(node))) }, content: [],
    }),
    ...Object.fromEntries(["ref", "eqref"].map(command => [command, (node: Macro) => {
      const label = printRaw(lastArg(node)).trim();
      return htmlLike({ tag: "a", attributes: {
        className: "ob-tex-ref", href: `#${texLabelId(label)}`,
        "data-tex-reference": label, "data-tex-reference-command": command,
      }, content: [str(label)] });
    }])),
    includegraphics,
    input: inputLike,
    include: inputLike,
    bibliography: inputLike,
    bibliographystyle: () => silent(),
    caption: (node: Macro) => htmlLike({
      tag: "div",
      attributes: { className: "ob-tex-caption" },
      content: lastArg(node),
    }),
    footnote: (node: Macro) => htmlLike({
      tag: "small",
      attributes: { className: "ob-tex-footnote" },
      content: [str(" ("), ...lastArg(node), str(")")],
    }),
    ...Object.fromEntries(["fbox", "fcolorbox"].map(command => [command, (node: Macro) => htmlLike({
      tag: "span",
      attributes: { className: "ob-tex-box inline-block max-w-full border border-line px-3 py-2" },
      content: lastArg(node),
    })])),
    parbox: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { className: "ob-tex-parbox" },
      content: lastArg(node),
    }),
    documentclass: () => silent(),
    usepackage: () => silent(),
    maketitle: () => silent(),
    appendix: () => silent(),
    shortstack: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { className: "ob-tex-shortstack" },
      content: lastArg(node),
    }),
    multirow: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { "data-ob-rowspan": printRaw(node.args?.find(arg => arg.openMark === "{")?.content || []) },
      content: lastArg(node),
    }),
    multicolumn: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { "data-ob-colspan": printRaw(argNodes(node, 0)) },
      content: lastArg(node),
    }),
    textsc: (node: Macro) => htmlLike({
      tag: "span",
      attributes: { className: "ob-tex-small-caps" },
      content: lastArg(node),
    }),
  };
  for (const [name, value] of Object.entries(TEXT_MACRO_VALUES)) {
    replacements[name] = () => str(value);
  }
  for (const name of SILENT_HAST_MACROS) {
    if (!replacements[name]) replacements[name] = () => silent();
  }
  for (const binding of extractPreviewMacroBindings(previewSource)) {
    if (replacements[binding.name]) continue;
    if (binding.kind === "text") {
      replacements[binding.name] = () => str(binding.text);
    } else {
      replacements[binding.name] = (node: Macro) => htmlLike({
        tag: "span",
        attributes: { className: "ob-tex-macro-expand" },
        content: lastArg(node),
      });
    }
  }
  return replacements;
}

function unwrapDocumentEnv(source: string): string {
  const begin = /\\begin\s*\{\s*document\s*\}/.exec(source);
  if (!begin) return source;
  const bodyStart = begin.index + begin[0].length;
  const endPattern = /\\end\s*\{\s*document\s*\}/g;
  endPattern.lastIndex = bodyStart;
  const end = endPattern.exec(source);
  return source.slice(bodyStart, end?.index ?? source.length);
}

function bodyTreeForPreview(source: string): TexRoot {
  const full = parseTexForDisplay(source);
  const document = full.content.find((node) => (
    node.type === "environment"
    && node.env === "document"
    && Array.isArray(node.content)
  ));
  if (!document || document.type !== "environment") {
    return parseTexForDisplay(unwrapDocumentEnv(source));
  }
  const title = full.content.find((node) => node.type === "macro" && node.content === "title");
  return {
    type: "root",
    content: title ? [title, ...document.content] : document.content,
  } as TexRoot;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const element = node as HastElement;
  if (typeof element.value === "string") return element.value;
  if (!Array.isArray(element.children)) return "";
  return element.children.map(textOf).join("");
}

function renderMath(source: string, display: boolean): string {
  try {
    return katex.renderToString(source, {
      displayMode: display,
      throwOnError: false,
      macros: { "\\label": { tokens: [], numArgs: 1 } },
    });
  } catch {
    return source;
  }
}

function hydrateMathAndBibliography(hast: unknown, options: HastPreviewOptions, headingKey: string): void {
  const equationLabels = new Map<string, string>();
  let equationNumber = 0;
  walkHast(hast, (element) => {
    const classes = classOf(element).split(/\s+/);
    if (classes.includes("inline-math")) {
      const html = renderMath(textOf(element), false);
      element.children = [{ type: "raw", value: html }];
      element.properties = { ...element.properties, className: `${classOf(element)} ob-rendered-math`.trim() };
    }
    if (classes.includes("display-math")) {
      const source = textOf(element);
      const html = renderMath(source, true);
      const labels = [...source.matchAll(/\\label\s*\{([^{}]+)\}/g)].map(match => match[1]!.trim());
      const automaticNumbers = [...html.matchAll(/class="eqn-num"/g)].length;
      const explicitTag = /\\tag\*?\s*\{([^{}]+)\}/.exec(source)?.[1];
      // KaTeX's automatic numbers use a document-wide CSS counter. A single
      // numbered display has an unambiguous label-to-number association.
      const number = explicitTag || (automaticNumbers === 1 ? String(equationNumber + 1) : undefined);
      equationNumber += automaticNumbers;
      if (number) for (const label of labels) equationLabels.set(label, number);
      element.children = [
        ...labels.map(label => ({ type: "element", tagName: "span", properties: { id: texLabelId(label) }, children: [] })),
        { type: "raw", value: html },
      ];
      element.properties = { ...element.properties, className: `${classOf(element)} ob-rendered-math`.trim() };
    }
    if (classes.includes("ob-hast-bib")) {
      const keys = String(element.properties?.dataCiteKeys || attr(element, "data-cite-keys") || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      const html = bibliographyHtml(keys, headingKey, options.bibliography || []);
      element.tagName = "div";
      element.children = html ? [{ type: "raw", value: html }] : [];
    }
  });
  walkHast(hast, element => {
    const label = attr(element, "data-tex-reference");
    const number = equationLabels.get(label);
    if (!number) return;
    const text = attr(element, "data-tex-reference-command") === "eqref" ? `(${number})` : number;
    element.children = [{ type: "text", value: text }];
  });
}

function bibliographyHtml(keys: string[], headingKey: string, bibliography: BibEntry[]): string {
  const byKey = new Map(bibliography.map((entry) => [entry.key.toLowerCase(), entry]));
  const refs = keys.map((key) => byKey.get(key.toLowerCase())).filter((entry): entry is BibEntry => Boolean(entry));
  if (!refs.length) return "";
  const items = refs.map((entry, index) => {
    const inner = entry.html || formatReference(entry);
    return `<li id="${refId(entry.key)}"><span class="ob-ref-num">${index + 1}</span><span class="ob-ref-csl">${inner}</span></li>`;
  }).join("");
  return `<section class="ob-references"><h2 id="ob-pv-h-${headingKey}" data-ob-heading-key="${headingKey}" class="ob-pv-heading scroll-mt-6">References</h2><ol class="ob-refs">${items}</ol></section>`;
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function serializeRoot(children: unknown[]): string {
  return toHtml({ type: "root", children } as never, { allowDangerousHtml: true });
}

function pdfFigureFromHast(node: unknown): { src: string; page?: number } | null {
  if (!node || typeof node !== "object") return null;
  const element = node as HastElement;
  if (element.type !== "element" || element.tagName !== "object") return null;
  if (attr(element, "type").toLowerCase() !== "application/pdf") return null;
  const data = attr(element, "data");
  if (!data || !/^\/(?:api|_next)\//.test(data)) return null;
  const pageMatch = /[#&]page=(\d+)/i.exec(data);
  const src = data.replace(/[#&]page=\d+/i, "");
  return { src, ...(pageMatch ? { page: Number(pageMatch[1]) } : {}) };
}

/** Collect every PDF panel in document order. */
function nestedPdfFiguresFromHast(node: unknown): Array<{ src: string; page?: number }> {
  const direct = pdfFigureFromHast(node);
  if (direct) return [direct];
  const children = node && typeof node === "object" ? (node as HastElement).children : undefined;
  return children?.flatMap(nestedPdfFiguresFromHast) || [];
}

/** Clone a HAST subtree while removing the structured PDF object. */
function withoutPdfObjects(node: unknown): unknown | null {
  if (!node || typeof node !== "object") return node;
  if (pdfFigureFromHast(node)) return null;
  const element = node as HastElement;
  if (!Array.isArray(element.children)) return node;
  const children = element.children
    .map((child) => withoutPdfObjects(child))
    .filter((child): child is unknown => child !== null);
  return { ...element, children };
}

function blocksFromHast(hast: unknown): { blocks: PreviewBlock[]; headingKeys: string[] } {
  const root = hast as HastElement;
  const children = Array.isArray(root.children) ? root.children : [];
  const headingKeys: string[] = [];
  const groups: Array<
    | { kind: "html"; key: string; headingKey?: string; nodes: unknown[] }
    | { kind: "figure"; key: string; src: string; page?: number; caption?: string }
  > = [];
  let current: { key: string; headingKey?: string; nodes: unknown[] } = { key: "preamble", nodes: [] };
  const flush = () => {
    if (current.nodes.length) groups.push({ kind: "html", ...current });
    current = { key: `block-${groups.length}`, nodes: [] };
  };
  for (const child of children) {
    const figure = pdfFigureFromHast(child);
    if (figure) {
      flush();
      groups.push({ kind: "figure", key: `figure-${groups.length}`, ...figure });
      continue;
    }
    const nestedFigures = nestedPdfFiguresFromHast(child);
    if (nestedFigures.length) {
      flush();
      const remainder = withoutPdfObjects(child);
      const caption = remainder ? serializeRoot([remainder]) : "";
      nestedFigures.forEach((panel, index) => groups.push({
        kind: "figure",
        key: `figure-${groups.length}`,
        ...panel,
        ...(index === nestedFigures.length - 1 && caption.trim() ? { caption } : {}),
      }));
      continue;
    }
    const element = child as HastElement;
    const headingKey = element.type === "element" && classOf(element).includes("ob-pv-heading")
      ? attr(element, "data-ob-heading-key")
      : "";
    if (headingKey) {
      headingKeys.push(headingKey);
      flush();
      current = { key: headingKey, headingKey, nodes: [child] };
    } else {
      current.nodes.push(child);
    }
  }
  if (current.nodes.length || groups.length === 0) flush();
  const blocks = groups.map((group, index): PreviewBlock => {
    if (group.kind === "figure") {
      return {
        key: group.key || `figure-${index}`,
        hash: fnv1a(`${group.src}#${group.page || 1}#${group.caption || ""}`),
        kind: "figure",
        src: group.src,
        ...(group.page ? { page: group.page } : {}),
        ...(group.caption ? { caption: group.caption } : {}),
      };
    }
    const html = serializeRoot(group.nodes);
    return {
      key: group.key || `block-${index}`,
      hash: fnv1a(html),
      kind: "html" as const,
      html,
      ...(group.headingKey ? { headingKey: group.headingKey } : {}),
    };
  });
  return { blocks, headingKeys };
}

function attachSourceRanges(
  source: string,
  blocks: PreviewBlock[],
  mapOffset: (offset: number) => number = (offset) => offset,
  mapFilePath?: (offset: number) => string | undefined,
): PreviewBlock[] {
  const visible = maskTexLiterals(source);
  const headings = [...visible.matchAll(/\\(section|subsection|subsubsection|paragraph|subparagraph)\*?(?![A-Za-z])/g)]
    .flatMap((match) => {
      const from = match.index ?? 0;
      const invocation = headingInvocation(visible, from);
      return invocation ? [{
        from, command: match[1]!, title: source.slice(invocation.titleFrom, invocation.titleTo),
      }] : [];
    });
  const counts = new Map<string, number>();
  const ranges = headings.map((heading, index) => ({
    key: headingOccurrenceKey(texHeadingLevel(heading.command), heading.title, counts),
    from: heading.from,
    to: headings[index + 1]?.from ?? source.length,
  }));
  let current = { from: mapOffset(0), to: mapOffset(ranges[0]?.from ?? source.length) };
  const mappedRange = (from: number, to: number): { from: number; to: number } => {
    const mappedFrom = mapOffset(from);
    if (!mapFilePath || to <= from) return { from: mappedFrom, to: mapOffset(to) };
    const owner = mapFilePath(from);
    if (!owner) return { from: mappedFrom, to: mapOffset(to) };

    // Inlined content can make mapOffset non-monotonic: a child file is
    // stored after the root in the bundle even though it renders before a
    // later root heading. End the range at the last character owned by the
    // heading's file, rather than spanning the intervening bundled files.
    let cursor = Math.min(source.length, to) - 1;
    while (cursor >= from && mapFilePath(cursor) !== owner) cursor -= 1;
    if (cursor < from) return { from: mappedFrom, to: mappedFrom };
    return { from: mappedFrom, to: Math.max(mappedFrom, mapOffset(cursor) + 1) };
  };
  return blocks.map((block) => {
    const range = block.headingKey ? ranges.find((item) => item.key === block.headingKey) : undefined;
    if (range) {
      current = mappedRange(range.from, range.to);
    }
    return { ...block, sourceFrom: current.from, sourceTo: current.to };
  });
}

function sourceFallback(source: string, diagnostic: string, from = 0, to = source.length, key = "source"): PreviewResult {
  return {
    blocks: [{
      key,
      hash: fnv1a(source),
      kind: "source",
      html: source,
      sourceFrom: from,
      sourceTo: to,
      diagnostic,
    }],
    headingKeys: [],
    diagnostics: [{ severity: "error", message: diagnostic }],
  };
}

function recoverPreviewBySection(source: string, options: PreviewHtmlOptions, diagnostic: string): PreviewResult {
  const starts = [...source.matchAll(/^[ \t]*\\(?:section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\s|\{)/gm)]
    .map((match) => match.index ?? 0)
    .filter((index, position, values) => position === 0 || index !== values[position - 1]);
  if (starts.length === 0) return sourceFallback(source, diagnostic);
  const boundaries = [0, ...starts.filter((index) => index > 0), source.length];
  const cites: CiteState = { order: [], num: new Map() };
  const headingCounts = new Map<string, number>();
  const blocks: PreviewBlock[] = [];
  const headingKeys: string[] = [];
  const diagnostics: PreviewResult["diagnostics"] = [{ severity: "error", message: diagnostic }];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    const fragment = source.slice(from, to);
    if (!fragment.trim()) continue;
    try {
      const tree = bodyTreeForPreview(fragment);
      const processor = unified().use(unifiedLatexToHast, {
        macroReplacements: buildReplacements(options, cites, headingCounts, fragment),
      });
      const hast = processor.runSync(tree);
      pruneEmptyTableRows(hast);
      hydrateTableSpans(hast);
      const rendered = blocksFromHast(hast);
      for (const block of rendered.blocks) {
        blocks.push({ ...block, key: `${block.key}-${index}`, sourceFrom: from, sourceTo: to });
      }
      headingKeys.push(...rendered.headingKeys);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TeX preview failed for this section.";
      diagnostics.push({ severity: "error", message: `Source ${from}–${to}: ${message}` });
      blocks.push({
        key: `source-${index}`,
        hash: fnv1a(fragment),
        kind: "source",
        html: fragment,
        sourceFrom: from,
        sourceTo: to,
        diagnostic: message,
      });
    }
  }
  if (!blocks.length) return sourceFallback(source, diagnostic);
  return { blocks, headingKeys, diagnostics };
}

export function renderPreviewDocument(source: string, options: PreviewHtmlOptions = {}): PreviewResult {
  try {
    const cites: CiteState = { order: [], num: new Map() };
    const headingCounts = new Map<string, number>();
    const inlined = inlineBundleIncludesMapped(source);
    const previewSource = inlined.source;
    const tree = bodyTreeForPreview(previewSource);
    const processor = unified().use(unifiedLatexToHast, {
      macroReplacements: buildReplacements(options, cites, headingCounts, previewSource),
    });
    const hast = processor.runSync(tree);
    pruneEmptyTableRows(hast);
    hydrateTableSpans(hast);
    const headingKey = headingOccurrenceKey(2, "References", headingCounts);
    patchBibliographyPlaceholders(hast, cites.order, headingKey);
    hydrateMathAndBibliography(hast, options, headingKey);
    const rendered = blocksFromHast(hast);
    return {
      blocks: attachSourceRanges(previewSource, rendered.blocks, inlined.mapOffset, inlined.mapFilePath),
      headingKeys: rendered.headingKeys,
      diagnostics: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TeX preview failed.";
    return recoverPreviewBySection(source, options, message);
  }
}
