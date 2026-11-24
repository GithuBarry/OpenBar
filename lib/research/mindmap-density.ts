import type { MindmapNode } from "@/lib/types";
import { markdownTableColumns, markdownTableHasVerboseHeaders } from "@/lib/mindmap/markdown-table";
import { stripInlineInfoNotes } from "@/lib/mindmap/inline-info-notes";
import type { OperationDiagnostic } from "./operation-result";

type VisibleCard = Pick<MindmapNode, "id" | "title" | "text" | "todoId" | "contentFormat">;
type DensityIssue = "table_headers" | "long_prose";

function densityIssue(node: VisibleCard): DensityIssue | undefined {
  if (node.todoId || node.contentFormat === "html") return;
  if (markdownTableHasVerboseHeaders(node.text)) return "table_headers";
  if (markdownTableColumns(node.text)) return;
  let words = 0;
  for (const raw of [node.title || "", node.text]) {
    const text = node.contentFormat === "markdown" ? stripInlineInfoNotes(raw) : raw;
    const token = /\S+/g;
    while (token.exec(text)) if (++words > 160) return "long_prose";
  }
}

/** Optional, response-local advice for a newly introduced content-density issue. */
export function mindmapDensityHint(
  updatedNodes: readonly VisibleCard[],
  beforeNodes: readonly VisibleCard[],
): OperationDiagnostic[] | undefined {
  const beforeById = new Map(beforeNodes.map(node => [node.id, node]));
  for (const node of updatedNodes) {
    const before = beforeById.get(node.id);
    if (before && before.title === node.title && before.text === node.text) continue;
    const issue = densityIssue(node);
    if (!issue || (before && densityIssue(before) === issue)) continue;
    const card = `Card ${JSON.stringify(node.id.slice(0, 80))}`;
    return [{
      severity: "info",
      code: "mindmap_density_hint",
      message: issue === "table_headers"
        ? `${card}: Long headings over short values. Consider compact "Metric /N" headers, <br> line breaks, or ((detail)) hover notes, and define N once.`
        : `${card}: Over 160 visible words. Consider aiming near 80 and moving supporting detail into collapsed Notes or distinct child cards.`,
    }];
  }
}
