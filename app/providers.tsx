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
    const onKey = (event: KeyboardEvent) => sync(event.altKey, event.shiftKey);
    const clear = () => sync(false, false);
    const onVis = () => { if (document.visibilityState !== "visible") clear(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVis);
      clear();
    };
  }, []);
  return <QueryClientProvider client={client}><ThemeProvider><TooltipProvider delayDuration={150} skipDelayDuration={700} disableHoverableContent>{children}</TooltipProvider></ThemeProvider></QueryClientProvider>;
}
