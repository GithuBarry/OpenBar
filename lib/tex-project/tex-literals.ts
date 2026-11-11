/** Browser-safe literal masking with exact UTF-16 offsets and line endings. */
export const TEX_LITERAL_ENVIRONMENTS = new Set(["verbatim", "verbatim*", "Verbatim", "Verbatim*", "lstlisting", "minted", "alltt", "comment"]);

function escapedAt(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function commandEnvironmentAt(source: string, index: number, command: "begin" | "end"): { name: string; to: number } | undefined {
  if (source[index] !== "\\" || escapedAt(source, index)) return undefined;
  const match = new RegExp(`^\\\\${command}\\s*\\{([^}\\r\\n]+)\\}`).exec(source.slice(index));
  const name = match?.[1]?.trim();
  return name && match ? { name, to: index + match[0].length } : undefined;
}

/** Return the end of an inline verbatim command using UTF-16 source offsets. */
export function texVerbCommandEnd(source: string, index: number): number | undefined {
  if (source[index] !== "\\" || escapedAt(source, index)) return undefined;
  const prefix = /^\\verb(?![A-Za-z@])\*?/.exec(source.slice(index));
  if (!prefix) return undefined;
  const delimiter = source[index + prefix[0].length];
  if (!delimiter || delimiter === "\r" || delimiter === "\n") return undefined;
  for (let cursor = index + prefix[0].length + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === delimiter) return cursor + 1;
    if (source[cursor] === "\r" || source[cursor] === "\n") return cursor;
  }
  return source.length;
}

/** Return the end of a literal environment, including an incomplete one. */
export function texLiteralEnvironmentEnd(source: string, index: number): number | undefined {
  const begin = commandEnvironmentAt(source, index, "begin");
  if (!begin || !TEX_LITERAL_ENVIRONMENTS.has(begin.name)) return undefined;
  for (let cursor = begin.to; cursor < source.length; cursor += 1) {
    if (source[cursor] !== "\\") continue;
    const end = commandEnvironmentAt(source, cursor, "end");
    if (end?.name === begin.name) return end.to;
  }
  return source.length;
}

/** Mask TeX comments and literal environments while retaining source offsets. */
export function maskTexLiterals(source: string): string {
  const output = source.split("");
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inComment) {
      if (char === "\r" || char === "\n") inComment = false;
      else output[index] = " ";
      continue;
    }
    const literalEnd = texLiteralEnvironmentEnd(source, index) ?? texVerbCommandEnd(source, index);
    if (literalEnd !== undefined) {
      for (let cursor = index; cursor < literalEnd; cursor += 1) {
        if (source[cursor] !== "\r" && source[cursor] !== "\n") output[cursor] = " ";
      }
      index = literalEnd - 1;
      continue;
    }
    if (char === "%" && !escapedAt(source, index)) {
      output[index] = " ";
      inComment = true;
    }
  }
  return output.join("");
}
