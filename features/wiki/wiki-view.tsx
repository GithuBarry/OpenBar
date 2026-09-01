"use client";

import React from "react";
import { Sparkles } from "lucide-react";

import { TexHastDocument } from "@/features/paper/tex-hast-document";
import { HtmlDocumentFrame } from "@/features/document/html-frame";
import { MarkdownDocument } from "@/features/document/markdown-document";
import { inferDocumentFormat } from "@/lib/document-format";
import { htmlFrameCapabilities } from "@/lib/html-policy";
import { WikiPage } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export function WikiView({ page, tex }: { page: WikiPage; tex: string }) {
  const format = inferDocumentFormat(tex, page.format);
  const htmlMode = page.htmlMode || "static";
  return (
    <article>
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3 text-xs text-faint">
        {page.pinnedForAgents && (
          <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-accent">
            <Sparkles size={10} /> agent-pinned
          </span>
        )}
        {page.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        <span>created {relativeTime(page.createdAt)}</span>
        <span>updated {relativeTime(page.updatedAt)}</span>
        <span>{format}</span>
        {format === "html" ? <span>{htmlMode}</span> : null}
      </div>
      {page.summary && <p className="mb-4 text-sm text-muted">{page.summary}</p>}
      {format === "html" ? (
        <HtmlDocumentFrame html={tex} mode={htmlMode} capabilities={htmlFrameCapabilities(htmlMode)} />
      ) : format === "markdown" ? (
        <MarkdownDocument source={tex} />
      ) : (
        <TexHastDocument source={tex} assetBaseUrl={`/api/p/${page.projectId}/asset`} />
      )}
    </article>
  );
}
