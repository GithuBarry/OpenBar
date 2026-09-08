"use client";

import { memo } from "react";

import { sanitizeHtmlFragmentSync } from "@/lib/html-policy";
import type { PreviewBlock } from "@/lib/tex-project/preview-html";

import { PdfJsViewer } from "./pdf-viewer";

export const TexPreview = memo(function TexPreview({
  project,
  blocks,
}: {
  project: string;
  blocks: PreviewBlock[];
}) {
  return (
    <div className="ob-tex-hast tex-document prose max-w-none">
      {blocks.map((block) => (
        block.kind === "source" ? (
          <pre
            key={block.key}
            className="ob-tex-source-block whitespace-pre-wrap break-words rounded-md border border-line bg-canvas/60 p-3 text-xs"
            data-preview-block={block.key}
            data-preview-from={block.sourceFrom}
            data-preview-to={block.sourceTo}
            title={block.diagnostic}
          >
            {block.diagnostic && <span className="mb-2 block text-danger">{block.diagnostic}</span>}
            {block.html}
          </pre>
        ) : block.kind === "figure" ? (
          <div key={block.key} data-preview-block={block.key} data-preview-from={block.sourceFrom} data-preview-to={block.sourceTo} className="ob-preview-figure">
            <PdfJsViewer project={project} src={block.src} page={block.page} compact />
            {block.caption && (
              <div className="ob-tex-caption" dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragmentSync(block.caption) }} />
            )}
          </div>
        ) : (
          <div
            key={block.key}
            data-preview-block={block.key}
            data-preview-from={block.sourceFrom}
            data-preview-to={block.sourceTo}
            data-ob-heading-key={block.headingKey}
          >
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragmentSync(block.html) }} />
          </div>
        )
      ))}
    </div>
  );
});
