"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, Badge, StatCard, EmptyState, PageSkeleton, ErrorState } from "@/components/ui";
import { ProgressBar } from "@/components/viz";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatPercent, toCents, fromCents } from "@/lib/format";
import type { Goal } from "@/lib/types";

const PACE: Record<Goal["pace"], { label: string; tone: string }> = {
  complete: { label: "Funded", tone: "positive" },
  on_track: { label: "On track", tone: "positive" },
  behind: { label: "Behind", tone: "warning" },
  overdue: { label: "Overdue", tone: "critical" },
  unscheduled: { label: "No deadline", tone: "neutral" },
};

function Detail({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const currency = useCurrency();

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

  function readForm(f: FormData) {
    return {
      name: f.get("name"),
      goal_type: (f.get("type") as string) || null,
      target_amount_cents: toCents(f.get("target") as string),
      current_amount_cents: toCents(f.get("current") as string),
      target_date: (f.get("date") as string) || null,
      monthly_contribution_cents: toCents(f.get("monthly") as string),
      priority: Number(f.get("priority") || 3),
      notes: (f.get("notes") as string) || null,
    };
  }

  async function createGoal(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/goals", readForm(new FormData(e.target as HTMLFormElement)));
      setShowForm(false);
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function saveGoal(id: number, e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/goals/${id}`, readForm(new FormData(e.target as HTMLFormElement)));
      setEditing(null);
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function removeGoal(g: Goal) {
    if (!confirm(`Delete the goal "${g.name}"? This can't be undone.`)) return;
    try { await api.del(`/goals/${g.id}`); await load(); }
    catch (err: any) { alert(err.message); }
  }

  const money = (c: number) => formatMoney(c, currency);

  // Portfolio roll-up — sums/counts of engine-computed figures, no re-derived formulas.
  const totals = goals.reduce(
    (a, g) => ({
      saved: a.saved + g.current_amount_cents,
      target: a.target + g.target_amount_cents,
      monthlyNeeded: a.monthlyNeeded + g.monthly_required_cents,
      onTrack: a.onTrack + (g.pace === "on_track" || g.pace === "complete" ? 1 : 0),
      attention: a.attention + (g.pace === "behind" || g.pace === "overdue" ? 1 : 0),
    }),
    { saved: 0, target: 0, monthlyNeeded: 0, onTrack: 0, attention: 0 },
  );

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

      {goals.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total saved" value={money(totals.saved)} hint={`of ${money(totals.target)} target`} />
          <StatCard label="Still to save" value={money(Math.max(totals.target - totals.saved, 0))} />
          <StatCard label="Monthly needed" value={money(totals.monthlyNeeded)} hint="across all goals" />
          <StatCard
            label="On track"
            value={`${totals.onTrack}/${goals.length}`}
            tone={totals.attention > 0 ? "negative" : "positive"}
            hint={totals.attention > 0 ? `${totals.attention} need attention` : "all goals on pace"}
          />
        </div>
      )}

      {showForm && (
        <Card className="mb-6" title="New goal">
          <form onSubmit={createGoal} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Type"><Input name="type" placeholder="emergency_fund" /></Field>
            <Field label="Target date"><Input name="date" type="date" /></Field>
            <Field label="Target amount"><Input name="target" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Current amount"><Input name="current" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Monthly contribution"><Input name="monthly" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Priority">
              <Select name="priority" defaultValue="3">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? "1 (highest)" : n === 5 ? "5 (lowest)" : n}</option>)}
              </Select>
            </Field>
            <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
            <div className="col-span-2 md:col-span-3"><Button type="submit">Create goal</Button></div>
          </form>
        </Card>
      )}

      {!goals.length ? (
        <EmptyState title="No goals yet" hint="Create a goal such as an emergency fund or school fees." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {goals.map((g) => {
            const pace = PACE[g.pace];
            const isEditing = editing === g.id;
            return (
              <Card
                key={g.id}
                title={g.name}
                subtitle={g.goal_type || undefined}
                actions={
                  <div className="flex items-center gap-2">
                    <Badge tone={pace.tone}>{pace.label}</Badge>
                    <button onClick={() => setEditing(isEditing ? null : g.id)} className="text-xs font-medium text-brand-dark hover:underline">{isEditing ? "Cancel" : "Edit"}</button>
                    <button onClick={() => removeGoal(g)} title="Delete goal" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
                  </div>
                }
              >
                {isEditing ? (
                  <form onSubmit={(e) => saveGoal(g.id, e)} className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Field label="Name"><Input name="name" defaultValue={g.name} required /></Field>
                    <Field label="Type"><Input name="type" defaultValue={g.goal_type ?? ""} /></Field>
                    <Field label="Target date"><Input name="date" type="date" defaultValue={g.target_date ?? ""} /></Field>
                    <Field label="Target amount"><Input name="target" type="number" step="0.01" defaultValue={fromCents(g.target_amount_cents)} /></Field>
                    <Field label="Current amount"><Input name="current" type="number" step="0.01" defaultValue={fromCents(g.current_amount_cents)} /></Field>
                    <Field label="Monthly contribution"><Input name="monthly" type="number" step="0.01" defaultValue={fromCents(g.monthly_contribution_cents)} /></Field>
                    <Field label="Priority">
                      <Select name="priority" defaultValue={String(g.priority)}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? "1 (highest)" : n === 5 ? "5 (lowest)" : n}</option>)}
                      </Select>
                    </Field>
                    <Field label="Notes"><Input name="notes" defaultValue={g.notes ?? ""} /></Field>
                    <div className="col-span-2 flex items-end md:col-span-3"><Button type="submit">Save changes</Button></div>
                  </form>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="tabular">{money(g.current_amount_cents)} / {money(g.target_amount_cents)}</span>
                      <span className="font-medium text-brand-dark">{formatPercent(g.progress)}</span>
                    </div>
                    <ProgressBar value={g.progress} tone={g.progress >= 1 ? "positive" : "brand"} />
                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                      <Detail label="Still to save" value={money(g.remaining_cents)} />
                      <Detail label="Monthly needed" value={money(g.monthly_required_cents)} />
                      <Detail label="You're contributing" value={money(g.monthly_contribution_cents)} />
                      {g.monthly_shortfall_cents > 0 && (
                        <Detail label="Monthly shortfall" value={money(g.monthly_shortfall_cents)} tone="negative" />
                      )}
                      {g.target_date && (
                        <Detail label="Target date" value={g.target_date} tone={g.pace === "overdue" ? "negative" : undefined} />
                      )}
                      <Detail
                        label="Projected finish"
                        value={g.pace === "complete" ? "Funded" : g.projected_date ?? "No end date"}
                        tone={g.pace === "complete" ? "positive" : g.projected_date == null ? "negative" : undefined}
                      />
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
