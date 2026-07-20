"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import Link from "next/link";
import { Card, StatCard, Badge, EmptyState, PageSkeleton, ErrorState } from "@/components/ui";
import { BalanceChart } from "@/components/viz";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/format";

interface CashFlow {
  has_period: boolean;
  period?: { id: number; label: string; start_date: string; end_date: string };
  today: string;
  opening_cents: number;
  closing_cents: number;
  liquid_accounts: { id: number; name: string; type: string; balance_cents: number }[];
  inflow_total_cents: number;
  outflow_total_cents: number;
  monthly_net_cents: number;
  runway_months: number | null;
  lowest: { lowest_cents: number; date: string | null; dips_negative: boolean };
  timeline: { date: string; amount_cents: number; label?: string; kind?: string; balance_cents: number }[];
  forward: { month_index: number; balance_cents: number }[];
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function CashFlowPage() {
  const [data, setData] = useState<CashFlow | null>(null);
  const currency = useCurrency();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      setData(await api.get<CashFlow>("/reports/cash-flow"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const money = (c: number) => formatMoney(c, currency);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  if (error) return (
    <AppShell>
      <PageHeader title="Cash flow" description="Timeline, runway and forward projection." />
      <ErrorState hint="We couldn't load your cash-flow projection. Check your connection and try again." onRetry={load} />
    </AppShell>
  );

  if (!data?.has_period) {
    return (
      <AppShell>
        <PageHeader title="Cash flow" description="Timeline, runway and forward projection." />
        <EmptyState
          title="No budget period yet"
          hint="Create a monthly budget in the planner, or import your workbook, to project your cash flow."
        />
      </AppShell>
    );
  }

  // Build the within-month balance line: opening point + each event's running balance.
  const timelinePoints = [
    { label: `Today (${shortDate(data.today)})`, balance_cents: data.opening_cents },
    ...data.timeline.map((t) => ({ label: `${shortDate(t.date)} · ${t.label ?? ""}`.trim(), balance_cents: t.balance_cents })),
  ];
  // Forward projection: closing balance now, then each projected month-end.
  const forwardPoints = [
    { label: "Now", balance_cents: data.closing_cents },
    ...data.forward.map((f) => ({ label: `+${f.month_index}m`, balance_cents: f.balance_cents })),
  ];

  const netTone = data.monthly_net_cents >= 0 ? "positive" : "negative";
  const runwayLabel =
    data.runway_months === null
      ? "Sustainable"
      : data.runway_months >= 24
      ? "24+ months"
      : `${data.runway_months} month${data.runway_months === 1 ? "" : "s"}`;

  return (
    <AppShell>
      <PageHeader
        title="Cash flow"
        description={`${data.period!.label} · liquid balance timeline and forward run-rate`}
        actions={<Link href="/payments" className="text-xs font-medium text-brand-dark hover:underline">Open Payments →</Link>}
      />

      {data.lowest.dips_negative && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-negative/30 bg-negative/5 p-4">
          <span className="mt-0.5 text-negative" aria-hidden>▲</span>
          <div className="text-sm">
            <span className="font-semibold text-negative">Projected cash shortfall</span>
            <span className="text-ink-soft">
              {" "}— your balance is projected to reach {money(data.lowest.lowest_cents)}
              {data.lowest.date ? ` around ${shortDate(data.lowest.date)}` : ""}. Consider moving a debit-order date or funding from savings.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Liquid now" value={money(data.opening_cents)} hint="Spendable account balances" />
        <StatCard
          label="Projected month-end"
          value={money(data.closing_cents)}
          tone={data.closing_cents >= 0 ? "positive" : "negative"}
          hint="After remaining income & obligations"
        />
        <StatCard label="Monthly net" value={money(data.monthly_net_cents)} tone={netTone} hint="Planned income − outflows" />
        <StatCard
          label="Cash runway"
          value={runwayLabel}
          tone={data.runway_months !== null && data.runway_months < 3 ? "negative" : "neutral"}
          hint={data.runway_months === null ? "Balance not depleting" : "At current run-rate"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="This month" subtitle="Running liquid balance as obligations settle">
          <BalanceChart points={timelinePoints} format={money} />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line-soft bg-muted px-3 py-2">
              <div className="text-xs text-ink-muted">Remaining inflows</div>
              <div className="tabular text-base font-semibold text-positive">{money(data.inflow_total_cents)}</div>
            </div>
            <div className="rounded-lg border border-line-soft bg-muted px-3 py-2">
              <div className="text-xs text-ink-muted">Remaining outflows</div>
              <div className="tabular text-base font-semibold text-negative">{money(data.outflow_total_cents)}</div>
            </div>
          </div>
        </Card>

        <Card title="Forward projection" subtitle="Month-end balance at the current run-rate">
          <BalanceChart points={forwardPoints} format={money} />
          <p className="mt-3 text-xs text-ink-muted">
            Projects the closing balance forward at {money(data.monthly_net_cents)}/month. A straight-line estimate — real months vary with one-off income and expenses.
          </p>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Upcoming movements" subtitle="Dated inflows & outflows this month" className="lg:col-span-2">
          {data.timeline.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Item</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.timeline.map((t, i) => (
                    <tr key={i} className="border-t border-line-soft">
                      <td className="py-2 text-ink-soft">{shortDate(t.date)}</td>
                      <td className="py-2 text-ink">{t.label}</td>
                      <td className={`tabular py-2 text-right ${t.amount_cents >= 0 ? "text-positive" : "text-negative"}`}>
                        {t.amount_cents >= 0 ? "+" : "−"}{money(Math.abs(t.amount_cents))}
                      </td>
                      <td className={`tabular py-2 text-right ${t.balance_cents < 0 ? "text-negative" : "text-ink"}`}>
                        {money(t.balance_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No dated movements remaining this month.</p>
          )}
        </Card>

        <Card title="Liquid accounts" subtitle="What's spendable now">
          <div className="space-y-2">
            {data.liquid_accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-ink-muted capitalize">{a.type}</div>
                </div>
                <span className="tabular text-sm font-semibold text-ink">{money(a.balance_cents)}</span>
              </div>
            ))}
            {!data.liquid_accounts.length && (
              <p className="text-sm text-ink-muted">
                No liquid accounts yet. <Link href="/wealth" className="text-brand-dark underline">Add an account</Link> to project cash flow.
              </p>
            )}
            <div className="flex items-center justify-between border-t border-line-soft pt-2">
              <span className="text-sm font-semibold text-ink">Opening balance</span>
              <span className="tabular text-sm font-semibold text-ink">{money(data.opening_cents)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Badge tone="info">Explainable estimate</Badge>
        <span className="ml-2 text-xs text-ink-muted">
          Cash flow uses your live account balances plus outstanding obligations from the settlement engine — no figures are invented.
        </span>
      </div>
    </AppShell>
  );
}
