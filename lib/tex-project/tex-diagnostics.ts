export type TexFileLine = { file: string; line: number; message: string };

/** Parse latexmk `-file-line-error` hits such as `sections/eval.tex:83: Undefined control sequence`. */
export function parseTexFileLines(diagnostics: string[]): TexFileLine[] {
  const hits: TexFileLine[] = [];
  for (const raw of diagnostics) {
    const match = raw.match(/(?:^|[\\/])([^\\/\s:]+\.tex):(\d+)(?::(?:\d+:)?\s*(.*))?/);
    if (!match) continue;
    hits.push({
      file: match[1]!,
      line: Number(match[2]),
      message: (match[3] || raw).trim(),
    });
  }
  return hits;
}
