/**
 * Citation.js adapter. Custom BibTeX parsing remains the fallback when
 * Citation.js cannot read an entry.
 */

import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import { stripScripts } from "@/lib/html-policy";
import { safeUrl } from "@/lib/safe-url";

type BibEntry = {
  key: string;
  type: string;
  fields: Record<string, string>;
};

function cslToFields(entry: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof entry.title === "string") fields.title = entry.title;
  if (typeof entry.URL === "string") fields.url = entry.URL;
  if (typeof entry.DOI === "string") fields.doi = entry.DOI;
  if (typeof entry["container-title"] === "string") fields.journal = entry["container-title"];
  const issued = entry.issued as { "date-parts"?: number[][] } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0];
  if (year) fields.year = String(year);
  const authors = Array.isArray(entry.author)
    ? entry.author
      .map((author) => {
        const item = author as { family?: string; given?: string };
        return [item.family, item.given].filter(Boolean).join(", ");
      })
      .filter(Boolean)
      .join(" and ")
    : "";
  if (authors) fields.author = authors;
  return fields;
}

export function parseBibtexCitationJs(raw: string): BibEntry[] | null {
  try {
    const cite = new Cite(raw, { forceType: "@bibtex/text" });
    const data = Array.isArray(cite.data) ? cite.data : [];
    if (!data.length) return null;
    return data.map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        key: String(record.id || record["citation-key"] || ""),
        type: String(record.type || "misc").replace(/^article-journal$/, "article"),
        fields: cslToFields(record),
      };
    }).filter((entry) => entry.key);
  } catch {
    return null;
  }
}

export function formatBibliographyHtml(entry: BibEntry): string | null {
  try {
    const url = safeUrl(entry.fields.url) || (entry.fields.doi ? safeUrl(`https://doi.org/${entry.fields.doi}`) : undefined);
    const authors = (entry.fields.author || "")
      .split(/\s+and\s+/i)
      .map((name) => {
        const [family, given] = name.split(",").map((part) => part.trim());
        return family ? { family, given } : { literal: name };
      });
    const cite = new Cite({
      id: entry.key,
      type: entry.type === "article" ? "article-journal" : entry.type,
      title: entry.fields.title,
      URL: url,
      DOI: entry.fields.doi,
      "container-title": entry.fields.journal || entry.fields.booktitle,
      issued: entry.fields.year ? { "date-parts": [[Number(entry.fields.year) || entry.fields.year]] } : undefined,
      author: authors,
    });
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
