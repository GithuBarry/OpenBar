import { markdownTableColumns } from "./markdown-table";

/** Lightly detect Markdown syntax (tables, headings, lists, links, emphasis, code, blockquotes). */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  if (markdownTableColumns(text) > 0) return true;
  if (/\[[^\]\n]+\]\((?:https?:\/\/|\/|#)[^)\s]+\)/.test(text)) return true;
  if (/\*\*[^*\s][^*\n]*\*\*/.test(text)) return true;
  if (/`[^`\n]+`/.test(text) || /^```/m.test(text)) return true;
  if (/^#{1,6}\s+\S/m.test(text)) return true;
  if (/^[ \t]*[-*]\s+\S/m.test(text)) return true;
  if (/(?:^|\n)[ \t]*\d+\.\s+\S[\s\S]*\n[ \t]*\d+\.\s+\S/.test(text)) return true;
  if (/^[ \t]*>\s+\S/m.test(text)) return true;
  if (/(?:^|[\s(])\*[^*\s][^*\n]*?\*(?=[\s.,;:!?)]|$)/.test(text)) return true;
  if (/~~[^~\s][^~\n]*~~/.test(text)) return true;
  return false;
}
