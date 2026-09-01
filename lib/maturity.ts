/**
 * OpenBar — maturity engine.
 *
 * The platform's central idea: research artifacts mature from an empty scaffold
 * into a finished draft, and immaturity must stay *visible* the whole way so
 * nothing provisional silently hardens into "final" — and so an AI collaborator
 * can never mistake a scaffold for a finished result.
 *
 * Authors annotate prose with lightweight inline markers. This module parses
 * them, scores section- and document-level maturity, and produces the "open
 * items" list the MCP server hands to coding agents.
 *
 * Marker syntax (deliberately simple, survives LaTeX and plain markdown):
 *
 *   {?hypothesized: ...}       a hypothesis
 *   {?notfinal: ...}           provisional wording
 *   {?placeholder: ...}        a stand-in to be replaced
 *   {?verify: ...}             a claim needing verification
 *   [[cite]] or {?cite}        citation needed
 *   TODO: ... / TODO(x): ...   a task
 *   \todo{...}                 LaTeX-style todo (todonotes package)
 *   <!-- FIGURE: ... -->       a planned-but-missing figure
 *   | --- | (empty table row)  an empty table cell scaffold
 *
 * A note can be attached after a second colon:
 *   {?hypothesized: 12ms : from a single run, needs averaging}
 *
 * Everything here is pure and dependency-free so it runs identically in the
 * browser editor, in Node during build, and inside the MCP server.
 */

import {
  DraftSection,
  Maturity,
  MATURITY_META,
  MaturityMarker,
  MaturityMarkerKind,
} from "./types";
import { analyzePaper } from "@/lib/research/paper-analysis";
import { TEX_HEADING_LINE, texHeadingLevel } from "./tex-project/paper-compose";

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

/** Matches {?kind: content} and {?kind: content : note}. */
const CURLY_MARKER = /\{\?\s*(hypothesized|notfinal|placeholder|verify|cite|citation-needed|todo)\b\s*:?\s*([^:}]*?)(?:\s*:\s*([^}]*?))?\s*\}/gi;

/** TODO: text  or  TODO(owner): text — line-anchored. */
const TODO_MARKER = /(?:^|\s)TODO(?:\([^)]*\))?\s*:?\s*([^\n]*)/gi;

/** LaTeX \todo{...} / \obtodo[...]{...}. Nested braces are not required here. */
const LATEX_TODO = /\\(?:ob)?todo(?:\[[^\]]*\])?\{([^}]*)\}/gi;

/** [[cite]] / [[citation needed]] wiki-style, and bare \cite{?} placeholders. */
const CITE_MARKER = /\[\[\s*(?:cite|citation needed|citation-needed)\s*\]\]|\\cite\{\s*\?\s*\}/gi;

/** <!-- FIGURE: caption --> / <!-- PLOT: ... --> planned figures. */
const FIGURE_MARKER = /<!--\s*(?:FIGURE|PLOT|TABLE)\s*:\s*([^>]*?)\s*-->/gi;

const KIND_ALIASES: Record<string, MaturityMarkerKind> = {
  hypothesized: "hypothesized",
  notfinal: "notfinal",
  placeholder: "placeholder",
  verify: "verify",
  cite: "citation-needed",
  "citation-needed": "citation-needed",
  todo: "todo",
};

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Extract every maturity marker from a block of source text. Offsets are
 * relative to the passed-in text; callers working on a section pass the section
 * body and add the section start offset if they need document coordinates.
 */
export function parseMarkers(text: string): MaturityMarker[] {
  const fromAnalysis = analyzePaper(text).markers;
  // Keep markdown-only markers (cite brackets, planned figures) that are not TeX macros.
  const extras: MaturityMarker[] = [];
  const push = (
    kind: MaturityMarkerKind,
    content: string,
    start: number,
    end: number,
    note?: string,
  ) => {
    extras.push({
      kind,
      content: content.trim(),
      note: note?.trim() || undefined,
      start,
      end,
      line: lineAt(text, start),
    });
  };

  let m: RegExpExecArray | null;
  CITE_MARKER.lastIndex = 0;
  while ((m = CITE_MARKER.exec(text))) {
    if (text.slice(0, m.index).split("\n").pop()?.includes("%")) continue;
    push("citation-needed", "", m.index, m.index + m[0].length);
  }

  FIGURE_MARKER.lastIndex = 0;
  while ((m = FIGURE_MARKER.exec(text))) {
    push("placeholder", m[1] ?? "figure", m.index, m.index + m[0].length);
  }

  return [...fromAnalysis, ...extras].sort((a, b) => a.line - b.line || a.start - b.start);
}

// ---------------------------------------------------------------------------
// Structural placeholder detection
// ---------------------------------------------------------------------------

/** An empty markdown table row: cells that are blank or only whitespace. */
const EMPTY_TABLE_ROW = /^\s*\|(?:\s*\|)+\s*$/gm;
/** A markdown table divider row (|---|---|). */
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/gm;

export function detectPlaceholders(body: string): DraftSection["placeholders"] {
  const emptyTables = (body.match(EMPTY_TABLE_ROW) || []).length;
  const missingFigures = (body.match(FIGURE_MARKER) || []).length;
  const todos =
    (body.match(TODO_MARKER) || []).length + (body.match(LATEX_TODO) || []).length;

  // "Empty body": nothing but whitespace, a lone table skeleton, or a single
  // placeholder marker. This is what makes a section count as a scaffold.
  const stripped = body
    .replace(CURLY_MARKER, "")
    .replace(FIGURE_MARKER, "")
    .replace(TABLE_DIVIDER, "")
    .replace(EMPTY_TABLE_ROW, "")
    .replace(/[|\-\s]/g, "")
    .trim();

  return {
    emptyTables,
    missingFigures,
    todos,
    emptyBody: stripped.length < 3,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a section's maturity from its content and markers.
 *
 * Precedence:
 *  1. An author-declared maturity (front-matter or {maturity=...}) always wins.
 *  2. An empty / scaffold body is `empty`.
 *  3. Otherwise the *least mature* marker present pins the ceiling: a section
 *     with any hypothesis marker caps at `hypothesized`, an unresolved TODO / citation / verify caps at
 *     `draft`. This is deliberate — immaturity is contagious upward so nothing
 *     hides.
 *  4. A clean, non-trivial body with no open markers reads as `review`
 *     (believed correct, not yet human-verified → not auto-promoted to final).
 */
export function scoreSection(
  body: string,
  markers: MaturityMarker[],
  declared?: Maturity,
): Maturity {
  if (declared) return declared;

  const placeholders = detectPlaceholders(body);
  if (placeholders.emptyBody) return "empty";

  const kinds = new Set(markers.map((m) => m.kind));

  if (kinds.has("hypothesized") || kinds.has("placeholder")) return "hypothesized";
  if (
    kinds.has("todo") ||
    kinds.has("notfinal") ||
    kinds.has("citation-needed") ||
    kinds.has("verify") ||
    placeholders.emptyTables > 0 ||
    placeholders.missingFigures > 0
  ) {
    return "draft";
  }

  return "review";
}

/**
 * Weight a section's contribution to overall completion by its body length
 * (longer sections matter more) and map maturity rank to a 0..1 fraction.
 */
export function sectionCompletion(section: DraftSection): number {
  return MATURITY_META[section.computedMaturity].rank / 5;
}

export function rollUpMaturity(sections: DraftSection[]): {
  completion: number;
  overall: Maturity;
} {
  if (sections.length === 0) return { completion: 0, overall: "empty" };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of sections) {
    const weight = Math.max(1, s.body.trim().length);
    weightedSum += sectionCompletion(s) * weight;
    totalWeight += weight;
  }
  const completion = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Overall maturity is the *floor* across sections that have real content —
  // a paper is only as mature as its least-mature section. Empty sections are
  // included so a scaffolded-but-unwritten section drags the whole doc down.
  const minRank = Math.min(...sections.map((s) => MATURITY_META[s.computedMaturity].rank));
  const overall =
    (Object.keys(MATURITY_META) as Maturity[]).find(
      (k) => MATURITY_META[k].rank === minRank,
    ) ?? "empty";

  return { completion, overall };
}

// ---------------------------------------------------------------------------
// Document sectioning
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,4})\s+(.*)$/;
/** Optional per-heading maturity hint: `## Results {maturity=draft}`. */
const HEADING_MATURITY = /\{maturity\s*=\s*(empty|hypothesized|draft|review|final)\}/i;

/**
 * Split a TeX paper (or a leftover markdown draft) into sections at headings
 * and score each. `\title{...}` is the document title, not a section.
 * Content before the first section heading becomes a synthetic "Preamble".
 */
export function parseDraft(source: string): DraftSection[] {
  const lines = source.split("\n");
  const sections: DraftSection[] = [];

  const lineStarts: number[] = [];
  {
    let off = 0;
    for (const l of lines) {
      lineStarts.push(off);
      off += l.length + 1;
    }
  }

  type Pending = { depth: number; title: string; declared?: Maturity; startLine: number };
  let pending: Pending | null = null;
  let bodyStartLine = 0;

  const flush = (endLine: number) => {
    const start = lineStarts[bodyStartLine] ?? 0;
    const end = endLine < lines.length ? lineStarts[endLine] : source.length;
    const body =
      pending == null
        ? source.slice(0, end).trim()
        : source.slice(lineStarts[pending.startLine + 1] ?? end, end);

    const title = pending?.title ?? "Preamble";
    const depth = pending?.depth ?? 1;
    const declared = pending?.declared;
    const headingLine = pending?.startLine ?? 0;

    if (pending == null && body.trim().length === 0) return;

    const markers = parseMarkers(body);
    const placeholders = detectPlaceholders(body);
    const computed = scoreSection(body, markers, declared);

    sections.push({
      id: slugifyHeading(title, sections.length),
      depth,
      title,
      body,
      declaredMaturity: declared,
      computedMaturity: computed,
      markers,
      placeholders,
      start,
      end,
      line: headingLine + 1,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const tex = TEX_HEADING_LINE.exec(lines[i] || "");
    if (tex) {
      if (tex[1] === "title") continue;
      if (pending != null || i > 0) flush(i);
      pending = {
        depth: texHeadingLevel(tex[1]!),
        title: tex[2]!.replace(/\s+\{[^}]*\}\s*$/, "").trim(),
        startLine: i,
      };
      bodyStartLine = i;
      continue;
    }
    const h = HEADING.exec(lines[i]);
    if (h) {
      if (pending != null || i > 0) flush(i);
      const rawTitle = h[2].trim();
      const mm = HEADING_MATURITY.exec(rawTitle);
      const declared = mm ? (mm[1].toLowerCase() as Maturity) : undefined;
      const title = rawTitle.replace(HEADING_MATURITY, "").trim();
      pending = { depth: h[1].length, title, declared, startLine: i };
      bodyStartLine = i;
    }
  }
  flush(lines.length);

  return sections;
}

function slugifyHeading(title: string, ord: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `${base}` : `section-${ord}`;
}

// ---------------------------------------------------------------------------
// Open-items extraction — the anti-"I finished everything" list for agents.
// ---------------------------------------------------------------------------

export interface OpenItem {
  section: string;
  kind: MaturityMarkerKind | "empty-section";
  text: string;
  line: number;
}

/**
 * The explicit inventory of what is *not done* in a draft. The MCP server hands
 * this to coding agents so they cannot claim the work is complete while
 * scaffolds, hypotheses, and TODOs remain.
 */
export function extractOpenItems(sections: DraftSection[]): OpenItem[] {
  const items: OpenItem[] = [];
  for (const s of sections) {
    if (s.placeholders.emptyBody && s.title !== "Preamble") {
      items.push({
        section: s.title,
        kind: "empty-section",
        text: `Section "${s.title}" is an empty scaffold with no real content.`,
        line: s.line,
      });
    }
    for (const mk of s.markers) {
      items.push({
        section: s.title,
        kind: mk.kind,
        text:
          mk.content.trim().length > 0
            ? `${mk.kind}: ${mk.content}${mk.note ? ` — ${mk.note}` : ""}`
            : `${mk.kind}${mk.note ? `: ${mk.note}` : ""}`,
        line: s.line + Math.max(0, lineAt(s.body, mk.start) - 1),
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Convenience: full analysis of a raw source string.
// ---------------------------------------------------------------------------

export interface DraftAnalysis {
  sections: DraftSection[];
  completion: number;
  overallMaturity: Maturity;
  openItems: OpenItem[];
  markerCounts: Record<MaturityMarkerKind, number>;
}

export function analyzeDraft(source: string): DraftAnalysis {
  const sections = parseDraft(source);
  const { completion, overall } = rollUpMaturity(sections);
  const openItems = extractOpenItems(sections);

  const markerCounts = {
    hypothesized: 0,
    notfinal: 0,
    todo: 0,
    placeholder: 0,
    "citation-needed": 0,
    verify: 0,
  } as Record<MaturityMarkerKind, number>;
  for (const s of sections) {
    for (const mk of s.markers) markerCounts[mk.kind]++;
  }

  return { sections, completion, overallMaturity: overall, openItems, markerCounts };
}
