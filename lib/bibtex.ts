import { safeUrl } from "@/lib/safe-url";

/**
 * Minimal, dependency-free BibTeX support. A per-project `references.bib` file
 * supplies bibliography entries for TeX previews and citation disclosures.
 */

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  /** Server-preformatted CSL HTML from Citation.js. Never imported from `lib/citation.ts` on the client. */
  html?: string;
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

/** Stable DOM anchor shared by citation links and rendered references. */
export function refId(key: string): string {
  return `ref-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
