import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

export type LatexLspContext = { project: string; source: string; file: string; fileFrom: number; available: boolean };

/** Request completions explicitly so launching TexLab never blocks ordinary typing. */
export function latexLspCompletions(read: () => LatexLspContext | undefined) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const current = read();
    if (!current?.available || !context.explicit) return null;
    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort());
    try {
      const response = await fetch(`/api/p/${encodeURIComponent(current.project)}/paper/language`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: current.source, file: current.file, offset: current.fileFrom + context.pos }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const result = await response.json() as { items?: Array<{ label: string; detail?: string; insert: string; from: number; to: number }> };
      const items = (result.items ?? []).filter((item) => item.from >= current.fileFrom && item.to === current.fileFrom + context.pos);
      const from = items.length ? Math.min(...items.map((item) => item.from)) : undefined;
      if (from === undefined) return null;
      return {
        from: from - current.fileFrom,
        options: items.filter((item) => item.from === from).map((item) => ({ label: item.label, detail: item.detail, apply: item.insert })),
      };
    } catch {
      return null;
    }
  };
}
