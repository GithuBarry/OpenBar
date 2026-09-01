import { redirect } from "next/navigation";

import { requireWorkbenchPage } from "@/lib/server/project-access";

export const dynamic = "force-dynamic";

export default async function ReviewRedirect() {
  await requireWorkbenchPage();
  redirect("/");
}
