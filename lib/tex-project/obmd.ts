import { FILE_SEGMENT, safeAssetPath, safeFileSegment } from "./codec";
import { tabularCellsFromTex } from "./table-ast";

/** OpenBarry Markdown (OBMD) <-> deliberately constrained TeX conversion.
 *
 * Editor-path converter for wiki/notes/slides. Not Pandoc: unknown TeX becomes
 * a raw-TeX island so a save cannot silently flatten TikZ, templates, or
 * custom environments. Pandoc is the cross-format engine; this converter stays
 * until wiki/notes fixture parity is complete.
 */

export interface FigureSpec {
  id: string;
  path: string;
  caption: string;
  width: string;
  position: string;
  page?: number;
  span?: "column" | "page";
  alt?: string;
}

const KNOWN_ENVIRONMENTS = new Set(["itemize", "enumerate", "tabular", "figure", "figure*", "center"]);
const KNOWN_COMMANDS = new Set([
  "obclaim", "obcomment", "obevidence", "obtodo", "obmarker", "obcite", "cite", "citep", "citet", "citealp", "citeauthor", "autocite", "parencite", "textcite", "ref", "label", "textbf", "emph", "textit", "texttt", "textsc", "href", "url", "includegraphics", "item", "hline", "toprule", "midrule", "bottomrule", "section", "subsection", "subsubsection", "paragraph", "subparagraph", "appendix", "begin", "end", "centering", "caption", "pm", "small", "linewidth", "textbackslash", "textasciitilde", "textasciicircum", "textbar", "textless", "textgreater",
]);

export function markdownToTex(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;
  let hasRawIsland = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      pushBlank(out);
      index += 1;
      continue;
    }

    const rawFence = /^(`{3,})\{=latex\}$/.exec(line.trim());
    if (rawFence) {
      hasRawIsland = true;
      const fence = rawFence[1]!;
      const start = ++index;
      while (index < lines.length && (lines[index] ?? "").trim() !== fence) index += 1;
      if (index >= lines.length) throw new Error("Raw TeX island is missing its closing fence.");
      out.push(...lines.slice(start, index));
      index += 1;
      pushBlank(out);
      continue;
    }

    if (line.trim() === "<!-- openbarry:appendix -->" || line.trim() === "\\appendix") {
      out.push("\\appendix");
      index += 1;
      pushBlank(out);
      continue;
    }

    const figure = parseMarkdownFigure(lines, index);
    if (figure) {
      out.push(figureToTex(figure.spec));
      index = figure.next;
      pushBlank(out);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.replace(/\s+\{#[^}]+\}\s*$/, "");
      const command = headingCommand(level);
      out.push(`\\${command}{${renderInline(title)}}`);
      index += 1;
      pushBlank(out);
      continue;
    }

    if (isTableStart(lines, index)) {
      const parsed = tableToTex(lines, index);
      out.push(parsed.tex);
      index = parsed.next;
      pushBlank(out);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      const type = bullet ? "itemize" : "enumerate";
      out.push(`\\begin{${type}}`);
      while (index < lines.length) {
        const item = (type === "itemize" ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/).exec(lines[index] ?? "");
        if (!item) break;
        out.push(`  \\item ${renderInline(item[1]!)}`);
        index += 1;
      }
      out.push(`\\end{${type}}`);
      pushBlank(out);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || /^(`{3,})\{=latex\}$/.test(next.trim()) || /^(#{1,6})\s+/.test(next) || isTableStart(lines, index) || /^\s*[-*+]\s+/.test(next) || /^\s*\d+[.)]\s+/.test(next) || parseMarkdownFigure(lines, index)) break;
      paragraph.push(next.trim());
      index += 1;
    }
    if (paragraph.length) out.push(renderInline(paragraph.join(" ")));
    pushBlank(out);
  }

  const rendered = out.join("\n");
  // Raw islands are an explicit byte-preservation escape hatch. Keep their
  // interior whitespace intact so an unknown environment such as TikZ makes
  // a lossless Markdown round trip. The envelope codec removes only the
  // separator whitespace around the editable body when it writes the file.
  return hasRawIsland ? rendered.replace(/\n+$/u, "") : rendered.replace(/\n{3,}/g, "\n\n").trim();
}

/** Convert generated/known TeX into a Markdown projection. Prose is always clean markdown, never raw code blocks. */
export function texToMarkdown(tex: string): string {
  const normalized = tex.replace(/\r\n/g, "\n");
  if (!normalized) return "";

  // Unknown TeX must remain an explicit raw island. Returning the whole body
  // as one island preserves command spelling, spacing, comments, and custom
  // environments byte-for-byte after LF normalization.
  if (containsUnsupportedTex(normalized) || containsAmbiguousGrouping(normalized)) return rawTexIsland(normalized.replace(/\n+$/u, ""));

  let source = normalized.trim();
  const figures: string[] = [];
  source = source.replace(/(?:%\s*OB-FIGURE\s+(\{[^\n]*\})\s*\n)?\\begin\{(figure\*?)\}(?:\[([^\]]*)\])?\s*([\s\S]*?)\\end\{\2\}/g, (_all, rawMeta?: string, env?: string, position?: string, body?: string) => {
    const fileMatch = /\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/.exec(body || "");
    if (!fileMatch) return _all;

    const file = fileMatch[2]!;
    const graphicOpts = fileMatch[1] || "";
    const captionArg = commandArg(body || "", "caption");
    const caption = captionArg ? texInlineToMarkdown(captionArg) : "Figure";
    const meta = rawMeta ? parseFigureMeta(rawMeta) : {};
    const width = meta.width || widthFromGraphicOpt(graphicOpts) || "100%";
    const page = /(?:^|,)\s*page=(\d+)/.exec(graphicOpts)?.[1];
    const label = commandArg(body || "", "label");
    const id = safeFileSegment(meta.id || label || file.split("/").pop()?.replace(/\.[^.]+$/, "") || "fig", "figure id");
    const path = safeAssetPath(meta.path || file);
    const alt = meta.alt ? ` alt="${escapeMarkdownAttribute(meta.alt)}"` : "";
    figures.push(`![${caption}](${path})\n{#${id} width="${normalizeWidth(width)}" fig-pos="${position || meta.position || "tbp"}"${page ? ` page="${page}"` : ""}${env === "figure*" ? ' span="page"' : ""}${alt}}`);
    return `\n\n@@OBFIGURE${figures.length - 1}@@\n\n`;
  });

  source = source.replace(/\\begin\{(itemize|enumerate)\}([\s\S]*?)\\end\{\1\}/g, (_all, env: string, body: string) => listToMarkdown(env, body));

  source = source.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_all, body: string) => tabularToMarkdown(body));
  source = source.replace(/\\(section|subsection|subsubsection|paragraph|subparagraph)\{([^}]*)\}/g, (_all, command: string, title: string) => {
    const level: Record<string, number> = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };
    return `${"#".repeat(level[command] || 2)} ${texInlineToMarkdown(title)}`;
  });
  source = source.replace(/\\appendix\b/g, "<!-- openbarry:appendix -->");

  source = texInlineToMarkdown(source);
  source = source.replace(/@@OBFIGURE(\d+)@@/g, (_all, raw: string) => figures[Number(raw)] || "");
  return source
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function figureToTex(spec: FigureSpec): string {
  const safeId = safeFileSegment(spec.id, "figure id");
  const safePath = safeAssetPath(spec.path);
  const width = widthToTex(spec.width);
  const position = /^[!htbp]+$/.test(spec.position) ? spec.position : "tbp";
  const page = spec.page && Number.isInteger(spec.page) && spec.page > 0 ? `page=${spec.page},` : "";
  const env = spec.span === "page" ? "figure*" : "figure";
  const metadata = JSON.stringify({
    alt: spec.alt || undefined,
    id: safeId,
    path: safePath,
    position,
    span: spec.span || "column",
    width: normalizeWidth(spec.width),
  });
  return [
    `% OB-FIGURE ${metadata}`,
    `\\begin{${env}}[${position}]`,
    "  \\centering",
    `  \\includegraphics[${page}width=${width}\\linewidth]{${safePath}}`,
    `  \\caption{${renderInline(spec.caption)}}`,
    `  \\label{${safeId}}`,
    `\\end{${env}}`,
  ].join("\n");
}

export function markdownFigure(id: string, path: string, caption = "Figure caption"): string {
  return `![${caption}](${safeAssetPath(path)})\n{#${safeFileSegment(id, "figure id")} width="100%" fig-pos="tbp" page="1"}`;
}

function parseMarkdownFigure(lines: string[], index: number): { spec: FigureSpec; next: number } | null {
  const image = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(lines[index] ?? "");
  if (!image) return null;
  const attrs = /^\{([^}]*)\}\s*$/.exec(lines[index + 1] ?? "");
  const values = parseAttributes(attrs?.[1] || "");
  const path = safeAssetPath(image[2]!.trim());
  const stem = path.slice("figures/".length).replace(/\.[^.]+$/, "");
  return {
    spec: {
      id: safeFileSegment(values.id || `fig-${stem}`, "figure id"),
      path,
      caption: image[1]!.trim(),
      width: values.width || "100%",
      position: values["fig-pos"] || "tbp",
      page: parseFigurePage(values.page),
      span: values.span === "page" ? "page" : "column",
      alt: values.alt,
    },
    next: attrs ? index + 2 : index + 1,
  };
}

function parseAttributes(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = new RegExp(`(?:^|\\s)(#(${FILE_SEGMENT})|([A-Za-z][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|[^\\s]+))`, "g");
  for (const match of raw.matchAll(pattern)) {
    if (match[2]) values.id = match[2];
    else if (match[3]) values[match[3]] = (match[4] || "").replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function parseFigurePage(raw?: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const page = Number(raw);
  if (!Number.isInteger(page) || page <= 0) throw new Error(`Invalid figure page: ${raw}`);
  return page;
}

function isTableStart(lines: string[], index: number): boolean {
  return /^\s*\|?.+\|.+\|?\s*$/.test(lines[index] ?? "") && /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "");
}

function tableToTex(lines: string[], index: number): { tex: string; next: number } {
  const rows: string[][] = [];
  let cursor = index;
  while (cursor < lines.length && /^\s*\|?.*\|.*\|?\s*$/.test(lines[cursor] ?? "") && (lines[cursor] ?? "").includes("|")) {
    if (cursor !== index + 1) rows.push(splitTableRow(lines[cursor] ?? ""));
    cursor += 1;
  }
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const spec = Array.from({ length: columns }, () => "l").join("|");
  const body = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, cellIndex) => renderInline(row[cellIndex] || ""));
    return `${cells.join(" & ")} \\\\${rowIndex === 0 ? " \\hline" : ""}`;
  });
  return { tex: ["\\begin{tabular}{" + spec + "}", "\\hline", ...body, "\\hline", "\\end{tabular}"].join("\n"), next: cursor };
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function tabularToMarkdown(body: string): string {
  const parsed = tabularCellsFromTex(body).map((row) => row.map((cell) => texInlineToMarkdown(cell)));
  const rows = parsed.some((row) => row.some(Boolean))
    ? parsed
    : body
      .split(/\\\\/)
      .map((row) => row.replace(/\\(?:hline|toprule|midrule|bottomrule)\b/g, "").trim())
      .filter(Boolean)
      .map((row) => splitTexTableRow(row).map(texInlineToMarkdown));
  if (!rows.length) return "";
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] || ""));
  const divider = Array.from({ length: columns }, () => "---");
  return [
    `| ${normalized[0]!.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function splitTexTableRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index]!;
    if (char === "{" && row[index - 1] !== "\\") depth += 1;
    if (char === "}" && row[index - 1] !== "\\") depth = Math.max(0, depth - 1);
    if (char === "&" && row[index - 1] !== "\\" && depth === 0) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function renderInline(input: string): string {
  const protectedParts: string[] = [];
  const protect = (value: string) => {
    const token = `\uE000${protectedParts.length}\uE001`;
    protectedParts.push(value);
    return token;
  };

  let source = input;
  // 1. Protect all LaTeX commands, inputs, macros, and environments so their backslashes and braces are never escaped
  source = source.replace(/\\(?:input|include|bibliography|bibliographystyle|appendix|pm|small|linewidth)\b(?:\{[^}]*\})?/g, (command: string) => protect(command));
  source = source.replace(/\\(?:begin|end)\{[^}]+\}(?:\[[^\]]*\])?(?:\{[^}]*\})*/g, (command: string) => protect(command));
  source = source.replace(/\\(?:obclaim|obcomment|obevidence|obtodo|obmarker|obcite|cite|citep|citet|citealp|citeauthor|autocite|parencite|textcite|ref|label|href|url|textbf|textit|emph|texttt|textsc|caption|includegraphics)(?:\[[^\]\n]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, (command: string) => protect(command));

  // 2. Protect citations in Markdown forms
  source = source.replace(/\[\$([^\]]+)\]/g, (_all, payload: string) => protect(citationToTex(payload)));
  source = source.replace(/\[@([^\]]+)\]/g, (_all, payload: string) => protect(citationToTex(payload.split(/[;,]/).map((item) => `$${item.replace(/^@/, "").trim()}`).join("; "))));
  source = source.replace(/```([^`]+)```/g, (_all, code: string) => protect(`\\texttt{${escapeTex(code)}}`));
  source = source.replace(/`([^`]+)`/g, (_all, code: string) => protect(`\\texttt{${escapeTex(code)}}`));
  source = source.replace(/\$\$([\s\S]+?)\$\$/g, (_all, math: string) => protect(`\\[${math}\\]`));
  source = source.replace(/\$([^$\n]+)\$/g, (_all, math: string) => protect(`$${math}$`));
  source = source.replace(/\{\?\s*(hypothesized|notfinal|placeholder|verify|cite|citation-needed|todo)\b\s*:?\s*([^}]*)\}/gi, (_all, kind: string, body: string) => {
    return protect(`\\obmarker{${escapeTex(kind.toLowerCase())}}{${renderInline(body.trim())}}`);
  });
  source = source.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_all, label: string, url: string) => protect(`\\href{${escapeTexUrl(url)}}{${renderInline(label)}}`));
  source = source.replace(new RegExp(`(?<![ $\\w])@(fig|sec|tbl|eq|alg|lst|app)-(${FILE_SEGMENT})`, "g"), (_all, kind: string, id: string) => protect(`\\ref{${kind}-${id}}`));

  let rendered = escapeTex(source);
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, (_all, text: string) => `\\textbf{${text}}`);
  rendered = rendered.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_all, text: string) => `\\emph{${text}}`);
  rendered = rendered.replace(/\uE000(\d+)\uE001/g, (_all, raw: string) => protectedParts[Number(raw)] || "");
  return rendered;
}

function citationToMarkdown(keys: string, locator?: string): string {
  const list = keys.split(",").map((key) => key.trim()).filter(Boolean);
  if (!list.length) throw new Error("A citation needs at least one key.");
  const inner = list.map((key) => `$${key}`).join("; ");
  return locator ? `[${inner}, ${locator}]` : `[${inner}]`;
}

function citationToTex(payload: string): string {
  const pieces = payload.split(";").map((value) => value.trim()).filter(Boolean);
  const keys: string[] = [];
  let locator = "";
  for (const piece of pieces) {
    const match = /^\$?([A-Za-z0-9:._-]+)(?:\s*,\s*(.+))?$/.exec(piece);
    if (!match) throw new Error(`Invalid citation syntax: [$${payload}]`);
    keys.push(match[1]!);
    if (match[2]) locator = match[2]!;
  }
  if (!keys.length) throw new Error("A citation needs at least one key.");
  return locator ? `\\obcite[${escapeTex(locator)}]{${keys.join(",")}}` : `\\cite{${keys.join(",")}}`;
}

function texInlineToMarkdown(value: string): string {
  let source = value;
  source = source.replace(/\\appendix\b/g, "<!-- openbarry:appendix -->");
  source = source.replace(/\\obmarker\{([^}]*)\}\{([^}]*)\}/g, (_all, kind: string, body: string) => `{?${unescapeTex(kind)}: ${unescapeTex(body)}}`);
  source = source.replace(/\\obcite\[([^\]]*)\]\{([^}]*)\}/g, (_all, locator: string, keys: string) => citationToMarkdown(keys, unescapeTex(locator)));
  source = source.replace(/\\(?:cite|citep|citet|citealp|citeauthor|autocite|parencite|textcite)\{([^}]*)\}/g, (_all, keys: string) => citationToMarkdown(keys));
  source = source.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (_all, url: string, label: string) => `[${texInlineToMarkdown(label)}](${unescapeTex(url)})`);
  source = source.replace(/\\textbf\{([^{}]*)\}/g, (_all, body: string) => `**${texInlineToMarkdown(body)}**`);
  source = source.replace(/\\(?:emph|textit)\{([^{}]*)\}/g, (_all, body: string) => `*${texInlineToMarkdown(body)}*`);
  source = source.replace(/\\texttt\{([^{}]*)\}/g, (_all, body: string) => `\`${texInlineToMarkdown(body)}\``);
  source = source.replace(/\\ref\{([^}]*)\}/g, (_all, id: string) => `@${id}`);
  source = source.replace(/\\\[([\s\S]*?)\\\]/g, (_all, math: string) => `$$${math}$$`);
  source = source.replace(/\$([^$\n]+)\$/g, (_all, math: string) => `$${math}$`);
  return unescapeTex(source);
}

function containsUnsupportedTex(source: string): boolean {
  for (const match of source.matchAll(/\\begin\{([^}]+)\}/g)) {
    if (!KNOWN_ENVIRONMENTS.has(match[1]!)) return true;
  }
  for (const match of source.matchAll(/\\([A-Za-z@]+)(?:\*?)/g)) {
    const command = match[1]!;
    if (!KNOWN_COMMANDS.has(command) && command !== "" && command !== "\\") return true;
  }
  return false;
}

function containsAmbiguousGrouping(source: string): boolean {
  let depth = 0;
  let backslashes = 0;
  for (const char of source) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    const escaped = backslashes % 2 === 1;
    backslashes = 0;
    if (char === "{" && !escaped) {
      depth += 1;
      if (depth > 1) return true;
    } else if (char === "}" && !escaped) {
      depth = Math.max(0, depth - 1);
    }
  }
  return /\\(?:[#$%&_{}]|[A-Za-z@]+)\{\}/.test(source);
}

function rawTexIsland(source: string): string {
  const longestRun = Math.max(0, ...[...source.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}{=latex}\n${source}\n${fence}`;
}

function headingCommand(level: number): string {
  return ["section", "section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"][Math.min(Math.max(level, 1), 6)]!;
}

function escapeTex(value: string): string {
  return Array.from(value, (char) => {
    switch (char) {
      case "\\": return "\\textbackslash{}";
      case "#":
      case "$":
      case "%":
      case "&":
      case "_":
      case "{":
      case "}": return `\\${char}`;
      case "~": return "\\textasciitilde{}";
      case "^": return "\\textasciicircum{}";
      case "|": return "\\textbar{}";
      case "<": return "\\textless{}";
      case ">": return "\\textgreater{}";
      default: return char;
    }
  }).join("");
}

function escapeTexUrl(value: string): string {
  return value.replace(/([%#{}])/g, "\\$1");
}

function unescapeTex(value: string): string {
  return value
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\textasciicircum\{\}/g, "^")
    .replace(/\\textbar\{\}/g, "|")
    .replace(/\\textless\{\}/g, "<")
    .replace(/\\textgreater\{\}/g, ">")
    .replace(/\\([#$%&_{}])/g, "$1");
}

function parseFigureMeta(raw: string): Partial<FigureSpec> {
  const data = JSON.parse(raw) as Partial<FigureSpec>;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("OB-FIGURE metadata must be a JSON object.");
  return data;
}

function widthFromGraphicOpt(graphicOpts: string): string | undefined {
  const raw = /(?:^|,)\s*width=([^,\]]+)/.exec(graphicOpts)?.[1];
  if (!raw) return undefined;
  if (/\\(?:line|column)width/.test(raw)) {
    const fraction = Number.parseFloat(raw);
    if (!Number.isFinite(fraction) || fraction <= 0) return undefined;
    return normalizeWidth(`${fraction * 100}%`);
  }
  return normalizeWidth(raw);
}

function commandArg(source: string, command: string): string | undefined {
  const match = new RegExp(`\\\\${command}\\s*\\{`).exec(source);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "{" && source[index - 1] !== "\\") depth += 1;
    else if (char === "}" && source[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index);
    }
  }
  return undefined;
}

function listToMarkdown(env: string, body: string): string {
  const marks = [...body.matchAll(/\\item\s*/g)];
  if (!marks.length) return `\\begin{${env}}${body}\\end{${env}}`;
  return marks.map((mark, index) => {
    const start = mark.index! + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1]!.index! : body.length;
    return `${env === "itemize" ? "-" : `${index + 1}.`} ${texInlineToMarkdown(body.slice(start, end).trim())}`;
  }).join("\n");
}

function widthToTex(value: string): string {
  const normalized = normalizeWidth(value);
  return `${Number.parseFloat(normalized) / 100}`;
}

function normalizeWidth(value: string): string {
  const parsed = Number.parseFloat(value.replace(/\\linewidth/g, "").replace("%", ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return "100%";
  return `${Math.round(parsed * 100) / 100}%`;
}

function escapeMarkdownAttribute(value: string): string {
  return value.replace(/"/g, "\\\"");
}

function pushBlank(out: string[]): void {
  if (out.length && out.at(-1) !== "") out.push("");
}
