"use client";

import { FastTooltip } from "@/components/fast-tooltip";
import type { PaperPageBudget } from "@/lib/tex-project/page-budget";
import { useEffect, useState } from "react";
import { estimateMainMatterPages } from "./pdf-page-estimate";
import { formatPaperCount } from "./paper-stats";

export function PaperMetrics({ wordCount, pageBudget, pdfSrc, compiling = false, stale = false, compileError, onMeasure }: { wordCount: number; pageBudget?: PaperPageBudget; pdfSrc?: string | null; compiling?: boolean; stale?: boolean; compileError?: string; onMeasure?: () => void }) {
  const [estimate, setEstimate] = useState<{ pdfSrc: string; firstPage: number; value: number }>();
  useEffect(() => {
    if (!pdfSrc || !pageBudget?.firstNumberedPage) return;
    const controller = new AbortController();
    void estimateMainMatterPages(pdfSrc, pageBudget, controller.signal).then(value => {
      if (!controller.signal.aborted && value !== undefined) setEstimate({ pdfSrc, firstPage: pageBudget.firstNumberedPage!, value });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [pdfSrc, pageBudget?.firstNumberedPage]);
  const fractional = estimate && estimate.pdfSrc === pdfSrc && estimate.firstPage === pageBudget?.firstNumberedPage ? estimate.value : undefined;
  const pageCount = fractional ?? pageBudget?.mainMatterPages ?? pageBudget?.totalPages;
  const countText = pageCount !== undefined ? `${fractional !== undefined ? `≈${fractional.toFixed(1)}` : formatPaperCount(pageCount)}${stale ? "*" : ""} ${pageCount === 1 ? "page" : "pages"}` : compiling ? "Compiling…" : compileError ? "Retry count" : "Count pages";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HoverMetric
        id="paper-page-count"
        value={countText}
        accessibility={pageCount !== undefined && stale ? `${fractional !== undefined ? "Approximately " : ""}${pageCount} ${pageCount === 1 ? "page" : "pages"}, previous compiled PDF` : undefined}
        measured={Boolean(pageBudget)}
        onMeasure={onMeasure}
        disabled={compiling}
        detail={pageBudget ? pageBudgetDetail(pageBudget, wordCount, fractional, stale) : `${compileError ? `Compile failed: ${compileError} ` : ""}Words: ${formatPaperCount(wordCount)}. ${compiling ? "The PDF is compiling. Page count will appear when it finishes." : "Select Count pages to compile the PDF and measure its pages."}`}
      />
    </div>
  );
}

function HoverMetric({ id, value, detail, accessibility, onMeasure, disabled, measured }: { id: string; value: string; detail: string; accessibility?: string; onMeasure?: () => void; disabled?: boolean; measured: boolean }) {
  return (
    <FastTooltip label={`${detail}\n${measured ? "Recompile to update page count" : "Compile the PDF to count pages"}`}>
      <button
        id={id}
        type="button"
        aria-label={accessibility}
        onClick={onMeasure}
        disabled={disabled}
        className="ob-paper-metric"
      >
        <span className="ob-paper-metric-value">{value}</span>
      </button>
    </FastTooltip>
  );
}

function pageBudgetDetail(pageBudget: PaperPageBudget, wordCount: number, fractional: number | undefined, stale: boolean): string {
  const last = pageBudget.lastNumberedSection;
  return [
    `Words: ${formatPaperCount(wordCount)} in the manuscript body. OpenBar annotations are excluded.`,
    ...(fractional !== undefined ? [`Estimated main matter: ${fractional.toFixed(1)} pages, from the first numbered section page to the start of references. The final fraction estimates vertical space used on the reference page and includes gaps and figures.`] : []),
    ...(last && pageBudget.mainMatterPages !== undefined ? [
      `${fractional === undefined ? "Whole-page fallback through the start of the last numbered section" : "Numbered section start pages"}: ${pageBudget.firstNumberedPage}–${last.startsOnPage}.`,
      `Last numbered section: §${last.number} ${last.title}, starting on page ${last.startsOnPage}.`,
    ] : ["Count covers the full compiled PDF."]),
    `Full compiled PDF: ${formatPaperCount(pageBudget.totalPages)} pages.`,
    ...(stale ? ["* The count comes from an earlier compiled PDF. Recompile to update it."] : []),
    `Measured ${new Date(pageBudget.measuredAt).toLocaleString()}.`,
  ].join("\n");
}
