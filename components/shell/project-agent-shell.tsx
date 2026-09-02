"use client";

import { usePathname } from "next/navigation";

import { useSharedProjectWebMcp } from "@/features/use-shared-webmcp";
import type { CurrentLocation } from "@/lib/research/webmcp-shared-contract";

function locationFromPath(project: string, pathname: string): CurrentLocation {
  const href = pathname;
  if (pathname.includes("/mindmap")) {
    const mapId = pathname.split("/mindmap/")[1]?.split("/")[0];
    return { kind: "mindmap", href, mapId };
  }
  if (pathname.includes("/wiki/")) {
    const pageId = decodeURIComponent(pathname.split("/wiki/")[1] || "");
    return { kind: "wiki", href, pageId };
  }
  if (pathname.includes("/wiki")) return { kind: "wiki", href };
  if (pathname.includes("/instructions")) return { kind: "instructions", href };
  return { kind: "paper", href };
}

export function ProjectAgentShell({
  project,
  children,
}: {
  project: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  useSharedProjectWebMcp({
    project,
    current: () => {
      const loc = locationFromPath(project, pathname);
      if (typeof window === "undefined") return loc;
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!hash) return loc;
      if (loc.kind === "paper") return { ...loc, href: `${pathname}${window.location.hash}`, sectionId: hash };
      if (loc.kind === "mindmap") return { ...loc, href: `${pathname}${window.location.hash}`, nodeId: hash };
      return { ...loc, href: `${pathname}${window.location.hash}` };
    },
  });
  return children;
}
