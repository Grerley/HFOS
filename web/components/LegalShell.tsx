import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/components/Logo";

// Simple public page shell for legal/marketing content (no auth, no AppShell).
export default function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-surface text-ink">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link href="/" className="inline-flex text-ink" aria-label="HFOS home">
          <Logo size={28} />
        </Link>
        <Link href="/" className="text-sm font-medium text-ink-soft hover:text-ink">Back to home</Link>
      </header>

      <article className="mx-auto max-w-3xl px-5 pb-16 pt-4">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">Last updated: {updated}</p>
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Draft template. Review and adapt this with a qualified legal professional before launch. It is a
          starting point, not legal advice.
        </div>
        <div className="legal mt-8 space-y-6 text-sm leading-relaxed text-ink-soft">{children}</div>
      </article>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6 text-sm text-ink-muted">
          <span>&copy; 2026 HFOS</span>
          <nav className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold text-ink">{children}</h2>;
}
