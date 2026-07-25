"use client";
import { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Badge, EmptyState, PageSkeleton } from "@/components/ui";
import ScenarioWizard from "@/components/ScenarioWizard";
import ScenarioChart from "@/components/ScenarioChart";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatPercent } from "@/lib/format";
import { TEMPLATES } from "@/lib/scenarioTemplates";
import type { Period, Scenario } from "@/lib/types";

const COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#10b981"];

const results = (s: Scenario) => (s.projected_results_json ?? {}) as any;
const isV2 = (s: Scenario) => results(s).schema_version === 2;
const v2Summary = (s: Scenario) => (isV2(s) ? results(s).summary : null);
const v2Months = (s: Scenario): any[] | null => (isV2(s) ? results(s).scenario?.months ?? null : null);
const v2Baseline = (s: Scenario): any[] | null => (isV2(s) ? results(s).baseline?.months ?? null : null);

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const currency = useCurrency();
  const money = (c: number) => formatMoney(c ?? 0, currency);

  async function load() {
    const [sc, ps] = await Promise.all([api.get<Scenario[]>("/scenarios"), api.get<Period[]>("/budget-periods")]);
    setScenarios(sc);
    setPeriods(ps);
    setSelected(sc.filter(isV2).slice(0, 3).map((s) => s.id));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditing(null); setTemplate(null); setWizardOpen(true); }
  function openTemplate(id: string) { setEditing(null); setTemplate(id); setWizardOpen(true); }
  function openEdit(s: Scenario) { setTemplate(null); setEditing(s); setWizardOpen(true); }

  function onSaved(s: Scenario) {
    setScenarios((cur) => {
      const exists = cur.some((x) => x.id === s.id);
      return exists ? cur.map((x) => (x.id === s.id ? s : x)) : [s, ...cur];
    });
    setSelected((cur) => (cur.includes(s.id) ? cur : isV2(s) ? [s.id, ...cur].slice(0, 4) : cur));
  }
  async function remove(s: Scenario) {
    if (!confirm(`Delete scenario "${s.name}"? This can't be undone.`)) return;
    try { await api.del(`/scenarios/${s.id}`); setScenarios((cur) => cur.filter((x) => x.id !== s.id)); setSelected((cur) => cur.filter((id) => id !== s.id)); }
    catch (e: any) { alert(e.message); }
  }
  function toggle(id: number) { setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4))); }

  const compared = useMemo(() => scenarios.filter((s) => selected.includes(s.id) && isV2(s)), [scenarios, selected]);

  const chart = useMemo(() => {
    if (!compared.length) return null;
    const maxMonths = Math.max(...compared.map((s) => v2Months(s)?.length ?? 0));
    if (!maxMonths) return null;
    const series = compared.map((s, i) => ({
      label: s.name,
      color: COLORS[i % COLORS.length],
      values: (v2Months(s) ?? []).map((m: any) => m.net_worth_cents),
    }));
    // Shared "do nothing" baseline from the first selected scenario.
    const base = v2Baseline(compared[0]);
    if (base) series.push({ label: "Do nothing", color: "#94a3b8", values: base.map((m: any) => m.net_worth_cents), dashed: true } as any);
    return { months: maxMonths, series };
  }, [compared]);

  const METRICS: { key: string; label: string; fmt: (v: any) => string; tone?: (v: any) => string }[] = [
    { key: "horizon_net_worth_cents", label: "Net worth at horizon", fmt: money },
    { key: "net_worth_delta_cents", label: "vs doing nothing", fmt: (v) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`, tone: (v) => (v >= 0 ? "text-positive" : "text-negative") },
    { key: "runway_months", label: "Cash runway", fmt: (v) => (v ? `${v} months` : "safe"), tone: (v) => (v ? "text-negative" : "text-ink") },
    { key: "break_even_month", label: "Break-even", fmt: (v) => (v ? `month ${v}` : "—") },
    { key: "min_cash_cents", label: "Lowest cash point", fmt: money, tone: (v) => (v < 0 ? "text-negative" : "text-ink") },
    { key: "ending_savings_rate", label: "Ending savings rate", fmt: (v) => formatPercent(v) },
  ];

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        title="Scenario planning"
        description="Project a decision over years — compounding returns, inflation and life events. Scenarios never change your real budgets."
        actions={<Button onClick={openNew} disabled={!periods.length}>New scenario</Button>}
      />

      <ScenarioWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        periods={periods}
        currency={currency}
        onSaved={onSaved}
        template={template}
        editing={editing}
      />

      {!periods.length ? (
        <EmptyState title="No budget periods yet" hint="Create a monthly budget first — scenarios build on a base month." />
      ) : (
        <div className="space-y-6">
          {/* Template gallery */}
          <Card title="Start from a template" subtitle="A ready-made model you can tweak — or build from scratch">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => openTemplate(t.id)}
                  className="rounded-xl border border-line bg-card p-4 text-left transition hover:border-brand hover:shadow-sm">
                  <div className="text-sm font-semibold text-ink">{t.title}</div>
                  <div className="mt-1 text-xs text-ink-muted">{t.blurb}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* Comparison */}
          {compared.length > 0 && chart && (
            <Card title="Compare scenarios" subtitle="Net worth trajectory and headline outcomes — select up to 4 below">
              <ScenarioChart months={chart.months} series={chart.series as any} format={money} height={280} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-ink-muted">
                      <th className="py-2 pr-4">Metric</th>
                      {compared.map((s) => <th key={s.id} className="py-2 pr-4 text-right">{s.name}</th>)}
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {METRICS.map((m) => (
                      <tr key={m.key} className="border-t border-line-soft">
                        <td className="py-2 pr-4 font-medium text-ink-soft">{m.label}</td>
                        {compared.map((s) => {
                          const val = v2Summary(s)?.[m.key];
                          return <td key={s.id} className={`py-2 pr-4 text-right ${m.tone ? m.tone(val) : "text-ink"}`}>{m.fmt(val)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Library */}
          {!scenarios.length ? (
            <EmptyState title="No scenarios yet" hint="Pick a template above, or “New scenario” to model your own." />
          ) : (
            <div className="space-y-3">
              {scenarios.map((s) => {
                const sm = v2Summary(s);
                const legacy = !isV2(s);
                const isSel = selected.includes(s.id);
                const delta = sm?.net_worth_delta_cents ?? 0;
                return (
                  <div key={s.id} className={`rounded-xl border bg-card p-4 shadow-sm transition ${isSel ? "border-brand" : "border-line"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-ink">{s.name}</h3>
                          {isSel && <Badge tone="info">comparing</Badge>}
                          {legacy && <Badge tone="warning">legacy</Badge>}
                        </div>
                        {s.description && <p className="text-xs text-ink-muted">{s.description}</p>}
                        {sm ? (
                          <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
                            <span>Net worth <span className="tabular font-medium text-ink">{money(sm.horizon_net_worth_cents)}</span></span>
                            <span>vs nothing <span className={`tabular font-medium ${delta >= 0 ? "text-positive" : "text-negative"}`}>{delta >= 0 ? "+" : "−"}{money(Math.abs(delta))}</span></span>
                            <span>Runway <span className={`tabular font-medium ${sm.runway_months ? "text-negative" : "text-ink"}`}>{sm.runway_months ? `${sm.runway_months} mo` : "safe"}</span></span>
                            {sm.break_even_month && <span>Break-even <span className="tabular font-medium text-ink">m{sm.break_even_month}</span></span>}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-ink-muted">Legacy single-month scenario — open Edit to upgrade it to a multi-year projection.</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {!legacy && (
                          <label className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                            <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} /> Compare
                          </label>
                        )}
                        <button onClick={() => openEdit(s)} className="text-xs font-medium text-brand-dark hover:underline">Edit</button>
                        <button onClick={() => remove(s)} title="Delete scenario" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
