import "server-only";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import packageJson from "@/package.json";
import { openBarPaths } from "@/lib/config/openbar-paths";
import { withWriteLockAsync, writeTextAtomic } from "@/lib/tex-project/codec";
import { PLATFORM_WISHLIST_INPUT } from "./platform-wishlist-contract";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { workspaceInstructionsAvailable } from "./project-skills";

const wishSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(2000),
  author: z.enum(["human", "agent"]),
  version: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type PlatformWish = z.infer<typeof wishSchema>;
export const platformWishlistAvailable = workspaceInstructionsAvailable;

function wishlistFile(): string {
  if (!platformWishlistAvailable()) throw new Error("The platform wishlist requires a private workspace.");
  return path.join(openBarPaths().dataRoot, "platform-wishlist.json");
}

function readWishes(file: string): PlatformWish[] {
  try {
    return wishSchema.array().parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function listPlatformWishlist(): PlatformWish[] {
  return readWishes(wishlistFile());
}

export async function addPlatformWish(input: { text: string }, author: PlatformWish["author"]): Promise<PlatformWish> {
  const file = wishlistFile();
  const text = input.text.trim();
  if (!text || text.length > 2000) throw new Error("Feedback must contain 1 to 2,000 characters.");
  return withWriteLockAsync(file, () => {
    const wishes = readWishes(file);
    const existing = wishes.find(wish => wish.version === packageJson.version && wish.author === author && wish.text === text);
    if (existing) return existing;
    const wish = { id: randomUUID(), text, author, version: packageJson.version, createdAt: new Date().toISOString() };
    writeTextAtomic(file, JSON.stringify([wish, ...wishes], null, 2) + "\n", 0o600);
    return wish;
  });
}

export async function runPlatformWishlist(raw: unknown): Promise<OperationResult<unknown>> {
  if (!platformWishlistAvailable()) return failResult("permission_denied", "The platform wishlist requires a private workspace.", false);
  const parsed = PLATFORM_WISHLIST_INPUT.safeParse(raw);
  if (!parsed.success) return failResult("invalid_arguments", parsed.error.issues.map(issue => issue.message).join(" "), false);
  const { action, text, before, limit = 10 } = parsed.data;
  try {
    if (action === "add") return okResult(await addPlatformWish({ text: text! }, "agent"));
    const wishes = listPlatformWishlist();
    const start = before ? wishes.findIndex(wish => wish.id === before) + 1 : 0;
    if (before && start === 0) return failResult("invalid_arguments", "Use nextBefore from the preceding page.", false);
    const items = wishes.slice(start, start + limit);
    const nextBefore = start + items.length < wishes.length ? items.at(-1)?.id : undefined;
    return okResult({ items, total: wishes.length, nextBefore });
  } catch {
    return failResult("operation_failed", "The platform wishlist is unavailable. Try again.", true);
  }
}
