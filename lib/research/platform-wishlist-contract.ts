import { z } from "zod";
import { commandJsonSchema, parseCommandInput } from "./command-schema";
import type { OperationResult } from "./operation-result";
import type { PaperWebMcpTool } from "./webmcp-paper-contract";

export const WISHLIST_DESCRIPTION = "List or add private workspace feedback for a future OpenBar version. Use text with add. List returns newest first, with nextBefore for older feedback.";
export const PLATFORM_WISHLIST_INPUT = z.strictObject({
  action: z.enum(["list", "add"]),
  text: z.string().trim().min(1).max(2000).optional(),
  before: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).refine(input => input.action === "add"
  ? input.text !== undefined && input.before === undefined && input.limit === undefined
  : input.text === undefined, "Use text for add, or optional before and limit for list.");

export function platformWishlistWebMcp(execute: (args: unknown) => Promise<OperationResult<unknown>>): PaperWebMcpTool {
  return {
    name: "platform_wishlist",
    title: "Platform wishlist",
    description: WISHLIST_DESCRIPTION,
    inputSchema: commandJsonSchema(PLATFORM_WISHLIST_INPUT),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(raw) {
      const args = parseCommandInput(PLATFORM_WISHLIST_INPUT, raw, true);
      return args.ok ? execute(args.value) : args;
    },
  };
}
