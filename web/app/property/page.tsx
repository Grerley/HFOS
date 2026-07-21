"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, EmptyState, PageSkeleton, StatCard, Badge, ErrorState } from "@/components/ui";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatPercent, fromCents, toCents } from "@/lib/format";
import type { Property } from "@/lib/types";

interface Portfolio {
  property_count: number;
  rented_count: number;
  total_market_value_cents: number;
  total_bond_cents: number;
  total_equity_cents: number;
  total_monthly_surplus_cents: number;
  overall_ltv: number;
  properties: {
    property_id: number; name: string; rental_status: string;
    market_value_cents: number; outstanding_bond_cents: number; equity_cents: number;
    loan_to_value: number; monthly_surplus_cents: number; gross_yield: number; net_yield: number; has_cash_flow: boolean;
  }[];
}

const STATUSES = ["rented", "owner_occupied", "vacant", "acquisition_target"];

export default function PropertyPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [flows, setFlows] = useState<Record<number, any>>({});
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const currency = useCurrency();
  const money = (c: number) => formatMoney(c, currency);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [props, pf] = await Promise.all([
        api.get<Property[]>("/properties"),
        api.get<Portfolio>("/properties-summary"),
      ]);
      setProperties(props);
      setPortfolio(pf);
      const entries = await Promise.all(props.map(async (p) => [p.id, await api.get<any>(`/properties/${p.id}/cash-flow`)] as const));
      setFlows(Object.fromEntries(entries));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createProperty(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.post<Property>("/properties", {
        name: f.get("name"), address_label: f.get("address") || null,
        market_value_cents: toCents(f.get("value") as string),
        outstanding_bond_cents: toCents(f.get("bond") as string),
        rental_status: f.get("status"),
      });
      setShowForm(false);
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function saveProperty(id: number, e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.patch(`/properties/${id}`, {
        name: f.get("name"), address_label: f.get("address") || null,
        market_value_cents: toCents(f.get("value") as string),
        outstanding_bond_cents: toCents(f.get("bond") as string),
        ownership_share_bp: Math.round((parseFloat(f.get("share") as string) || 100) * 100),
        valuation_date: (f.get("valuation") as string) || null,
        rental_status: f.get("status"),
      });
      setEditing(null);
      await load();
    } catch (err: any) { alert(err.message); }
  }

  async function removeProperty(p: Property) {
    if (!confirm(`Remove "${p.name}"? Its cash-flow history is also deleted.`)) return;
    try { await api.del(`/properties/${p.id}`); await load(); }
    catch (err: any) { alert(err.message); }
  }

  async function addCashFlow(pid: number, e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    try {
      await api.post(`/properties/${pid}/cash-flows`, {
        rent_cents: toCents(f.get("rent") as string),
        bond_cents: toCents(f.get("bond") as string),
        levies_cents: toCents(f.get("levies") as string),
        utilities_cents: toCents(f.get("utilities") as string),
        maintenance_cents: toCents(f.get("maintenance") as string),
      });
      await load();
      (e.target as HTMLFormElement).reset();
    } catch (err: any) { alert(err.message); }
  }

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  if (error) return (
    <AppShell>
      <PageHeader title="Property portfolio" description="Per-property cash flow, yield and loan-to-value." />
      <ErrorState hint="We couldn't load your properties. Check your connection and try again." onRetry={load} />
    </AppShell>
  );

  return (
    <AppShell>
      <PageHeader
        title="Property portfolio"
        description="Value, equity, yield and cash flow across your properties."
        actions={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "Add property"}</Button>}
      />

      {/* Combined portfolio view */}
      {portfolio && portfolio.property_count > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Portfolio value" value={money(portfolio.total_market_value_cents)} hint={`${portfolio.property_count} propert${portfolio.property_count === 1 ? "y" : "ies"} · ${portfolio.rented_count} rented`} />
            <StatCard label="Total equity" value={money(portfolio.total_equity_cents)} tone="positive" hint={`Bonds ${money(portfolio.total_bond_cents)}`} />
            <StatCard label="Monthly cash flow" value={money(portfolio.total_monthly_surplus_cents)} tone={portfolio.total_monthly_surplus_cents >= 0 ? "positive" : "negative"} hint="Across all properties" />
            <StatCard label="Overall LTV" value={formatPercent(portfolio.overall_ltv, 1)} hint="Total bond ÷ total value" />
          </div>
        </div>
      )}

      {showForm && (
        <Card className="mb-6" title="New property">
          <form onSubmit={createProperty} className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Address"><Input name="address" /></Field>
            <Field label="Market value"><Input name="value" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Outstanding bond"><Input name="bond" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Status">
              <Select name="status" defaultValue="rented">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </Select>
            </Field>
            <div className="col-span-2 md:col-span-4"><Button type="submit">Create</Button></div>
          </form>
        </Card>
      )}

      {!properties.length ? (
        <EmptyState title="No properties yet" hint="Add a property to track its value, equity, yield and monthly cash flow." />
      ) : (
        <div className="space-y-6">
          {properties.map((p) => {
            const cf = flows[p.id];
            const pf = portfolio?.properties.find((x) => x.property_id === p.id);
            const equity = p.market_value_cents - p.outstanding_bond_cents;
            const isEditing = editing === p.id;
            return (
              <Card key={p.id} title={p.name} subtitle={p.address_label || p.rental_status.replace(/_/g, " ")}
                actions={
                  <div className="flex items-center gap-2">
                    <Badge tone={cf?.is_shortfall ? "critical" : "positive"}>{cf?.has_data ? (cf.is_shortfall ? "Shortfall" : "Surplus") : "No cash flow"}</Badge>
                    <button onClick={() => setEditing(isEditing ? null : p.id)} className="text-xs font-medium text-brand-dark hover:underline">{isEditing ? "Cancel" : "Edit"}</button>
                    <button onClick={() => removeProperty(p)} title="Remove property" className="rounded px-1.5 text-ink-muted hover:text-negative">✕</button>
                  </div>
                }
              >
                {isEditing ? (
                  <form onSubmit={(e) => saveProperty(p.id, e)} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Field label="Name"><Input name="name" defaultValue={p.name} required /></Field>
                    <Field label="Address"><Input name="address" defaultValue={p.address_label ?? ""} /></Field>
                    <Field label="Status">
                      <Select name="status" defaultValue={p.rental_status}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </Select>
                    </Field>
                    <Field label="Market value"><Input name="value" type="number" step="0.01" defaultValue={fromCents(p.market_value_cents)} /></Field>
                    <Field label="Outstanding bond"><Input name="bond" type="number" step="0.01" defaultValue={fromCents(p.outstanding_bond_cents)} /></Field>
                    <Field label="Ownership share %"><Input name="share" type="number" step="0.1" defaultValue={((p.ownership_share_bp ?? 10000) / 100).toString()} /></Field>
                    <Field label="Valuation date"><Input name="valuation" type="date" defaultValue={p.valuation_date ?? ""} /></Field>
                    <div className="col-span-2 flex items-end md:col-span-3"><Button type="submit">Save changes</Button></div>
                  </form>
                ) : (
                  <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Detail label="Market value" value={money(p.market_value_cents)} />
                    <Detail label="Outstanding bond" value={money(p.outstanding_bond_cents)} />
                    <Detail label="Equity" value={money(equity)} tone={equity >= 0 ? "positive" : "negative"} />
                    <Detail label="Loan-to-value" value={formatPercent(pf?.loan_to_value ?? 0, 1)} />
                    {cf?.has_data && <Detail label="Monthly cash flow" value={money(cf.surplus_shortfall_cents)} tone={cf.is_shortfall ? "negative" : "positive"} />}
                    {cf?.has_data && <Detail label="Gross yield" value={formatPercent(cf.gross_yield, 2)} />}
                    {cf?.has_data && <Detail label="Net yield" value={formatPercent(cf.net_yield, 2)} />}
                    {(p.ownership_share_bp ?? 10000) !== 10000 && <Detail label="Ownership" value={`${((p.ownership_share_bp ?? 10000) / 100).toFixed(1)}%`} />}
                  </div>
                )}

                <details className="rounded-lg border border-line-soft">
                  <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink-soft">Monthly cash-flow model {cf?.has_data ? "(update)" : "(add)"}</summary>
                  <form onSubmit={(e) => addCashFlow(p.id, e)} className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-6">
                    <Field label="Rent"><Input name="rent" type="number" step="0.01" defaultValue="0" /></Field>
                    <Field label="Bond (monthly)"><Input name="bond" type="number" step="0.01" defaultValue="0" /></Field>
                    <Field label="Levies"><Input name="levies" type="number" step="0.01" defaultValue="0" /></Field>
                    <Field label="Utilities"><Input name="utilities" type="number" step="0.01" defaultValue="0" /></Field>
                    <Field label="Maintenance"><Input name="maintenance" type="number" step="0.01" defaultValue="0" /></Field>
                    <div className="flex items-end"><Button type="submit" variant="ghost">Update</Button></div>
                  </form>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const c = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="rounded-lg border border-line-soft bg-muted px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-base font-semibold ${c}`}>{value}</div>
    </div>
  );
}
