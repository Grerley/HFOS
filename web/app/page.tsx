import Link from "next/link";
import type { Metadata } from "next";
import Logo from "@/components/Logo";

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
      {/* Hero on the deep-navy brand field */}
      <section className="brand-field text-white">
        <div className="mx-auto max-w-6xl px-5">
          <header className="flex items-center justify-between py-5">
            <Logo size={48} variant="dark" />
            <nav className="flex items-center gap-2 text-sm font-medium">
              <Link href="/login" className="rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white">Log in</Link>
              <Link href="/register" className="accent-gradient rounded-lg px-4 py-2 font-semibold text-white shadow-lift hover:opacity-95">Get started</Link>
            </nav>
          </header>

          <div className="max-w-3xl py-16 md:py-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-white/85">
              Personal CFO for households
            </span>
            <h1 className="mt-5 font-serif text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Run your household like a <span className="accent-gradient-text">business</span>.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-white/80 md:text-xl">
              HFOS turns a family budget into a real personal-CFO platform: plan every month, settle payments,
              forecast cash flow, grow wealth, and model the big decisions. Every number is produced by one
              calculation engine and traceable to its inputs.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/register" className="accent-gradient rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-lift hover:opacity-95">Get started free</Link>
              <Link href="/login" className="rounded-lg border border-white/25 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">Log in</Link>
            </div>
            <p className="mt-5 text-sm text-white/60">Your data stays yours. Export or delete it any time.</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-20">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-bold tracking-tight text-ink md:text-4xl">Everything a household CFO needs.</h2>
          <p className="mt-3 text-ink-soft">One place for the money coming in, going out, owed, owned and planned.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-line bg-card p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift">
              <div className="mb-3 h-1 w-8 rounded-full accent-gradient opacity-80 transition group-hover:w-12" />
              <h3 className="text-sm font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust: grounded in fact */}
      <section className="mx-auto max-w-6xl px-5 pb-4 md:pb-8">
        <div className="rounded-3xl border border-line bg-card p-8 shadow-card md:p-12">
          <h2 className="font-serif text-2xl font-bold text-ink md:text-3xl">Every number is <span className="accent-gradient-text">explainable</span>.</h2>
          <p className="mt-3 max-w-3xl text-ink-soft">
            The interface never re-implements a formula. Totals, forecasts, yields and projections all come from a
            single, versioned, unit-tested engine on the server, so what you see always traces back to your inputs.
            The AI copilot only reads and phrases those figures. It never does the arithmetic.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              ["Grounded", "Figures from the deterministic engine, not guesses."],
              ["Private", "Per-household isolation, with export and delete on request."],
              ["Yours", "Installable, offline-capable, and fast wherever you are."],
            ].map(([t, b]) => (
              <div key={t}>
                <div className="mb-2 h-1 w-8 rounded-full accent-gradient" />
                <div className="text-sm font-semibold text-ink">{t}</div>
                <div className="mt-1 text-sm text-ink-muted">{b}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="brand-field flex flex-col items-start justify-between gap-5 rounded-3xl px-8 py-12 text-white shadow-lift md:flex-row md:items-center md:px-12">
          <div>
            <h2 className="font-serif text-2xl font-bold md:text-3xl">Take command of your household finances.</h2>
            <p className="mt-2 text-white/80">Start planning in minutes.</p>
          </div>
          <Link href="/register" className="accent-gradient shrink-0 rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-lift hover:opacity-95">Get started free</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Logo size={38} />
          <nav className="flex items-center gap-5 text-sm text-ink-muted">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/login" className="hover:text-ink">Log in</Link>
          </nav>
          <span className="text-sm text-ink-muted">&copy; 2026 HFOS</span>
        </div>
      </footer>
    </main>
  );
}
