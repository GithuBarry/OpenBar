/**
 * Convert a TeX fragment with unified-latex-to-hast. HTML strings are
 * sanitised. Interactive preview uses hast-util-to-jsx-runtime so React owns
 * the tree; OpenBarry macros become classed spans. Paper chrome (heading keys,
 * cites, bibliography placement) is attached here so editor–preview sync and
 * wiki preview share one path.
 */

import { unified } from "unified";
import { unifiedLatexToHast } from "@unified-latex/unified-latex-to-hast";
import { htmlLike } from "@unified-latex/unified-latex-util-html-like";
import { getArgsContent } from "@unified-latex/unified-latex-util-arguments";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import type { Macro, Node } from "@unified-latex/unified-latex-types";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { createElement, type ReactElement, type ReactNode } from "react";

import { headingOccurrenceKey, texHeadingLevel } from "@/features/paper/heading-keys";
import { resolveAssetUrl } from "@/lib/marker-codec";
import { formatReference, refId, type BibEntry } from "@/lib/bibtex";
import { sanitizeHtmlFragmentSync } from "@/lib/html-policy";
import { extractPreviewMacroBindings } from "./pandoc-macros";
import { inlineBundleIncludes } from "./source-bundle-format";
import { wrapComplexTablesForPreview } from "./table-fragments";
import { parseTexForDisplay } from "./tex-ast";

type HastPreviewOptions = {
  bibliography?: BibEntry[];
  assetBaseUrl?: string;
  pandocTables?: Record<string, string>;
};

type CiteState = {
  order: string[];
  num: Map<string, number>;
};

type HastElement = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
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

/**
 * unified-latex represents horizontal table rules as empty table rows. They
 * are useful to the parser but create visible blank bands in an HTML reader.
 * Keep rows with cells, including deliberately empty cells, and remove only
 * rows with no children at all.
 */
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

function HastBibliography({
  keys,
  headingKey,
  bibliography,
}: {
  keys: string[];
  headingKey: string;
  bibliography: BibEntry[];
}): ReactElement | null {
  const byKey = new Map(bibliography.map((entry) => [entry.key.toLowerCase(), entry]));
  const refs = keys
    .map((key) => byKey.get(key.toLowerCase()))
    .filter((entry): entry is BibEntry => Boolean(entry));
  if (!refs.length) return null;
  return createElement(
    "section",
    { className: "ob-references" },
    createElement("h2", {
      id: `ob-pv-h-${headingKey}`,
      "data-ob-heading-key": headingKey,
      className: "ob-pv-heading scroll-mt-6",
    }, "References"),
    createElement(
      "ol",
      { className: "ob-refs" },
      ...refs.map((entry, index) =>
        createElement(
          "li",
          { key: entry.key, id: refId(entry.key) },
          createElement("span", { className: "ob-ref-num" }, String(index + 1)),
          entry.html
            ? createElement("span", {
              className: "ob-ref-csl",
              dangerouslySetInnerHTML: { __html: entry.html },
            })
            : createElement("span", {
              className: "ob-ref-text",
              dangerouslySetInnerHTML: { __html: formatReference(entry) },
            }),
        ),
      ),
    ),
  );
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
  "label",
];

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
    const titleText = printRaw(titleNodes).trim();
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
        attributes: { className: "ob-cite", href: `#${refId(canon)}` },
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
    const path = printRaw(args[args.length - 1] || []).trim();
    const opts = printRaw(args[0] || []);
    const page = /(?:^|,)\s*page\s*=\s*(\d+)/.exec(opts)?.[1];
    const src = resolveAssetUrl(path, options.assetBaseUrl);
    const href = page && src ? `${src}#page=${page}` : src;
    if (!href) return htmlLike({ tag: "code", attributes: { className: "ob-tex-unknown" }, content: [str(printRaw(node))] });
    if (href.toLowerCase().includes(".pdf")) {
      return htmlLike({
        tag: "object",
        attributes: {
          className: "w-full max-w-2xl h-80 rounded-lg border border-line/60 bg-white",
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
    obclaim: (node: Macro) => htmlLike({ tag: "span", attributes: { className: "ob-claim-inline", title: "Claim" }, content: lastArg(node) }),
    obevidence: (node: Macro) => htmlLike({ tag: "span", attributes: { className: "ob-evidence-inline", title: "Evidence note" }, content: lastArg(node) }),
    obcomment: (node: Macro) => htmlLike({ tag: "span", attributes: { className: "ob-comment-inline", title: "Comment" }, content: lastArg(node) }),
    obtodo: (node: Macro) => htmlLike({ tag: "span", attributes: { className: "ob-todo-inline", title: "TODO" }, content: lastArg(node) }),
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
    includegraphics,
    obpandocTable: (node: Macro) => htmlLike({
      tag: "div",
      attributes: {
        className: "ob-hast-pandoc-table",
        "data-table-key": printRaw(lastArg(node)).trim(),
      },
      content: [],
    }),
    input: inputLike,
    include: inputLike,
    bibliography: inputLike,
    documentclass: () => silent(),
    usepackage: () => silent(),
    maketitle: () => silent(),
    appendix: () => silent(),
  };
  for (const [name, value] of Object.entries({
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
    pm: "±",
  })) {
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
  return source.replace(/\\begin\{document\}/g, "").replace(/\\end\{document\}/g, "");
}

function convertTree(source: string, options: HastPreviewOptions = {}) {
  const cites: CiteState = { order: [], num: new Map() };
  const headingCounts = new Map<string, number>();
  const previewSource = wrapComplexTablesForPreview(inlineBundleIncludes(source), options.pandocTables);
  const tree = parseTexForDisplay(unwrapDocumentEnv(previewSource));
  const processor = unified().use(unifiedLatexToHast, {
    macroReplacements: buildReplacements(options, cites, headingCounts, previewSource),
  });
  const hast = processor.runSync(tree);
  pruneEmptyTableRows(hast);
  const headingKey = headingOccurrenceKey(2, "References", headingCounts);
  patchBibliographyPlaceholders(hast, cites.order, headingKey);
  return { hast, cites, headingKey };
}

function bibliographyComponent(options: HastPreviewOptions, headingKey: string) {
  return function HastBibDiv(props: Record<string, unknown>): ReactNode {
    const className = Array.isArray(props.className) ? props.className.join(" ") : String(props.className || "");
    if (className.includes("ob-hast-bib")) {
      const keys = String(props["data-cite-keys"] || props.dataCiteKeys || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      return createElement(HastBibliography, {
        keys,
        headingKey: String(props["data-ob-heading-key"] || props.dataObHeadingKey || headingKey),
        bibliography: options.bibliography || [],
      });
    }
    return createElement("div", props);
  };
}

function previewDivComponent(options: HastPreviewOptions, headingKey: string) {
  const bib = bibliographyComponent(options, headingKey);
  return function HastPreviewDiv(props: Record<string, unknown>): ReactNode {
    const className = Array.isArray(props.className) ? props.className.join(" ") : String(props.className || "");
    if (className.includes("ob-hast-pandoc-table")) {
      const key = String(props["data-table-key"] || props.dataTableKey || "");
      const html = options.pandocTables?.[key];
      if (html) {
        return createElement("div", {
          className: "ob-hast-pandoc-table overflow-x-auto",
          dangerouslySetInnerHTML: { __html: sanitizeHtmlFragmentSync(html) },
        });
      }
    }
    return bib(props);
  };
}

export function texFragmentPreview(source: string, options: HastPreviewOptions = {}): {
  tree: ReactElement | null;
  headingKeys: string[];
} {
  try {
    const { hast, headingKey } = convertTree(source, options);
    const headingKeys: string[] = [];
    walkHast(hast, (element) => {
      const key = attr(element, "data-ob-heading-key");
      if (key && classOf(element).includes("ob-pv-heading")) headingKeys.push(key);
    });
    const tree = toJsxRuntime(hast as never, {
      Fragment,
      jsx,
      jsxs,
      components: {
        div: previewDivComponent(options, headingKey) as never,
      },
    });
    return { tree, headingKeys };
  } catch {
    return { tree: null, headingKeys: [] };
  }
}
