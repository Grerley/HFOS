"use client";
import { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, EmptyState, Spinner, StatCard, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, toCents } from "@/lib/format";
import type { Property } from "@/lib/types";

export default function PropertyPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [flows, setFlows] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const currency = "ZAR";

  async function load() {
    const props = await api.get<Property[]>("/properties");
    setProperties(props);
    const entries = await Promise.all(
      props.map(async (p) => [p.id, await api.get<any>(`/properties/${p.id}/cash-flow`)] as const)
    );
    setFlows(Object.fromEntries(entries));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createProperty(e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    await api.post<Property>("/properties", {
      name: f.get("name"),
      market_value_cents: toCents(f.get("value") as string),
      outstanding_bond_cents: toCents(f.get("bond") as string),
      rental_status: f.get("status"),
    });
    setShowForm(false);
    await load();
  }

  async function addCashFlow(pid: number, e: React.FormEvent) {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    await api.post(`/properties/${pid}/cash-flows`, {
      rent_cents: toCents(f.get("rent") as string),
      bond_cents: toCents(f.get("bond") as string),
      levies_cents: toCents(f.get("levies") as string),
      utilities_cents: toCents(f.get("utilities") as string),
      maintenance_cents: toCents(f.get("maintenance") as string),
    });
    await load();
    (e.target as HTMLFormElement).reset();
  }

  if (loading) return <AppShell><Spinner /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        title="Property portfolio"
        description="Per-property cash flow, yield and loan-to-value."
        actions={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "Add property"}</Button>}
      />

      {showForm && (
        <Card className="mb-6" title="New property">
          <form onSubmit={createProperty} className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Market value"><Input name="value" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Outstanding bond"><Input name="bond" type="number" step="0.01" defaultValue="0" /></Field>
            <Field label="Status">
              <Select name="status" defaultValue="rented">
                {["rented", "owner_occupied", "vacant", "acquisition_target"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <div className="col-span-2 md:col-span-4"><Button type="submit">Create</Button></div>
          </form>
        </Card>
      )}

      {!properties.length ? (
        <EmptyState title="No properties yet" hint="Add a property to track its monthly cash flow and yield." />
      ) : (
        <div className="space-y-6">
          {properties.map((p) => {
            const cf = flows[p.id];
            return (
              <Card key={p.id} title={p.name} subtitle={p.rental_status}
                actions={<Badge tone={cf?.is_shortfall ? "critical" : "positive"}>{cf?.has_data ? (cf.is_shortfall ? "Shortfall" : "Surplus") : "No data"}</Badge>}>
                {cf?.has_data ? (
                  <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <StatCard label="Monthly cash flow" value={formatMoney(cf.surplus_shortfall_cents, currency)} tone={cf.is_shortfall ? "negative" : "positive"} />
                    <StatCard label="Gross yield" value={formatPercent(cf.gross_yield, 2)} />
                    <StatCard label="Net yield" value={formatPercent(cf.net_yield, 2)} />
                    <StatCard label="Loan-to-value" value={formatPercent(cf.loan_to_value, 1)} />
                  </div>
                ) : (
                  <p className="mb-4 text-sm text-ink-muted">Add a monthly cash-flow model below.</p>
                )}
                <form onSubmit={(e) => addCashFlow(p.id, e)} className="grid grid-cols-2 gap-3 md:grid-cols-6">
                  <Field label="Rent"><Input name="rent" type="number" step="0.01" defaultValue="0" /></Field>
                  <Field label="Bond"><Input name="bond" type="number" step="0.01" defaultValue="0" /></Field>
                  <Field label="Levies"><Input name="levies" type="number" step="0.01" defaultValue="0" /></Field>
                  <Field label="Utilities"><Input name="utilities" type="number" step="0.01" defaultValue="0" /></Field>
                  <Field label="Maintenance"><Input name="maintenance" type="number" step="0.01" defaultValue="0" /></Field>
                  <div className="flex items-end"><Button type="submit" variant="ghost">Update</Button></div>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
