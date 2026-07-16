"use client";
// Route-level error boundary (Next.js). Catches uncaught render/runtime errors
// in any page so the app degrades to a recoverable state instead of a blank screen.
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface for debugging; no PII beyond the message is logged.
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 text-ink">
      <div className="w-full max-w-md rounded-xl border border-negative/30 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-negative/10 text-negative" aria-hidden>!</div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-ink-muted">
          This page hit an unexpected error. Your data is safe — try again, or head back to the dashboard.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90">Try again</button>
          <a href="/dashboard" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-muted">Go to dashboard</a>
        </div>
      </div>
    </div>
  );
}
