"use client";

import { agentPlatformWishlist } from "@/app/wishlist/actions";
import { platformWishlistWebMcp } from "@/lib/research/platform-wishlist-contract";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { workspaceWebMcpActions } from "@/features/webmcp-actions";
import {
  buildWorkspaceWebMcpTools,
  type WorkspaceWebMcpHost,
} from "@/lib/research/webmcp-workspace-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";
import { useInboxWebMcp } from "@/features/use-inbox-webmcp";

export function useWorkspaceWebMcp(host: WorkspaceWebMcpHost, wishlistAvailable: boolean): void {
  useInboxWebMcp();
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | undefined;
    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const bound = hostRef.current;
      const tools = buildWorkspaceWebMcpTools(bound);
      if (wishlistAvailable) tools.push(platformWishlistWebMcp(agentPlatformWishlist));
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        tools,
        controller.signal,
        "workspace",
      );
      release = registration.release;
      if (!active || controller.signal.aborted) release();
    })();
    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, [wishlistAvailable]);
}

/** Client-only mount for the workspace catalog on the home page. */
export function WorkspaceWebMcp({ wishlistAvailable }: { wishlistAvailable: boolean }) {
  const router = useRouter();
  useWorkspaceWebMcp({
    actions: workspaceWebMcpActions,
    navigate: (href) => router.push(href),
  }, wishlistAvailable);
  return null;
}
