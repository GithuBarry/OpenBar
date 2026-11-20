/**
 * Pandoc's latex_macros reader cannot expand optional-arg `\providecommand`
 * bodies that contain `#1` / `\if` / `\detokenize`. Collect a Pandoc-safe
 * header from OpenBar macros plus simple `\newcommand` replacements.
 */

const OPENBAR_PANDOC_MACROS = [
  "\\providecommand{\\xspace}{}",
  "\\providecommand{\\obcite}[1]{\\cite{#1}}",
  "\\providecommand{\\obclaim}[1]{#1}",
  "\\providecommand{\\obevidence}[1]{#1}",
  "\\providecommand{\\obcomment}[1]{}",
  "\\providecommand{\\obtodo}[1]{}",
  "\\providecommand{\\obmarker}[2]{\\textit{[#1: #2]}}",
].join("\n");

function consumeGroup(source: string, openBrace: number): { body: string; end: number } | null {
  if (source[openBrace] !== "{") return null;
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\" && i + 1 < source.length) {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(openBrace + 1, i), end: i + 1 };
    }
  }
  return null;
}

function skipSpace(source: string, index: number): number {
  let i = index;
  while (i < source.length && /[ \t\r\n]/.test(source[i]!)) i += 1;
  return i;
}

function simplifyMacroBody(body: string): string {
  return body
    .replace(/\\xspace\b/g, "")
    .replace(/\\(?:textsc|textrm|textsf|textit|textbf|emph)\{([^{}]+)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull `\newcommand{\name}{body}` forms whose bodies have no parameter tokens
 * and no TeX conditionals. Nested one-level font commands are flattened so
 * Pandoc can expand `\local` to `LocalAgent`.
 */
export function extractSimpleNewcommands(source: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\\(?:re)?newcommand\*?\{(\\[A-Za-z]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1]!;
    if (seen.has(name) || name === "\\obcite" || name === "\\obclaim" || name === "\\obtodo") continue;
    let i = skipSpace(source, match.index + match[0].length);
    if (source[i] === "[") continue;
    const group = consumeGroup(source, i);
    if (!group) continue;
    if (/#|\\if\b|\\detokenize|\\csname|\\makeat|\\@/.test(group.body)) continue;
    const body = simplifyMacroBody(group.body);
    if (!body || /[{}\\]/.test(body)) continue;
    seen.add(name);
    out.push(`\\providecommand{${name}}{${body}}`);
  }
  return out.join("\n");
}

export function pandocSafeMacros(...sources: Array<string | undefined | null>): string {
  const extracted = sources
    .filter((value): value is string => Boolean(value))
    .map(extractSimpleNewcommands)
    .filter(Boolean)
    .join("\n");
  return extracted ? `${OPENBAR_PANDOC_MACROS}\n${extracted}` : OPENBAR_PANDOC_MACROS;
}

export type PreviewMacroBinding =
  | { name: string; kind: "text"; text: string }
  | { name: string; kind: "identity" };

/** Bindings for interactive preview: hide `\newcommand` and expand simple uses. */
export function extractPreviewMacroBindings(source: string): PreviewMacroBinding[] {
  const out: PreviewMacroBinding[] = [];
  const seen = new Set<string>();
  const re = /\\(?:re)?newcommand\*?\{(\\[A-Za-z]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const control = match[1]!;
    const name = control.slice(1);
    if (seen.has(name) || name === "obcite" || name === "obclaim" || name === "obtodo") continue;
    let i = skipSpace(source, match.index + match[0].length);
    let nargs = 0;
    if (source[i] === "[") {
      const close = source.indexOf("]", i);
      if (close < 0) continue;
      nargs = Number(source.slice(i + 1, close)) || 0;
      i = skipSpace(source, close + 1);
    }
    const group = consumeGroup(source, i);
    if (!group) continue;
    seen.add(name);
    if (nargs === 0) {
      if (/#|\\if\b|\\detokenize|\\csname/.test(group.body)) continue;
      const body = simplifyMacroBody(group.body);
      if (!body || /[{}\\]/.test(body)) continue;
      out.push({ name, kind: "text", text: body });
      continue;
    }
    if (nargs === 1) out.push({ name, kind: "identity" });
  }
  return out;
}
