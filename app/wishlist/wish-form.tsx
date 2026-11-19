"use client";

import { useActionState, useState } from "react";
import { submitPlatformWish } from "./actions";

export function WishForm() {
  const [text, setText] = useState("");
  const [result, submit, pending] = useActionState(async () => {
    try {
      const response = await submitPlatformWish(text);
      if (response.ok) setText("");
      return response;
    } catch {
      return { ok: false, message: "Feedback could not be saved. Try again." };
    }
  }, null);

  return <form action={submit} className="grid gap-3 rounded-xl border border-line bg-surface p-4">
    <label htmlFor="platform-feedback" className="text-sm font-semibold">What would you like to improve in OpenBar?</label>
    <textarea id="platform-feedback" name="text" rows={3} maxLength={2000} required
      className="w-full rounded-lg border border-line bg-canvas p-3 text-sm" value={text} readOnly={pending}
      onChange={event => setText(event.target.value)} />
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span role="status" className={result?.ok === false ? "mr-auto text-sm text-danger" : "mr-auto text-sm text-muted"}>{pending ? "" : result?.message}</span>
      <button type="submit" className="p-button p-button-primary" disabled={pending || !text.trim()}>{pending ? "Adding…" : "Add feedback"}</button>
    </div>
  </form>;
}
