/** Server-side Citation.js adapter for the project's BibTeX bibliography. */

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import { stripScripts } from "@/lib/html-policy";
import { safeUrl } from "@/lib/safe-url";
import type { BibEntry } from "@/lib/bibtex";

type CitationRecord = Record<string, unknown>;

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

function dateParts(value: string): number[] | undefined {
  const match = value.trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (!match) return undefined;
  return match.slice(1).filter(Boolean).map(Number);
}

function cslIssued(value: string | undefined): { "date-parts": number[][] } | undefined {
  if (!value) return undefined;
  const parts = dateParts(value);
  return parts?.length ? { "date-parts": [parts] } : undefined;
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
      return {
        key: asText(record.id) || asText(record["citation-key"]) || asText(source.label) || "",
        type: (asText(record.type) || sourceType || "misc").replace(/^article-journal$/, "article"),
        fields: cslToFields(record, source),
      };
    }).filter((entry) => entry.key);
  } catch {
    return null;
  }
}

export function formatBibliographyHtml(entry: BibEntry): string | null {
  try {
    const url = safeUrl(entry.fields.url) || (entry.fields.doi ? safeUrl(`https://doi.org/${entry.fields.doi}`) : undefined);
    const authors = bibtexNamesToCsl(entry.fields.author);
    const editors = bibtexNamesToCsl(entry.fields.editor);
    const issued = cslIssued(entry.fields.year || entry.fields.date);
    const citeData: CitationRecord = {
      id: entry.key,
      type: entry.type === "article" ? "article-journal" : entry.type,
      title: entry.fields.title,
      URL: url,
      DOI: entry.fields.doi,
      "container-title": entry.fields.journal || entry.fields.booktitle,
      publisher: entry.fields.publisher || entry.fields.school || entry.fields.institution || entry.fields.howpublished,
      note: entry.fields.note,
      issued,
      ...(authors.length ? { author: authors } : {}),
      ...(editors.length ? { editor: editors } : {}),
    };
    const cite = new Cite(citeData);
    const html = String(cite.format("bibliography", { format: "html", template: "apa", lang: "en-US" }) || "");
    if (!html.trim()) return null;
    const cleaned = stripScripts(html)
      .replace(/\s*href=["']javascript:[^"']*["']/gi, "")
      .replace(/javascript:/gi, "");
    if (/javascript:/i.test(cleaned)) return null;
    return cleaned.trim();
  } catch {
    return null;
  }
}

function bibtexNamesToCsl(raw?: string): CitationRecord[] {
  const names: CitationRecord[] = [];
  for (const name of (raw || "").split(/\s+and\s+/i)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (trimmed.includes(",")) {
      const [family, given] = trimmed.split(",", 2).map((part) => part.trim());
      names.push({ family, given });
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const family = parts.pop() || "";
    names.push({ family, given: parts.join(" ") });
  }
  return names;
}
