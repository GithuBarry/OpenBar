"use client";

import { ThemeProvider } from "@/components/theme";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

/** Client-side providers mounted once under the server root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider><TooltipProvider delayDuration={150} skipDelayDuration={700} disableHoverableContent>{children}</TooltipProvider></ThemeProvider>;
}
