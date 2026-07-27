import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HFOS — Your household's financial operating system",
  description:
    "HFOS is a personal-CFO platform for serious households: budgeting, payments, cash-flow forecasting, wealth and property, goals, multi-year scenarios and an AI copilot grounded in your real numbers.",
};

const FEATURES: { title: string; body: string }[] = [
  { title: "Budgeting that owns the plan", body: "Income ownership, expense responsibility and savings as a budgeted obligation. Every month is planned, approved and tracked." },
  { title: "Payments and settlement", body: "Track debit orders and manual payments, confirm what cleared, and see what is overdue or due soon at a glance." },
  { title: "Cash-flow forecast", body: "A forward timeline of money in and out, with runway and a projection so you see a shortfall before it arrives." },
  { title: "Wealth and property", body: "Net worth from your accounts, plus per-property equity, loan-to-value, yield and monthly cash-flow." },
  { title: "Goals with real pace", body: "Amount remaining, monthly requirement versus contribution, projected finish date and whether each goal is on track." },
  { title: "Multi-year scenarios", body: "Project a decision over years: job loss, buying a home, aggressive saving. See net worth, runway and break-even against doing nothing." },
  { title: "An AI copilot, grounded in fact", body: "Ask questions in plain language. Every figure comes from the calculation engine, never invented, and you can chat over Telegram too." },
  { title: "Yours, everywhere", body: "An installable app that works offline for reading, with a durable write queue that syncs when you reconnect." },
];

export default function MarketingHome() {
  return (
    <main className="min-h-screen bg-surface text-ink">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="inline-block rounded-lg bg-white p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.png" alt="HFOS" className="block h-8 w-auto" />
        </span>
        <nav className="flex items-center gap-3 text-sm font-medium">
          <Link href="/login" className="rounded-lg px-3 py-2 text-ink-soft hover:bg-muted">Log in</Link>
          <Link href="/register" className="rounded-lg bg-brand px-3.5 py-2 text-white hover:bg-brand-dark">Get started</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-10 md:pt-20">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-ink md:text-6xl">
            Your household's financial operating system.
          </h1>
          <p className="mt-5 text-lg text-ink-soft md:text-xl">
            HFOS turns a family budget into a real personal-CFO platform: plan every month, settle payments,
            forecast cash flow, grow wealth, and model the big decisions. Every number is produced by one
            calculation engine and traceable to its inputs.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Get started free</Link>
            <Link href="/login" className="rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft hover:bg-muted">Log in</Link>
          </div>
          <p className="mt-4 text-sm text-ink-muted">No spreadsheets to wrangle. Your data stays yours, and you can export or delete it at any time.</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-card p-5">
              <h3 className="text-sm font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust: grounded in fact */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="rounded-2xl border border-line bg-card p-8 md:p-12">
          <h2 className="text-2xl font-bold text-ink md:text-3xl">Every number is explainable.</h2>
          <p className="mt-3 max-w-3xl text-ink-soft">
            The interface never re-implements a formula. Totals, forecasts, yields and projections all come from a
            single, versioned, unit-tested engine on the server, so what you see always traces back to your inputs.
            The AI copilot only reads and phrases those figures. It never does the arithmetic.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-sm font-semibold text-ink">Grounded</div>
              <div className="mt-1 text-sm text-ink-muted">Figures from the deterministic engine, not guesses.</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Private</div>
              <div className="mt-1 text-sm text-ink-muted">Per-household isolation, export and delete on request.</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Yours</div>
              <div className="mt-1 text-sm text-ink-muted">Installable, offline-capable, and fast wherever you are.</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-brand px-8 py-10 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-bold">Run your household like a business.</h2>
            <p className="mt-1 text-white/85">Start planning in minutes.</p>
          </div>
          <Link href="/register" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-dark hover:bg-white/90">Get started</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-ink-muted sm:flex-row">
          <span>&copy; {"2026"} HFOS. All rights reserved.</span>
          <nav className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/login" className="hover:text-ink">Log in</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
