import path from "node:path";

import { analyzePaper } from "@/lib/research/paper-analysis";

export type PaperSourceHitKind =
  | "section"
  | "claim"
  | "evidence"
  | "comment"
  | "source"
  | "raw"
  | "todo"
  | "question";

export interface PaperSourceHit {
  kind: PaperSourceHitKind;
  line: number;
  section?: string;
  label?: string;
  text: string;
  raw: string;
}

export interface PaperSourceScan {
  label: string;
  path?: string;
  lineCount: number;
  hits: PaperSourceHit[];
  counts: Record<PaperSourceHitKind, number>;
  nextActions: string[];
}

const emptyCounts: Record<PaperSourceHitKind, number> = {
  section: 0,
  claim: 0,
  evidence: 0,
  comment: 0,
  source: 0,
  raw: 0,
  todo: 0,
  question: 0,
};

const sectionPattern = /^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{(.+?)\}/;
const markdownHeadingPattern = /^(#{1,6})\s+(.+?)\s*$/;
const bareTodoPattern = /\b(TODO|FIXME|MISSING EVIDENCE|NEEDS CLAIM CHECK|CITATION NEEDED|PLACEHOLDER|TBD)\b/i;

export function scanPaperSource({
  label,
  filePath,
  source,
}: {
  label: string;
  filePath?: string;
  source: string;
}): PaperSourceScan {
  const hits: PaperSourceHit[] = [];
  const counts = { ...emptyCounts };
  const lines = source.split(/\r?\n/);
  let section = "frontmatter";

  const analysis = analyzePaper(source);
  const liveAnchors = [
    ...analysis.claims.filter((claim) => claim.macro !== "ob-directive"),
    ...analysis.evidence.filter((item) => item.macro !== "ob-directive"),
    ...analysis.todos.filter((todo) => todo.macro !== "ob-directive"),
    ...analysis.comments,
  ];
  const liveAnchorLines = new Set(liveAnchors.map((item) => item.line));
  const sectionAt: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const live = livePortion(line);
    const sectionMatch = live.match(sectionPattern);
    const markdownHeadingMatch = line.match(markdownHeadingPattern);

    if (sectionMatch) {
      section = cleanText(sectionMatch[2]!);
      pushHit(hits, counts, {
        kind: "section",
        line: lineNumber,
        section,
        label: sectionMatch[1],
        text: section,
        raw: line,
      });
    } else if (markdownHeadingMatch) {
      section = cleanText(markdownHeadingMatch[2]!);
      pushHit(hits, counts, {
        kind: "section",
        line: lineNumber,
        section,
        label: markdownHeadingMatch[1],
        text: section,
        raw: line,
      });
    }
    sectionAt[lineNumber] = section;

    for (const marker of analysis.curlyMarkers.filter((item) => item.line === lineNumber)) {
      pushHit(hits, counts, {
        kind: marker.kind === "hypothesized" ? "claim" : "todo",
        line: lineNumber,
        section,
        label: marker.kind,
        text: cleanText(marker.content),
        raw: line,
      });
    }

    const bareTodo = live.match(bareTodoPattern);
    if (bareTodo && !liveAnchorLines.has(lineNumber)) {
      pushHit(hits, counts, {
        kind: "todo",
        line: lineNumber,
        section,
        label: bareTodo[1],
        text: cleanText(live),
        raw: line,
      });
    }

    const htmlComment = line.match(/<!--\s*(.*?)\s*-->/);
    if (htmlComment) {
      for (const hit of commentHits(htmlComment[1]!, line, lineNumber, section)) {
        pushHit(hits, counts, hit);
      }
    }
  }

  for (const claim of analysis.claims.filter((item) => item.macro !== "ob-directive")) {
    pushHit(hits, counts, {
      kind: "claim",
      line: claim.line,
      section: sectionAt[claim.line] || "frontmatter",
      label: claim.macro || "obclaim",
      text: cleanText(claim.text),
      raw: lines[claim.line - 1] || claim.text,
    });
  }
  for (const item of analysis.evidence.filter((entry) => entry.macro !== "ob-directive")) {
    pushHit(hits, counts, {
      kind: macroKind(item.macro || "obevidence"),
      line: item.line,
      section: sectionAt[item.line] || "frontmatter",
      label: item.macro || "obevidence",
      text: cleanText(item.summary),
      raw: lines[item.line - 1] || item.summary,
    });
  }
  for (const todo of analysis.todos.filter((item) => item.macro !== "ob-directive")) {
    pushHit(hits, counts, {
      kind: "todo",
      line: todo.line,
      section: sectionAt[todo.line] || "frontmatter",
      label: todo.macro || "obtodo",
      text: cleanText(todo.text),
      raw: lines[todo.line - 1] || todo.text,
    });
  }
  for (const note of analysis.comments) {
    pushHit(hits, counts, {
      kind: note.kind === "question" ? "question" : macroKind(note.macro),
      line: note.line,
      section: sectionAt[note.line] || "frontmatter",
      label: note.macro,
      text: cleanText(note.text),
      raw: lines[note.line - 1] || note.text,
    });
  }

  return {
    label,
    path: filePath ? path.resolve(filePath) : undefined,
    lineCount: lines.length,
    hits,
    counts,
    nextActions: nextActions(counts),
  };
}

export function renderPaperSourceScanMarkdown(scan: PaperSourceScan, maxHits = 60) {
  const countLine = (Object.keys(scan.counts) as PaperSourceHitKind[])
    .filter((kind) => scan.counts[kind] > 0)
    .map((kind) => `${kind}: ${scan.counts[kind]}`)
    .join(", ");
  const hits = scan.hits.slice(0, maxHits);

  return [
    `# Paper source scan: ${scan.label}`,
    "",
    scan.path ? `- path: ${scan.path}` : undefined,
    `- lines: ${scan.lineCount}`,
    `- markers: ${countLine || "none"}`,
    "",
    "## Hits",
    "",
    hits.length
      ? hits
          .map(
            (hit) =>
              `- L${hit.line} [${hit.kind}${hit.section ? `, ${hit.section}` : ""}] ${hit.text}`,
          )
          .join("\n")
      : "- none",
    scan.hits.length > maxHits ? `\n- ... ${scan.hits.length - maxHits} more hit(s) omitted` : undefined,
    "",
    "## Suggested next moves",
    "",
    scan.nextActions.map((item) => `- ${item}`).join("\n"),
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

function pushHit(
  hits: PaperSourceHit[],
  counts: Record<PaperSourceHitKind, number>,
  hit: PaperSourceHit,
) {
  hits.push(hit);
  counts[hit.kind] += 1;
}

function livePortion(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "%" && line[i - 1] !== "\\") return line.slice(0, i);
  }
  return line;
}

function commentHits(comment: string, raw: string, line: number, section: string): PaperSourceHit[] {
  const text = cleanText(comment);
  if (!text) return [];
  const kind = classifyComment(text);
  if (!kind) return [];
  return [{ kind, line, section, text, raw }];
}

function classifyComment(text: string): PaperSourceHitKind | null {
  const lower = text.toLowerCase();
  if (/\b(claim|hypothesis|theorem)\b/.test(lower)) return "claim";
  if (/\b(comment|note|review|evidence|result|supports|weakens|ablation|metric)\b/.test(lower)) return "comment";
  if (/\b(raw|input|intermediate|output|trace|example|failure case|wandb|w&b|gpu|log)\b/.test(lower)) return "raw";
  if (/\b(source|artifact|overleaf|drive|github|commit|table|figure)\b/.test(lower)) return "source";
  if (/\b(todo|fixme|missing|needs|tbd|placeholder|empty)\b/.test(lower)) return "todo";
  if (/\b(question|why|objection|concern|daphne|advisor)\b/.test(lower)) return "question";
  if (/\bopenbarry\b/.test(lower)) return "source";
  return null;
}

function macroKind(macro: string): PaperSourceHitKind {
  if (macro.includes("claim")) return "claim";
  if (macro.includes("comment") || macro.includes("evidence")) return "comment";
  if (macro.includes("source")) return "source";
  if (macro.includes("raw")) return "raw";
  if (macro.includes("todo") || macro.includes("gap")) return "todo";
  if (macro.includes("question")) return "question";
  return "source";
}

function extractComment(line: string): string | null {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "%" && line[i - 1] !== "\\") return line.slice(i + 1);
  }
  return null;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function nextActions(counts: Record<PaperSourceHitKind, number>): string[] {
  const actions: string[] = [];
  if (counts.todo > 0) {
    actions.push("Open TODO markers remain. Keep them visible until the work is resolved.");
  }
  if (counts.raw > 0) {
    actions.push("Raw artifact markers exist. Register source refs or ingest source notes from those files.");
  }
  if (actions.length === 0) {
    actions.push("Source scan complete. Add an \\obcomment note where a collaborator needs context or a decision.");
  }
  return actions;
}
