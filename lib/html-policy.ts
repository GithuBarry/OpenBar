/**
 * HTML preview policy. Static frames omit scripts. Interactive frames use
 * an opaque origin plus a strict CSP. Fragments entering the parent are
 * stripped of executable and embedded content.
 */

import createDOMPurify from "dompurify";

export type HtmlMode = "static" | "interactive";

const STATIC_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; sandbox";
const INTERACTIVE_CSP = "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts";

export function htmlFrameSandbox(mode: HtmlMode): string {
  return mode === "interactive" ? "allow-scripts" : "";
}

let cachedPurifier: ReturnType<typeof createDOMPurify> | null = null;

/** Synchronous sanitizer for SSR and parent-document fragments. */
export function sanitizeHtmlFragmentSync(html: string): string {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    cachedPurifier ??= createDOMPurify(window);
    return cachedPurifier.sanitize(html, {
      ALLOW_DATA_ATTR: true,
      ADD_TAGS: ["math", "mi", "mn", "mo", "mrow", "ms", "mspace", "msup", "msub", "mover", "munder", "munderover", "annotation", "semantics"],
      ADD_ATTR: ["data-ob-heading-key", "data-cite-keys", "aria-label", "aria-hidden"],
      USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
    });
  }
  // Server rendering has no DOM to hand to DOMPurify. Keep the conservative
  // fallback for that path; browser previews always use the library above.
  return stripScripts(html).replace(/<\/?(?:iframe|object|embed|link|meta|base)[^>]*>/gi, "");
}

export function htmlFrameCsp(mode: HtmlMode): string {
  return mode === "interactive" ? INTERACTIVE_CSP : STATIC_CSP;
}

/** Granted iframe capabilities shown next to HTML mode. */
export function htmlFrameCapabilities(mode: HtmlMode): string[] {
  if (mode === "interactive") return ["scripts", "img-data", "img-blob", "img-https"];
  return ["no-scripts", "img-data", "img-blob"];
}

export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}
