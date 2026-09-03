import { FILE_SEGMENT, safeAssetPath, safeFileSegment } from "./codec";

/** OpenBarry Markdown (OBMD) <-> deliberately constrained TeX conversion.
 *
 * Editor-path converter for wiki Markdown. Not Pandoc: unknown TeX becomes
 * a raw-TeX island so a save cannot silently flatten TikZ, templates, or
 * custom environments.
 */

interface FigureSpec {
  id: string;
  path: string;
  caption: string;
  width: string;
  position: string;
  page?: number;
  span?: "column" | "page";
  alt?: string;
}

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
  source = source.replace(/\{\?\s*(notfinal|placeholder|verify|cite|citation-needed|todo)\b\s*:?\s*([^}]*)\}/gi, (_all, kind: string, body: string) => {
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

function widthToTex(value: string): string {
  const normalized = normalizeWidth(value);
  return `${Number.parseFloat(normalized) / 100}`;
}

function normalizeWidth(value: string): string {
  const parsed = Number.parseFloat(value.replace(/\\linewidth/g, "").replace("%", ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return "100%";
  return `${Math.round(parsed * 100) / 100}%`;
}

function pushBlank(out: string[]): void {
  if (out.length && out.at(-1) !== "") out.push("");
}
