import type { Metadata, Viewport } from "next";

import "./globals.css";
import { agentOrigins } from "@/lib/server/agent-origins";
import { ThemeScript } from "@/components/theme";
import { Providers } from "./providers";
import { getWorkspaceSettings } from "@/lib/workspace";

const siteUrl = new URL(process.env.NEXT_PUBLIC_OPENBARRY_URL || "http://localhost:3000");

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const workspace = getWorkspaceSettings();
  const description = workspace.tagline || "Pouring the perfect draft.";
  return {
    title: {
      default: workspace.name,
      template: `%s · ${workspace.name}`,
    },
    description,
    metadataBase: siteUrl,
    openGraph: {
      title: workspace.name,
      description,
      url: siteUrl.toString(),
      siteName: workspace.name,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f6f6f5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta name="openbar-agent-origins" content={JSON.stringify(agentOrigins())} />
        <link rel="help" href="/agents" title="Tools and agent access" />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="OpenBar agent guide" />
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
