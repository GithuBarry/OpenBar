"use client";

import { MarkdownDocument } from "@/features/document/markdown-document";
import { WikiPage } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export function WikiView({ page }: { page: WikiPage }) {
  return (
    <article>
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3 text-xs text-faint">
        {(page.tags || []).map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        <span>created {relativeTime(page.createdAt)}</span>
        <span>updated {relativeTime(page.updatedAt)}</span>
      </div>
      {page.body.trim() ? (
        <MarkdownDocument source={page.body} />
      ) : (
        <p className="text-sm text-faint">Empty page.</p>
      )}
    </article>
  );
}

export function wikiBacklinks(pages: WikiPage[], slug: string): WikiPage[] {
  const needle = `/wiki/${slug}`;
  const wikiLink = `[[${slug}]]`;
  return pages.filter((page) => (
    page.slug !== slug
    && (page.body.includes(needle) || page.body.includes(wikiLink) || page.body.includes(`](${slug})`))
  ));
}
