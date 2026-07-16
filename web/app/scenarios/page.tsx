"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, EmptyState, PageSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, toCents } from "@/lib/format";
import type { Period, Scenario } from "@/lib/types";

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const currency = "ZAR";

  async function load() {
    const [sc, ps] = await Promise.all([api.get<Scenario[]>("/scenarios"), api.get<Period[]>("/budget-periods")]);
    setScenarios(sc);
    setPeriods(ps);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createScenario(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const assumptions: Record<string, number> = {};
    const incomePct = parseFloat(f.get("income_pct") as string);
    const expensePct = parseFloat(f.get("expense_pct") as string);
    const newExpense = f.get("new_expense") as string;
    const saveInc = f.get("save_inc") as string;
    if (incomePct) assumptions.income_change_pct = incomePct / 100;
    if (expensePct) assumptions.expense_change_pct = expensePct / 100;
    if (newExpense && Number(newExpense)) assumptions.new_monthly_expense_cents = toCents(newExpense);
    if (saveInc && Number(saveInc)) assumptions.savings_increase_cents = toCents(saveInc);
    await api.post<Scenario>("/scenarios", {
      name: f.get("name"),
      base_period_id: Number(f.get("base")) || null,
      description: f.get("desc") || null,
      assumptions_json: assumptions,
    });
    setShowForm(false);
    await load();
  }

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        title="Scenario simulator"
        description="Model a decision before committing. Scenarios never change your real budgets."
        actions={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "New scenario"}</Button>}
      />

      {showForm && (
        <Card className="mb-6" title="New scenario" subtitle="Leave a field at 0 to ignore it">
          <form onSubmit={createScenario} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Base period">
              <Select name="base" required>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Description"><Input name="desc" /></Field>
            <Field label="Income change %"><Input name="income_pct" type="number" step="1" defaultValue="0" /></Field>
            <Field label="Expense change %"><Input name="expense_pct" type="number" step="1" defaultValue="0" /></Field>
            <Field label="New monthly expense"><Input name="new_expense" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Extra monthly savings"><Input name="save_inc" type="number" step="0.01" defaultValue="0" /></Field>
            <div className="col-span-2 md:col-span-3"><Button type="submit">Run scenario</Button></div>
          </form>
        </Card>
      )}

      {!scenarios.length ? (
        <EmptyState title="No scenarios yet" hint="Try 'What if income drops 20%?' or 'Can we afford a new bond?'" />
      ) : (
        <div className="space-y-4">
          {scenarios.map((s) => {
            const r = s.projected_results_json || {};
            const base = r.baseline || {};
            const proj = r.projected || {};
            return (
              <Card key={s.id} title={s.name} subtitle={s.description || undefined}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-ink-muted">
                        <th className="py-1">Metric</th>
                        <th className="py-1 text-right">Baseline</th>
                        <th className="py-1 text-right">Scenario</th>
                        <th className="py-1 text-right">Delta</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      <Row label="Income" b={base.total_income_cents} s={proj.total_income_cents} currency={currency} />
                      <Row label="Expenses" b={base.total_expenses_cents} s={proj.total_expenses_cents} currency={currency} />
                      <Row label="Net position" b={base.net_position_cents} s={proj.net_position_cents} currency={currency} />
                      <tr className="border-t border-line-soft">
                        <td className="py-1.5">Savings rate</td>
                        <td className="py-1.5 text-right">{formatPercent(base.savings_rate)}</td>
                        <td className="py-1.5 text-right">{formatPercent(proj.savings_rate)}</td>
                        <td className="py-1.5 text-right">{formatPercent((proj.savings_rate || 0) - (base.savings_rate || 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, b, s, currency }: { label: string; b: number; s: number; currency: string }) {
  const delta = (s || 0) - (b || 0);
  return (
    <tr className="border-t border-line-soft">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right">{formatMoney(b, currency)}</td>
      <td className="py-1.5 text-right">{formatMoney(s, currency)}</td>
      <td className={`py-1.5 text-right ${delta >= 0 ? "text-positive" : "text-negative"}`}>{formatMoney(delta, currency)}</td>
    </tr>
  );
}
