/** Derive table layout from the GFM delimiter row while preserving authored content. */
export function markdownTableColumns(text: string): number {
  let columns = 0;
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell))) columns = Math.max(columns, cells.length);
  }
  return columns;
}

/** Estimate the rendered width from the longest authored cell in each column. */
export function markdownTableWidth(text: string): number {
  const rows = text.split(/\r?\n/)
    .filter((line) => line.includes("|"))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const columns = Math.max(0, ...rows.map((cells) => cells.length));
  if (columns < 2) return 0;
  const widths = Array.from({ length: columns }, () => 72);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index]!, Math.min(560, cell.length * 7 + 20));
    });
  }
  return Math.ceil(widths.reduce((total, width) => total + width, 0) + 20);
}

export function startsWithMarkdownTable(text: string): boolean {
  const lines = text.trimStart().split(/\r?\n/);
  return Boolean(lines[0]?.includes("|") && lines[1] && markdownTableColumns(lines[1]));
}
