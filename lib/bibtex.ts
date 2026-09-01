import { safeUrl } from "@/lib/safe-url";

/**
 * Minimal, dependency-free BibTeX support. A per-project `references.bib` file
 * is the separate bibliography source; the draft cites entries with
 * `\cite{key}` (also `\citep`/`\citet`/`[@key]`), and `compileBibliography`
 * resolves those into numbered links plus a rendered References list.
 */

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  /** Server-preformatted CSL HTML from Citation.js. Never imported from `lib/citation.ts` on the client. */
  html?: string;
}

export interface CompiledReference {
  n: number;
  key: string;
  entry: BibEntry;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function readDelimited(raw: string, j: number, open: string, close: string): [string, number] {
  if (open === close) {
    // Quoted BibTeX fields may contain escaped quotes. Preserve escapes here;
    // cleanValue handles their display representation after the whole field is
    // read, so later fields cannot be swallowed by a premature delimiter.
    j++;
    let out = "";
    while (j < raw.length) {
      const ch = raw[j]!;
      if (ch === "\\" && j + 1 < raw.length) {
        out += ch + raw[j + 1]!;
        j += 2;
        continue;
      }
      if (ch === close) {
        j++;
        break;
      }
      out += ch;
      j++;
    }
    return [out, j];
  }
  let depth = 0;
  let out = "";
  for (; j < raw.length; j++) {
    const ch = raw[j];
    if (ch === open) {
      depth++;
      if (depth === 1) continue;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
    out += ch;
  }
  return [out, j];
}

function cleanValue(value: string): string {
  return value
    .replace(/\\"/g, '"') // literal escaped quote, not an accent command
    .replace(/\\(['`^~=.])\{?([a-zA-Z])\}?/g, "$2") // accents: \'{a} / \'a -> a
    .replace(/\\[a-zA-Z]+/g, "") // strip other TeX commands
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBibtex(raw: string): BibEntry[] {
  return parseBibtexLegacy(raw);
}

function parseBibtexLegacy(raw: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const at = raw.indexOf("@", i);
    if (at === -1) break;
    let j = at + 1;
    let type = "";
    while (j < n && /[A-Za-z]/.test(raw[j])) type += raw[j++];
    while (j < n && /\s/.test(raw[j])) j++;
    if (raw[j] !== "{") {
      i = at + 1;
      continue;
    }
    j++;
    let key = "";
    while (j < n && raw[j] !== "," && raw[j] !== "}") key += raw[j++];
    key = key.trim();
    const fields: Record<string, string> = {};
    if (raw[j] === ",") {
      j++;
      while (j < n) {
        while (j < n && /[\s,]/.test(raw[j])) j++;
        if (j >= n || raw[j] === "}") {
          j++;
          break;
        }
        let name = "";
        while (j < n && /[A-Za-z0-9_:.\-]/.test(raw[j])) name += raw[j++];
        while (j < n && /\s/.test(raw[j])) j++;
        if (raw[j] !== "=") break;
        j++;
        while (j < n && /\s/.test(raw[j])) j++;
        let value = "";
        if (raw[j] === "{") {
          [value, j] = readDelimited(raw, j, "{", "}");
        } else if (raw[j] === '"') {
          [value, j] = readDelimited(raw, j, '"', '"');
        } else {
          while (j < n && !/[\s,}]/.test(raw[j])) value += raw[j++];
        }
        if (name) fields[name.toLowerCase()] = cleanValue(value);
      }
    }
    const lowerType = type.toLowerCase();
    if (key && lowerType !== "comment" && lowerType !== "preamble" && lowerType !== "string") {
      entries.push({ key, type: lowerType, fields });
    }
    i = Math.max(j, at + 1);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

function formatOneAuthor(name: string): string {
  name = name.trim();
  let last: string;
  let firsts: string;
  if (name.includes(",")) {
    const [l, f] = name.split(",", 2);
    last = l.trim();
    firsts = (f || "").trim();
  } else {
    const parts = name.split(/\s+/);
    last = parts.pop() || "";
    firsts = parts.join(" ");
  }
  const initials = firsts
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + ".")
    .join(" ");
  return initials ? `${initials} ${last}` : last;
}

function formatAuthors(raw?: string): string {
  if (!raw) return "";
  const list = raw.split(/\s+and\s+/i).map(formatOneAuthor).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length > 4) return `${list[0]} et al.`;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export interface ReferenceFields {
  authors: string;
  title: string;
  venue: string;
  year: string;
  url?: string;
}

export function referenceFields(entry: BibEntry): ReferenceFields {
  const f = entry.fields;
  const authors = formatAuthors(f.author || f.editor);
  const title = f.title || "Untitled";
  const venue = f.journal || f.booktitle || f.publisher || f.school || f.institution || f.howpublished || f.note || "";
  const year = f.year || f.date || "";
  const url = safeUrl(f.url) || (f.doi ? safeUrl(`https://doi.org/${f.doi}`) : undefined);
  return { authors, title, venue, year, url };
}

/** One reference formatted as an HTML string (safe to inject via rehype-raw). */
export function formatReference(entry: BibEntry): string {
  const r = referenceFields(entry);
  const parts: string[] = [];
  if (r.authors) parts.push(`${esc(r.authors).replace(/\.$/, "")}.`);
  parts.push(`${esc(r.title)}.`);
  const vy = [r.venue ? `<em>${esc(r.venue)}</em>` : "", r.year ? esc(r.year) : ""].filter(Boolean).join(", ");
  if (vy) parts.push(`${vy}.`);
  let html = parts.join(" ");
  if (r.url) html += ` <a class="ob-ref-link" href="${escAttr(r.url)}">link</a>`;
  return html;
}

// ---------------------------------------------------------------------------
// Compiling citations
// ---------------------------------------------------------------------------

export function refId(key: string): string {
  return `ref-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const CITE_RE = /\\(?:cite|citep|citet|citealp|citeauthor|autocite|parencite|textcite|obcite)(?:\[[^\]]*\])?\{([^}]*)\}|\[[@$]([^\]\s]+(?:\s*[;,]\s*[@$]?[^\]\s]+)*)\]/g;

/**
 * Replace citation commands in `source` with numbered `[n]` links and return the
 * ordered list of cited references (by first appearance). Unknown keys render as
 * a muted `[?]`.
 */
export function compileBibliography(
  source: string,
  entries: BibEntry[],
): { source: string; references: CompiledReference[] } {
  if (!entries.length) return { source, references: [] };
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const numByKey = new Map<string, number>();
  const order: string[] = [];

  const newSource = source.replace(CITE_RE, (_m, latexKeys?: string, mdKeys?: string) => {
    const raw = latexKeys ?? mdKeys ?? "";
    const keys = raw
      .split(/[;,]/)
      .map((k) => k.replace(/^[@$]/, "").trim())
      .filter(Boolean);
    const inner = keys
      .map((k) => {
        if (!byKey.has(k)) return `<span class="ob-cite-missing" title="unknown key: ${escAttr(k)}">?</span>`;
        if (!numByKey.has(k)) {
          order.push(k);
          numByKey.set(k, order.length);
        }
        const num = numByKey.get(k)!;
        return `<a class="ob-cite" href="#${refId(k)}">${num}</a>`;
      })
      .join(", ");
    return `[${inner}]`;
  });

  const references: CompiledReference[] = order.map((key, idx) => ({
    n: idx + 1,
    key,
    entry: byKey.get(key)!,
  }));
  return { source: newSource, references };
}

/** Render the compiled References section as an HTML block for the paper. */
export function renderReferencesHtml(references: CompiledReference[]): string {
  if (!references.length) return "";
  const items = references
    .map((r) => `<li id="${refId(r.key)}">${formatReference(r.entry)}</li>`)
    .join("\n");
  return `\n\n<section class="ob-references">\n<h2 id="references">References</h2>\n<ol class="ob-refs">\n${items}\n</ol>\n</section>\n`;
}
