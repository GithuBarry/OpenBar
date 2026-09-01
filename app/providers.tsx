"use client";

import { ThemeProvider } from "@/components/theme";

/** Client-side providers mounted once under the server root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
