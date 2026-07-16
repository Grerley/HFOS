"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Input, Select, Badge, EmptyState, Spinner } from "@/components/ui";
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
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const period = periods.find((p) => p.id === periodId) || null;
  const currency = "ZAR";
  const locked = period?.status === "closed" || period?.status === "archived";

  // ── Section helpers ─────────────────────────────────────────────────────
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const sections = useMemo(
    () => categories.filter((c) => c.is_section).sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );
  const sectionIdOf = useCallback(
    (categoryId: number): number | null => {
      const c = catMap.get(categoryId);
      if (!c) return null;
      return c.is_section ? c.id : c.parent_id ?? null;
    },
    [catMap],
  );

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

  // Default to the first section tab once categories are known.
  useEffect(() => {
    if (activeSection === null && sections.length) setActiveSection(sections[0].id);
  }, [sections, activeSection]);

  async function selectPeriod(id: number) {
    setPeriodId(id);
    setLoading(true);
    await loadPeriod(id);
    setLoading(false);
  }

  function editRow(id: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)));
  }

  function addRow() {
    const child =
      categories.find((c) => !c.is_section && c.parent_id === activeSection) ||
      categories.find((c) => !c.is_section);
    setRows((rs) => [
      ...rs,
      {
        id: -Date.now(), period_id: periodId!, category_id: child?.id ?? activeSection ?? 0,
        item_name: "", planned_amount_cents: 0, actual_amount_cents: 0, recurrence: "monthly",
        payment_status: "planned", is_recurring: true, priority: 3, needs_review: false, _new: true,
      } as EditRow,
    ]);
  }

  function removeRow(id: number) {
    const row = rows.find((r) => r.id === id);
    if (row && !row._new) setDeletes((d) => [...d, row.id]);
    setRows((rs) => rs.filter((r) => r.id !== id));
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

  const catName = (id: number) => catMap.get(id)?.name || "—";
  const dirty = rows.some((r) => r._dirty || r._new) || deletes.length > 0;

  // Tabs: every section plus an "Other" bucket if any line can't be mapped.
  const hasUnmapped = rows.some((r) => sectionIdOf(r.category_id) === null);
  const tabs = [
    ...sections.map((s) => ({ id: s.id as number | null, name: s.name, type: s.type })),
    ...(hasUnmapped ? [{ id: null as number | null, name: "Other", type: "expense" }] : []),
  ];
  const countFor = (sid: number | null) => rows.filter((r) => sectionIdOf(r.category_id) === sid).length;
  const plannedFor = (sid: number | null) =>
    rows.filter((r) => sectionIdOf(r.category_id) === sid).reduce((s, r) => s + r.planned_amount_cents, 0);
  const visibleRows = rows.filter((r) => sectionIdOf(r.category_id) === activeSection);
  const activeName = tabs.find((t) => t.id === activeSection)?.name ?? "Section";

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
            subtitle={
              locked
                ? "Period is locked — unlock via status to edit"
                : `${activeName}: ${formatMoney(plannedFor(activeSection), currency)} planned across ${visibleRows.length} line${visibleRows.length === 1 ? "" : "s"}`
            }
            actions={
              <div className="flex gap-2">
                {!locked && <Button variant="ghost" onClick={addRow}>Add line</Button>}
                {!locked && <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</Button>}
              </div>
            }
          >
            {/* Section tabs */}
            <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
              {tabs.map((t) => {
                const active = t.id === activeSection;
                return (
                  <button
                    key={String(t.id)}
                    onClick={() => setActiveSection(t.id)}
                    className={`-mb-px flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "border-brand text-brand-dark"
                        : "border-transparent text-ink-muted hover:text-ink"
                    }`}
                  >
                    {t.type === "income" && <span className="text-positive">▲</span>}
                    {t.name}
                    <span className={`rounded-full px-1.5 text-xs ${active ? "bg-brand-light text-brand-dark" : "bg-slate-100 text-ink-muted"}`}>
                      {countFor(t.id)}
                    </span>
                  </button>
                );
              })}
            </div>

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
                  {visibleRows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">
                        {locked ? r.item_name : (
                          <Input value={r.item_name} onChange={(e) => editRow(r.id, { item_name: e.target.value })} className="min-w-[10rem]" />
                        )}
                        {r.needs_review && <Badge tone="warning">review</Badge>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? catName(r.category_id) : (
                          <Select value={r.category_id} onChange={(e) => editRow(r.id, { category_id: Number(e.target.value) })}>
                            {sections.map((sec) => (
                              <optgroup key={sec.id} label={sec.name}>
                                {categories.filter((c) => !c.is_section && c.parent_id === sec.id).map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? (members.find((m) => m.id === r.owner_member_id)?.name || "—") : (
                          <Select value={r.owner_member_id ?? ""} onChange={(e) => editRow(r.id, { owner_member_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {locked ? formatMoney(r.planned_amount_cents, currency) : (
                          <Input type="number" step="0.01" defaultValue={fromCents(r.planned_amount_cents)}
                            onChange={(e) => editRow(r.id, { planned_amount_cents: toCents(e.target.value) })}
                            className="w-28 text-right tabular" />
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {locked ? formatMoney(r.actual_amount_cents, currency) : (
                          <Input type="number" step="0.01" defaultValue={fromCents(r.actual_amount_cents)}
                            onChange={(e) => editRow(r.id, { actual_amount_cents: toCents(e.target.value) })}
                            className="w-28 text-right tabular" />
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {locked ? r.payment_status : (
                          <Select value={r.payment_status} onChange={(e) => editRow(r.id, { payment_status: e.target.value })}>
                            {["planned", "unpaid", "paid"].map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {!locked && <button onClick={() => removeRow(r.id)} className="text-xs text-ink-muted hover:text-negative">✕</button>}
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length > 0 && (
                    <tr className="border-t-2 border-slate-200 font-medium">
                      <td className="py-2 pr-3 text-ink-muted" colSpan={3}>{activeName} subtotal (planned)</td>
                      <td className="tabular py-2 pr-3 text-right">{formatMoney(plannedFor(activeSection), currency)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  )}
                  {!visibleRows.length && (
                    <tr><td colSpan={7} className="py-6 text-center text-ink-muted">
                      No lines in {activeName}. {!locked && "Use “Add line” to create one here."}
                    </td></tr>
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
