import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 text-ink">
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-ink-muted" aria-hidden>?</div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-ink-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <Link href="/dashboard" className="mt-5 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
