"use client";

import { memo, useMemo } from "react";

import { TexDocument } from "@/features/paper/tex-document";
import type { BibEntry } from "@/lib/bibtex";
import { texFragmentPreview } from "@/lib/tex-project/tex-hast";

/**
 * Interactive TeX preview via unified-latex → HAST → JSX. Falls back to the
 * custom walker when the HAST path cannot produce a tree, or when the paper
 * has section commands but no heading keys for editor–preview sync.
 */
export const TexHastDocument = memo(function TexHastDocument({
  source,
  bibliography,
  assetBaseUrl,
  pandocTables,
  allowFallback = true,
  requireHeadingKeys = false,
}: {
  source: string;
  bibliography?: BibEntry[];
  assetBaseUrl?: string;
  pandocTables?: Record<string, string>;
  allowFallback?: boolean;
  requireHeadingKeys?: boolean;
}) {
  const options = useMemo(
    () => ({ bibliography, assetBaseUrl, pandocTables }),
    [bibliography, assetBaseUrl, pandocTables],
  );
  const preview = useMemo(() => texFragmentPreview(source, options), [source, options]);
  const needsHeadingKeys = requireHeadingKeys || /\\(?:section|subsection|subsubsection)\*?[{\[]/.test(source);
  const headingOk = Boolean(preview.tree) && (!needsHeadingKeys || preview.headingKeys.length > 0);

  if (preview.tree && headingOk) {
    return <div className="ob-tex-hast tex-document prose max-w-none">{preview.tree}</div>;
  }
  if (allowFallback) {
    return <TexDocument source={source} bibliography={bibliography} assetBaseUrl={assetBaseUrl} />;
  }
  return <p className="text-sm text-muted">This TeX fragment could not be previewed.</p>;
});
