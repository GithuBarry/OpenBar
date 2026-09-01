/**
 * Document body bytes. Routine previews derive from native source bytes.
 */

import { inferDocumentFormat as inferClientDocumentFormat } from "@/lib/document-format";
import type { StoredDocumentFormat } from "@/lib/document-format";
import { texToMarkdown } from "./obmd";

export type { StoredDocumentFormat };

export function inferDocumentFormat(body: string, declared?: string): StoredDocumentFormat {
  const inferred = inferClientDocumentFormat(body, declared);
  return inferred;
}

export function prepareDocumentBody(body: string, _format: StoredDocumentFormat): {
  body: string;
  converted: boolean;
} {
  // Every document format keeps its native bytes. Cross-format conversion is
  // explicit when an agent or server caller requests a durable sidecar, so a
  // TeX percent, brace, backslash, table, or custom environment stays intact.
  return { body, converted: false };
}

export function previewTexAsMarkdown(tex: string): string {
  return texToMarkdown(tex);
}
