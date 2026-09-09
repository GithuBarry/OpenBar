/** Ephemeral section addresses derived from the current file and heading order. */
import { discoverTexHeadings, type TexHeading } from "./tex-structure";
import { splitBundleSource, inlineBundleIncludesMapped } from "./source-bundle-format";

export type DerivedSection = {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  order: number;
  label: string;
  appendix?: boolean;
  from: number;
  bodyFrom: number;
  to: number;
  heading: TexHeading;
};

export function stripSectionComments(source: string): string {
  return source.replace(/^[\t ]*%\s*OB-(?:SECTION\b[^\r\n]*|EDIT-(?:BEGIN|END)\b[^\r\n]*)\r?\n?/gm, "");
}

/** Scan balanced heading arguments while retaining exact source offsets. */
export function headingInvocation(source: string, from: number) {
  const command = /^\\(?:section|subsection|subsubsection|paragraph|subparagraph)\*?/.exec(source.slice(from));
  if (!command) return null;
  let cursor = from + command[0].length;
  const skip = () => {
    while (cursor < source.length) {
      if (/\s/.test(source[cursor]!)) { cursor += 1; continue; }
      if (source[cursor] === "%") { cursor = source.indexOf("\n", cursor); if (cursor < 0) cursor = source.length; continue; }
      break;
    }
  };
  const group = (open: string, close: string) => {
    if (source[cursor] !== open) return null;
    const start = ++cursor;
    let depth = 1;
    while (cursor < source.length) {
      const char = source[cursor++]!;
      if (char === "\\") { cursor += 1; continue; }
      if (char === "%") { const end = source.indexOf("\n", cursor); cursor = end < 0 ? source.length : end; continue; }
      if (char === open) depth += 1;
      if (char === close) { depth -= 1; if (!depth) return { from: start, to: cursor - 1 }; }
    }
    return null;
  };
  skip();
  if (source[cursor] === "[") { if (!group("[", "]")) return null; skip(); }
  const title = group("{", "}");
  return title ? { titleFrom: title.from, titleTo: title.to, end: cursor } : null;
}

export function deriveSections(source: string, filePath = "paper.tex"): DerivedSection[] {
  const headings = discoverTexHeadings(source, filePath);
  const address = Array.from(new TextEncoder().encode(filePath), byte => byte.toString(16).padStart(2, "0")).join("");
  return headings.flatMap((heading, index) => {
    const invocation = headingInvocation(source, heading.start);
    if (!invocation) return [];
    const next = headings[index + 1];
    let to = next?.start ?? source.length;
    const endDocument = /\\end\s*\{document\}|^[\t ]*\\appendix\b/m.exec(source.slice(invocation.end, to));
    if (endDocument) to = invocation.end + endDocument.index;
    // Retain the heading's ordinary label when replacing its body.
    let bodyFrom = invocation.end;
    const label = /^(?:\s|%[^\n]*(?:\n|$))*\\label\s*\{([^{}]+)\}/.exec(source.slice(bodyFrom, to));
    if (label) bodyFrom += label[0].length;
    return [{
      id: `section-${address}-${index + 1}`,
      title: heading.title,
      level: heading.level as DerivedSection["level"],
      order: index,
      label: label?.[1] || "",
      ...(/^\s*\\appendix\b/m.test(source.slice(0, heading.start)) ? { appendix: true } : {}),
      from: heading.start,
      bodyFrom,
      to,
      heading,
    }];
  });
}

export function bundleSections(source: string) {
  const parts = splitBundleSource(source);
  const sections = parts.flatMap(part => deriveSections(part.body, part.filePath).map(section => ({
    ...section, filePath: part.filePath,
    from: part.bodyFrom + section.from,
    bodyFrom: part.bodyFrom + section.bodyFrom,
    to: part.bodyFrom + section.to,
  })));
  const expanded = inlineBundleIncludesMapped(source);
  const order = new Map(discoverTexHeadings(expanded.source).map((heading, index) => [expanded.mapOffset(heading.start), index]));
  return sections.sort((a, b) => (order.get(a.from) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.from) ?? Number.MAX_SAFE_INTEGER));
}
