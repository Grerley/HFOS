"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Card, Badge, PageSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/format";
import { SIM_META, type SimType } from "@/lib/simConfig";

type AnyObj = Record<string, any>;
const ORDER: SimType[] = ["investment", "tax", "asset"];

// One-line headline from a stored scenario summary, per simulation type.
function headline(type: string, s: AnyObj | null, money: (c: number) => string): string {
  if (!s) return "No scenarios yet";
  if (type === "investment") return `Projected ${money(s.final_nominal_cents ?? 0)}`;
  if (type === "tax") return `Save ${money(s.tax_saving_cents ?? 0)}`;
  if (type === "asset") return `Instalment ${money(s.monthly_instalment_cents ?? 0)}`;
  return "";
}

export default function SimulationsLanding() {
  const [sims, setSims] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(true);
  const currency = useCurrency();
  const money = (c: number) => formatMoney(c ?? 0, currency);

  useEffect(() => {
    api.get<AnyObj[]>("/simulations").then(setSims).catch(() => setSims([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

  const latestOf = (type: string) => sims.filter((s) => s.simulation_type === type).sort((a, b) => (b.latest_updated ?? 0) - (a.latest_updated ?? 0))[0] ?? null;

  return (
    <AppShell>
      <PageHeader
        title="Simulations"
        description="Model a financial decision, understand the consequences, choose the best option, and turn it into an executable plan. Simulations never change your real budget until you implement them."
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {ORDER.map((type) => {
          const meta = SIM_META[type];
          const latest = latestOf(type);
          return (
            <Link key={type} href={`/simulations/${type}`} className="group block">
              <Card className="h-full transition group-hover:border-brand group-hover:shadow-card">
                <div className="flex items-start justify-between">
                  <span aria-hidden className="text-2xl">{meta.icon}</span>
                  {latest && <Badge tone={latest.status === "approved" ? "positive" : "neutral"}>{latest.status}</Badge>}
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{meta.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{meta.blurb}</p>
                <div className="mt-4 rounded-lg bg-muted px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted">Most recent</p>
                  {latest ? (
                    <>
                      <p className="text-sm font-medium text-ink">{latest.name}</p>
                      <p className="tabular text-xs text-ink-soft">{headline(type, latest.latest_summary, money)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">Start your first {meta.title.toLowerCase()}</p>
                  )}
                </div>
                <p className="mt-3 text-xs font-medium text-brand-dark">Open planner →</p>
              </Card>
            </Link>
          );
        })}
      </div>

      {sims.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink">All simulations</h2>
          <div className="space-y-2">
            {sims.sort((a, b) => (b.latest_updated ?? 0) - (a.latest_updated ?? 0)).map((s) => (
              <Link key={s.id} href={`/simulations/${s.simulation_type}`} className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3 shadow-sm transition hover:border-brand">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{s.name}</span>
                    <Badge tone="info">{s.simulation_type}</Badge>
                    <Badge tone="neutral">{s.status}</Badge>
                  </div>
                  <p className="tabular text-xs text-ink-muted">{s.scenario_count ?? 0} scenario(s) · {headline(s.simulation_type, s.latest_summary, money)}</p>
                </div>
                <span aria-hidden className="text-ink-muted">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 text-xs text-ink-muted">
        Release 1: multi-goal investment projection with goal-seeking, SA straight-vs-optimised tax with cash impact, and asset
        financing with optimised repayment, affordability and interest-rate stress. Results are indicative, not advice.
      </p>
    </AppShell>
  );
}
