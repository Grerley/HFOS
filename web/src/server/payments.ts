/** Payment settlement service: loads live settlement per period, records payments,
 * and keeps each line's paid amount (actual_amount_cents) in sync with its records. */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { budgetLines, categories, expenseComments, householdMembers, paymentRecords } from "../db/schema";
import * as calc from "../lib/calc";
import { OUTFLOW_TYPES } from "../lib/enums";
import { HttpError } from "./context";
import { recordAudit } from "./services";

export const todayISO = () => new Date().toISOString().slice(0, 10);
const inNext = (dateISO: string | null, days: number, from: string) => {
  if (!dateISO) return false;
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  return dateISO >= from && dateISO <= end.toISOString().slice(0, 10);
};

/** Active (non-deleted) payment records grouped by line. */
async function recordsByLine(db: DB, lineIds: number[]) {
  const map = new Map<number, (typeof paymentRecords.$inferSelect)[]>();
  if (!lineIds.length) return map;
  const recs = await db
    .select()
    .from(paymentRecords)
    .where(and(inArray(paymentRecords.budget_line_id, lineIds), isNull(paymentRecords.deleted_at)))
    .orderBy(paymentRecords.payment_date, paymentRecords.id);
  for (const r of recs) {
    const list = map.get(r.budget_line_id) ?? [];
    list.push(r);
    map.set(r.budget_line_id, list);
  }
  return map;
}

/** Recompute a line's paid total from its records and persist it as actual_amount_cents. */
export async function recomputeLine(db: DB, householdId: number, lineId: number): Promise<number> {
  const recs = (await recordsByLine(db, [lineId])).get(lineId) ?? [];
  const paid = calc.paidAmount(recs.map((r) => ({ amount_cents: r.amount_cents, is_reversal: r.is_reversal })));
  await db.update(budgetLines).set({ actual_amount_cents: paid }).where(eq(budgetLines.id, lineId));
  return paid;
}

export async function getLineScoped(db: DB, householdId: number, lineId: number) {
  const line = (await db.select().from(budgetLines).where(eq(budgetLines.id, lineId))).at(0);
  if (!line || line.household_id !== householdId) throw new HttpError(404, "Expense line not found");
  return line;
}

/** Full settlement view for a period: per-line settlement + household + category rollups. */
export async function periodSettlement(db: DB, householdId: number, periodId: number) {
  const lines = await db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.period_id, periodId), eq(budgetLines.household_id, householdId)))
    .orderBy(budgetLines.sort_order, budgetLines.id);

  const catIds = [...new Set(lines.map((l) => l.category_id))];
  const cats = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : [];
  const catById = new Map(cats.map((c) => [c.id, c]));
  const sectionOf = (cid: number) => {
    const c = catById.get(cid);
    if (!c) return null;
    return c.is_section ? c : catById.get(c.parent_id ?? -1) ?? c;
  };

  // Only outflow lines are payable obligations (income is not "settled").
  const payable = lines.filter((l) => OUTFLOW_TYPES.has(catById.get(l.category_id)?.type ?? "expense"));
  const recsMap = await recordsByLine(db, payable.map((l) => l.id));
  const commentCounts = new Map<number, number>();
  if (payable.length) {
    const cs = await db
      .select()
      .from(expenseComments)
      .where(inArray(expenseComments.budget_line_id, payable.map((l) => l.id)));
    for (const c of cs) commentCounts.set(c.budget_line_id, (commentCounts.get(c.budget_line_id) ?? 0) + 1);
  }
  const members = new Map(
    (await db.select().from(householdMembers).where(eq(householdMembers.household_id, householdId))).map((m) => [m.id, m.name]),
  );

  const day = todayISO();
  const out = payable.map((l) => {
    const recs = recsMap.get(l.id) ?? [];
    const paid = calc.paidAmount(recs.map((r) => ({ amount_cents: r.amount_cents, is_reversal: r.is_reversal })));
    const s = calc.settlement(l.planned_amount_cents, paid, { dueDate: l.due_date, today: day, manualStatus: l.manual_status });
    const sec = sectionOf(l.category_id);
    return {
      line_id: l.id,
      item_name: l.item_name,
      category_id: l.category_id,
      category_name: catById.get(l.category_id)?.name ?? null,
      section_id: sec?.id ?? null,
      section_name: sec?.name ?? "Other",
      due_date: l.due_date,
      priority: l.priority,
      is_debit_order: l.is_debit_order,
      is_manual_payment: l.is_manual_payment,
      requires_confirmation: l.requires_confirmation,
      responsible_member_id: l.responsible_member_id,
      responsible_member_name: l.responsible_member_id ? members.get(l.responsible_member_id) ?? null : null,
      payment_count: recs.length,
      comment_count: commentCounts.get(l.id) ?? 0,
      ...s,
    };
  });

  // Household summary (FR-025, FR-030).
  const sum = out.reduce(
    (a, r) => {
      a.total_planned_cents += r.planned_cents;
      a.total_paid_cents += r.paid_cents;
      a.total_outstanding_cents += r.outstanding_cents;
      a.total_overpaid_cents += r.overpaid_cents;
      if (r.is_overdue) { a.total_overdue_cents += r.outstanding_cents; a.overdue_count += 1; }
      if (r.status === "not_paid") a.unpaid_count += 1;
      if (r.status === "partially_paid") a.partial_count += 1;
      if (r.is_manual_payment && r.outstanding_cents > 0) a.manual_remaining_count += 1;
      if (r.is_debit_order && r.requires_confirmation && r.status !== "fully_paid") a.debit_pending_count += 1;
      if (r.outstanding_cents > 0 && inNext(r.due_date, 7, day)) a.upcoming_7d_count += 1;
      return a;
    },
    {
      total_planned_cents: 0, total_paid_cents: 0, total_outstanding_cents: 0, total_overpaid_cents: 0,
      total_overdue_cents: 0, overdue_count: 0, unpaid_count: 0, partial_count: 0,
      manual_remaining_count: 0, debit_pending_count: 0, upcoming_7d_count: 0, line_count: out.length,
    },
  );

  // Category rollup (FR-029).
  const byCat = new Map<string, any>();
  for (const r of out) {
    const key = r.section_name;
    const c = byCat.get(key) ?? {
      section_name: key, planned_cents: 0, paid_cents: 0, outstanding_cents: 0, overpaid_cents: 0,
      unpaid_count: 0, partial_count: 0, overdue_count: 0,
    };
    c.planned_cents += r.planned_cents;
    c.paid_cents += r.paid_cents;
    c.outstanding_cents += r.outstanding_cents;
    c.overpaid_cents += r.overpaid_cents;
    if (r.status === "not_paid") c.unpaid_count += 1;
    if (r.status === "partially_paid") c.partial_count += 1;
    if (r.is_overdue) c.overdue_count += 1;
    byCat.set(key, c);
  }
  const categoriesOut = [...byCat.values()].map((c) => ({
    ...c,
    pct_paid: c.planned_cents ? Math.round((c.paid_cents / c.planned_cents) * 1e6) / 1e6 : 0,
  }));

  const completion_pct = sum.line_count
    ? Math.round((out.filter((r) => r.status === "fully_paid" || r.status === "overpaid").length / sum.line_count) * 1e6) / 1e6
    : 0;

  return { period_id: periodId, today: day, lines: out, summary: { ...sum, completion_pct }, categories: categoriesOut };
}

// ── Payment record operations ─────────────────────────────────────────────────
interface PaymentInput {
  amount_cents: number;
  payment_date?: string;
  payment_method?: string;
  paid_by_member_id?: number | null;
  source_account_id?: number | null;
  beneficiary?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export async function addPayment(db: DB, householdId: number, actorUserId: number, lineId: number, p: PaymentInput) {
  const line = await getLineScoped(db, householdId, lineId);
  if (p.amount_cents == null || p.amount_cents === 0) throw new HttpError(422, "Payment amount is required");
  const [rec] = await db.insert(paymentRecords).values({
    budget_line_id: line.id, household_id: householdId,
    payment_date: p.payment_date ?? todayISO(), amount_cents: p.amount_cents,
    payment_method: p.payment_method ?? "eft", paid_by_member_id: p.paid_by_member_id ?? null,
    source_account_id: p.source_account_id ?? null, beneficiary: p.beneficiary ?? null,
    reference: p.reference ?? null, notes: p.notes ?? null, created_by: actorUserId,
  }).returning();
  const paid = await recomputeLine(db, householdId, line.id);
  await recordAudit(db, {
    action: "payment.created", entity_type: "payment_record", entity_id: rec.id,
    household_id: householdId, actor_user_id: actorUserId,
    detail: { line_id: line.id, amount_cents: p.amount_cents, paid_after: paid },
  });
  return { record: rec, paid_cents: paid };
}

export async function editPayment(db: DB, householdId: number, actorUserId: number, paymentId: number, patch: Partial<PaymentInput>) {
  const rec = (await db.select().from(paymentRecords).where(eq(paymentRecords.id, paymentId))).at(0);
  if (!rec || rec.household_id !== householdId) throw new HttpError(404, "Payment not found");
  const before = rec.amount_cents;
  await db.update(paymentRecords).set({ ...patch, updated_at: new Date() as any }).where(eq(paymentRecords.id, paymentId));
  const paid = await recomputeLine(db, householdId, rec.budget_line_id);
  await recordAudit(db, {
    action: "payment.edited", entity_type: "payment_record", entity_id: paymentId,
    household_id: householdId, actor_user_id: actorUserId,
    detail: { line_id: rec.budget_line_id, amount_before: before, amount_after: patch.amount_cents ?? before, paid_after: paid },
  });
  return { paid_cents: paid };
}

export async function reversePayment(db: DB, householdId: number, actorUserId: number, paymentId: number, reason?: string) {
  const rec = (await db.select().from(paymentRecords).where(eq(paymentRecords.id, paymentId))).at(0);
  if (!rec || rec.household_id !== householdId) throw new HttpError(404, "Payment not found");
  if (rec.is_reversal) throw new HttpError(409, "Cannot reverse a reversal");
  const [rev] = await db.insert(paymentRecords).values({
    budget_line_id: rec.budget_line_id, household_id: householdId, payment_date: todayISO(),
    amount_cents: rec.amount_cents, payment_method: "reversal", is_reversal: true,
    reversed_payment_record_id: rec.id, notes: reason ?? `Reversal of payment #${rec.id}`, created_by: actorUserId,
  }).returning();
  const paid = await recomputeLine(db, householdId, rec.budget_line_id);
  await recordAudit(db, {
    action: "payment.reversed", entity_type: "payment_record", entity_id: rec.id,
    household_id: householdId, actor_user_id: actorUserId,
    detail: { line_id: rec.budget_line_id, reversal_id: rev.id, amount_cents: rec.amount_cents, paid_after: paid },
  });
  return { reversal: rev, paid_cents: paid };
}

export async function softDeletePayment(db: DB, householdId: number, actorUserId: number, paymentId: number) {
  const rec = (await db.select().from(paymentRecords).where(eq(paymentRecords.id, paymentId))).at(0);
  if (!rec || rec.household_id !== householdId) throw new HttpError(404, "Payment not found");
  await db.update(paymentRecords).set({ deleted_at: new Date() as any }).where(eq(paymentRecords.id, paymentId));
  const paid = await recomputeLine(db, householdId, rec.budget_line_id);
  await recordAudit(db, {
    action: "payment.deleted", entity_type: "payment_record", entity_id: paymentId,
    household_id: householdId, actor_user_id: actorUserId,
    detail: { line_id: rec.budget_line_id, amount_cents: rec.amount_cents, paid_after: paid },
  });
  return { paid_cents: paid };
}

/** Mark an expense fully paid by settling its outstanding balance with one record. */
export async function markPaidInFull(db: DB, householdId: number, actorUserId: number, lineId: number, p: PaymentInput) {
  const line = await getLineScoped(db, householdId, lineId);
  const paidNow = await recomputeLine(db, householdId, line.id);
  const outstanding = Math.max(line.planned_amount_cents - paidNow, 0);
  if (outstanding <= 0) throw new HttpError(409, "Nothing outstanding to settle");
  return addPayment(db, householdId, actorUserId, lineId, { ...p, amount_cents: outstanding });
}

export async function paymentHistory(db: DB, householdId: number, lineId: number) {
  await getLineScoped(db, householdId, lineId);
  const recs = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.budget_line_id, lineId))
    .orderBy(paymentRecords.payment_date, paymentRecords.id);
  return recs.filter((r) => r.household_id === householdId);
}
