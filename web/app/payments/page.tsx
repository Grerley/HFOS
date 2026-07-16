"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/AppShell";
import { Button, Card, Field, Input, Select, EmptyState, PageSkeleton } from "@/components/ui";
import PaymentCalendar from "@/components/PaymentCalendar";
import { api } from "@/lib/api";
import { formatMoney, formatPercent, toCents } from "@/lib/format";
import type { Member, Period } from "@/lib/types";

interface SettleLine {
  line_id: number; item_name: string; category_name: string | null; section_name: string;
  due_date: string | null; priority: number; is_debit_order: boolean; is_manual_payment: boolean;
  requires_confirmation: boolean; responsible_member_id: number | null; responsible_member_name: string | null;
  payment_count: number; comment_count: number;
  planned_cents: number; paid_cents: number; outstanding_cents: number; overpaid_cents: number;
  status: string; is_overdue: boolean;
}
interface Settlement {
  period_id: number; today: string; lines: SettleLine[];
  summary: {
    total_planned_cents: number; total_paid_cents: number; total_outstanding_cents: number;
    total_overpaid_cents: number; total_overdue_cents: number; overdue_count: number;
    unpaid_count: number; partial_count: number; manual_remaining_count: number;
    debit_pending_count: number; upcoming_7d_count: number; line_count: number; completion_pct: number;
  };
  categories: any[];
}
interface Account { id: number; name: string; }
interface PaymentRec {
  id: number; payment_date: string; amount_cents: number; payment_method: string;
  is_reversal: boolean; notes: string | null; reference: string | null;
}

const CUR = "ZAR";
const METHODS = ["debit_order", "eft", "card", "cash", "internal_transfer", "stop_order", "bank_app", "other"];

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: string }> = {
  not_paid: { label: "Not paid", cls: "bg-muted text-ink", icon: "○" },
  scheduled: { label: "Scheduled", cls: "bg-cyan-50 text-cyan-700", icon: "◷" },
  partially_paid: { label: "Partial", cls: "bg-amber-50 text-amber-700", icon: "◑" },
  fully_paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700", icon: "●" },
  overpaid: { label: "Overpaid", cls: "bg-purple-50 text-purple-700", icon: "▲" },
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700", icon: "!" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-ink-muted line-through", icon: "—" },
  not_applicable: { label: "N/A", cls: "bg-muted text-ink-muted", icon: "—" },
};

function StatusBadge({ status, overdue }: { status: string; overdue: boolean }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.not_paid;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
        <span aria-hidden>{s.icon}</span>{s.label}
      </span>
      {overdue && status !== "overdue" && <span className="text-xs font-semibold text-red-600">• overdue</span>}
    </span>
  );
}

const FILTERS = [
  "All", "Not Paid", "Partially Paid", "Fully Paid", "Overpaid", "Overdue", "Due Soon", "Debit Orders", "Manual", "Needs Confirmation",
];

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso || new Date().toISOString().slice(0, 10));
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function PaymentsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [data, setData] = useState<Settlement | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [history, setHistory] = useState<PaymentRec[]>([]);
  const [modal, setModal] = useState<{ line: SettleLine; prefill: number } | null>(null);
  const [confirmLine, setConfirmLine] = useState<SettleLine | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadSettlement = useCallback(async (pid: number) => {
    setData(await api.get<Settlement>(`/budget-periods/${pid}/settlement`));
  }, []);

  useEffect(() => {
    (async () => {
      const [ps, mem, acc] = await Promise.all([
        api.get<Period[]>("/budget-periods"),
        api.get<Member[]>("/members"),
        api.get<Account[]>("/accounts"),
      ]);
      setPeriods(ps); setMembers(mem); setAccounts(acc);
      if (ps.length) { setPeriodId(ps[0].id); await loadSettlement(ps[0].id); }
      setLoading(false);
    })();
  }, [loadSettlement]);

  async function selectPeriod(id: number) {
    setPeriodId(id); setExpanded(null); setSelected(new Set());
    await loadSettlement(id);
  }
  async function refresh() { if (periodId) await loadSettlement(periodId); if (expanded) setHistory(await api.get(`/budget-lines/${expanded}/payments`)); }

  function toggleSelect(id: number) {
    setSelected((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkMarkPaid() {
    if (!periodId || !selected.size) return;
    const ids = [...selected];
    if (!confirm(`Mark ${ids.length} obligation${ids.length === 1 ? "" : "s"} paid in full? This records a payment settling each one's outstanding balance.`)) return;
    setBulkBusy(true);
    try {
      const r = await api.post<{ settled: number; requested: number }>(`/budget-periods/${periodId}/bulk-mark-paid`, { line_ids: ids });
      setSelected(new Set());
      await refresh();
      if (r.settled < r.requested) alert(`Settled ${r.settled} of ${r.requested}. Some had nothing outstanding.`);
    } catch (e: any) { alert(e.message); }
    finally { setBulkBusy(false); }
  }

  async function markPaidFull(lineId: number) {
    try { await api.post(`/budget-lines/${lineId}/mark-paid`, {}); await refresh(); }
    catch (e: any) { alert(e.message); }
  }

  async function toggleExpand(lineId: number) {
    if (expanded === lineId) { setExpanded(null); return; }
    setExpanded(lineId);
    setHistory(await api.get<PaymentRec[]>(`/budget-lines/${lineId}/payments`));
  }

  const visible = useMemo(() => {
    const lines = data?.lines ?? [];
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      const byFilter =
        filter === "All" ? true :
        filter === "Not Paid" ? l.status === "not_paid" :
        filter === "Partially Paid" ? l.status === "partially_paid" :
        filter === "Fully Paid" ? l.status === "fully_paid" :
        filter === "Overpaid" ? l.status === "overpaid" :
        filter === "Overdue" ? l.is_overdue || l.status === "overdue" :
        filter === "Due Soon" ? (l.outstanding_cents > 0 && !!l.due_date && !l.is_overdue && !!data && l.due_date >= data.today && l.due_date <= addDaysISO(data.today, 7)) :
        filter === "Debit Orders" ? l.is_debit_order :
        filter === "Manual" ? l.is_manual_payment :
        filter === "Needs Confirmation" ? l.is_debit_order && l.requires_confirmation && l.status !== "fully_paid" :
        true;
      const byText = !q || [l.item_name, l.category_name, l.responsible_member_name].some((x) => (x ?? "").toLowerCase().includes(q));
      return byFilter && byText;
    });
  }, [data, filter, search]);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;
  const s = data?.summary;

  return (
    <AppShell>
      <PageHeader
        title="Payments & settlement"
        description="Track what's paid, outstanding, partial and overdue this month."
        actions={
          <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            <button onClick={() => setView("list")}
              className={`rounded-md px-3 py-1 font-medium transition ${view === "list" ? "bg-brand text-brand-fg" : "text-ink-soft hover:bg-muted"}`}>List</button>
            <button onClick={() => setView("calendar")}
              className={`rounded-md px-3 py-1 font-medium transition ${view === "calendar" ? "bg-brand text-brand-fg" : "text-ink-soft hover:bg-muted"}`}>Calendar</button>
          </div>
        }
      />

      {!periods.length ? (
        <EmptyState title="No budget periods yet" hint="Create a monthly budget in the planner first." />
      ) : (
        <>
          <div className="mb-4">
            <Select value={periodId ?? ""} onChange={(e) => selectPeriod(Number(e.target.value))} className="max-w-xs">
              {periods.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.status})</option>)}
            </Select>
          </div>

          {/* Outstanding summary panel */}
          {s && (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Tile label="Planned" value={formatMoney(s.total_planned_cents, CUR)} />
              <Tile label="Paid" value={formatMoney(s.total_paid_cents, CUR)} tone="positive" />
              <Tile label="Outstanding" value={formatMoney(s.total_outstanding_cents, CUR)} tone={s.total_outstanding_cents > 0 ? "negative" : "neutral"} />
              <Tile label="Overdue" value={formatMoney(s.total_overdue_cents, CUR)} tone={s.total_overdue_cents > 0 ? "negative" : "neutral"} hint={`${s.overdue_count} item${s.overdue_count === 1 ? "" : "s"}`} />
              <Tile label="Completion" value={formatPercent(s.completion_pct)} hint={`${s.line_count} obligations`} />
              <Tile label="Due ≤ 7 days" value={String(s.upcoming_7d_count)} hint={`${s.manual_remaining_count} manual left`} />
            </div>
          )}

          {/* Bulk action bar (FR-020) */}
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand bg-brand-light px-4 py-2.5">
              <span className="text-sm font-medium text-brand-dark">{selected.size} selected</span>
              <Button onClick={bulkMarkPaid} disabled={bulkBusy}>{bulkBusy ? "Settling…" : "Mark paid in full"}</Button>
              <button onClick={() => setSelected(new Set())} className="text-xs font-medium text-ink-soft underline hover:text-ink">Clear</button>
            </div>
          )}

          {view === "calendar" && data && (
            <Card title="Payment calendar" subtitle="Obligations by due date — click an item to record a payment">
              <PaymentCalendar
                lines={data.lines}
                today={data.today}
                currency={CUR}
                selected={selected}
                onToggleSelect={toggleSelect}
                onPay={(id) => { const l = data.lines.find((x) => x.line_id === id); if (l) setModal({ line: l, prefill: l.outstanding_cents }); }}
              />
            </Card>
          )}

          {view === "list" && (
          <>
          {/* Filters + search */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${filter === f ? "bg-brand text-brand-fg" : "border border-line text-ink-soft hover:bg-muted"}`}>
                {f}
              </button>
            ))}
            {visible.some((l) => l.outstanding_cents > 0) && (
              <button
                onClick={() => {
                  const payable = visible.filter((l) => l.outstanding_cents > 0).map((l) => l.line_id);
                  const allSel = payable.every((id) => selected.has(id));
                  setSelected(allSel ? new Set() : new Set(payable));
                }}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft hover:bg-muted"
              >
                {visible.filter((l) => l.outstanding_cents > 0).every((l) => selected.has(l.line_id)) ? "Deselect all" : "Select all outstanding"}
              </button>
            )}
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="ml-auto max-w-[12rem]" />
          </div>

          <div className="hidden md:block">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3">Expense</th>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3 text-right">Planned</th>
                    <th className="py-2 pr-3 text-right">Paid</th>
                    <th className="py-2 pr-3 text-right">Outstanding</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <Fragment key={l.line_id}>
                      <tr className="border-b border-line-soft align-middle">
                        <td className="py-2 pr-2">
                          {l.outstanding_cents > 0 && (
                            <input type="checkbox" aria-label={`Select ${l.item_name}`} checked={selected.has(l.line_id)} onChange={() => toggleSelect(l.line_id)} />
                          )}
                        </td>
                        <td className="py-2 pr-3 font-medium text-ink">
                          <button onClick={() => toggleExpand(l.line_id)} className="mr-1 text-ink-muted">{expanded === l.line_id ? "▾" : "▸"}</button>
                          {l.item_name}
                          {l.comment_count > 0 && <span className="ml-1 text-xs text-ink-muted">💬{l.comment_count}</span>}
                        </td>
                        <td className="py-2 pr-3 text-ink-muted">{l.category_name}</td>
                        <td className="tabular py-2 pr-3 text-right">{formatMoney(l.planned_cents, CUR)}</td>
                        <td className="tabular py-2 pr-3 text-right text-positive">{formatMoney(l.paid_cents, CUR)}</td>
                        <td className={`tabular py-2 pr-3 text-right ${l.outstanding_cents > 0 ? "text-negative" : "text-ink-muted"}`}>
                          {formatMoney(l.outstanding_cents, CUR)}
                          {l.overpaid_cents > 0 && <div className="text-xs text-purple-600">+{formatMoney(l.overpaid_cents, CUR)}</div>}
                        </td>
                        <td className="py-2 pr-3"><StatusBadge status={l.status} overdue={l.is_overdue} /></td>
                        <td className="py-2 pr-3 text-ink-muted">{l.due_date ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs text-ink-muted">
                          {l.is_debit_order ? "Debit order" : l.is_manual_payment ? "Manual" : "—"}
                        </td>
                        <td className="py-2 pr-3 text-ink-muted">{l.responsible_member_name ?? "—"}</td>
                        <td className="py-2 text-right">
                          {l.outstanding_cents > 0 ? (
                            <div className="flex items-center justify-end gap-1">
                              {l.is_debit_order && <Button variant="ghost" onClick={() => setConfirmLine(l)}>Confirm</Button>}
                              <Button variant="ghost" onClick={() => setModal({ line: l, prefill: l.outstanding_cents })}>Pay</Button>
                            </div>
                          ) : <span className="text-xs text-positive">settled</span>}
                        </td>
                      </tr>
                      {expanded === l.line_id && (
                        <tr className="bg-muted">
                          <td colSpan={11} className="px-6 py-4">
                            <ExpandedRow line={l} history={history} members={members} accounts={accounts}
                              onChanged={refresh} onAddPayment={() => setModal({ line: l, prefill: l.outstanding_cents })}
                              onMarkFull={() => markPaidFull(l.line_id)} onConfirm={() => setConfirmLine(l)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {!visible.length && (
                    <tr><td colSpan={11} className="py-8 text-center text-ink-muted">No expenses match “{filter}”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          </div>

          {/* Mobile: card-based payment view (AC-005) */}
          <div className="space-y-3 md:hidden">
            {visible.map((l) => (
              <PaymentCard key={l.line_id} line={l} expanded={expanded === l.line_id}
                onToggle={() => toggleExpand(l.line_id)} onPay={() => setModal({ line: l, prefill: l.outstanding_cents })}
                onConfirm={() => setConfirmLine(l)} onMarkFull={() => markPaidFull(l.line_id)}
                history={history} members={members} accounts={accounts} onChanged={refresh}
                onAddPayment={() => setModal({ line: l, prefill: l.outstanding_cents })} />
            ))}
            {!visible.length && <EmptyState title="Nothing here" hint={`No expenses match “${filter}”.`} />}
          </div>
          </>
          )}
        </>
      )}

      {modal && (
        <AddPaymentModal line={modal.line} prefill={modal.prefill} members={members} accounts={accounts}
          onClose={() => setModal(null)} onSaved={async () => { setModal(null); await refresh(); }} />
      )}
      {confirmLine && (
        <ConfirmDebitModal line={confirmLine} onClose={() => setConfirmLine(null)}
          onSaved={async () => { setConfirmLine(null); await refresh(); }} />
      )}
    </AppShell>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "positive" | "negative" | "neutral" }) {
  const c = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`tabular text-lg font-semibold ${c}`}>{value}</div>
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

function ExpandedRow({ line, history, members, accounts, onChanged, onAddPayment, onMarkFull, onConfirm }: {
  line: SettleLine; history: PaymentRec[]; members: Member[]; accounts: Account[];
  onChanged: () => Promise<void>; onAddPayment: () => void; onMarkFull?: () => void; onConfirm?: () => void;
}) {
  const [comment, setComment] = useState("");
  const [cfg, setCfg] = useState({
    due_date: line.due_date ?? "", responsible_member_id: line.responsible_member_id ?? "",
    is_debit_order: line.is_debit_order, is_manual_payment: line.is_manual_payment, manual_status: "",
  });

  async function reverse(id: number) {
    if (!confirm("Reverse this payment? The original stays in history.")) return;
    await api.post(`/payments/${id}/reverse`, { reason: "Reversed from settlement view" });
    await onChanged();
  }
  async function saveConfig() {
    await api.patch(`/budget-lines/${line.line_id}/payment-config`, {
      due_date: cfg.due_date || null,
      responsible_member_id: cfg.responsible_member_id ? Number(cfg.responsible_member_id) : null,
      is_debit_order: cfg.is_debit_order, is_manual_payment: cfg.is_manual_payment,
      ...(cfg.manual_status ? { manual_status: cfg.manual_status } : {}),
    });
    await onChanged();
  }
  async function addComment() {
    if (!comment.trim()) return;
    await api.post(`/budget-lines/${line.line_id}/comments`, { comment_text: comment });
    setComment(""); await onChanged();
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold uppercase text-ink-muted">Payment history</h4>
          <Button variant="ghost" onClick={onAddPayment}>Add payment</Button>
          {line.outstanding_cents > 0 && onMarkFull && <Button variant="ghost" onClick={onMarkFull}>Mark paid in full</Button>}
          {line.is_debit_order && line.outstanding_cents > 0 && onConfirm && <Button variant="ghost" onClick={onConfirm}>Confirm debit order</Button>}
        </div>
        {history.length ? (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ink-muted">
              <th className="py-1">Date</th><th>Amount</th><th>Method</th><th>Notes</th><th></th>
            </tr></thead>
            <tbody className="tabular">
              {history.map((h) => (
                <tr key={h.id} className={`border-t border-line-soft ${h.is_reversal ? "text-negative" : ""}`}>
                  <td className="py-1">{h.payment_date}</td>
                  <td>{h.is_reversal ? "−" : ""}{formatMoney(h.amount_cents, CUR)}</td>
                  <td>{h.payment_method}{h.is_reversal ? " (reversal)" : ""}</td>
                  <td className="text-ink-muted">{h.notes ?? h.reference ?? ""}</td>
                  <td className="text-right">{!h.is_reversal && <button onClick={() => reverse(h.id)} className="text-ink-muted hover:text-negative">reverse</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-xs text-ink-muted">No payments recorded yet.</p>}

        <div className="mt-4 flex gap-2">
          <Input placeholder="Add a note / reconciliation comment…" value={comment} onChange={(e) => setComment(e.target.value)} className="text-xs" />
          <Button variant="ghost" onClick={addComment}>Comment</Button>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-ink-muted">Payment settings</h4>
        <div className="space-y-2">
          <Field label="Due date"><Input type="date" value={cfg.due_date} onChange={(e) => setCfg({ ...cfg, due_date: e.target.value })} /></Field>
          <Field label="Responsible">
            <Select value={cfg.responsible_member_id} onChange={(e) => setCfg({ ...cfg, responsible_member_id: e.target.value })}>
              <option value="">—</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={cfg.is_debit_order} onChange={(e) => setCfg({ ...cfg, is_debit_order: e.target.checked, is_manual_payment: e.target.checked ? false : cfg.is_manual_payment })} /> Debit order
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={cfg.is_manual_payment} onChange={(e) => setCfg({ ...cfg, is_manual_payment: e.target.checked, is_debit_order: e.target.checked ? false : cfg.is_debit_order })} /> Manual payment
          </label>
          <Field label="Override status">
            <Select value={cfg.manual_status} onChange={(e) => setCfg({ ...cfg, manual_status: e.target.value })}>
              <option value="">Auto (derive)</option>
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
              <option value="not_applicable">Not applicable</option>
            </Select>
          </Field>
          <Button variant="ghost" onClick={saveConfig} className="w-full">Save settings</Button>
        </div>
      </div>
    </div>
  );
}

function AddPaymentModal({ line, prefill, members, accounts, onClose, onSaved }: {
  line: SettleLine; prefill: number; members: Member[]; accounts: Account[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    amount: (prefill > 0 ? prefill : line.planned_cents) / 100,
    payment_date: "", payment_method: "eft", paid_by_member_id: "", source_account_id: "", reference: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const remaining = line.outstanding_cents - toCents(String(form.amount));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/budget-lines/${line.line_id}/payments`, {
        amount_cents: toCents(String(form.amount)),
        payment_date: form.payment_date || undefined,
        payment_method: form.payment_method,
        paid_by_member_id: form.paid_by_member_id ? Number(form.paid_by_member_id) : null,
        source_account_id: form.source_account_id ? Number(form.source_account_id) : null,
        reference: form.reference || null, notes: form.notes || null,
      });
      onSaved();
    } catch (err: any) { alert(err.message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-ink">Record payment — {line.item_name}</h3>
        <p className="mb-4 text-xs text-ink-muted">
          Planned {formatMoney(line.planned_cents, CUR)} · Outstanding {formatMoney(line.outstanding_cents, CUR)}
        </p>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Amount"><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value as any })} required /></Field>
          <Field label="Date"><Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></Field>
          <Field label="Method">
            <Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </Select>
          </Field>
          <Field label="Paid by">
            <Select value={form.paid_by_member_id} onChange={(e) => setForm({ ...form, paid_by_member_id: e.target.value })}>
              <option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Source account">
            <Select value={form.source_account_id} onChange={(e) => setForm({ ...form, source_account_id: e.target.value })}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={remaining > 0 ? "Reason for partial payment…" : ""} /></Field>
          </div>
          <div className="col-span-2 text-xs text-ink-muted">
            {remaining > 0 ? `Will remain partially paid — ${formatMoney(remaining, CUR)} outstanding.` : remaining < 0 ? `This overpays by ${formatMoney(-remaining, CUR)}.` : "This settles the expense in full."}
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save payment"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentCard({ line, expanded, onToggle, onPay, onConfirm, onMarkFull, history, members, accounts, onChanged, onAddPayment }: {
  line: SettleLine; expanded: boolean; onToggle: () => void; onPay: () => void; onConfirm: () => void; onMarkFull: () => void;
  history: PaymentRec[]; members: Member[]; accounts: Account[]; onChanged: () => Promise<void>; onAddPayment: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-ink">{line.item_name}</div>
          <div className="text-xs text-ink-muted">
            {line.category_name}{line.due_date ? ` · due ${line.due_date}` : ""}{line.is_debit_order ? " · debit order" : line.is_manual_payment ? " · manual" : ""}
          </div>
        </div>
        <StatusBadge status={line.status} overdue={line.is_overdue} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[10px] uppercase text-ink-muted">Planned</div><div className="tabular text-sm font-semibold">{formatMoney(line.planned_cents, CUR)}</div></div>
        <div><div className="text-[10px] uppercase text-ink-muted">Paid</div><div className="tabular text-sm font-semibold text-positive">{formatMoney(line.paid_cents, CUR)}</div></div>
        <div><div className="text-[10px] uppercase text-ink-muted">Outstanding</div><div className={`tabular text-sm font-semibold ${line.outstanding_cents > 0 ? "text-negative" : "text-ink-muted"}`}>{formatMoney(line.outstanding_cents, CUR)}</div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {line.outstanding_cents > 0 && <Button onClick={onPay}>Pay</Button>}
        {line.outstanding_cents > 0 && <Button variant="ghost" onClick={onMarkFull}>Mark full</Button>}
        {line.is_debit_order && line.outstanding_cents > 0 && <Button variant="ghost" onClick={onConfirm}>Confirm</Button>}
        <Button variant="ghost" onClick={onToggle} className="ml-auto">{expanded ? "Hide" : "Details"}</Button>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-line-soft pt-3">
          <ExpandedRow line={line} history={history} members={members} accounts={accounts}
            onChanged={onChanged} onAddPayment={onAddPayment} onMarkFull={onMarkFull} onConfirm={onConfirm} />
        </div>
      )}
    </div>
  );
}

// Debit-order confirmation flow (FR-022, UX-007): did it go off, and for how much?
function ConfirmDebitModal({ line, onClose, onSaved }: { line: SettleLine; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<"confirmed" | "different" | "failed">("confirmed");
  const [amount, setAmount] = useState<number | string>(line.outstanding_cents / 100);
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (outcome === "failed") {
        if (!notes.trim()) { alert("Please add a note explaining what happened."); setBusy(false); return; }
        await api.post(`/budget-lines/${line.line_id}/comments`, { comment_text: `Debit order not successful: ${notes}`, comment_type: "dispute" });
      } else {
        if (outcome === "different" && !notes.trim()) { alert("A note is required when the debited amount differs."); setBusy(false); return; }
        const amt = outcome === "confirmed" ? line.outstanding_cents : toCents(String(amount));
        await api.post(`/budget-lines/${line.line_id}/payments`, {
          amount_cents: amt, payment_method: "debit_order", payment_date: date || undefined,
          notes: notes || (outcome === "confirmed" ? "Debit order confirmed" : null),
        });
      }
      onSaved();
    } catch (err: any) { alert(err.message); setBusy(false); }
  }

  const opts: [typeof outcome, string][] = [
    ["confirmed", `Yes — went off as expected (${formatMoney(line.outstanding_cents, CUR)})`],
    ["different", "Yes — but a different amount"],
    ["failed", "No — failed / not debited"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-ink">Confirm debit order — {line.item_name}</h3>
        <p className="mb-4 text-xs text-ink-muted">Did this debit order go off?</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            {opts.map(([val, label]) => (
              <label key={val} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${outcome === val ? "border-brand bg-brand-light text-brand-dark" : "border-line text-ink-soft"}`}>
                <input type="radio" name="outcome" checked={outcome === val} onChange={() => setOutcome(val)} />
                {label}
              </label>
            ))}
          </div>
          {outcome === "different" && (
            <Field label="Amount debited"><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          )}
          {outcome !== "failed" && (
            <Field label="Date debited"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          )}
          <Field label={outcome === "failed" || outcome === "different" ? "Note (required)" : "Note"}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={outcome === "failed" ? "What happened?" : outcome === "different" ? "Why did the amount differ?" : "Optional"} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
