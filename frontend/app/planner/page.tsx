"use client";
import { useCallback, useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, Badge, EmptyState, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, fromCents, toCents } from "@/lib/format";
import type { Category, Line, Member, Period, PeriodSummary } from "@/lib/types";

interface EditRow extends Line {
  _dirty?: boolean;
  _new?: boolean;
}

export default function PlannerPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [deletes, setDeletes] = useState<number[]>([]);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const period = periods.find((p) => p.id === periodId) || null;
  const currency = "ZAR";
  const locked = period?.status === "closed" || period?.status === "archived";

  const loadPeriod = useCallback(async (pid: number) => {
    const [lines, sum] = await Promise.all([
      api.get<Line[]>(`/budget-periods/${pid}/lines`),
      api.get<{ summary: PeriodSummary }>(`/reports/monthly?period_id=${pid}`),
    ]);
    setRows(lines.map((l) => ({ ...l })));
    setDeletes([]);
    setSummary(sum.summary);
  }, []);

  useEffect(() => {
    (async () => {
      const [ps, cats, mem] = await Promise.all([
        api.get<Period[]>("/budget-periods"),
        api.get<Category[]>("/categories"),
        api.get<Member[]>("/members"),
      ]);
      setPeriods(ps);
      setCategories(cats);
      setMembers(mem);
      if (ps.length) {
        setPeriodId(ps[0].id);
        await loadPeriod(ps[0].id);
      }
      setLoading(false);
    })();
  }, [loadPeriod]);

  async function selectPeriod(id: number) {
    setPeriodId(id);
    setLoading(true);
    await loadPeriod(id);
    setLoading(false);
  }

  function editRow(idx: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
  }

  function addRow() {
    const firstCat = categories.find((c) => !c.is_section) || categories[0];
    setRows((rs) => [
      ...rs,
      {
        id: -Date.now(), period_id: periodId!, category_id: firstCat?.id ?? 0, item_name: "",
        planned_amount_cents: 0, actual_amount_cents: 0, recurrence: "monthly",
        payment_status: "planned", is_recurring: true, priority: 3, needs_review: false, _new: true,
      } as EditRow,
    ]);
  }

  function removeRow(idx: number) {
    const row = rows[idx];
    if (!row._new) setDeletes((d) => [...d, row.id]);
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!periodId) return;
    setSaving(true);
    try {
      const creates = rows.filter((r) => r._new && r.item_name).map((r) => ({
        category_id: r.category_id, item_name: r.item_name, owner_member_id: r.owner_member_id,
        planned_amount_cents: r.planned_amount_cents, actual_amount_cents: r.actual_amount_cents,
        due_day: r.due_day, payment_status: r.payment_status, is_recurring: r.is_recurring,
        priority: r.priority,
      }));
      const updates: Record<number, any> = {};
      rows.filter((r) => r._dirty && !r._new).forEach((r) => {
        updates[r.id] = {
          category_id: r.category_id, item_name: r.item_name, owner_member_id: r.owner_member_id,
          planned_amount_cents: r.planned_amount_cents, actual_amount_cents: r.actual_amount_cents,
          payment_status: r.payment_status,
        };
      });
      await api.post(`/budget-periods/${periodId}/lines/batch`, { creates, updates, deletes });
      await loadPeriod(periodId);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function createPeriod() {
    const label = prompt("Period label (e.g. Jan4Feb)");
    if (!label) return;
    const start = prompt("Start date (YYYY-MM-DD)", "2025-01-01");
    const end = prompt("End date (YYYY-MM-DD)", "2025-02-28");
    if (!start || !end) return;
    const p = await api.post<Period>("/budget-periods", { label, start_date: start, end_date: end });
    setPeriods((ps) => [p, ...ps]);
    await selectPeriod(p.id);
  }

  async function duplicatePeriod() {
    if (!period) return;
    const label = prompt("New period label", period.label + " copy");
    if (!label) return;
    const start = prompt("Start date (YYYY-MM-DD)", period.start_date);
    const end = prompt("End date (YYYY-MM-DD)", period.end_date);
    if (!start || !end) return;
    const p = await api.post<Period>(`/budget-periods/${period.id}/duplicate`, {
      label, start_date: start, end_date: end, copy_ad_hoc: false,
    });
    setPeriods((ps) => [p, ...ps]);
    await selectPeriod(p.id);
  }

  async function setStatus(status: string) {
    if (!period) return;
    await api.patch(`/budget-periods/${period.id}/status`, { status });
    setPeriods((ps) => ps.map((p) => (p.id === period.id ? { ...p, status } : p)));
  }

  async function generateInsights() {
    if (!periodId) return;
    await api.post(`/insights/generate/${periodId}`);
    alert("Insights generated — see the Dashboard.");
  }

  if (loading && !periods.length) return <AppShell><Spinner /></AppShell>;

  const catName = (id: number) => categories.find((c) => c.id === id)?.name || "—";
  const dirty = rows.some((r) => r._dirty || r._new) || deletes.length > 0;

  return (
    <AppShell>
      <PageHeader
        title="Monthly planner"
        description="Plan before spending. Every total is computed server-side."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={createPeriod}>New period</Button>
            {period && <Button variant="ghost" onClick={duplicatePeriod}>Duplicate</Button>}
          </div>
        }
      />

      {!periods.length ? (
        <EmptyState title="No budget periods yet" hint="Create your first monthly period to begin planning." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select value={periodId ?? ""} onChange={(e) => selectPeriod(Number(e.target.value))} className="max-w-xs">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label} ({p.status})</option>
              ))}
            </Select>
            {period && (
              <Select value={period.status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]">
                {["draft", "planned", "approved", "active", "closed", "archived"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            )}
            <Button variant="ghost" onClick={generateInsights}>Generate insights</Button>
          </div>

          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryTile label="Income" value={formatMoney(summary.planned.total_income_cents, currency)} />
              <SummaryTile label="Expenses" value={formatMoney(summary.planned.total_expenses_cents, currency)} />
              <SummaryTile
                label="Net"
                value={formatMoney(summary.planned.net_position_cents, currency)}
                tone={summary.planned.net_position_cents >= 0 ? "positive" : "negative"}
              />
              <SummaryTile label="Savings rate" value={formatPercent(summary.planned.savings_rate)} />
            </div>
          )}

          <Card
            title="Budget lines"
            subtitle={locked ? "Period is locked — unlock via status to edit" : "Edit inline, then Save changes"}
            actions={
              <div className="flex gap-2">
                {!locked && <Button variant="ghost" onClick={addRow}>Add line</Button>}
                {!locked && <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</Button>}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2 pr-3 text-right">Planned</th>
                    <th className="py-2 pr-3 text-right">Actual</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">
                        {locked ? r.item_name : (
                          <Input value={r.item_name} onChange={(e) => editRow(idx, { item_name: e.target.value })} className="min-w-[10rem]" />
                        )}
                        {r.needs_review && <Badge tone="warning">review</Badge>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? catName(r.category_id) : (
                          <Select value={r.category_id} onChange={(e) => editRow(idx, { category_id: Number(e.target.value) })}>
                            {categories.filter((c) => !c.is_section).map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? (members.find((m) => m.id === r.owner_member_id)?.name || "—") : (
                          <Select value={r.owner_member_id ?? ""} onChange={(e) => editRow(idx, { owner_member_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {locked ? formatMoney(r.planned_amount_cents, currency) : (
                          <Input type="number" step="0.01" defaultValue={fromCents(r.planned_amount_cents)}
                            onChange={(e) => editRow(idx, { planned_amount_cents: toCents(e.target.value) })}
                            className="w-28 text-right tabular" />
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {locked ? formatMoney(r.actual_amount_cents, currency) : (
                          <Input type="number" step="0.01" defaultValue={fromCents(r.actual_amount_cents)}
                            onChange={(e) => editRow(idx, { actual_amount_cents: toCents(e.target.value) })}
                            className="w-28 text-right tabular" />
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? r.payment_status : (
                          <Select value={r.payment_status} onChange={(e) => editRow(idx, { payment_status: e.target.value })}>
                            {["planned", "unpaid", "paid"].map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {!locked && <button onClick={() => removeRow(idx)} className="text-xs text-ink-muted hover:text-negative">✕</button>}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7} className="py-6 text-center text-ink-muted">No lines. Add one to begin.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
