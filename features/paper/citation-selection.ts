import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";

export type CitationSelection = {
  filePath: string;
  occurrence: number;
  body: string;
  from: number;
  to: number;
};

/** Keep the citation's owning file and range while saves rebuild bundle offsets. */
export function captureCitationSelection(source: string, range: { from: number; to: number } | null): CitationSelection | null {
  if (!range) return null;
  const parts = splitBundleSource(source);
  const index = parts.findIndex(part => range.from >= part.bodyFrom && range.to <= part.bodyTo);
  const part = parts[index];
  return part ? {
    filePath: part.filePath,
    occurrence: parts.slice(0, index).filter(item => item.filePath === part.filePath).length,
    body: part.body,
    from: range.from - part.bodyFrom,
    to: range.to - part.bodyFrom,
  } : null;
}

export function resolveCitationSelection(source: string, selection: CitationSelection): { from: number; to: number } | null {
  const part = splitBundleSource(source).filter(item => item.filePath === selection.filePath)[selection.occurrence];
  if (!part) return null;
  let prefix = 0;
  while (prefix < selection.body.length && prefix < part.body.length && selection.body[prefix] === part.body[prefix]) prefix += 1;
  let beforeEnd = selection.body.length, afterEnd = part.body.length;
  while (beforeEnd > prefix && afterEnd > prefix && selection.body[beforeEnd - 1] === part.body[afterEnd - 1]) { beforeEnd -= 1; afterEnd -= 1; }
  const map = (offset: number) => offset <= prefix ? offset : offset >= beforeEnd ? offset + afterEnd - beforeEnd : null;
  const from = map(selection.from), to = map(selection.to);
  return from === null || to === null ? null : { from: part.bodyFrom + from, to: part.bodyFrom + to };
}
