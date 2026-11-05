import { safeAssetPath, safeFileSegment } from "./codec";
import { escapeTexText } from "./tex-encode";

/** Generate the TeX insertion for an uploaded manuscript figure. */

interface FigureSpec {
  id: string;
  path: string;
  caption: string;
  width: string;
  position: string;
  page?: number;
  span?: "column" | "page";
  alt?: string;
}

export function figureToTex(spec: FigureSpec): string {
  const safeId = safeFileSegment(spec.id, "figure id");
  const safePath = safeAssetPath(spec.path);
  const width = normalizeWidth(spec.width);
  const position = /^[!htbp]+$/.test(spec.position) ? spec.position : "tbp";
  const page = spec.page && Number.isInteger(spec.page) && spec.page > 0 ? `page=${spec.page},` : "";
  const env = spec.span === "page" ? "figure*" : "figure";
  const metadata = JSON.stringify({
    alt: spec.alt || undefined,
    id: safeId,
    path: safePath,
    position,
    span: spec.span || "column",
    width,
  });
  return [
    `% OB-FIGURE ${metadata}`,
    `\\begin{${env}}[${position}]`,
    "  \\centering",
    `  \\includegraphics[${page}width=${Number.parseFloat(width) / 100}\\linewidth]{${safePath}}`,
    `  \\caption{${escapeTexText(spec.caption)}}`,
    `  \\label{${safeId}}`,
    `\\end{${env}}`,
  ].join("\n");
}

function normalizeWidth(value: string): string {
  const parsed = Number.parseFloat(value.replace(/\\linewidth/g, "").replace("%", ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return "100%";
  return `${Math.round(parsed * 100) / 100}%`;
}
