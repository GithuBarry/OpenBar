/**
 * Legacy adapter. `analyzePaper` in `lib/research/paper-analysis.ts` is the
 * source of truth. Keep this wrapper so existing imports keep working.
 */

import {
  analyzePaper,
  analysisMaturityMarkers,
  type PaperAnchorKind,
  type PaperDirective,
  type PaperHeading,
} from "@/lib/research/paper-analysis";
import type { MaturityMarker } from "@/lib/types";

export type { PaperAnchorKind, PaperDirective, PaperHeading };
export { analyzePaper, analysisMaturityMarkers };

export interface PaperAnchor {
  kind: PaperAnchorKind;
  name: string;
  attrs: Record<string, string>;
  text: string;
  line: number;
}

export interface PaperAnalysis {
  anchors: PaperAnchor[];
  directives: PaperDirective[];
  headings: PaperHeading[];
  curlyMarkers: MaturityMarker[];
  lineTodos: MaturityMarker[];
}

export function analyzePaperTex(source: string): PaperAnalysis {
  const analysis = analyzePaper(source);
  const live = <T extends { macro?: string }>(items: T[]) => items.filter((item) => item.macro !== "ob-directive");
  const anchors: PaperAnchor[] = [
    ...live(analysis.claims).map((claim) => ({
      kind: "claim" as const,
      name: claim.macro || "obclaim",
      attrs: claim.attrs,
      text: claim.text,
      line: claim.line,
    })),
    ...live(analysis.evidence).map((item) => ({
      kind: "evidence" as const,
      name: item.macro || "obevidence",
      attrs: item.attrs,
      text: item.summary,
      line: item.line,
    })),
    ...live(analysis.todos).map((todo) => ({
      kind: "todo" as const,
      name: todo.macro || "obtodo",
      attrs: todo.attrs,
      text: todo.text,
      line: todo.line,
    })),
    ...analysis.comments.map((note) => ({
      kind: note.kind,
      name: note.macro,
      attrs: note.attrs,
      text: note.text,
      line: note.line,
    })),
  ];
  return {
    anchors,
    directives: analysis.directives,
    headings: analysis.outline,
    curlyMarkers: analysis.curlyMarkers,
    lineTodos: analysis.lineTodos,
  };
}
