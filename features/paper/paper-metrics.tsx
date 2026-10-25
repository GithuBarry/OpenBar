"use client";

import { FastTooltip } from "@/components/fast-tooltip";
import type { PaperPageBudget } from "@/lib/tex-project/page-budget";
import { formatPaperCount } from "./paper-stats";

export function PaperMetrics({ wordCount, pageBudget }: { wordCount: number; pageBudget?: PaperPageBudget }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HoverMetric
        id="paper-page-count"
        label="Pages"
        value={pageBudget ? `${formatPaperCount(pageBudget.mainMatterPages)} pp` : "Pending"}
        detail={pageBudget ? pageBudgetDetail(pageBudget, wordCount) : `Words: ${formatPaperCount(wordCount)} in the manuscript body. OpenBar annotations are excluded. Compile the paper to measure numbered manuscript pages.`}
      />
    </div>
  );
}

function HoverMetric({ id, label, value, detail }: { id: string; label: string; value: string; detail: string }) {
  return (
    <FastTooltip label={detail}>
      <span id={id} tabIndex={0} role="status" className="ob-paper-metric">
        <span className="ob-paper-metric-label">{label}</span>
        <span className="ob-paper-metric-value">{value}</span>
      </span>
    </FastTooltip>
  );
}

function pageBudgetDetail(pageBudget: PaperPageBudget, wordCount: number): string {
  const last = pageBudget.lastNumberedSection;
  return [
    `Words: ${formatPaperCount(wordCount)} in the manuscript body. OpenBar annotations are excluded.`,
    `Main matter: pages ${pageBudget.firstNumberedPage}–${last.startsOnPage} (${formatPaperCount(pageBudget.mainMatterPages)} pages).`,
    `Last numbered section: §${last.number} ${last.title}, starting on page ${last.startsOnPage}.`,
    `Full compiled PDF: ${formatPaperCount(pageBudget.totalPages)} pages.`,
    `Measured ${new Date(pageBudget.measuredAt).toLocaleString()}.`,
  ].join("\n");
}
