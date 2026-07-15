"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Card, StatCard, Badge, EmptyState, Spinner } from "@/components/ui";
import { CategoryBars, TrendChart } from "@/components/viz";
import { api } from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import type { DashboardResponse, Insight } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, ins, tr] = await Promise.all([
          api.get<DashboardResponse>("/dashboard"),
          api.get<Insight[]>("/insights").catch(() => []),
          api.get<{ series: any[] }>("/reports/trends").catch(() => ({ series: [] })),
        ]);
        setData(d);
        setInsights(ins);
        setTrend(tr.series);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <AppShell><Spinner /></AppShell>;

  if (!data?.has_period) {
    return (
      <AppShell>
        <PageHeader title="Dashboard" description="Your household's financial position at a glance." />
        <EmptyState
          title="No budget period yet"
          hint="Create a monthly budget in the planner, or import your existing workbook, to populate the dashboard."
        />
      </AppShell>
    );
  }

  const currency = data.currency || "ZAR";
  const p = data.summary!.planned;
  const netTone = p.net_position_cents >= 0 ? "positive" : "negative";

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description={`${data.period!.label} · ${data.period!.status}`}
        actions={<Badge tone="info">Formula v{data.summary!.formula_version}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Income" value={formatMoney(p.total_income_cents, currency)} />
        <StatCard label="Expenses" value={formatMoney(p.total_expenses_cents, currency)} />
        <StatCard
          label="Surplus / shortfall"
          value={formatMoney(p.net_position_cents, currency)}
          tone={netTone}
          hint={p.net_position_cents >= 0 ? "Planned surplus" : "Planned shortfall"}
        />
        <StatCard label="Savings rate" value={formatPercent(p.savings_rate)} hint="Savings ÷ income" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard label="Net worth" value={formatMoney(data.net_worth_cents, currency)} hint="Assets − liabilities" />
        <StatCard label="Actual income" value={formatMoney(data.summary!.actual.total_income_cents, currency)} />
        <StatCard
          label="Expense variance"
          value={formatMoney(data.summary!.variance.expenses.variance_cents, currency)}
          tone={data.summary!.variance.expenses.variance_cents > 0 ? "negative" : "positive"}
          hint="Actual − planned"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Expense breakdown" subtitle="Share of planned expenses by category">
          <CategoryBars rows={data.summary!.category_breakdown} format={(c) => formatMoney(c, currency)} />
        </Card>

        <Card title="Owner contributions" subtitle="Income, responsibility and net by member">
          <div className="space-y-3">
            {(data.owner_cards || []).map((o) => (
              <div key={o.member_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-ink">{o.member_name}</span>
                <div className="tabular flex gap-4 text-xs text-ink-muted">
                  <span>In {formatMoney(o.income_cents, currency)}</span>
                  <span>Out {formatMoney(o.expense_cents, currency)}</span>
                  <span className={o.net_cents >= 0 ? "text-positive" : "text-negative"}>
                    Net {formatMoney(o.net_cents, currency)}
                  </span>
                </div>
              </div>
            ))}
            {!(data.owner_cards || []).length && <p className="text-sm text-ink-muted">No owner allocations yet.</p>}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="12-month trend" subtitle="Income · expenses · net" className="lg:col-span-2">
          <TrendChart series={trend} />
          <div className="mt-3 flex gap-4 text-xs text-ink-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-positive" />Income</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-negative" />Expenses</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand" />Net</span>
          </div>
        </Card>

        <Card title="Insights & alerts" subtitle="Explainable, rule-based">
          <div className="space-y-3">
            {insights.slice(0, 5).map((i) => (
              <div key={i.id} className="rounded-lg border border-slate-100 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <Badge tone={i.severity}>{i.severity}</Badge>
                </div>
                <p className="text-sm font-medium text-ink">{i.summary}</p>
                {i.explanation && <p className="mt-1 text-xs text-ink-muted">{i.explanation}</p>}
              </div>
            ))}
            {!insights.length && <p className="text-sm text-ink-muted">No alerts. Generate insights from the planner.</p>}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
