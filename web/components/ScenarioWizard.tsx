"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Steps, Button, Field, Input, Select, Badge } from "@/components/ui";
import ScenarioChart from "@/components/ScenarioChart";
import { api } from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import type { Period, Scenario } from "@/lib/types";
import {
  type ScenarioDraft, type EventDraft, EVENT_TYPES, eventMeta, newEvent, blankDraft,
  serializeDraft, describeEvent, draftFromAssumptions, TEMPLATES,
} from "@/lib/scenarioTemplates";

interface StartState {
  monthly_income_cents: number;
  monthly_expense_cents: number;
  monthly_contribution_cents: number;
  cash_cents: number;
  investments_cents: number;
  liabilities_cents: number;
  other_net_worth_cents: number;
}

const HORIZONS = [1, 2, 3, 5, 7, 10, 15, 20];

export default function ScenarioWizard({
  open, onClose, periods, currency, onSaved, template, editing,
}: {
  open: boolean;
  onClose: () => void;
  periods: Period[];
  currency: string;
  onSaved: (s: Scenario) => void;
  template?: string | null;      // template id to prefill a new scenario
  editing?: Scenario | null;     // existing scenario to edit
}) {
  const [step, setStep] = useState(0);
  const [baseId, setBaseId] = useState<number | null>(periods[0]?.id ?? null);
  const [draft, setDraft] = useState<ScenarioDraft>(blankDraft());
  const [start, setStart] = useState<StartState | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = useCallback((c: number) => formatMoney(c, currency), [currency]);

  // Seed the draft on open (blank, from a template, or from an editing target).
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    if (editing) {
      setBaseId(editing.base_period_id ?? periods[0]?.id ?? null);
      setDraft(draftFromAssumptions(editing.name, editing.description, editing.assumptions_json as any));
    } else if (template) {
      const t = TEMPLATES.find((x) => x.id === template);
      setBaseId(periods[0]?.id ?? null);
      setDraft(t ? t.build() : blankDraft());
    } else {
      setBaseId(periods[0]?.id ?? null);
      setDraft(blankDraft());
    }
  }, [open, template, editing, periods]);

  // Fetch the starting balance sheet for the chosen base month.
  useEffect(() => {
    if (!open) return;
    const q = baseId ? `?base_period_id=${baseId}` : "";
    api.get<StartState>(`/scenarios/start-state${q}`).then(setStart).catch(() => setStart(null));
  }, [open, baseId]);

  // Debounced live preview from the server (single source of truth for the maths).
  const timer = useRef<any>(null);
  useEffect(() => {
    if (!open) return;
    setPreviewing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.post<any>("/scenarios/preview", { base_period_id: baseId, assumptions_json: serializeDraft(draft) });
        setPreview(r);
      } catch { /* keep last preview */ }
      finally { setPreviewing(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [open, baseId, draft]);

  const steps = ["Base", "Assumptions", "Events", "Review"];
  const lastStep = steps.length - 1;
  function next() { setError(null); if (step === 0 && !baseId) { setError("Choose a base month."); return; } setStep((s) => Math.min(s + 1, lastStep)); }
  function back() { setError(null); setStep((s) => Math.max(s - 1, 0)); }

  function patch(p: Partial<ScenarioDraft>) { setDraft((d) => ({ ...d, ...p })); }
  function addEvent(kind: string) { setDraft((d) => ({ ...d, events: [...d.events, newEvent(kind)] })); }
  function updateEvent(id: string, p: Partial<EventDraft>) {
    setDraft((d) => ({ ...d, events: d.events.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  }
  function removeEvent(id: string) { setDraft((d) => ({ ...d, events: d.events.filter((e) => e.id !== id) })); }

  async function save() {
    if (!draft.name.trim()) { setError("Give the scenario a name."); return; }
    setBusy(true); setError(null);
    try {
      const payload = { name: draft.name.trim(), base_period_id: baseId, description: draft.description || null, assumptions_json: serializeDraft(draft) };
      const s = editing
        ? await api.patch<Scenario>(`/scenarios/${editing.id}`, payload)
        : await api.post<Scenario>("/scenarios", payload);
      onSaved(s);
      onClose();
    } catch (e: any) { setError(e.message || "Could not save the scenario."); }
    finally { setBusy(false); }
  }

  const summary = preview?.summary;
  const netWorthSeries = useMemo(() => {
    if (!preview?.scenario?.months) return null;
    return {
      months: preview.scenario.months.length,
      scenario: preview.scenario.months.map((m: any) => m.net_worth_cents),
      baseline: preview.baseline.months.map((m: any) => m.net_worth_cents),
    };
  }, [preview]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit scenario" : "New scenario"}
      subtitle="Project a decision over years: scenarios never change your real budgets"
      wide
      footer={
        <>
          {step > 0 && <Button variant="ghost" onClick={back} disabled={busy}>Back</Button>}
          {step < lastStep
            ? <Button onClick={next}>Continue</Button>
            : <Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save scenario"}</Button>}
        </>
      }
    >
      <Steps steps={steps} current={step} />
      {error && <p className="mb-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      {/* STEP 0: base month + horizon + starting balance sheet */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Base month (your starting point)">
              <Select value={baseId ?? ""} onChange={(e) => setBaseId(Number(e.target.value))}>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.status})</option>)}
              </Select>
            </Field>
            <Field label="Project over">
              <Select value={draft.horizon_years} onChange={(e) => patch({ horizon_years: Number(e.target.value) })}>
                {HORIZONS.map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
              </Select>
            </Field>
          </div>
          {start && (
            <div className="rounded-xl border border-line bg-muted p-4 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Starting point (from your data)</span>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Income / mo" value={money(start.monthly_income_cents)} />
                <Stat label="Living costs / mo" value={money(start.monthly_expense_cents)} />
                <Stat label="Saving / mo" value={money(start.monthly_contribution_cents)} />
                <Stat label="Cash" value={money(start.cash_cents)} />
                <Stat label="Investments" value={money(start.investments_cents)} />
                <Stat label="Debts" value={money(start.liabilities_cents)} />
              </div>
              <p className="mt-2 text-xs text-ink-muted">Balances come from your accounts; monthly flows from the base month's plan. Property equity is included in net worth.</p>
            </div>
          )}
        </div>
      )}

      {/* STEP 1: global assumptions */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">These drive the year-on-year drift. Sensible South-African defaults are pre-filled. Adjust to taste.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PctField label="Inflation on living costs" value={draft.annual_inflation} onChange={(v) => patch({ annual_inflation: v })} />
            <PctField label="Income growth / year" value={draft.annual_income_growth} onChange={(v) => patch({ annual_income_growth: v })} />
            <PctField label="Investment return / year" value={draft.annual_investment_return} onChange={(v) => patch({ annual_investment_return: v })} />
            <PctField label="Cash return / year" value={draft.annual_cash_return} onChange={(v) => patch({ annual_cash_return: v })} />
          </div>
          <MiniOutcome summary={summary} previewing={previewing} money={money} />
        </div>
      )}

      {/* STEP 2: event timeline */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-ink-soft">Add the decisions and life events to model. Each applies from its month onward.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EVENT_TYPES.map((t) => (
                <button key={t.kind} type="button" onClick={() => addEvent(t.kind)}
                  className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:border-brand hover:text-brand-dark">
                  + {t.label}
                </button>
              ))}
            </div>
          </div>

          {draft.events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
              No events yet. Add one above, or leave empty to project your current trajectory.
            </p>
          ) : (
            <div className="space-y-3">
              {draft.events.map((e) => <EventEditor key={e.id} e={e} horizonMonths={draft.horizon_years * 12} onChange={(p) => updateEvent(e.id, p)} onRemove={() => removeEvent(e.id)} />)}
            </div>
          )}
          <MiniOutcome summary={summary} previewing={previewing} money={money} />
        </div>
      )}

      {/* STEP 3: review + chart + save */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Scenario name"><Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Buy a home in 2027" /></Field>
            <Field label="Description (optional)"><Input value={draft.description} onChange={(e) => patch({ description: e.target.value })} /></Field>
          </div>

          {netWorthSeries && (
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Net worth projection</span>
                {previewing && <Badge tone="info">updating…</Badge>}
              </div>
              <ScenarioChart
                months={netWorthSeries.months}
                format={money}
                series={[
                  { label: "This scenario", color: "#6366f1", values: netWorthSeries.scenario },
                  { label: "Do nothing", color: "#94a3b8", values: netWorthSeries.baseline, dashed: true },
                ]}
              />
            </div>
          )}
          <MiniOutcome summary={summary} previewing={previewing} money={money} expanded />
          {draft.events.length > 0 && (
            <div className="text-xs text-ink-muted">
              <span className="font-medium text-ink-soft">Events:</span> {draft.events.map((e) => describeEvent(e, (v) => money(Math.round(v * 100)))).join(" · ")}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-muted">{label}</div><div className="tabular text-sm font-semibold text-ink">{value}</div></div>;
}

function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={`${label} (%)`}>
      <Input type="number" step="0.5" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </Field>
  );
}

function MiniOutcome({ summary, previewing, money, expanded }: { summary: any; previewing: boolean; money: (c: number) => string; expanded?: boolean }) {
  if (!summary) return <p className="text-xs text-ink-muted">{previewing ? "Projecting…" : "Adjust inputs to see the projection."}</p>;
  const nwDelta = summary.net_worth_delta_cents ?? 0;
  return (
    <div className="rounded-xl border border-line bg-muted p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Projected outcome</span>
        <Badge tone="info">{previewing ? "updating…" : "live"}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Net worth at horizon" value={money(summary.horizon_net_worth_cents ?? 0)} />
        <div>
          <div className="text-xs text-ink-muted">vs doing nothing</div>
          <div className={`tabular text-sm font-semibold ${nwDelta >= 0 ? "text-positive" : "text-negative"}`}>{nwDelta >= 0 ? "+" : "−"}{money(Math.abs(nwDelta))}</div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">Runway (cash)</div>
          <div className={`tabular text-sm font-semibold ${summary.runway_months ? "text-negative" : "text-ink"}`}>{summary.runway_months ? `${summary.runway_months} mo` : "safe"}</div>
        </div>
        <Stat label="Ending savings rate" value={formatPercent(summary.ending_savings_rate ?? 0)} />
        {expanded && <Stat label="Lowest cash point" value={money(summary.min_cash_cents ?? 0)} />}
        {expanded && <Stat label="Total invested" value={money(summary.total_contributions_cents ?? 0)} />}
        {expanded && <Stat label="Break-even" value={summary.break_even_month ? `month ${summary.break_even_month}` : "n/a"} />}
      </div>
    </div>
  );
}

function EventEditor({ e, horizonMonths, onChange, onRemove }: { e: EventDraft; horizonMonths: number; onChange: (p: Partial<EventDraft>) => void; onRemove: () => void }) {
  const meta = eventMeta(e.kind);
  const show = (f: string) => meta.fields.includes(f);
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <Select value={e.kind} onChange={(ev) => onChange({ kind: ev.target.value })} className="!w-auto text-sm font-medium">
          {EVENT_TYPES.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
        </Select>
        <button onClick={onRemove} title="Remove event" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
      </div>
      {meta.help && <p className="mt-1 text-xs text-ink-muted">{meta.help}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {show("month") && <Field label="Month"><Input type="number" min={1} max={horizonMonths} value={e.month} onChange={(ev) => onChange({ month: Number(ev.target.value) || 1 })} /></Field>}
        {show("pct") && <Field label="Change %"><Input type="number" step="1" value={e.pct ?? 0} onChange={(ev) => onChange({ pct: Number(ev.target.value) || 0 })} /></Field>}
        {show("amount") && <Field label="Amount"><Input type="number" step="0.01" value={e.amount ?? ""} onChange={(ev) => onChange({ amount: ev.target.value })} /></Field>}
        {show("end_month") && <Field label="Until month (optional)"><Input type="number" min={e.month} max={horizonMonths} value={e.end_month ?? ""} onChange={(ev) => onChange({ end_month: ev.target.value ? Number(ev.target.value) : null })} /></Field>}
        {show("price") && <Field label={e.kind === "property_sale" ? "Net proceeds" : "Price"}><Input type="number" step="0.01" value={e.price ?? ""} onChange={(ev) => onChange({ price: ev.target.value })} /></Field>}
        {show("deposit") && <Field label="Deposit"><Input type="number" step="0.01" value={e.deposit ?? ""} onChange={(ev) => onChange({ deposit: ev.target.value })} /></Field>}
        {show("annual_rate") && <Field label="Bond rate %"><Input type="number" step="0.1" value={e.annual_rate ?? 11.5} onChange={(ev) => onChange({ annual_rate: Number(ev.target.value) || 0 })} /></Field>}
        {show("term_months") && <Field label="Term (months)"><Input type="number" step="12" value={e.term_months ?? 240} onChange={(ev) => onChange({ term_months: Number(ev.target.value) || 240 })} /></Field>}
        {show("rent") && <Field label="Rent / mo (optional)"><Input type="number" step="0.01" value={e.rent ?? ""} onChange={(ev) => onChange({ rent: ev.target.value })} /></Field>}
        {show("clears") && <Field label="Bond cleared (optional)"><Input type="number" step="0.01" value={e.clears ?? ""} onChange={(ev) => onChange({ clears: ev.target.value })} /></Field>}
      </div>
    </div>
  );
}
