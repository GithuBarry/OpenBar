/** A separate serving process exposes the paper viewer through a guarded gateway. */
export function isViewOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENBAR_VIEW_ONLY === "1"
}

/** Keep the shared surface limited to viewing pages, paper assets, and static code. */
export function viewOnlyPathAllowed(pathname: string): boolean {
  const segment = "[A-Za-z0-9][A-Za-z0-9._-]*"
  return pathname === "/" || pathname === "/about" || pathname === "/api/health"
    || pathname === "/favicon.ico" || pathname.startsWith("/_next/static/")
    || new RegExp(`^/p/${segment}(?:/(?:paper|mindmap(?:/${segment})?|wiki(?:/${segment})?))?/?$`).test(pathname)
    || new RegExp(`^/api/p/${segment}/(?:paper/(?:source|pdf|compile)|mindmap|asset/.+)$`).test(pathname)
}
