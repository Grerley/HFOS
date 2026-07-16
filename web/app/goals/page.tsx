"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, EmptyState, PageSkeleton, ErrorState } from "@/components/ui";
import { ProgressBar } from "@/components/viz";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, toCents } from "@/lib/format";
import type { Goal } from "@/lib/types";

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const currency = "ZAR";

  async function load() {
    setLoading(true);
    setError(false);
    try {
      setGoals(await api.get<Goal[]>("/goals"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createGoal(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    await api.post("/goals", {
      name: f.get("name"),
      goal_type: f.get("type") || null,
      target_amount_cents: toCents(f.get("target") as string),
      current_amount_cents: toCents(f.get("current") as string),
      target_date: (f.get("date") as string) || null,
      monthly_contribution_cents: toCents(f.get("monthly") as string),
    });
    setShowForm(false);
    await load();
  }

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  if (error) return (
    <AppShell>
      <PageHeader title="Goals" description="Target, deadline and the monthly contribution needed to get there." />
      <ErrorState hint="We couldn't load your goals. Check your connection and try again." onRetry={load} />
    </AppShell>
  );

  return (
    <AppShell>
      <PageHeader
        title="Goals"
        description="Target, deadline and the monthly contribution needed to get there."
        actions={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "New goal"}</Button>}
      />

      {showForm && (
        <Card className="mb-6" title="New goal">
          <form onSubmit={createGoal} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Type"><Input name="type" placeholder="emergency_fund" /></Field>
            <Field label="Target date"><Input name="date" type="date" /></Field>
            <Field label="Target amount"><Input name="target" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Current amount"><Input name="current" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Monthly contribution"><Input name="monthly" type="number" step="0.01" defaultValue="0" /></Field>
            <div className="col-span-2 md:col-span-3"><Button type="submit">Create goal</Button></div>
          </form>
        </Card>
      )}

      {!goals.length ? (
        <EmptyState title="No goals yet" hint="Create a goal such as an emergency fund or school fees." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.id} title={g.name} subtitle={g.goal_type || undefined}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="tabular">{formatMoney(g.current_amount_cents, currency)} / {formatMoney(g.target_amount_cents, currency)}</span>
                <span className="font-medium text-brand-dark">{formatPercent(g.progress)}</span>
              </div>
              <ProgressBar value={g.progress} tone={g.progress >= 1 ? "positive" : "brand"} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted">
                <div>Months left: <span className="font-medium text-ink">{g.months_remaining}</span></div>
                <div>Monthly needed: <span className="tabular font-medium text-ink">{formatMoney(g.monthly_required_cents, currency)}</span></div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
