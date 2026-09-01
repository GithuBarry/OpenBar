/**
 * Escape generated TeX title/attribute values. Does not rewrite existing source.
 */

export function escapeTexText(value: string): string {
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
      default: return char;
    }
  }).join("");
}

export function paperTitleCommand(title: string): string {
  return `\\title{${escapeTexText(title)}}`;
}
