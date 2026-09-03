"use client";

import { useRef, useState, type FocusEvent, type MouseEvent } from "react";

import { AnchoredPop } from "@/components/pop";
import type { PaperPageBudget } from "@/lib/tex-project/page-budget";
import { formatPaperCount } from "./paper-stats";

export function PaperMetrics({ wordCount, pageBudget }: { wordCount: number; pageBudget?: PaperPageBudget }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HoverMetric
        id="paper-word-count"
        label="Words"
        value={formatPaperCount(wordCount)}
        detail={`${formatPaperCount(wordCount)} words in the manuscript body. OpenBar annotations are excluded.`}
      />
      <HoverMetric
        id="paper-page-count"
        label="Pages"
        value={pageBudget ? `${formatPaperCount(pageBudget.mainMatterPages)} pp` : "Pending"}
        detail={pageBudget ? pageBudgetDetail(pageBudget) : "Compile the paper to measure numbered manuscript pages."}
      />
    </div>
  );
}

function HoverMetric({ id, label, value, detail }: { id: string; label: string; value: string; detail: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const tooltipId = `${id}-detail`;

  const show = (_event: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) => setOpen(true);
  const hide = (_event: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) => setOpen(false);

  return (
    <span
      ref={anchorRef}
      tabIndex={0}
      role="status"
      aria-describedby={open ? tooltipId : undefined}
      className="ob-paper-metric"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className="ob-paper-metric-label">{label}</span>
      <span className="ob-paper-metric-value">{value}</span>
      <AnchoredPop open={open} anchorRef={anchorRef}>
        <span id={tooltipId} role="tooltip" className="block max-w-72 text-[11px] leading-snug text-ink">
          {detail}
        </span>
      </AnchoredPop>
    </span>
  );
}

function pageBudgetDetail(pageBudget: PaperPageBudget): string {
  const last = pageBudget.lastNumberedSection;
  return [
    `Main matter: pages ${pageBudget.firstNumberedPage}–${last.startsOnPage} (${formatPaperCount(pageBudget.mainMatterPages)} pages).`,
    `Last numbered section: §${last.number} ${last.title}, starting on page ${last.startsOnPage}.`,
    `Full compiled PDF: ${formatPaperCount(pageBudget.totalPages)} pages.`,
    `Measured ${new Date(pageBudget.measuredAt).toLocaleString()}.`,
  ].join(" ");
}
