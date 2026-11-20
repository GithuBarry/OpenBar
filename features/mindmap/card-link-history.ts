function mapPath(path: string) {
  return path.replace(/\/$/, "")
    .replace(/^\/p\/([^/]+)\/mindmap(?=\/|$)/, (_, slug: string) =>
      `/p/${encodeURIComponent(decodeURIComponent(slug).toLowerCase())}/mindmap`)
    .replace(/^(\/p\/[^/]+\/mindmap)\/(?:draft|mindmap)$/, "$1");
}

export function sameMapCardId(href: string, current: URL): string | undefined {
  if (!href.includes("#")) return;
  try {
    const url = new URL(href, current);
    if (url.origin === current.origin && mapPath(url.pathname) === mapPath(current.pathname) && url.hash.length > 1) {
      return decodeURIComponent(url.hash.slice(1));
    }
  } catch { /* A malformed fragment has no map destination. */ }
}

/** Keep the unfragmented map entry reachable when the first jump starts on the canvas. */
export function connectCardLinkHistory(focus: (id: string) => boolean, selectedId: () => string | undefined) {
  function followLocation() {
    const url = new URL(window.location.href);
    const id = sameMapCardId(url.href, url);
    if (id) focus(id);
    else if (!url.hash && typeof window.history.state?.openbarReturnCard === "string") {
      focus(window.history.state.openbarReturnCard);
    }
  }
  function followLink(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const current = new URL(window.location.href);
    const id = sameMapCardId(link.href, current);
    if (!id) return;
    const origin = link.dataset.mapCardSource || link.closest<HTMLElement>("[data-mind-node]")?.dataset.mindNode || selectedId();
    if (!focus(id)) return;
    event.preventDefault();
    const hash = new URL(link.href).hash;
    if (hash === current.hash) return;
    if (!current.hash && origin) {
      window.history.replaceState({ ...window.history.state, openbarReturnCard: origin }, "");
    }
    window.history.pushState(null, "", current.pathname + current.search + hash);
  }
  if (window.location.hash) followLocation();
  window.addEventListener("hashchange", followLocation);
  document.addEventListener("click", followLink, true);
  return () => {
    window.removeEventListener("hashchange", followLocation);
    document.removeEventListener("click", followLink, true);
  };
}
