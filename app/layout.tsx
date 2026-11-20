import type { Metadata, Viewport } from "next";

import "@codedgar/puppertino/colors";
import "@codedgar/puppertino/materials";
import "@codedgar/puppertino/buttons";
import "@codedgar/puppertino/forms";
import "@codedgar/puppertino/menus";
import "@codedgar/puppertino/modals";
import "@codedgar/puppertino/popovers";
import "@codedgar/puppertino/segmented-controls";
import "@codedgar/puppertino/sidebars";
import "@codedgar/puppertino/toolbars";
import "./globals.css";
import { agentOrigins } from "@/lib/server/agent-origins";
import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance";
import { ThemeScript } from "@/components/theme";
import { Providers } from "./providers";
import { getWorkspaceSettings } from "@/lib/workspace";

const siteUrl = new URL(process.env.NEXT_PUBLIC_OPENBAR_URL || "http://localhost:3000");

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const workspace = getWorkspaceSettings();
  const description = workspace.tagline || "Pouring the perfect draft.";
  return {
    title: {
      default: workspace.name,
      template: `%s | ${workspace.name}`,
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
  const viewOnly = process.env.OPENBAR_VIEW_ONLY === "1";
  const agentGuide = viewOnly ? "/about#agent-setup" : "/agents";
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta name="openbar-agent-instructions" content={viewOnly ? "Read-only viewer. Read the agent instructions at /about#agent-setup." : AGENT_GUIDANCE} />
        <meta name="openbar-agent-origins" content={JSON.stringify(agentOrigins())} />
        <link rel="help" href={agentGuide} title="OpenBar agent instructions" />
        {!viewOnly && <>
          <link rel="alternate" type="text/plain" href="/llms.txt" title="OpenBar agent guide" />
          <link rel="help" type="text/plain" href="/llms-deployment.txt" title="OpenBar deployment and connection setup" />
        </>}
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        <a className="ob-skip-link" href="#main-content">Skip to content</a>
        <a className="ob-skip-link" href={agentGuide}>OpenBar agent instructions</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
