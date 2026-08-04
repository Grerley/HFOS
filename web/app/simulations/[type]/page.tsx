"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Badge, Field, Input, Select, StatCard, DrillRow, Drawer, Modal, PageSkeleton, EmptyState } from "@/components/ui";
import ScenarioChart from "@/components/ScenarioChart";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatPercent } from "@/lib/format";
import { FIELDS, SIM_META, defaultInputs, toAssumptions, fromAssumptions, type SimType } from "@/lib/simConfig";

type AnyObj = Record<string, any>;
const isType = (t: string): t is SimType => t === "investment" || t === "tax" || t === "asset";

export default function PlannerPage() {
  const params = useParams();
  const type = String(params.type) as SimType;
  const currency = useCurrency();
  const money = (c: number | null | undefined) => formatMoney(c ?? 0, currency);

  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState<AnyObj[]>([]);
  const [periods, setPeriods] = useState<AnyObj[]>([]);
  const [categories, setCategories] = useState<AnyObj[]>([]);
  const [sims, setSims] = useState<AnyObj[]>([]);
  const [activeSim, setActiveSim] = useState<AnyObj | null>(null);
  const [scenarios, setScenarios] = useState<AnyObj[]>([]);

  const [inputs, setInputs] = useState<Record<string, string>>(() => (isType(type) ? defaultInputs(type) : {}));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<AnyObj | null>(null);
  const [impact, setImpact] = useState<AnyObj | null>(null);
  const [calcAt, setCalcAt] = useState<string | null>(null);
  const [calcing, setCalcing] = useState(false);

  const [explainOpen, setExplainOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [implementFor, setImplementFor] = useState<AnyObj | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  // Risk-appetite → expected-return map, sourced from the engine's central risk
  // assumptions (falls back to sensible ZAR defaults until reference loads).
  const [riskReturns, setRiskReturns] = useState<Record<string, number>>({ low: 0.07, medium: 0.10, high: 0.13 });

  const meta = isType(type) ? SIM_META[type] : null;

  const loadScenarios = useCallback(async (simId: number) => {
    const full = await api.get<AnyObj>(`/simulations/${simId}`);
    setScenarios(full.scenarios ?? []);
    setCompareIds((full.scenarios ?? []).slice(0, 4).map((s: AnyObj) => s.id));
  }, []);

  useEffect(() => {
    if (!isType(type)) return;
    (async () => {
      const [mem, per, cat, list, ref] = await Promise.all([
        api.get<AnyObj[]>("/members").catch(() => []),
        api.get<AnyObj[]>("/budget-periods").catch(() => []),
        api.get<AnyObj[]>("/categories").catch(() => []),
        api.get<AnyObj[]>(`/simulations?type=${type}`).catch(() => []),
        api.get<AnyObj>("/simulations/reference").catch(() => null),
      ]);
      setMembers(mem); setPeriods(per); setCategories(cat); setSims(list);
      if (ref?.risk_profiles) {
        const rr: Record<string, number> = {};
        for (const [k, v] of Object.entries<any>(ref.risk_profiles)) rr[k] = v.expected_return;
        setRiskReturns(rr);
        // Sync the return field to the current risk profile on first load.
        if (type === "investment") {
          setInputs((cur) => {
            const r = rr[cur.risk_profile];
            return r != null ? { ...cur, annual_return: String(Math.round(r * 1000) / 10) } : cur;
          });
        }
      }
      if (list.length) { setActiveSim(list[0]); await loadScenarios(list[0].id); }
      setReady(true);
    })();
  }, [type, loadScenarios]);

  // Live server-side recalculation (debounced). The client never does the maths.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isType(type) || !ready) return;
    if (debounce.current) clearTimeout(debounce.current);
    setCalcing(true);
    debounce.current = setTimeout(async () => {
      try {
        const assumptions = toAssumptions(type, inputs);
        const r = await api.post<AnyObj>(`/simulations/calc/${type}`, { assumptions });
        setResult(r);
        setCalcAt(new Date().toLocaleTimeString());
        setImpact(await computeImpact(type, r, assumptions));
      } catch { /* keep last good result */ }
      finally { setCalcing(false); }
    }, 320);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, ready, type]);

  async function computeImpact(t: SimType, r: AnyObj, a: AnyObj): Promise<AnyObj | null> {
    try {
      if (t === "investment") return api.post("/simulations/household-impact", { monthly_contribution_delta_cents: Number(a.monthly_contribution_cents ?? 0) });
      if (t === "asset") return api.post("/simulations/household-impact", { monthly_expense_delta_cents: r.detail?.total_monthly_obligation_cents ?? 0, one_off_cash_cents: Number(a.deposit_cents ?? 0) });
      if (t === "tax") return api.post("/simulations/household-impact", { monthly_contribution_delta_cents: Math.round(Number(a.additional_ra_cents ?? 0) / 12) });
    } catch { /* ignore */ }
    return null;
  }

  const set = (k: string, v: string) => setInputs((cur) => {
    const next = { ...cur, [k]: v };
    // Risk appetite drives the expected return (low ≈ 7%, medium ≈ 10%, high ≈
    // 13%) for realistic projections. The user can still override the return
    // afterwards under advanced assumptions; changing risk again re-syncs it.
    if (k === "risk_profile" && type === "investment") {
      const r = riskReturns[v];
      if (r != null) next.annual_return = String(Math.round(r * 1000) / 10);
    }
    return next;
  });

  function loadScenarioInputs(s: AnyObj) {
    if (!isType(type)) return;
    setInputs(fromAssumptions(type, (s.assumptions_json ?? {}) as AnyObj));
  }

  async function onSimSelect(id: string) {
    if (id === "__new__") { setActiveSim(null); setScenarios([]); setCompareIds([]); return; }
    const s = sims.find((x) => String(x.id) === id) ?? null;
    setActiveSim(s);
    if (s) await loadScenarios(s.id);
  }

  async function reloadSims() {
    const list = await api.get<AnyObj[]>(`/simulations?type=${type}`).catch(() => []);
    setSims(list);
  }

  if (!isType(type)) return <AppShell><EmptyState title="Unknown planner" hint="Pick a planner from the Simulations page." /></AppShell>;
  if (!ready || !meta) return <AppShell><PageSkeleton /></AppShell>;

  const fields = FIELDS[type];
  const visible = fields.filter((f) => f.group !== "advanced" || showAdvanced);

  return (
    <AppShell>
      <PageHeader
        title={meta.title}
        description={meta.question + " Scenarios never change your real budget until you implement them."}
        actions={<Link href="/simulations" className="text-sm font-medium text-brand-dark hover:underline">← All simulations</Link>}
      />

      {/* Active simulation selector */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Working simulation">
              <Select value={activeSim ? String(activeSim.id) : "__new__"} onChange={(e) => onSimSelect(e.target.value)}>
                <option value="__new__">➕ New simulation (unsaved)</option>
                {sims.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.scenario_count ?? 0} scenario(s)</option>)}
              </Select>
            </Field>
          </div>
          <Button onClick={() => setSaveOpen(true)} disabled={!result}>Save as scenario</Button>
          <Button variant="ghost" onClick={() => setExplainOpen(true)} disabled={!result}>Explain calculation</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Inputs */}
        <div className="lg:col-span-2">
          <Card title="Assumptions" subtitle="Editable inputs. Results update live.">
            <div className="space-y-3">
              {visible.map((f) => (
                <Field key={f.key} label={f.label}>
                  {f.kind === "select" ? (
                    <Select value={inputs[f.key] ?? f.def} onChange={(e) => set(f.key, e.target.value)}>
                      {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  ) : (
                    <Input
                      inputMode={f.kind === "money" || f.kind === "percent" ? "decimal" : "numeric"}
                      value={inputs[f.key] ?? f.def}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                  {f.help && <span className="mt-1 block text-[11px] text-ink-muted">{f.help}</span>}
                </Field>
              ))}
              <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs font-medium text-brand-dark hover:underline">
                {showAdvanced ? "Hide advanced assumptions" : "Show advanced assumptions"}
              </button>
            </div>
          </Card>
        </div>

        {/* Results */}
        <div className="space-y-6 lg:col-span-3">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{calcing ? "Calculating…" : calcAt ? `Last calculated ${calcAt}` : ""}</span>
            <span className="italic">Indicative — not a guarantee or advice.</span>
          </div>
          {result ? (
            <>
              {type === "investment" && <InvestmentResult r={result} money={money} />}
              {type === "tax" && <TaxResult r={result} money={money} />}
              {type === "asset" && <AssetResult r={result} money={money} />}
              {(result.warnings ?? []).length > 0 && (
                <Card title="Alerts">
                  <ul className="space-y-1 text-sm text-amber-700">
                    {result.warnings.map((w: string, i: number) => <li key={i}>⚠ {w}</li>)}
                  </ul>
                </Card>
              )}
              {impact && impact.has_period && <HouseholdImpact i={impact} money={money} />}
            </>
          ) : <PageSkeleton />}
        </div>
      </div>

      {/* Saved scenarios + comparison */}
      {activeSim && (
        <div className="mt-6">
          <Card title="Saved scenarios" subtitle={`Compare up to 4 side by side · ${activeSim.name}`}>
            {scenarios.length === 0 ? (
              <EmptyState title="No scenarios saved yet" hint="Adjust the assumptions and “Save as scenario”." />
            ) : (
              <>
                <div className="mb-4 space-y-2">
                  {scenarios.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={compareIds.includes(s.id)} onChange={() =>
                          setCompareIds((cur) => cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id].slice(-4))} />
                        <span className="font-medium text-ink">{s.scenario_name}</span>
                        <Badge tone="neutral">{s.scenario_type}</Badge>
                        {s.recommendation_status === "recommended" && <Badge tone="positive">recommended</Badge>}
                      </label>
                      <div className="flex items-center gap-3 text-xs">
                        <button onClick={() => loadScenarioInputs(s)} className="font-medium text-brand-dark hover:underline">Load</button>
                        <button onClick={() => setImplementFor(s)} className="font-medium text-brand-dark hover:underline">Implement</button>
                        <button onClick={async () => { await api.del(`/simulations/${activeSim.id}/scenarios/${s.id}`); await loadScenarios(activeSim.id); }} className="text-ink-muted hover:text-negative">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <ComparisonTable type={type} scenarios={scenarios.filter((s) => compareIds.includes(s.id))} money={money} />
              </>
            )}
          </Card>
        </div>
      )}

      {/* Explain drawer */}
      <Drawer open={explainOpen} onClose={() => setExplainOpen(false)} title="How this is calculated" subtitle="Formula, inputs and assumptions">
        {result && (
          <div className="space-y-4">
            {(result.explain ?? []).map((e: AnyObj, i: number) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">{e.label}</h4>
                  {e.indicative && <Badge tone="warning">indicative</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-ink-soft">{e.formula}</p>
                <dl className="mt-2 space-y-0.5">
                  {Object.entries(e.assumptions ?? {}).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs text-ink-muted"><dt>{k}</dt><dd className="tabular">{String(v)}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
            <p className="text-xs text-ink-muted">Model {result.model_version}. Results are estimates and may change; seek professional advice for complex matters. HFOS does not submit returns or move money.</p>
          </div>
        )}
      </Drawer>

      <SaveScenarioModal
        open={saveOpen} onClose={() => setSaveOpen(false)} type={type} activeSim={activeSim}
        onSaved={async (simId) => {
          setSaveOpen(false);
          await reloadSims();
          const s = (await api.get<AnyObj[]>(`/simulations?type=${type}`)).find((x) => x.id === simId) ?? null;
          if (s) { setActiveSim(s); await loadScenarios(simId); }
        }}
        assumptions={toAssumptions(type, inputs)}
      />

      <ImplementModal
        scenario={implementFor} onClose={() => setImplementFor(null)} type={type} simId={activeSim?.id}
        members={members} periods={periods} categories={categories}
        onDone={() => setImplementFor(null)}
      />
    </AppShell>
  );
}

// ── Result panels ──────────────────────────────────────────────────────────────
function InvestmentResult({ r, money }: { r: AnyObj; money: (c: number) => string }) {
  const d = r.detail;
  const series = useMemo(() => {
    const s = (d.series ?? []) as AnyObj[];
    return [
      { label: "Portfolio value", color: "#6366f1", values: s.map((m) => m.balance_cents) },
      { label: "Contributions", color: "#94a3b8", values: s.map((m) => m.contributions_to_date_cents), dashed: true },
    ];
  }, [d.series]);
  const goal = d.goal;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projected value" value={money(d.final_nominal_cents)} hint={`in ${Math.round(d.months / 12 * 10) / 10} years`} />
        <StatCard label="Real value (today)" value={money(d.final_real_cents)} hint="after inflation" />
        <StatCard label="Contributions" value={money(d.contributions_cents)} />
        <StatCard label="Investment growth" value={money(d.net_return_cents)} tone="positive" hint={`fees ${money(d.fees_cents)}`} />
      </div>
      <Card title="Portfolio growth" subtitle={`Value vs contributions · assumed return ${formatPercent(d.annual_return)}${d.risk_profile ? ` (${d.risk_profile} risk)` : ""}, fees ${formatPercent(d.annual_fees)}`}>
        {series[0].values.length > 0 && <ScenarioChart months={series[0].values.length} series={series as any} format={money} height={260} />}
      </Card>
      {goal && (
        <Card title="Reaching your target" subtitle={goal.reached ? "On track ✓" : "Funding gap"}>
          <DrillRow label="Target amount" value={money(d.target_amount_cents)} />
          <DrillRow label="Projected shortfall" value={money(goal.gap_cents)} tone={goal.gap_cents > 0 ? "negative" : "positive"} />
          <DrillRow label="Monthly contribution needed" value={goal.required_monthly_contribution.value != null ? money(goal.required_monthly_contribution.value) : "—"} strong />
          <DrillRow label="Time to target at this rate" value={goal.months_to_target.value != null ? `${goal.months_to_target.value} months` : "not reachable"} />
          <DrillRow label="Return required" value={goal.required_annual_return.feasible ? formatPercent(goal.required_annual_return.value) : "implausible"} />
          <DrillRow label="Extra lump sum needed" value={goal.required_lump_sum.value != null ? money(goal.required_lump_sum.value) : "—"} />
        </Card>
      )}
      {d.affordability && (
        <Card title="Affordability">
          <DrillRow label="Contribution vs net income" value={formatPercent(d.affordability.ratio)} />
          <DrillRow label="Status" value={d.affordability.status} tone={d.affordability.status === "unsustainable" ? "negative" : d.affordability.status === "comfortable" ? "positive" : undefined} strong />
          <DrillRow label="Remaining monthly cash" value={money(d.affordability.remaining_cents)} />
        </Card>
      )}
    </>
  );
}

function TaxResult({ r, money }: { r: AnyObj; money: (c: number) => string }) {
  const d = r.detail;
  const s = d.straight, o = d.optimised;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Straight tax" value={money(s.annual_tax_cents)} hint="current structure" />
        <StatCard label="Optimised tax" value={money(o.annual_tax_cents)} tone="positive" />
        <StatCard label="Potential saving" value={money(d.tax_saving_cents)} tone="positive" hint={`costs ${money(d.additional_cash_cents)} cash`} />
        <StatCard label="Effective rate" value={formatPercent(s.effective_rate)} hint={`marginal ${formatPercent(s.marginal_rate)}`} />
      </div>
      <Card title="Tax saving vs cash cost" subtitle="A saving is never shown without its cash contribution (§4.9)">
        <DrillRow label="Additional cash contribution" value={money(d.additional_cash_cents)} />
        <DrillRow label="Immediate tax saving" value={money(d.tax_saving_cents)} tone="positive" />
        <DrillRow label="Net cash cost after tax benefit" value={money(d.net_cash_cost_cents)} strong />
        <DrillRow label="Effective return from the deduction" value={formatPercent(d.effective_deduction_return)} tone="positive" />
        <DrillRow label="Impact on monthly take-home" value={money(d.monthly_takehome_impact_cents)} tone={d.monthly_takehome_impact_cents < 0 ? "negative" : "positive"} />
      </Card>
      <Card title="Year-end position">
        <DrillRow label="Taxable income" value={money(s.taxable_income_cents)} />
        <DrillRow label="Tax before rebates" value={money(s.tax_before_rebates_cents)} />
        <DrillRow label="Rebates" value={money(s.rebates_cents)} tone="positive" />
        <DrillRow label="Medical tax credits" value={money(s.medical_credits_cents)} tone="positive" />
        <DrillRow label="Annual tax liability" value={money(s.annual_tax_cents)} strong />
        <DrillRow label={s.refund_or_due_cents >= 0 ? "Expected refund" : "Amount owing"} value={money(Math.abs(s.refund_or_due_cents))} tone={s.refund_or_due_cents >= 0 ? "positive" : "negative"} />
        <DrillRow label="Monthly net income (after tax)" value={money(s.monthly_net_income_cents)} />
        <p className="mt-2 text-[11px] text-ink-muted">Tax table {d.tax_table?.version}. Estimates only — tax rules may change; HFOS does not submit returns.</p>
      </Card>
    </>
  );
}

function AssetResult({ r, money }: { r: AnyObj; money: (c: number) => string }) {
  const d = r.detail;
  const base = d.base, early = d.optimised;
  const chart = useMemo(() => {
    const b = (base.schedule ?? []) as AnyObj[];
    const o = (early.optimised.schedule ?? []) as AnyObj[];
    const months = Math.max(b.length, o.length);
    return { months, series: [
      { label: "Balance (base)", color: "#6366f1", values: b.map((x) => x.balance_cents) },
      { label: "Balance (optimised)", color: "#10b981", values: o.map((x) => x.balance_cents) },
    ] };
  }, [base.schedule, early.optimised.schedule]);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Monthly instalment" value={money(base.monthly_instalment_cents)} hint={`financed ${money(d.financed_amount_cents)}`} />
        <StatCard label="Total interest" value={money(base.total_interest_cents)} tone="negative" />
        <StatCard label="Interest saved (optimised)" value={money(early.interest_saved_cents)} tone="positive" hint={`${early.months_saved} months sooner`} />
        <StatCard label="Debt-service ratio" value={d.debt_service_ratio != null ? formatPercent(d.debt_service_ratio) : "—"} tone={d.debt_service_ratio != null && d.debt_service_ratio > 0.35 ? "negative" : "neutral"} hint={`LTV ${formatPercent(d.loan_to_value)}`} />
      </div>
      <Card title="Amortisation" subtitle="Outstanding balance: base vs optimised">
        {chart.months > 0 && <ScenarioChart months={chart.months} series={chart.series as any} format={money} height={260} />}
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Optimised repayment">
          <DrillRow label="Revised term" value={`${early.optimised.months_to_payoff} months`} />
          <DrillRow label="Interest saved" value={money(early.interest_saved_cents)} tone="positive" />
          <DrillRow label="% interest saved" value={formatPercent(early.interest_saved_pct)} />
          <DrillRow label="Time saved" value={`${early.months_saved} months`} strong />
          <DrillRow label="Total interest (optimised)" value={money(early.optimised.total_interest_cents)} />
        </Card>
        <Card title="Affordability & risk">
          <DrillRow label="Max affordable price" value={d.affordability ? money(d.affordability.max_price_cents) : "set a max instalment"} />
          <DrillRow label="NPV of financing cost" value={money(d.npv_financing_cost_cents)} />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ink-muted"><th className="py-1">Rate stress</th><th className="text-right">Instalment</th><th className="text-right">+Cost</th><th className="text-right">DSR</th></tr></thead>
              <tbody className="tabular">
                {(d.rate_sensitivity ?? []).map((row: AnyObj) => (
                  <tr key={row.delta_bp} className="border-t border-line-soft">
                    <td className="py-1">+{row.delta_bp / 100}pp</td>
                    <td className="text-right">{money(row.instalment_cents)}</td>
                    <td className="text-right">{money(row.additional_cost_cents)}</td>
                    <td className={`text-right ${row.debt_service_ratio != null && !row.affordable ? "text-negative" : ""}`}>{row.debt_service_ratio != null ? formatPercent(row.debt_service_ratio) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function HouseholdImpact({ i, money }: { i: AnyObj; money: (c: number) => string }) {
  return (
    <Card title="Household impact" subtitle={`Effect on your plan${i.period_label ? ` · ${i.period_label}` : ""}`}>
      <DrillRow label="New monthly obligation" value={money(i.new_monthly_obligation_cents)} />
      <DrillRow label="Monthly surplus" value={`${money(i.surplus_before_cents)} → ${money(i.surplus_after_cents)}`} tone={i.surplus_after_cents < 0 ? "negative" : undefined} />
      <DrillRow label="Savings rate" value={`${formatPercent(i.savings_rate_before)} → ${formatPercent(i.savings_rate_after)}`} />
      <DrillRow label="Safe to spend" value={money(i.safe_to_spend_cents)} strong />
      <DrillRow label="Liquidity" value={`${money(i.liquidity_before_cents)} → ${money(i.liquidity_after_cents)}`} />
      {i.warning && <p className="mt-2 text-xs text-negative">⚠ {i.warning}</p>}
    </Card>
  );
}

// ── Comparison table ────────────────────────────────────────────────────────────
const COMPARE_ROWS: Record<SimType, { key: string; label: string; kind: "money" | "pct" | "num" | "text" }[]> = {
  investment: [
    { key: "final_nominal_cents", label: "Projected value", kind: "money" },
    { key: "final_real_cents", label: "Real value", kind: "money" },
    { key: "contributions_cents", label: "Contributions", kind: "money" },
    { key: "net_return_cents", label: "Investment growth", kind: "money" },
    { key: "monthly_contribution_cents", label: "Monthly contribution", kind: "money" },
    { key: "affordability_status", label: "Affordability", kind: "text" },
  ],
  tax: [
    { key: "straight_tax_cents", label: "Straight tax", kind: "money" },
    { key: "optimised_tax_cents", label: "Optimised tax", kind: "money" },
    { key: "tax_saving_cents", label: "Tax saving", kind: "money" },
    { key: "additional_cash_cents", label: "Additional cash", kind: "money" },
    { key: "net_cash_cost_cents", label: "Net cash cost", kind: "money" },
    { key: "effective_rate", label: "Effective rate", kind: "pct" },
  ],
  asset: [
    { key: "monthly_instalment_cents", label: "Monthly instalment", kind: "money" },
    { key: "total_interest_cents", label: "Total interest", kind: "money" },
    { key: "interest_saved_cents", label: "Interest saved", kind: "money" },
    { key: "months_saved", label: "Months saved", kind: "num" },
    { key: "debt_service_ratio", label: "Debt-service ratio", kind: "pct" },
    { key: "loan_to_value", label: "Loan-to-value", kind: "pct" },
  ],
};

function ComparisonTable({ type, scenarios, money }: { type: SimType; scenarios: AnyObj[]; money: (c: number) => string }) {
  if (!scenarios.length) return <p className="text-sm text-ink-muted">Select scenarios above to compare.</p>;
  const rows = COMPARE_ROWS[type];
  const fmt = (kind: string, v: any) => v == null ? "—" : kind === "money" ? money(v) : kind === "pct" ? formatPercent(v) : String(v);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-ink-muted">
            <th className="py-2 pr-4">Metric</th>
            {scenarios.map((s) => <th key={s.id} className="py-2 pr-4 text-right">{s.scenario_name}</th>)}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line-soft">
              <td className="py-2 pr-4 font-medium text-ink-soft">{row.label}</td>
              {scenarios.map((s) => <td key={s.id} className="py-2 pr-4 text-right text-ink">{fmt(row.kind, (s.result_summary_json ?? {})[row.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Save scenario modal ─────────────────────────────────────────────────────────
function SaveScenarioModal({ open, onClose, type, activeSim, assumptions, onSaved }: {
  open: boolean; onClose: () => void; type: SimType; activeSim: AnyObj | null; assumptions: AnyObj; onSaved: (simId: number) => void;
}) {
  const [simName, setSimName] = useState("");
  const [scenName, setScenName] = useState("Base case");
  const [scenType, setScenType] = useState("base");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setErr(null); setScenName(activeSim ? "Scenario " : "Base case"); } }, [open, activeSim]);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      let simId = activeSim?.id;
      if (!simId) {
        const created = await api.post<AnyObj>("/simulations", { simulation_type: type, name: simName || `${SIM_META[type].title}` });
        simId = created.id;
      }
      await api.post(`/simulations/${simId}/scenarios`, { scenario_name: scenName || "Scenario", scenario_type: scenType, assumptions });
      onSaved(simId!);
    } catch (e: any) { setErr(e.message || "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save as scenario" subtitle="Stored with a version; your budget is untouched (BR-008)"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save scenario"}</Button></>}>
      <div className="space-y-3">
        {!activeSim && <Field label="New simulation name"><Input value={simName} onChange={(e) => setSimName(e.target.value)} placeholder={SIM_META[type].title} /></Field>}
        <Field label="Scenario name"><Input value={scenName} onChange={(e) => setScenName(e.target.value)} /></Field>
        <Field label="Scenario type">
          <Select value={scenType} onChange={(e) => setScenType(e.target.value)}>
            <option value="base">Base case</option>
            <option value="conservative">Conservative</option>
            <option value="optimistic">Optimistic</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
        {err && <p className="text-sm text-negative">{err}</p>}
      </div>
    </Modal>
  );
}

// ── Implement (convert to plan) modal ───────────────────────────────────────────
function ImplementModal({ scenario, onClose, type, simId, members, periods, categories, onDone }: {
  scenario: AnyObj | null; onClose: () => void; type: SimType; simId?: number;
  members: AnyObj[]; periods: AnyObj[]; categories: AnyObj[]; onDone: () => void;
}) {
  const target = type === "investment" ? "goal" : "budget_line";
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [monthly, setMonthly] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const summary = (scenario?.result_summary_json ?? {}) as AnyObj;
  useEffect(() => {
    if (!scenario) return;
    setErr(null); setDone(false);
    setName(scenario.scenario_name || "");
    if (type === "investment") { setAmount(((summary.final_nominal_cents ?? 0) / 100).toString()); setMonthly(((summary.monthly_contribution_cents ?? 0) / 100).toString()); }
    if (type === "asset") setMonthly(((summary.monthly_instalment_cents ?? 0) / 100).toString());
    if (type === "tax") setMonthly((Math.round((summary.additional_cash_cents ?? 0) / 12) / 100).toString());
    const editable = periods.find((p) => !["closed", "archived"].includes(p.status));
    if (editable) setPeriodId(String(editable.id));
    if (categories.length) setCategoryId(String(categories[0].id));
  }, [scenario, type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scenario) return null;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const toCents = (s: string) => Math.round((parseFloat(s) || 0) * 100);
      if (target === "goal") {
        await api.post(`/simulations/${simId}/scenarios/${scenario!.id}/implement`, {
          target: "goal", name, target_amount_cents: toCents(amount), monthly_contribution_cents: toCents(monthly),
        });
      } else {
        await api.post(`/simulations/${simId}/scenarios/${scenario!.id}/implement`, {
          target: "budget_line", period_id: Number(periodId), category_id: Number(categoryId),
          item_name: name, planned_amount_cents: toCents(monthly),
        });
      }
      setDone(true);
      setTimeout(onDone, 900);
    } catch (e: any) { setErr(e.message || "Could not implement"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!scenario} onClose={onClose} title="Implement into your plan"
      subtitle={target === "goal" ? "Creates a household goal" : "Adds a recurring budget line"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || done}>{done ? "Added ✓" : busy ? "Adding…" : "Add to plan"}</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-ink-muted">Nothing moves money. This only adds a plan item you can edit later.</p>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {target === "goal" && <Field label="Target amount"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>}
        {target === "goal" ? (
          <Field label="Monthly contribution"><Input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" /></Field>
        ) : (
          <>
            <Field label="Monthly amount"><Input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Budget period">
              <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </>
        )}
        {err && <p className="text-sm text-negative">{err}</p>}
      </div>
    </Modal>
  );
}
