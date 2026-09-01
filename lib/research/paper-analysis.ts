/**
 * One TeX analysis pass on unified-latex.
 *
 * Live macros in comments are not claims/todos (`% \obtodo` is not live).
 * `% OB:` directives stay as intentional comment metadata.
 * No MCP, no React.
 */

import { parseAnchorAttrs } from "@/lib/marker-codec";
import { claimFromAnchor, claimFromRecord, type Claim } from "@/lib/research/claim-model";
import { todoMetaFromAttrs, type TodoPriority } from "@/lib/todo-meta";
import { isClaimTag } from "@/lib/research/claim-tags";
import type { Maturity, MaturityMarker, MaturityMarkerKind } from "@/lib/types";
import {
  isMacro,
  mandatoryArgs,
  nodesToPlainText,
  optionalArg,
  parseTex,
  type TexMacro,
} from "@/lib/tex-project/tex-ast";

export type PaperAnchorKind = "claim" | "evidence" | "comment" | "todo" | "source" | "raw" | "question";

export interface PaperHeading {
  command: string;
  title: string;
  line: number;
}

export interface PaperDirective {
  raw: string;
  line: number;
}

export interface PaperClaim extends Claim {
  line: number;
  section?: string;
  attrs: Record<string, string>;
  macro?: string;
}

export interface PaperEvidence {
  id: string;
  summary: string;
  line: number;
  claimIds: string[];
  sourceRef?: string;
  rawRefs: string[];
  metricRefs: string[];
  sampleCount?: number;
  limitations?: string;
  attrs: Record<string, string>;
  macro?: string;
}

export interface PaperTodo {
  id: string;
  text: string;
  line: number;
  start: number;
  end: number;
  claimId?: string;
  section?: string;
  owner?: string;
  /** Optional `priority=p0|p1|p2` (aliases: high/medium/low). */
  priority?: TodoPriority;
  /** Optional target date `due=YYYY-MM-DD`. */
  due?: string;
  /** Optional creation date `created=YYYY-MM-DD`. */
  createdAt?: string;
  attrs: Record<string, string>;
  macro?: string;
}

export interface PaperCitation {
  command: string;
  keys: string[];
  line: number;
}

export interface PaperNote {
  kind: "comment" | "source" | "raw" | "question";
  text: string;
  line: number;
  section?: string;
  attrs: Record<string, string>;
  macro: string;
}

export interface PaperDiagnostic {
  code: string;
  message: string;
  line?: number;
  claimId?: string;
}

export interface PaperMaturitySnapshot {
  overall: Maturity;
  markerCounts: Record<MaturityMarkerKind, number>;
}

export interface PaperAnalysis {
  outline: PaperHeading[];
  claims: PaperClaim[];
  evidence: PaperEvidence[];
  todos: PaperTodo[];
  citations: PaperCitation[];
  markers: MaturityMarker[];
  maturity: PaperMaturitySnapshot;
  diagnostics: PaperDiagnostic[];
  comments: PaperNote[];
  directives: PaperDirective[];
  curlyMarkers: MaturityMarker[];
  lineTodos: MaturityMarker[];
}

const ANCHOR_MACROS: Record<string, PaperAnchorKind> = {
  obclaim: "claim",
  obevidence: "evidence",
  obcomment: "comment",
  obtodo: "todo",
  obsource: "source",
  obraw: "raw",
  obquestion: "question",
  claimgap: "todo",
  evidencegap: "todo",
};

const HEADING_COMMANDS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "title"];
const CITE_COMMANDS = ["cite", "citep", "citet", "obcite"];

export const CURLY_MARKER =
  /\{\?\s*(hypothesized|notfinal|placeholder|verify|cite|citation-needed|todo)\b\s*:?\s*([^:}]*?)(?:\s*:\s*([^}]*?))?\s*\}/gi;
export const CURLY_MARKER_KIND =
  /^(?:hypothesized|notfinal|placeholder|verify|cite|citation-needed|todo)\b/i;
const TODO_MARKER = /(?:^|\s)TODO(?:\([^)]*\))?\s*:?\s*([^\n]*)/gi;
const KIND_ALIASES: Record<string, MaturityMarkerKind> = {
  hypothesized: "hypothesized",
  notfinal: "notfinal",
  placeholder: "placeholder",
  verify: "verify",
  cite: "citation-needed",
  "citation-needed": "citation-needed",
  todo: "todo",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function lineOf(node: unknown): number {
  if (!isRecord(node)) return 1;
  const position = node.position;
  if (isRecord(position) && isRecord(position.start) && typeof position.start.line === "number") {
    return position.start.line;
  }
  return 1;
}

function offsetOf(node: unknown, which: "start" | "end"): number | undefined {
  if (!isRecord(node)) return undefined;
  const position = node.position;
  if (!isRecord(position) || !isRecord(position[which])) return undefined;
  const offset = position[which].offset;
  return typeof offset === "number" ? offset : undefined;
}

/** Original TeX for an argument, using unified-latex source positions — not a second parser. */
function nodesToSource(source: string, nodes: unknown): string {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  let start: number | undefined;
  let end: number | undefined;
  for (const node of list) {
    const from = offsetOf(node, "start");
    const to = offsetOf(node, "end");
    if (from == null || to == null) continue;
    if (start == null || from < start) start = from;
    if (end == null || to > end) end = to;
  }
  if (start == null || end == null) return nodesToPlainText(nodes);
  return source.slice(start, end);
}

function childArrays(node: unknown): unknown[][] {
  const out: unknown[][] = [];
  if (!isRecord(node)) return out;
  if (
    Array.isArray(node.content) &&
    node.type !== "string" &&
    node.type !== "comment" &&
    node.type !== "verb" &&
    node.type !== "verbatim_environment"
  ) {
    out.push(node.content);
  }
  if (Array.isArray(node.args)) {
    for (const arg of node.args) {
      if (isRecord(arg) && Array.isArray(arg.content)) out.push(arg.content);
    }
  }
  return out;
}

function walkLive(node: unknown, visit: (node: unknown) => void): void {
  if (!isRecord(node) || node.type === "comment") return;
  visit(node);
  for (const children of childArrays(node)) {
    for (const child of children) walkLive(child, visit);
  }
}

function walkAll(node: unknown, visit: (node: unknown) => void): void {
  if (!isRecord(node)) return;
  visit(node);
  for (const children of childArrays(node)) {
    for (const child of children) walkAll(child, visit);
  }
}

function macroNameOf(node: TexMacro): string {
  return node.content.replace(/\*$/, "");
}

function splitIds(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function safeTags(raw?: string): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[,\s]+/).filter(Boolean).filter(isClaimTag))];
}

function pushRegexMarkers(
  text: string,
  line: number,
  baseOffset: number,
  pattern: RegExp,
  kindFor: (match: RegExpExecArray) => { kind: MaturityMarkerKind; content: string; note?: string },
  into: MaturityMarker[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const parsed = kindFor(match);
    into.push({
      kind: parsed.kind,
      content: parsed.content.trim(),
      note: parsed.note?.trim() || undefined,
      start: baseOffset + match.index,
      end: baseOffset + match.index + match[0].length,
      line,
    });
  }
}

function emptyMarkerCounts(): Record<MaturityMarkerKind, number> {
  return {
    hypothesized: 0,
    notfinal: 0,
    todo: 0,
    placeholder: 0,
    "citation-needed": 0,
    verify: 0,
  };
}

function asPaperClaim(attrs: Record<string, string>, text: string, line: number, macro: string): PaperClaim {
  const id = attrs.id || `claim-L${line}`;
  const tags = safeTags(attrs.tags);
  let claim: Claim;
  try {
    claim = claimFromAnchor({ ...attrs, id, ...(tags.length ? { tags: tags.join(",") } : { tags: "" }) }, text);
  } catch {
    claim = {
      id,
      text,
      evidenceIds: splitIds(attrs.evidence || attrs.evidenceIds),
      challengeIds: splitIds(attrs.challenges || attrs.challengeIds),
      tags,
      assessments: [],
      state: attrs.state,
    };
  }
  return { ...claim, line, section: attrs.section || undefined, attrs, macro };
}

function asPaperEvidence(attrs: Record<string, string>, summary: string, line: number, macro: string): PaperEvidence {
  const samples = attrs.samples ? Number(attrs.samples) : undefined;
  return {
    id: attrs.id || `evidence-L${line}`,
    summary,
    line,
    claimIds: splitIds(attrs.claim || attrs.claims || attrs.claimIds),
    sourceRef: attrs.source,
    rawRefs: splitIds(attrs.raw || attrs.rawRefs),
    metricRefs: splitIds(attrs.metric || attrs.metricRefs),
    sampleCount: Number.isFinite(samples) ? samples : undefined,
    limitations: attrs.limitations,
    attrs,
    macro,
  };
}

function asPaperTodo(
  attrs: Record<string, string>,
  text: string,
  line: number,
  macro: string,
  start = 0,
  end = 0,
): PaperTodo {
  return {
    id: attrs.id || `todo-off-${start}`,
    text,
    line,
    start,
    end,
    claimId: attrs.claim,
    section: attrs.section,
    ...todoMetaFromAttrs(attrs),
    attrs,
    macro,
  };
}

function ingestDirective(
  raw: string,
  line: number,
  into: { claims: PaperClaim[]; evidence: PaperEvidence[]; todos: PaperTodo[] },
): void {
  const jsonMatch = raw.match(/^\s*(\{.*\})\s*$/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]!) as Record<string, unknown>;
      const type = String(data.type || "").toLowerCase();
      if (type === "claim") {
        const id = String(data.id || `claim-L${line}`);
        try {
          const claim = claimFromRecord({ ...data, id });
          into.claims.push({
            ...claim,
            line,
            section: typeof data.section === "string" ? data.section : undefined,
            attrs: {
              id,
              ...(typeof data.state === "string" ? { state: data.state } : {}),
              ...(typeof data.section === "string" ? { section: data.section } : {}),
              ...(typeof data.scope === "string" ? { scope: data.scope } : {}),
              ...(typeof data.weakness === "string" ? { weakness: data.weakness } : {}),
              ...(typeof data.next === "string" ? { next: data.next } : {}),
            },
            macro: "ob-directive",
          });
        } catch {
          into.claims.push(
            asPaperClaim(
              {
                id,
                ...(typeof data.state === "string" ? { state: data.state } : {}),
                ...(typeof data.section === "string" ? { section: data.section } : {}),
                evidence: Array.isArray(data.evidence) ? data.evidence.map(String).join(",") : String(data.evidence || ""),
              },
              String(data.text || data.claim || ""),
              line,
              "ob-directive",
            ),
          );
        }
      }
      if (type === "evidence") {
        const claimIds = Array.isArray(data.claims)
          ? data.claims.map(String)
          : typeof data.claims === "string"
            ? splitIds(data.claims)
            : data.claim
              ? splitIds(String(data.claim))
              : [];
        const rawRefs = Array.isArray(data.raw) ? data.raw.map(String) : typeof data.raw === "string" ? splitIds(data.raw) : [];
        const metricRefs = Array.isArray(data.metrics)
          ? data.metrics.map(String)
          : typeof data.metrics === "string"
            ? splitIds(data.metrics)
            : [];
        into.evidence.push({
          id: String(data.id || `evidence-L${line}`),
          summary: String(data.summary || data.text || ""),
          line,
          claimIds,
          sourceRef: data.source ? String(data.source) : undefined,
          rawRefs,
          metricRefs,
          sampleCount: typeof data.samples === "number" ? data.samples : undefined,
          limitations: data.limitations ? String(data.limitations) : undefined,
          attrs: { id: String(data.id || "") },
          macro: "ob-directive",
        });
      }
    } catch {
      return;
    }
    return;
  }

  const [kindPart, rest] = raw.trim().split(/\s+/, 2);
  const kind = kindPart.replace(/:$/, "").toLowerCase();
  const attrs = parseAnchorAttrs(rest || "");
  if (kind === "claim") {
    into.claims.push(asPaperClaim(attrs, attrs.text || attrs.claim || "", line, "ob-directive"));
  }
  if (kind === "evidence") {
    into.evidence.push(asPaperEvidence(attrs, attrs.summary || attrs.text || "", line, "ob-directive"));
  }
  if (kind === "todo" || kind === "todo_evidence") {
    into.todos.push(asPaperTodo(attrs, attrs.text || attrs.need || "", line, "ob-directive"));
  }
}

function maturityFrom(markers: MaturityMarker[]): PaperMaturitySnapshot {
  const markerCounts = emptyMarkerCounts();
  for (const marker of markers) markerCounts[marker.kind] += 1;
  let overall: Maturity = "review";
  if (markers.length === 0) overall = "empty";
  else if (markerCounts.hypothesized > 0 || markerCounts.placeholder > 0) overall = "hypothesized";
  else if (
    markerCounts.todo > 0 ||
    markerCounts.notfinal > 0 ||
    markerCounts["citation-needed"] > 0 ||
    markerCounts.verify > 0
  ) {
    overall = "draft";
  }
  return { overall, markerCounts };
}

function diagnosticsOf(claims: PaperClaim[], evidence: PaperEvidence[]): PaperDiagnostic[] {
  const diagnostics: PaperDiagnostic[] = [];
  const seen = new Map<string, number>();
  for (const claim of claims) {
    const prior = seen.get(claim.id);
    if (prior != null) {
      diagnostics.push({
        code: "duplicate-claim-id",
        message: `Claim id "${claim.id}" appears more than once.`,
        line: claim.line,
        claimId: claim.id,
      });
    } else {
      seen.set(claim.id, claim.line);
    }
    const linked = claim.evidenceIds.length > 0 || evidence.some((item) => item.claimIds.includes(claim.id));
    if (!linked) {
      diagnostics.push({
        code: "claim-without-linked-evidence",
        message: `Claim "${claim.id}" has no linked evidence.`,
        line: claim.line,
        claimId: claim.id,
      });
    }
  }
  return diagnostics;
}

export function analyzePaper(source: string): PaperAnalysis {
  const ast = parseTex(source);
  const liveMacros: TexMacro[] = [];
  walkLive(ast, (node) => {
    if (isMacro(node)) liveMacros.push(node);
  });

  const directives: PaperDirective[] = [];
  walkAll(ast, (node) => {
    if (!isRecord(node) || node.type !== "comment") return;
    const content = typeof node.content === "string" ? node.content : "";
    if (/^\s*OB(?::|\s+)/.test(content)) {
      directives.push({ raw: content.replace(/^\s*OB(?::|\s+)/, "").trim(), line: lineOf(node) });
    }
  });

  const claims: PaperClaim[] = [];
  const evidence: PaperEvidence[] = [];
  const todos: PaperTodo[] = [];
  const comments: PaperNote[] = [];
  for (const directive of directives) {
    ingestDirective(directive.raw, directive.line, { claims, evidence, todos });
  }

  const seen = new Set<unknown>();
  for (const node of liveMacros) {
    if (seen.has(node)) continue;
    const name = macroNameOf(node);
    const kind = ANCHOR_MACROS[name];
    if (!kind) continue;
    seen.add(node);
    const attrs = parseAnchorAttrs(nodesToPlainText(optionalArg(node) ?? []));
    const text = nodesToSource(source, mandatoryArgs(node)[0] ?? []).trim();
    const line = lineOf(node);
    if (kind === "claim") claims.push(asPaperClaim(attrs, text, line, name));
    else if (kind === "evidence") evidence.push(asPaperEvidence(attrs, text, line, name));
    else if (kind === "todo") {
      todos.push(asPaperTodo(attrs, text, line, name, offsetOf(node, "start") ?? 0, offsetOf(node, "end") ?? 0));
    }
    else comments.push({ kind, text, line, section: attrs.section, attrs, macro: name });
  }

  for (const node of liveMacros) {
    if (macroNameOf(node) !== "obmarker") continue;
    const args = mandatoryArgs(node);
    const kindRaw = nodesToPlainText(args[0] ?? []).trim().toLowerCase();
    if (kindRaw !== "todo") continue;
    todos.push(asPaperTodo(
      {},
      nodesToSource(source, args[1] ?? []).trim(),
      lineOf(node),
      "obmarker",
      offsetOf(node, "start") ?? 0,
      offsetOf(node, "end") ?? 0,
    ));
  }

  const outline: PaperHeading[] = [];
  for (const node of liveMacros) {
    const command = macroNameOf(node);
    if (!HEADING_COMMANDS.includes(command)) continue;
    outline.push({
      command,
      title: nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim(),
      line: lineOf(node),
    });
  }
  outline.sort((a, b) => a.line - b.line);

  const citations: PaperCitation[] = [];
  for (const node of liveMacros) {
    const command = macroNameOf(node);
    if (!CITE_COMMANDS.includes(command)) continue;
    const keys = nodesToPlainText(mandatoryArgs(node)[0] ?? [])
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    citations.push({ command, keys, line: lineOf(node) });
  }

  const curlyMarkers: MaturityMarker[] = [];
  const lineTodos: MaturityMarker[] = [];
  walkLive(ast, (node) => {
    if (!isRecord(node) || node.type !== "string" || typeof node.content !== "string") return;
    const line = lineOf(node);
    const baseOffset = offsetOf(node, "start") ?? 0;
    pushRegexMarkers(
      node.content,
      line,
      baseOffset,
      CURLY_MARKER,
      (match) => ({
        kind: KIND_ALIASES[match[1]!.toLowerCase()] ?? "notfinal",
        content: match[2] ?? "",
        note: match[3],
      }),
      curlyMarkers,
    );
    pushRegexMarkers(node.content, line, baseOffset, TODO_MARKER, (match) => ({ kind: "todo", content: match[1] ?? "" }), lineTodos);
  });

  const fromAnchors: MaturityMarker[] = [
    ...claims
      .filter((claim) => claim.macro !== "ob-directive")
      .map((claim) => ({
        kind: "hypothesized" as const,
        content: claim.text,
        start: 0,
        end: claim.text.length,
        line: claim.line,
      })),
    ...todos
      .filter((todo) => todo.macro !== "ob-directive")
      .map((todo) => ({
        kind: "todo" as const,
        content: todo.text,
        start: todo.start,
        end: todo.end,
        line: todo.line,
      })),
  ];
  const markers = [...fromAnchors, ...curlyMarkers, ...lineTodos].sort(
    (a, b) => a.line - b.line || a.start - b.start,
  );

  return {
    outline,
    claims,
    evidence,
    todos,
    citations,
    markers,
    maturity: maturityFrom(markers),
    diagnostics: diagnosticsOf(claims, evidence),
    comments,
    directives,
    curlyMarkers,
    lineTodos,
  };
}

export function analysisMaturityMarkers(analysis: PaperAnalysis): MaturityMarker[] {
  return analysis.markers;
}
