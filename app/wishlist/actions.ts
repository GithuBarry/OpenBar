"use server";

import { revalidatePath } from "next/cache";
import { addPlatformWish, platformWishlistAvailable } from "@/lib/research/platform-wishlist";
import { requireWorkbenchAccess } from "@/lib/server/project-access";

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
