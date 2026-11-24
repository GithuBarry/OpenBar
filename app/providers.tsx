"use client";

import { ThemeProvider } from "@/components/theme";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: {
    staleTime: 5_000, gcTime: 60_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  }, mutations: { retry: false } } });
}

let browserQueryClient: QueryClient | undefined;

function isTextEditingElement(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : document.activeElement;
  if (!(el instanceof Element)) return false;
  if (el.closest("textarea, [contenteditable='true'], .cm-editor, .mindmap-node-editing")) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(el.type);
  }
  return false;
}

/** Client-side providers mounted once under the server root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  const client = typeof window === "undefined" ? createQueryClient() : (browserQueryClient ??= createQueryClient());
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: ["openbar", "inbox"] }); };
    window.addEventListener("openbar-inbox-updated", refresh);
    return () => window.removeEventListener("openbar-inbox-updated", refresh);
  }, [client]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = (alt: boolean, shift: boolean) => {
      if (alt) root.dataset.altKey = "true"; else delete root.dataset.altKey;
      if (shift) root.dataset.shiftKey = "true"; else delete root.dataset.shiftKey;
    };
    const clear = () => sync(false, false);
    const onKey = (event: KeyboardEvent) => {
      if (isTextEditingElement(event.target)) { clear(); return; }
      sync(event.altKey, event.shiftKey);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isTextEditingElement(event.target)) clear();
    };
    const onVis = () => { if (document.visibilityState !== "visible") clear(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVis);
      clear();
    };
  }, []);
  return <QueryClientProvider client={client}><ThemeProvider><TooltipProvider delayDuration={150} skipDelayDuration={700} disableHoverableContent>{children}</TooltipProvider></ThemeProvider></QueryClientProvider>;
}
