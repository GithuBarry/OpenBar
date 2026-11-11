import type { PaperWebMcpHost } from "./webmcp-paper-contract";
import type { CurrentLocation,SharedWebMcpActions } from "./webmcp-shared-contract";

/** The paper editor supplies its live buffer and ordinary navigation callbacks. */
export type PaperSourceHost = PaperWebMcpHost & {
  replaceRange: (from: number, to: number, text: string, signal?: AbortSignal) => void | Promise<void>;
  sharedActions?: SharedWebMcpActions;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};
