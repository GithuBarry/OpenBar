export interface MacroMatch {
  name: string;
  attrs: string;
  body: string;
  index: number;
  length: number;
}

import { texLiteralEnvironmentEnd, texVerbCommandEnd } from "@/lib/tex-project/tex-literals";

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function skipBalanced(source: string, start: number, open: string, close: string, quotedValues = open === "["): number | undefined {
  let depth = 1;
  let inComment = false;
  let quote: string | undefined;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (inComment) {
      if (char === "\n") inComment = false;
      continue;
    }
    if (quote) {
      if (char === "\\") cursor += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "%" && !isEscaped(source, cursor)) {
      inComment = true;
      continue;
    }
    if (char === "\\") {
      const literalEnd = texVerbCommandEnd(source, cursor) ?? texLiteralEnvironmentEnd(source, cursor);
      if (literalEnd !== undefined) {
        cursor = literalEnd - 1;
        continue;
      }
      cursor += 1;
      continue;
    }
    if (quotedValues && (char === '"' || char === "'") && source.slice(start + 1, cursor).trimEnd().endsWith("=")) {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return undefined;
}

function skipDefinition(source: string, index: number): number | undefined {
  const command = /^\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand|newenvironment|renewenvironment|provideenvironment|(?:New|Renew|Provide|Declare)DocumentEnvironment|def|gdef|edef|xdef)\*?(?![A-Za-z@])/.exec(source.slice(index));
  if (!command) return undefined;
  let cursor = index + command[0].length;
  const trivia = () => {
    while (cursor < source.length) {
      if (/\s/.test(source[cursor]!)) cursor += 1;
      else if (source[cursor] === "%") {
        const end = source.indexOf("\n", cursor);
        cursor = end < 0 ? source.length : end + 1;
      } else break;
    }
  };
  const group = () => {
    trivia();
    if (source[cursor] !== "{") return false;
    cursor = skipBalanced(source, cursor, "{", "}") ?? source.length;
    return true;
  };
  trivia();
  if (source[cursor] === "{") group();
  else {
    const name = /^\\(?:[A-Za-z@]+|.)/.exec(source.slice(cursor));
    if (!name) return undefined;
    cursor += name[0].length;
  }
  if (/^(?:def|gdef|edef|xdef)$/.test(command[1]!)) {
    while (cursor < source.length && source[cursor] !== "{") {
      trivia();
      if (source[cursor] !== "{") cursor += 1;
    }
  } else {
    trivia();
    while (source[cursor] === "[") {
      cursor = skipBalanced(source, cursor, "[", "]", false) ?? source.length;
      trivia();
    }
  }
  const bodies = /Document/.test(command[1]!) ? (/Environment/.test(command[1]!) ? 3 : 2) : /environment/.test(command[1]!) ? 2 : 1;
  for (let body = 0; body < bodies; body += 1) if (!group()) return cursor;
  return cursor;
}

export function findMacroMatches(src: string, macroNames: string[]): MacroMatch[] {
  const matches: MacroMatch[] = [];
  const nameSet = new Set(macroNames);
  let i = 0;
  let inComment = false;
  while (i < src.length) {
    if (inComment) {
      if (src[i] === "\n") inComment = false;
      i += 1;
      continue;
    }
    if (src[i] === "%" && !isEscaped(src, i)) {
      inComment = true;
      i += 1;
      continue;
    }
    const verbatimEnd = src[i] === "\\" && !isEscaped(src, i)
      ? texVerbCommandEnd(src, i) ?? texLiteralEnvironmentEnd(src, i)
      : undefined;
    if (verbatimEnd !== undefined) {
      i = verbatimEnd;
      continue;
    }
    if (src[i] === "\\" && !isEscaped(src, i)) {
      const definitionEnd = skipDefinition(src, i);
      if (definitionEnd !== undefined) {
        i = definitionEnd;
        continue;
      }
      const matchName = src.slice(i + 1).match(/^[A-Za-z0-9@*]+/);
      if (matchName && nameSet.has(matchName[0])) {
        const name = matchName[0];
        let pos = i + 1 + name.length;
        let attrs = "";
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (pos < src.length && src[pos] === "[") {
          const bStart = pos + 1;
          const bp = skipBalanced(src, pos, "[", "]");
          if (bp !== undefined) {
            attrs = src.slice(bStart, bp - 1);
            pos = bp;
          }
        }
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (pos < src.length && src[pos] === "{") {
          const bodyStart = pos + 1;
          const p = skipBalanced(src, pos, "{", "}");
          if (p !== undefined) {
            const body = src.slice(bodyStart, p - 1);
            matches.push({
              name,
              attrs,
              body,
              index: i,
              length: p - i,
            });
            i = p;
            continue;
          }
        }
      }
    }
    i++;
  }
  return matches;
}

export function parseAnchorAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let position = 0;
  while (position < raw.length) {
    while (position < raw.length && /[\s,]/.test(raw[position])) position++;
    const keyStart = position;
    while (position < raw.length && /[A-Za-z0-9_-]/.test(raw[position])) position++;
    if (position === keyStart) {
      position++;
      continue;
    }
    const key = raw.slice(keyStart, position);
    while (position < raw.length && /\s/.test(raw[position])) position++;
    if (raw[position] !== "=") {
      position++;
      continue;
    }
    position++;
    while (position < raw.length && /\s/.test(raw[position])) position++;

    if (raw[position] === "\"" || raw[position] === "'") {
      const quote = raw[position++];
      let value = "";
      while (position < raw.length) {
        const char = raw[position];
        if (char === "\\" && position + 1 < raw.length && [quote, "\\", "]"].includes(raw[position + 1]!)) {
          value += raw[position + 1];
          position += 2;
          continue;
        }
        if (char === quote) break;
        value += char;
        position += 1;
      }
      attrs[key] = value;
      if (position < raw.length) position++;
      continue;
    }

    const valueStart = position;
    while (position < raw.length && !/[\s,]/.test(raw[position])) position++;
    attrs[key] = raw.slice(valueStart, position);
  }
  return attrs;
}

const ATTR_KEY_ORDER = ["id", "title", "created", "updated", "completed"];

export function serializeAnchorAttrs(attrs: Record<string, string>): string {
  const keys = Object.keys(attrs).filter((key) => (attrs[key] || "").trim());
  keys.sort((a, b) => {
    const ia = ATTR_KEY_ORDER.indexOf(a);
    const ib = ATTR_KEY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys
    .map((key) => {
      const value = attrs[key]!.trim();
      if (!/[\s,\[\]"']/.test(value)) return `${key}=${value}`;
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]");
      return `${key}="${escaped}"`;
    })
    .join(", ");
}

import { safeUrl } from "@/lib/safe-url";

export function resolveAssetUrl(src: string | undefined, assetBaseUrl: string | undefined): string | undefined {
  if (!src) return src;
  if (/^(?:javascript:|vbscript:|data:)/i.test(src)) return undefined;
  if (/^\/\//.test(src)) return undefined;
  if (/^(?:https?:|\/)/i.test(src)) return safeUrl(src) ?? (src.startsWith("/") ? src : undefined);
  if (!assetBaseUrl) return src;
  return `${assetBaseUrl.replace(/\/$/, "")}/${src.split("/").map(encodeURIComponent).join("/")}`;
}
