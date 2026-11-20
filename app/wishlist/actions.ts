"use server";

import { headers } from "next/headers";
import { bearerMatches } from "@/lib/server/access-policy";
import { failResult } from "@/lib/research/operation-result";
import { revalidatePath } from "next/cache";
import { addPlatformWish, platformWishlistAvailable, runPlatformWishlist } from "@/lib/research/platform-wishlist";
import { ProjectAccessError, requireWorkbenchAccess } from "@/lib/server/project-access";

export async function submitPlatformWish(text: string) {
  await requireWorkbenchAccess();
  if (!platformWishlistAvailable()) return { ok: false, message: "Open your private workspace to add feedback." };
  const feedback = typeof text === "string" ? text.trim() : "";
  if (!feedback || feedback.length > 2000) return { ok: false, message: "Enter between 1 and 2,000 characters." };
  try {
    await addPlatformWish({ text: feedback }, "human");
  } catch {
    return { ok: false, message: "Feedback could not be saved. Try again." };
  }
  revalidatePath("/wishlist");
  return { ok: true, message: "Feedback added." };
}

export async function agentPlatformWishlist(raw: unknown) {
  try {
    await requireWorkbenchAccess();
  } catch (error) {
    if (error instanceof ProjectAccessError) return failResult("permission_denied", "Workspace access is required for platform feedback.", false);
    throw error;
  }
  const authorization = (await headers()).get("authorization");
  if (authorization && !bearerMatches(authorization, process.env.OPENBAR_ACCESS_TOKEN?.trim() || "")) {
    return failResult("permission_denied", "Workspace access is required for platform feedback.", false);
  }
  return runPlatformWishlist(raw);
}
