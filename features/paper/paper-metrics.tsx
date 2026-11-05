"use client";

import { FastTooltip } from "@/components/fast-tooltip";
import type { PaperPageBudget } from "@/lib/tex-project/page-budget";
import { formatPaperCount } from "./paper-stats";

export function PaperMetrics({ wordCount, pageBudget, compiling = false, stale = false, compileError, onMeasure }: { wordCount: number; pageBudget?: PaperPageBudget; compiling?: boolean; stale?: boolean; compileError?: string; onMeasure?: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HoverMetric
        id="paper-page-count"
        label={pageBudget && pageBudget.mainMatterPages === undefined ? "PDF pages" : "Pages"}
        value={pageBudget ? `${formatPaperCount(pageBudget.mainMatterPages ?? pageBudget.totalPages)} pp${stale ? " (previous)" : ""}` : compiling ? "Compiling…" : compileError ? "Retry count" : "Count pages"}
        onMeasure={onMeasure}
        disabled={compiling}
        detail={pageBudget ? pageBudgetDetail(pageBudget, wordCount) : `${compileError ? `Compile failed: ${compileError} ` : ""}Words: ${formatPaperCount(wordCount)}. ${compiling ? "The PDF is compiling. Page count will appear when it finishes." : "Select Count pages to compile the PDF and measure its pages."}`}
      />
    </div>
  );
}

function HoverMetric({ id, label, value, detail, onMeasure, disabled }: { id: string; label: string; value: string; detail: string; onMeasure?: () => void; disabled?: boolean }) {
  return (
    <FastTooltip label={`${detail}\n${pageCountTitle(value)}`}>
      <button
        id={id}
        type="button"
        onClick={onMeasure}
        disabled={disabled}
        className="ob-paper-metric"
      >
        <span className="ob-paper-metric-label">{label}</span>
        <span className="ob-paper-metric-value">{value}</span>
      </button>
    </FastTooltip>
  );
}

function pageCountTitle(value: string) { return value.includes("pp") ? "Recompile to update page count" : "Compile the PDF to count pages"; }

function pageBudgetDetail(pageBudget: PaperPageBudget, wordCount: number): string {
  const last = pageBudget.lastNumberedSection;
  return [
    `Words: ${formatPaperCount(wordCount)} in the manuscript body. OpenBar annotations are excluded.`,
    ...(last && pageBudget.mainMatterPages !== undefined ? [
      `Main matter: pages ${pageBudget.firstNumberedPage}–${last.startsOnPage} (${formatPaperCount(pageBudget.mainMatterPages)} pages).`,
      `Last numbered section: §${last.number} ${last.title}, starting on page ${last.startsOnPage}.`,
    ] : ["Count covers the full compiled PDF."]),
    `Full compiled PDF: ${formatPaperCount(pageBudget.totalPages)} pages.`,
    `Measured ${new Date(pageBudget.measuredAt).toLocaleString()}.`,
  ].join("\n");
}
