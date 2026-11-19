import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listPlatformWishlist, platformWishlistAvailable } from "@/lib/research/platform-wishlist";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import { WishForm } from "./wish-form";

export const metadata: Metadata = { title: "Platform wishlist" };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function WishlistPage() {
  await requireWorkbenchPage();
  if (!platformWishlistAvailable()) notFound();
  const wishes = listPlatformWishlist();

  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} aria-hidden="true" />Workspace</Link>
      <h1 className="mb-2 mt-6 text-3xl font-semibold tracking-tight">Platform wishlist</h1>
      <p className="mb-5 text-sm leading-6 text-muted">Ideas from people and agents for the next version of OpenBar.</p>
      <WishForm />
      {wishes.length ? <ol aria-label="Platform feedback" className="mt-5 divide-y divide-line">
        {wishes.map(wish => <li key={wish.id} className="py-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{wish.text}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{wish.author === "agent" ? "Agent" : "Human"}</span><span aria-hidden="true">·</span>
            <time dateTime={wish.createdAt}>{dateFormat.format(new Date(wish.createdAt))}</time>
            <span aria-hidden="true">·</span><span>OpenBar {wish.version}</span>
          </div>
        </li>)}
      </ol> : <p className="mt-6 text-sm text-muted">Feedback will appear here as it arrives.</p>}
    </div>
  </main>;
}
