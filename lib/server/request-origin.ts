export function requestIsSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  const origin = request.headers.get("origin")?.trim();
  let originMatches = false;
  if (origin) {
    try {
      const requestHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
        || request.headers.get("host")?.trim()
        || new URL(request.url).host;
      originMatches = new URL(origin).host.toLowerCase() === requestHost.toLowerCase();
    } catch {
      return false;
    }
  }
  if (fetchSite) return fetchSite === "same-origin" && (!origin || originMatches);
  return originMatches;
}
