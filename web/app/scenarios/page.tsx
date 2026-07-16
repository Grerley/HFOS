"use client";
import { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Badge, EmptyState, PageSkeleton } from "@/components/ui";
import ScenarioWizard from "@/components/ScenarioWizard";
import { api } from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import type { Period, Scenario } from "@/lib/types";

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const currency = "ZAR";

  async function load() {
    const [sc, ps] = await Promise.all([api.get<Scenario[]>("/scenarios"), api.get<Period[]>("/budget-periods")]);
    setScenarios(sc);
    setPeriods(ps);
    setSelected(sc.slice(0, 3).map((s) => s.id));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function onCreated(s: Scenario) {
    setScenarios((cur) => [s, ...cur]);
    setSelected((cur) => [s.id, ...cur].slice(0, 3));
  }

  function toggle(id: number) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-3)));
  }

  // Shared baseline (scenarios compared here should share a base period).
  const money = (c: number) => formatMoney(c ?? 0, currency);
  const compared = useMemo(() => scenarios.filter((s) => selected.includes(s.id)), [scenarios, selected]);
  const baseline = compared[0]?.projected_results_json?.baseline ?? null;

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

  const METRICS: { key: string; label: string; pct?: boolean }[] = [
    { key: "total_income_cents", label: "Income" },
    { key: "total_expenses_cents", label: "Expenses" },
    { key: "net_position_cents", label: "Net position" },
    { key: "savings_rate", label: "Savings rate", pct: true },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Scenario simulator"
        description="Model a decision before committing. Scenarios never change your real budgets."
        actions={<Button onClick={() => setWizardOpen(true)} disabled={!periods.length}>New scenario</Button>}
      />

      <ScenarioWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        periods={periods}
        currency={currency}
        onCreated={onCreated}
      />

      {!periods.length ? (
        <EmptyState title="No budget periods yet" hint="Create a monthly budget first — scenarios build on a base month." />
      ) : !scenarios.length ? (
        <EmptyState title="No scenarios yet" hint="Try “What if income drops 20%?” or “Can we afford a new bond?”" />
      ) : (
        <div className="space-y-6">
          {/* Comparison: baseline vs the selected scenarios side by side (A/B/C). */}
          {compared.length > 0 && baseline && (
            <Card
              title="Compare scenarios"
              subtitle="Baseline vs selected scenarios, side by side"
              actions={<span className="text-xs text-ink-muted">Select up to 3 below</span>}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-ink-muted">
                      <th className="py-2 pr-4">Metric</th>
                      <th className="py-2 pr-4 text-right">Baseline</th>
                      {compared.map((s) => (
                        <th key={s.id} className="py-2 pr-4 text-right">{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {METRICS.map((m) => {
                      const baseVal = baseline[m.key] ?? 0;
                      return (
                        <tr key={m.key} className="border-t border-line-soft">
                          <td className="py-2 pr-4 font-medium text-ink-soft">{m.label}</td>
                          <td className="py-2 pr-4 text-right text-ink">{m.pct ? formatPercent(baseVal) : money(baseVal)}</td>
                          {compared.map((s) => {
                            const proj = s.projected_results_json?.projected ?? {};
                            const val = proj[m.key] ?? 0;
                            const delta = val - baseVal;
                            const isNet = m.key === "net_position_cents";
                            return (
                              <td key={s.id} className="py-2 pr-4 text-right">
                                <div className={isNet ? (val >= 0 ? "text-positive" : "text-negative") : "text-ink"}>
                                  {m.pct ? formatPercent(val) : money(val)}
                                </div>
                                {delta !== 0 && (
                                  <div className={`text-xs ${delta >= 0 ? "text-positive" : "text-negative"}`}>
                                    {m.pct
                                      ? `${delta >= 0 ? "+" : ""}${formatPercent(delta)}`
                                      : `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Scenario library with select toggles */}
          <div className="space-y-3">
            {scenarios.map((s) => {
              const r = s.projected_results_json || {};
              const proj = r.projected || {};
              const base = r.baseline || {};
              const net = proj.net_position_cents ?? 0;
              const netDelta = net - (base.net_position_cents ?? 0);
              const isSel = selected.includes(s.id);
              return (
                <div key={s.id} className={`rounded-xl border bg-card p-4 shadow-sm transition ${isSel ? "border-brand" : "border-line"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink">{s.name}</h3>
                        {isSel && <Badge tone="info">comparing</Badge>}
                      </div>
                      {s.description && <p className="text-xs text-ink-muted">{s.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
                        <span>Net <span className={`tabular font-medium ${net >= 0 ? "text-positive" : "text-negative"}`}>{money(net)}</span></span>
                        <span>vs baseline <span className={`tabular font-medium ${netDelta >= 0 ? "text-positive" : "text-negative"}`}>{netDelta >= 0 ? "+" : "−"}{money(Math.abs(netDelta))}</span></span>
                        <span>Savings rate <span className="tabular font-medium text-ink">{formatPercent(proj.savings_rate ?? 0)}</span></span>
                      </div>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-ink-soft">
                      <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} />
                      Compare
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}
