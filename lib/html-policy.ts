/**
 * HTML preview policy. Static frames omit scripts. Interactive frames use
 * an opaque origin plus a strict CSP. Fragments entering the parent are
 * sanitized with DOMPurify when a window exists.
 */

export type HtmlMode = "static" | "interactive";

const STATIC_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; sandbox";
const INTERACTIVE_CSP = "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts";

export function htmlFrameSandbox(mode: HtmlMode): string {
  return mode === "interactive" ? "allow-scripts" : "";
}

/** Synchronous sanitizer for SSR and parent-document fragments. */
export function sanitizeHtmlFragmentSync(html: string): string {
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

export async function sanitizeHtmlFragment(html: string): Promise<string> {
  const stripped = stripScripts(html);
  if (typeof window === "undefined") return stripped;
  const { default: DOMPurify } = await import("dompurify");
  return DOMPurify.sanitize(stripped, { USE_PROFILES: { html: true } });
}
