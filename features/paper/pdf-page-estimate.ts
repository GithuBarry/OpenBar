import type { PaperPageBudget } from "@/lib/tex-project/page-budget";

type PageGeometry = { page: number; width: number; height: number; left: number; bottom: number; top: number; bodyHeight: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Estimate the fraction occupied before a reference heading in a single-column PDF. */
export async function estimateMainMatterPages(pdfSrc: string, budget: PaperPageBudget, signal: AbortSignal): Promise<number | undefined> {
  if (!budget.firstNumberedPage) return undefined;
  const pdfjs = await import("pdfjs-dist");
  if (signal.aborted) return undefined;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ url: pdfSrc, withCredentials: true });
  const abort = () => { void task.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 80 || signal.aborted) return undefined;
    const labels = await pdf.getPageLabels();
    const firstPage = labels ? labels.indexOf(String(budget.firstNumberedPage)) + 1 : budget.firstNumberedPage;
    if (firstPage < 1 || firstPage > pdf.numPages) return undefined;
    const preceding: PageGeometry[] = [];
    for (let number = firstPage; number <= pdf.numPages; number++) {
      if (signal.aborted) return undefined;
      const page = await pdf.getPage(number);
      if (page.rotate % 360 !== 0) return undefined;
      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      if (!(width > 0 && height > 0)) return undefined;
      const content = await page.getTextContent();
      const fragments = content.items.filter(item => "str" in item).filter(item => Boolean(item.str.trim()));
      const references = fragments.filter(item => /^(references|bibliography)$/i.test(item.str.trim()));
      if (references.length && preceding.length) {
        const samples = preceding;
        const left = median(samples.map(item => item.left / item.width)) * width;
        const top = Math.max(...samples.map(item => item.top / item.height)) * height;
        const bottom = Math.min(...samples.map(item => item.bottom / item.height)) * height;
        const textHeight = median(samples.map(item => item.bodyHeight / item.height)) * height;
        const reference = references.find(item => Math.abs((item.transform[4] - x0) - left) <= width * 0.04
          && item.height >= textHeight * 1.05 && item.transform[5] - y0 < top + textHeight && item.transform[5] - y0 > bottom - textHeight);
        if (reference && top - bottom > height * 0.4) {
          const fraction = Math.max(0, Math.min(1, (top - (reference.transform[5] - y0 + reference.height)) / (top - bottom)));
          return Math.round((number - firstPage + fraction) * 10) / 10;
        }
      }
      // Long text fragments distinguish ordinary full-width body lines from
      // multi-column layouts. Uncertain geometry uses the integer count.
      const wide = fragments.filter(item => item.width >= width * 0.4
        && item.transform[5] - y0 >= height * 0.1 && item.transform[5] - y0 <= height * 0.9);
      if (wide.length >= 12) preceding.push({ page: number, width, height, left: median(wide.map(item => item.transform[4] - x0)),
        bottom: Math.min(...wide.map(item => item.transform[5] - y0)), top: Math.max(...wide.map(item => item.transform[5] - y0)),
        bodyHeight: median(wide.map(item => item.height)) });
      page.cleanup();
    }
    return undefined;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy().catch(() => undefined);
  }
}
