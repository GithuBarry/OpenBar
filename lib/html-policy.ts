/**
 * HTML preview policy. Static frames omit scripts. Interactive frames use
 * an opaque origin plus a strict CSP. Fragments entering the parent are
 * stripped of executable and embedded content.
 */

/** Synchronous sanitizer for SSR and parent-document fragments. */
export function sanitizeHtmlFragmentSync(html: string): string {
  return stripScripts(html).replace(/<\/?(?:iframe|object|embed|link|meta|base)[^>]*>/gi, "");
}

export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}
