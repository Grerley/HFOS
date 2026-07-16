"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Card, StatCard, EmptyState, PageSkeleton, Badge, ErrorState } from "@/components/ui";
import { ProgressBar } from "@/components/viz";
import { api } from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import type { Category, DashboardResponse, Line, Period } from "@/lib/types";

interface AccountRow { id: number; name: string; type: string; current_balance_cents: number; }

export default function WealthPage() {
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [savingsLines, setSavingsLines] = useState<Line[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const currency = dash?.currency || "ZAR";

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [d, periods, cats, accs] = await Promise.all([
        api.get<DashboardResponse>("/dashboard"),
        api.get<Period[]>("/budget-periods"),
        api.get<Category[]>("/categories"),
        api.get<AccountRow[]>("/accounts"),
      ]);
      setDash(d);
      setAccounts(accs);
      const savingCatIds = new Set(cats.filter((c) => c.type === "saving" || c.type === "investment").map((c) => c.id));
      if (periods.length) {
        const lines = await api.get<Line[]>(`/budget-periods/${periods[0].id}/lines`);
        setSavingsLines(lines.filter((l) => savingCatIds.has(l.category_id)));
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  if (error) return (
    <AppShell>
      <PageHeader title="Wealth & savings" description="Savings and investments are budgeted obligations, not leftover cash." />
      <ErrorState hint="We couldn't load your wealth data. Check your connection and try again." onRetry={load} />
    </AppShell>
  );
  const p = dash?.summary?.planned;
  const investmentAccounts = accounts.filter((a) => ["investment", "savings_pocket"].includes(a.type));

  return (
    <AppShell>
      <PageHeader title="Wealth & savings" description="Savings and investments are budgeted obligations, not leftover cash." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Monthly savings" value={formatMoney(p?.total_savings_cents, currency)} />
        <StatCard label="Savings rate" value={formatPercent(p?.savings_rate)} hint="Savings ÷ income" />
        <StatCard label="Invested balance" value={formatMoney(investmentAccounts.reduce((s, a) => s + a.current_balance_cents, 0), currency)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Contribution plan" subtitle="Current period savings & investment lines">
          {savingsLines.length ? (
            <div className="space-y-2">
              {savingsLines.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5">
                  <span className="text-sm text-ink">{l.item_name}</span>
                  <span className="tabular text-sm font-medium">{formatMoney(l.planned_amount_cents, currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No savings lines" hint="Add retirement, emergency fund or investment lines in the planner." />
          )}
        </Card>

        <Card title="Investment & savings accounts" subtitle="Balances used for net worth">
          {investmentAccounts.length ? (
            <div className="space-y-2">
              {investmentAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-line-soft px-4 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-ink">{a.name}</div>
                    <Badge>{a.type}</Badge>
                  </div>
                  <span className="tabular text-sm font-medium">{formatMoney(a.current_balance_cents, currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No investment accounts" hint="Add accounts in Settings to track invested balances." />
          )}
        </Card>
      </div>
    </AppShell>
  );
}
