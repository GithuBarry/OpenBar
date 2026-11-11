"use client";

export default function WorkbenchError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <main id="main-content" className="grid min-h-screen place-items-center bg-canvas p-6">
    <div role="alert" className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
      <h1 className="font-sans text-2xl font-semibold">OpenBar hit a problem</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Try this page again, or return to your projects.</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={retry} className="p-button p-button-primary btn-primary">Try again</button>
        <a href="/" className="p-button p-button-borderless btn-ghost">All projects</a>
      </div>
      {error.digest && <p className="mt-4 text-xs text-faint">Error reference: {error.digest}</p>}
    </div>
  </main>;
}
