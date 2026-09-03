/**
 * Legacy adapter. `analyzePaper` is the source of truth.
 */

import { analyzePaper, type PaperDirective, type PaperHeading, type PaperTodo } from "@/lib/research/paper-analysis";

export type { PaperDirective, PaperHeading, PaperTodo };
export { analyzePaper };

export interface PaperAnchor {
  kind: "todo" | "comment";
  name: string;
  attrs: Record<string, string>;
  text: string;
  line: number;
}

export function analyzePaperTex(source: string) {
  const analysis = analyzePaper(source);
  return {
    headings: analysis.outline,
    todos: analysis.todos,
    comments: analysis.comments,
    diagnostics: analysis.diagnostics,
    directives: analysis.directives,
    anchors: [
      ...analysis.todos.map((todo) => ({
        kind: "todo" as const,
        name: todo.macro,
        attrs: todo.attrs,
        text: todo.text,
        line: todo.line,
      })),
      ...analysis.comments.map((note) => ({
        kind: "comment" as const,
        name: note.macro,
        attrs: note.attrs,
        text: note.text,
        line: note.line,
      })),
    ] satisfies PaperAnchor[],
  };
}
