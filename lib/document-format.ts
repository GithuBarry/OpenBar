/**
 * Browser-safe document format detection. Keep Node codecs out of this module.
 */

export type StoredDocumentFormat = "tex" | "markdown" | "html";

export function inferDocumentFormat(body: string, declared?: string): StoredDocumentFormat {
  if (declared === "markdown" || declared === "html" || declared === "tex") return declared;
  if (/^#{1,6}\s+\S/m.test(body)) return "markdown";
  if (/^\s*</.test(body) && /<\/[a-z]/i.test(body)) return "html";
  return "tex";
}
