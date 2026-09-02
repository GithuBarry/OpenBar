export interface MacroMatch {
  name: string;
  attrs: string;
  body: string;
  index: number;
  length: number;
}

export function findMacroMatches(src: string, macroNames: string[]): MacroMatch[] {
  const matches: MacroMatch[] = [];
  const nameSet = new Set(macroNames);
  let i = 0;
  while (i < src.length) {
    if (src[i] === "\\" && (i === 0 || src[i - 1] !== "\\")) {
      const matchName = src.slice(i + 1).match(/^[A-Za-z0-9@*]+/);
      if (matchName && nameSet.has(matchName[0])) {
        const name = matchName[0];
        let pos = i + 1 + name.length;
        let attrs = "";
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (pos < src.length && src[pos] === "[") {
          let bDepth = 1;
          const bStart = pos + 1;
          let bp = bStart;
          while (bp < src.length && bDepth > 0) {
            if (src[bp] === "\\") {
              bp += 2;
              continue;
            }
            if (src[bp] === "[") bDepth++;
            else if (src[bp] === "]") bDepth--;
            bp++;
          }
          if (bDepth === 0) {
            attrs = src.slice(bStart, bp - 1);
            pos = bp;
          }
        }
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (pos < src.length && src[pos] === "{") {
          let depth = 1;
          const bodyStart = pos + 1;
          let p = bodyStart;
          while (p < src.length && depth > 0) {
            if (src[p] === "\\") {
              p += 2;
              continue;
            }
            if (src[p] === "{") depth++;
            else if (src[p] === "}") depth--;
            p++;
          }
          if (depth === 0) {
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
      const valueStart = position;
      while (position < raw.length && raw[position] !== quote) position++;
      attrs[key] = raw.slice(valueStart, position);
      if (position < raw.length) position++;
      continue;
    }

    const valueStart = position;
    while (position < raw.length && !/\s/.test(raw[position])) position++;
    attrs[key] = raw.slice(valueStart, position).replace(/,+$/, "");
  }
  return attrs;
}

const ATTR_KEY_ORDER = ["id", "claim", "priority", "due", "created", "section", "state", "tags", "evidence"];

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
      return /[\s,]/.test(value) ? `${key}="${value.replace(/"/g, "")}"` : `${key}=${value}`;
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
