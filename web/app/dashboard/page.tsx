"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import Link from "next/link";
import { Card, StatCard, Badge, EmptyState, PageSkeleton } from "@/components/ui";
import { CategoryBars, TrendChart } from "@/components/viz";
import { api } from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import type { DashboardResponse, Insight } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [settle, setSettle] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, ins, tr, st] = await Promise.all([
          api.get<DashboardResponse>("/dashboard"),
          api.get<Insight[]>("/insights").catch(() => []),
          api.get<{ series: any[] }>("/reports/trends").catch(() => ({ series: [] })),
          api.get<any>("/reports/outstanding").catch(() => null),
        ]);
        setData(d);
        setInsights(ins);
        setTrend(tr.series);
        setSettle(st?.has_period ? st : null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

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
  const sm = settle?.summary ?? null;

  const briefing = (() => {
    const bits: string[] = [];
    bits.push(
      p.net_position_cents >= 0
        ? `Your household is broadly on track — a planned surplus of ${formatMoney(p.net_position_cents, currency)} this month`
        : `Heads up: planned expenses exceed income by ${formatMoney(-p.net_position_cents, currency)} this month`,
    );
    if (sm) {
      if (sm.total_outstanding_cents > 0)
        bits.push(`${formatMoney(sm.total_outstanding_cents, currency)} is still outstanding across ${sm.line_count} obligations`);
      if (sm.overdue_count > 0) bits.push(`${sm.overdue_count} overdue`);
      if (sm.debit_pending_count > 0) bits.push(`${sm.debit_pending_count} debit order${sm.debit_pending_count === 1 ? "" : "s"} to confirm`);
      if (sm.manual_remaining_count > 0) bits.push(`${sm.manual_remaining_count} manual payment${sm.manual_remaining_count === 1 ? "" : "s"} still to make`);
    }
    bits.push(`Savings rate is ${formatPercent(p.savings_rate)}`);
    return bits.join(". ") + ".";
  })();

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description={`${data.period!.label} · ${data.period!.status}`}
        actions={<Badge tone="info">Formula v{data.summary!.formula_version}</Badge>}
      />

      {/* AI CFO briefing (§9.5) — concise, explainable, non-alarmist, actionable. */}
      <div className="mb-5 rounded-xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-ai" aria-hidden>✦</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">CFO briefing</h3>
              <Badge tone="info">rule-based</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{briefing}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/payments" className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:bg-muted">Review payments</Link>
              <Link href="/copilot" className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:bg-muted">Ask HFOS</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Payment settlement status (§9.4) — month-to-date operational reality. */}
      {sm && (
        <Card className="mb-5" title="Payment settlement status" subtitle="Where this month's obligations stand"
          actions={<Link href="/payments" className="text-xs font-medium text-brand-dark hover:underline">Open Payments →</Link>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MiniStat label="Planned" value={formatMoney(sm.total_planned_cents, currency)} />
            <MiniStat label="Paid" value={formatMoney(sm.total_paid_cents, currency)} tone="positive" />
            <MiniStat label="Outstanding" value={formatMoney(sm.total_outstanding_cents, currency)} tone={sm.total_outstanding_cents > 0 ? "negative" : undefined} />
            <MiniStat label="Overdue" value={formatMoney(sm.total_overdue_cents, currency)} tone={sm.total_overdue_cents > 0 ? "negative" : undefined} hint={`${sm.overdue_count} item${sm.overdue_count === 1 ? "" : "s"}`} />
            <MiniStat label="Debit pending" value={String(sm.debit_pending_count)} />
            <MiniStat label="Manual left" value={String(sm.manual_remaining_count)} />
          </div>
        </Card>
      )}

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
              <div key={o.member_id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
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
              <div key={i.id} className="rounded-lg border border-line-soft p-3">
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

function MiniStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "positive" | "negative" }) {
  const c = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="rounded-lg border border-line-soft bg-muted px-3 py-2.5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-base font-semibold ${c}`}>{value}</div>
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
