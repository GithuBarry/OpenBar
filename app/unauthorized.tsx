export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16">
      <div className="mx-auto max-w-lg space-y-3">
        <h1 className="font-serif text-2xl font-semibold">401 — Unauthorized</h1>
        <p className="text-sm text-muted">
          This workbench requires a verified Cloudflare Access identity or a bearer token.
        </p>
      </div>
    </main>
  );
}
