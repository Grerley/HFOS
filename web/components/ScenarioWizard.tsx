"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal, Steps, Button, Field, Input, Select, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, toCents } from "@/lib/format";
import type { Period, PeriodSummary, Scenario } from "@/lib/types";

// Guided "what-if" builder: pick a base month, dial in assumptions with presets,
// preview the projected position live, then persist (the server recomputes).
interface Assumptions {
  income_change_pct: number; // whole percent
  expense_change_pct: number;
  new_monthly_expense: string; // major units, kept as string for the input
  savings_increase: string;
}

const BLANK: Assumptions = { income_change_pct: 0, expense_change_pct: 0, new_monthly_expense: "", savings_increase: "" };

const PRESETS: { label: string; apply: Partial<Assumptions> }[] = [
  { label: "Income −20%", apply: { income_change_pct: -20 } },
  { label: "Lose one salary", apply: { income_change_pct: -50 } },
  { label: "Inflation +8% costs", apply: { expense_change_pct: 8 } },
  { label: "Save R2 000 more", apply: { savings_increase: "2000" } },
];

export default function ScenarioWizard({
  open,
  onClose,
  periods,
  currency,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  periods: Period[];
  currency: string;
  onCreated: (s: Scenario) => void;
}) {
  const [step, setStep] = useState(0);
  const [baseId, setBaseId] = useState<number | null>(periods[0]?.id ?? null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [a, setA] = useState<Assumptions>(BLANK);
  const [baseSummary, setBaseSummary] = useState<PeriodSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setBaseId(periods[0]?.id ?? null);
    setName(""); setDesc(""); setA(BLANK); setError(null);
  }, [open, periods]);

  useEffect(() => {
    if (!open || !baseId) { setBaseSummary(null); return; }
    api.get<{ summary: PeriodSummary }>(`/reports/monthly?period_id=${baseId}`)
      .then((r) => setBaseSummary(r.summary))
      .catch(() => setBaseSummary(null));
  }, [open, baseId]);

  // Mirror server applyAssumptions() for an instant preview.
  const preview = useMemo(() => {
    if (!baseSummary) return null;
    const b = baseSummary.planned;
    const income = Math.round(b.total_income_cents * (1 + a.income_change_pct / 100));
    const extra = a.savings_increase ? toCents(a.savings_increase) : 0;
    const newExp = a.new_monthly_expense ? toCents(a.new_monthly_expense) : 0;
    const expenses = Math.round(b.total_expenses_cents * (1 + a.expense_change_pct / 100)) + newExp + extra;
    const savings = b.total_savings_cents + extra;
    const net = income - expenses;
    return { income, expenses, net, savings_rate: income > 0 ? savings / income : 0 };
  }, [baseSummary, a]);

  const steps = ["Base", "Assumptions", "Save"];
  const lastStep = steps.length - 1;
  function next() {
    setError(null);
    if (step === 0 && !baseId) { setError("Choose a base month."); return; }
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function back() { setError(null); setStep((s) => Math.max(s - 1, 0)); }
  function applyPreset(p: Partial<Assumptions>) { setA((cur) => ({ ...cur, ...p })); }

  async function submit() {
    if (!name.trim()) { setError("Give the scenario a name."); return; }
    setBusy(true); setError(null);
    try {
      const assumptions: Record<string, number> = {};
      if (a.income_change_pct) assumptions.income_change_pct = a.income_change_pct / 100;
      if (a.expense_change_pct) assumptions.expense_change_pct = a.expense_change_pct / 100;
      if (a.new_monthly_expense && Number(a.new_monthly_expense)) assumptions.new_monthly_expense_cents = toCents(a.new_monthly_expense);
      if (a.savings_increase && Number(a.savings_increase)) assumptions.savings_increase_cents = toCents(a.savings_increase);
      const s = await api.post<Scenario>("/scenarios", {
        name: name.trim(), base_period_id: baseId, description: desc || null, assumptions_json: assumptions,
      });
      onCreated(s);
      onClose();
    } catch (e: any) {
      setError(e.message || "Could not create the scenario.");
    } finally {
      setBusy(false);
    }
  }

  const money = (c: number) => formatMoney(c, currency);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New scenario"
      subtitle="Model a decision safely — scenarios never change your real budgets"
      wide
      footer={
        <>
          {step > 0 && <Button variant="ghost" onClick={back} disabled={busy}>Back</Button>}
          {step < lastStep ? <Button onClick={next}>Continue</Button>
            : <Button onClick={submit} disabled={busy}>{busy ? "Running…" : "Run scenario"}</Button>}
        </>
      }
    >
      <Steps steps={steps} current={step} />
      {error && <p className="mb-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      {step === 0 && (
        <div className="space-y-4">
          <Field label="Base month">
            <Select value={baseId ?? ""} onChange={(e) => setBaseId(Number(e.target.value))}>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.status})</option>)}
            </Select>
          </Field>
          {baseSummary && (
            <div className="rounded-xl border border-line bg-muted p-4 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Baseline</span>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="Income" value={money(baseSummary.planned.total_income_cents)} />
                <Stat label="Expenses" value={money(baseSummary.planned.total_expenses_cents)} />
                <Stat label="Net" value={money(baseSummary.planned.net_position_cents)} tone={baseSummary.planned.net_position_cents >= 0 ? "positive" : "negative"} />
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => applyPreset(p.apply)}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:border-brand hover:text-brand-dark">
                {p.label}
              </button>
            ))}
            <button type="button" onClick={() => setA(BLANK)}
              className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-muted hover:text-ink">Reset</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Income change %">
              <Input type="number" step="1" value={a.income_change_pct} onChange={(e) => setA({ ...a, income_change_pct: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Expense change %">
              <Input type="number" step="1" value={a.expense_change_pct} onChange={(e) => setA({ ...a, expense_change_pct: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="New monthly expense">
              <Input type="number" step="0.01" value={a.new_monthly_expense} onChange={(e) => setA({ ...a, new_monthly_expense: e.target.value })} />
            </Field>
            <Field label="Extra monthly savings">
              <Input type="number" step="0.01" value={a.savings_increase} onChange={(e) => setA({ ...a, savings_increase: e.target.value })} />
            </Field>
          </div>

          {preview && baseSummary && (
            <div className="rounded-xl border border-line bg-muted p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Projected outcome</span>
                <Badge tone="info">live preview</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Delta label="Income" from={baseSummary.planned.total_income_cents} to={preview.income} money={money} />
                <Delta label="Expenses" from={baseSummary.planned.total_expenses_cents} to={preview.expenses} money={money} invert />
                <Delta label="Net" from={baseSummary.planned.net_position_cents} to={preview.net} money={money} good={preview.net >= 0} />
                <div>
                  <div className="text-xs text-ink-muted">Savings rate</div>
                  <div className="tabular text-base font-semibold text-ink">{formatPercent(preview.savings_rate)}</div>
                  <div className="tabular text-xs text-ink-muted">was {formatPercent(baseSummary.planned.savings_rate)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Scenario name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. If we lose one salary" /></Field>
          <Field label="Description (optional)"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          {preview && (
            <p className="text-xs text-ink-muted">
              This scenario projects a net position of {money(preview.net)}. It is saved for comparison and never alters your real budget.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const c = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return <div><div className="text-xs text-ink-muted">{label}</div><div className={`tabular text-base font-semibold ${c}`}>{value}</div></div>;
}

function Delta({ label, from, to, money, good, invert }: { label: string; from: number; to: number; money: (c: number) => string; good?: boolean; invert?: boolean }) {
  const delta = to - from;
  const positiveIsGood = invert ? delta < 0 : delta > 0;
  const deltaColor = delta === 0 ? "text-ink-muted" : positiveIsGood ? "text-positive" : "text-negative";
  const valueColor = good === false ? "text-negative" : "text-ink";
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-base font-semibold ${valueColor}`}>{money(to)}</div>
      {delta !== 0 && <div className={`tabular text-xs ${deltaColor}`}>{delta >= 0 ? "+" : "−"}{money(Math.abs(delta))}</div>}
    </div>
  );
}
