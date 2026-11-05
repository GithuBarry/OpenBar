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

function verbCommandEnd(source: string, index: number): number | undefined {
  if (source[index] !== "\\" || escapedAt(source, index)) return undefined;
  const prefix = /^\\verb\*?(?![A-Za-z@])/.exec(source.slice(index));
  if (!prefix) return undefined;
  const delimiter = source[index + prefix[0].length];
  if (!delimiter || delimiter === "\r" || delimiter === "\n") return undefined;
  for (let cursor = index + prefix[0].length + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === delimiter) return cursor + 1;
    if (source[cursor] === "\r" || source[cursor] === "\n") return cursor;
  }
  return source.length;
}

/** Mask TeX comments and literal environments while retaining source offsets. */
export function maskTexLiterals(source: string): string {
  const output = source.split("");
  let inComment = false;
  let verbatimEnvironment: string | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inComment) {
      if (char === "\r" || char === "\n") inComment = false;
      else output[index] = " ";
      continue;
    }
    if (verbatimEnvironment) {
      const end = commandEnvironmentAt(source, index, "end");
      if (end?.name === verbatimEnvironment) {
        for (let cursor = index; cursor < end.to; cursor += 1) {
          if (source[cursor] !== "\r" && source[cursor] !== "\n") output[cursor] = " ";
        }
        index = end.to - 1;
        verbatimEnvironment = undefined;
      } else if (char !== "\r" && char !== "\n") {
        output[index] = " ";
      }
      continue;
    }
    const begin = commandEnvironmentAt(source, index, "begin");
    if (begin && TEX_LITERAL_ENVIRONMENTS.has(begin.name)) {
      for (let cursor = index; cursor < begin.to; cursor += 1) {
        if (source[cursor] !== "\r" && source[cursor] !== "\n") output[cursor] = " ";
      }
      index = begin.to - 1;
      verbatimEnvironment = begin.name;
      continue;
    }
    const verbEnd = verbCommandEnd(source, index);
    if (verbEnd !== undefined) {
      for (let cursor = index; cursor < verbEnd; cursor += 1) {
        if (source[cursor] !== "\r" && source[cursor] !== "\n") output[cursor] = " ";
      }
      index = verbEnd - 1;
      continue;
    }
    if (char === "%" && !escapedAt(source, index)) {
      output[index] = " ";
      inComment = true;
    }
  }
  return output.join("");
}
