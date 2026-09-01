/**
 * TeX-mode character lint: likely prose percentages and strict `%` comments.
 *
 * An unescaped `%` always starts a TeX comment. Digit+`%` sequences such as
 * `100%` are still comments, but they are almost always intended as prose
 * percentages, so the editor offers a `\%` quick fix. Other unescaped `%`
 * markers stay comments and are not rewritten. `\verb` and verbatim bodies
 * keep literal `%`.
 */

export type TexLintFix = {
  from: number;
  to: number;
  original: string;
  replacement: string;
  message: string;
};

function isEscaped(line: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) slashes += 1;
  return slashes % 2 === 1;
}

function maskKeepLayout(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

function maskLiteralRegions(source: string): string {
  return source
    .replace(/\\begin\{verbatim\*?\}[\s\S]*?\\end\{verbatim\*?\}/g, maskKeepLayout)
    .replace(/\\verb\*?(.)(?:(?!\1).)*\1/g, maskKeepLayout);
}

export function lintProsePercentages(source: string): TexLintFix[] {
  const fixes: TexLintFix[] = [];
  const lines = maskLiteralRegions(source).split(/\n/);
  let offset = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "%") continue;
      if (isEscaped(line, i)) continue;
      const before = line.slice(0, i);
      const prose = before.match(/(\d+(?:\.\d+)?)$/);
      if (prose) {
        const original = `${prose[1]}%`;
        const from = offset + i - prose[1]!.length;
        fixes.push({
          from,
          to: from + original.length,
          original,
          replacement: `${prose[1]}\\%`,
          message: `Literal "%" starts a TeX comment. Use \\% for a prose percentage.`,
        });
      }
      break;
    }
    offset += line.length + 1;
  }
  return fixes;
}

export function applyTexLintFix(source: string, fix: TexLintFix): string {
  return `${source.slice(0, fix.from)}${fix.replacement}${source.slice(fix.to)}`;
}
