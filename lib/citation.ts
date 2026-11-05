/** Server-side Citation.js adapter for the project's BibTeX bibliography. */

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import { stripScripts } from "@/lib/html-policy";
import { safeUrl } from "@/lib/safe-url";
import type { BibEntry } from "@/lib/bibtex";

type CitationRecord = Record<string, unknown>;
const cslByEntry = new WeakMap<BibEntry, CitationRecord>();

type ParsedBibtexEntry = {
  type?: unknown;
  label?: unknown;
  properties?: unknown;
};

function asRecord(value: unknown): CitationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as CitationRecord
    : {};
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.map(asText).filter((item): item is string => Boolean(item));
    return values.length ? values.join(" and ") : undefined;
  }
  return undefined;
}

function cslNames(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((author) => {
      const item = asRecord(author);
      const literal = asText(item.literal);
      if (literal) return literal;
      const family = asText(item.family);
      const given = asText(item.given);
      return [family, given].filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join(" and ");
}

function cslToFields(entry: CitationRecord, source: ParsedBibtexEntry): Record<string, string> {
  // Citation.js exposes its parsed BibTeX properties when the target is the
  // BibTeX entry format. Keep those source fields so paper behavior retains
  // BibTeX-only values such as school, institution, and howpublished.
  const sourceFields = asRecord(source.properties);
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(sourceFields)) {
    const text = asText(value);
    if (text) fields[name.toLowerCase()] = text;
  }

  if (typeof entry.title === "string") fields.title = entry.title;
  if (typeof entry.URL === "string") fields.url = entry.URL;
  if (typeof entry.DOI === "string") fields.doi = entry.DOI;

  const containerTitle = asText(entry["container-title"]);
  const sourceType = asText(source.type);
  const isConference = entry.type === "paper-conference" || sourceType === "inproceedings" || sourceType === "conference";
  if (containerTitle) {
    if (isConference) fields.booktitle = containerTitle;
    else fields.journal = containerTitle;
  }

  const publisher = asText(entry.publisher);
  if (publisher && (fields.publisher || (!fields.institution && !fields.school && !fields.howpublished))) {
    fields.publisher = publisher;
  }

  const issued = asRecord(entry.issued) as { "date-parts"?: unknown };
  const issuedParts = Array.isArray(issued["date-parts"]) && Array.isArray(issued["date-parts"][0])
    ? issued["date-parts"][0].filter((part): part is number => typeof part === "number")
    : [];
  if (!fields.year && !fields.date && issuedParts.length === 1) fields.year = String(issuedParts[0]);
  if (!fields.year && !fields.date && issuedParts.length > 1) fields.date = issuedParts.join("-");

  const authors = cslNames(entry.author);
  if (authors) fields.author = authors;
  const editors = cslNames(entry.editor);
  if (editors) fields.editor = editors;
  return fields;
}

export function parseBibtexCitationJs(raw: string): BibEntry[] | null {
  try {
    const parsed = new Cite(raw, {
      forceType: "@bibtex/text",
      target: "@bibtex/entries+list",
    });
    const sourceEntries = Array.isArray(parsed.data) ? parsed.data as ParsedBibtexEntry[] : [];
    if (!sourceEntries.length) return null;

    const normalized = new Cite(sourceEntries, {
      forceType: "@biblatex/entries+list",
    });
    const data = Array.isArray(normalized.data) ? normalized.data : [];
    return sourceEntries.map((source, index) => {
      const record = asRecord(data[index]);
      const sourceType = asText(source.type);
      const entry = {
        key: asText(record.id) || asText(record["citation-key"]) || asText(source.label) || "",
        type: (asText(record.type) || sourceType || "misc").replace(/^article-journal$/, "article"),
        fields: cslToFields(record, source),
      };
      cslByEntry.set(entry, record);
      return entry;
    }).filter((entry) => entry.key);
  } catch {
    return null;
  }
}

/** Format the original normalized CSL record while its parsed entry is in use. */
export function formatBibliographyHtml(entry: BibEntry): string | null {
  const record = cslByEntry.get(entry);
  if (!record) return null;
  try {
    const url = safeUrl(asText(record.URL));
    const cite = new Cite({ ...record, URL: url });
    const html = String(cite.format("bibliography", { format: "html", template: "apa", lang: "en-US" }) || "");
    return html.trim() ? stripScripts(html).trim() : null;
  } catch {
    return null;
  }
}
