"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal, Steps, Button, Field, Input, Select, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Period, PeriodSummary } from "@/lib/types";

// Guided "new month" creation: start fresh or copy a prior month with
// inflation / salary adjustments and a live projected-totals preview.
export default function NewMonthWizard({
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
  onCreated: (p: Period) => void;
}) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"copy" | "fresh">("copy");
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [copyAdHoc, setCopyAdHoc] = useState(false);
  const [incomePct, setIncomePct] = useState(0);
  const [expensePct, setExpensePct] = useState(0);
  const [savingsPct, setSavingsPct] = useState(0);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sourceSummary, setSourceSummary] = useState<PeriodSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPeriods = periods.length > 0;

  // Reset to a sensible starting state whenever the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setMode(hasPeriods ? "copy" : "fresh");
    setSourceId(hasPeriods ? periods[0].id : null);
    setCopyAdHoc(false);
    setIncomePct(0); setExpensePct(0); setSavingsPct(0);
    setLabel(""); setStart(""); setEnd("");
    setError(null);
  }, [open, hasPeriods, periods]);

  // Load the source period's totals to preview the projection.
  useEffect(() => {
    if (!open || mode !== "copy" || !sourceId) { setSourceSummary(null); return; }
    api.get<{ summary: PeriodSummary }>(`/reports/monthly?period_id=${sourceId}`)
      .then((r) => setSourceSummary(r.summary))
      .catch(() => setSourceSummary(null));
    // Suggest label + next-month dates from the source period.
    const src = periods.find((p) => p.id === sourceId);
    if (src) {
      setLabel((l) => l || `${src.label} +1`);
      if (src.end_date) {
        const d = new Date(src.end_date);
        const ns = new Date(d); ns.setDate(d.getDate() + 1);
        const ne = new Date(ns); ne.setMonth(ns.getMonth() + 1); ne.setDate(ne.getDate() - 1);
        setStart((s) => s || ns.toISOString().slice(0, 10));
        setEnd((e) => e || ne.toISOString().slice(0, 10));
      }
    }
  }, [open, mode, sourceId, periods]);

  const projected = useMemo(() => {
    if (mode !== "copy" || !sourceSummary) return null;
    const p = sourceSummary.planned;
    const inc = Math.round(p.total_income_cents * (1 + incomePct / 100));
    // Expenses here means all outflows; savings sit inside expenses total, so
    // approximate the adjusted expense total by scaling the non-savings portion
    // by expense% and the savings portion by savings%.
    const savingsBase = p.total_savings_cents;
    const pureExpense = p.total_expenses_cents - savingsBase;
    const exp = Math.round(pureExpense * (1 + expensePct / 100)) + Math.round(savingsBase * (1 + savingsPct / 100));
    return { income: inc, expenses: exp, net: inc - exp };
  }, [mode, sourceSummary, incomePct, expensePct, savingsPct]);

  const steps = mode === "copy" ? ["Source", "Adjust", "Dates"] : ["Start", "Dates"];
  const lastStep = steps.length - 1;

  function next() {
    setError(null);
    if (step === 0 && mode === "copy" && !sourceId) { setError("Choose a month to copy from."); return; }
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function back() { setError(null); setStep((s) => Math.max(s - 1, 0)); }

  async function submit() {
    if (!label.trim() || !start || !end) { setError("Label, start and end dates are required."); return; }
    setBusy(true); setError(null);
    try {
      let created: Period;
      if (mode === "copy" && sourceId) {
        created = await api.post<Period>(`/budget-periods/${sourceId}/duplicate`, {
          label: label.trim(), start_date: start, end_date: end, copy_ad_hoc: copyAdHoc,
          adjust: { income_pct: incomePct / 100, expense_pct: expensePct / 100, savings_pct: savingsPct / 100 },
        });
      } else {
        created = await api.post<Period>("/budget-periods", { label: label.trim(), start_date: start, end_date: end });
      }
      onCreated(created);
      onClose();
    } catch (e: any) {
      setError(e.message || "Could not create the period.");
    } finally {
      setBusy(false);
    }
  }

  const money = (c: number) => formatMoney(c, currency);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New month"
      subtitle="Plan the next period in a few guided steps"
      wide
      footer={
        <>
          {step > 0 && <Button variant="ghost" onClick={back} disabled={busy}>Back</Button>}
          {step < lastStep ? (
            <Button onClick={next}>Continue</Button>
          ) : (
            <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create month"}</Button>
          )}
        </>
      }
    >
      <Steps steps={steps} current={step} />
      {error && <p className="mb-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      {/* Step: choose start mode / source */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("copy")}
              disabled={!hasPeriods}
              className={`rounded-xl border p-4 text-left transition disabled:opacity-40 ${
                mode === "copy" ? "border-brand ring-1 ring-brand" : "border-line hover:border-brand"
              }`}
            >
              <div className="text-sm font-semibold text-ink">Copy a previous month</div>
              <p className="mt-1 text-xs text-ink-muted">Carry recurring lines forward, then adjust for inflation or a raise.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("fresh")}
              className={`rounded-xl border p-4 text-left transition ${
                mode === "fresh" ? "border-brand ring-1 ring-brand" : "border-line hover:border-brand"
              }`}
            >
              <div className="text-sm font-semibold text-ink">Start fresh</div>
              <p className="mt-1 text-xs text-ink-muted">An empty period you build up from scratch.</p>
            </button>
          </div>

          {mode === "copy" && (
            <>
              <Field label="Copy from">
                <Select value={sourceId ?? ""} onChange={(e) => setSourceId(Number(e.target.value))}>
                  {periods.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.status})</option>)}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={copyAdHoc} onChange={(e) => setCopyAdHoc(e.target.checked)} />
                Also copy one-off (non-recurring) lines
              </label>
            </>
          )}
        </div>
      )}

      {/* Step: adjustments (copy mode only) */}
      {mode === "copy" && step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Scale carried-forward amounts. Leave at 0 to copy exactly.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Income / salary %">
              <Input type="number" step="0.5" value={incomePct} onChange={(e) => setIncomePct(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Expenses (inflation) %">
              <Input type="number" step="0.5" value={expensePct} onChange={(e) => setExpensePct(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Savings %">
              <Input type="number" step="0.5" value={savingsPct} onChange={(e) => setSavingsPct(Number(e.target.value) || 0)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Preset label="CPI +6% expenses" onClick={() => setExpensePct(6)} />
            <Preset label="Salary +5%" onClick={() => setIncomePct(5)} />
            <Preset label="No change" onClick={() => { setIncomePct(0); setExpensePct(0); setSavingsPct(0); }} />
          </div>

          {projected && (
            <div className="rounded-xl border border-line bg-muted p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Projected totals</span>
                <Badge tone="info">preview</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Preview label="Income" from={sourceSummary!.planned.total_income_cents} to={projected.income} money={money} good />
                <Preview label="Expenses" from={sourceSummary!.planned.total_expenses_cents} to={projected.expenses} money={money} />
                <Preview label="Net" from={sourceSummary!.planned.net_position_cents} to={projected.net} money={money} good={projected.net >= 0} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step: label + dates (always last) */}
      {step === lastStep && (
        <div className="space-y-4">
          <Field label="Period label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mar 2026" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          {mode === "copy" && projected && (
            <p className="text-xs text-ink-muted">
              Creating this month will carry forward {copyAdHoc ? "all" : "recurring"} lines from the source with your adjustments applied
              (projected net {money(projected.net)}). Amounts remain fully editable afterwards.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:border-brand hover:text-brand-dark">
      {label}
    </button>
  );
}

function Preview({ label, from, to, money, good }: { label: string; from: number; to: number; money: (c: number) => string; good?: boolean }) {
  const delta = to - from;
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-base font-semibold ${good === false ? "text-negative" : "text-ink"}`}>{money(to)}</div>
      {delta !== 0 && (
        <div className={`tabular text-xs ${delta >= 0 ? "text-positive" : "text-negative"}`}>
          {delta >= 0 ? "+" : "−"}{money(Math.abs(delta))}
        </div>
      )}
    </div>
  );
}
