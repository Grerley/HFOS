/** Core services: household provisioning, calc-input loading, audit, budget ops. */
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  accounts,
  auditEvents,
  budgetLineAllocations,
  budgetLines,
  budgetPeriods,
  categories,
  households,
  householdMembers,
  memberships,
} from "../db/schema";
import { contentHash } from "../lib/hash";
import type { LineCalc } from "../lib/calc";
import { EDITABLE_STATUSES, Role } from "../lib/enums";
import { DEFAULT_TAXONOMY } from "./taxonomy";
import { HttpError } from "./context";

// ── Household provisioning ────────────────────────────────────────────────────
export async function provisionHousehold(
  db: DB,
  owner: { id: number; name: string },
  opts: { name: string; base_currency?: string; country?: string; budget_cycle_day?: number },
): Promise<{ id: number; name: string; base_currency: string; country: string; budget_cycle_day: number }> {
  const [hh] = await db
    .insert(households)
    .values({
      name: opts.name,
      base_currency: opts.base_currency ?? "ZAR",
      country: opts.country ?? "ZA",
      budget_cycle_day: opts.budget_cycle_day ?? 1,
      created_by_id: owner.id,
    })
    .returning();

  await db.insert(memberships).values({ user_id: owner.id, household_id: hh.id, role: Role.OWNER });
  await db.insert(householdMembers).values({
    household_id: hh.id,
    user_id: owner.id,
    name: owner.name,
    relationship_label: "self",
    role: Role.OWNER,
  });

  let order = 0;
  for (const [sectionName, ctype, children] of DEFAULT_TAXONOMY) {
    const [section] = await db
      .insert(categories)
      .values({ household_id: hh.id, name: sectionName, type: ctype, sort_order: order++, is_section: true })
      .returning();
    let cidx = 0;
    for (const child of children) {
      await db
        .insert(categories)
        .values({ household_id: hh.id, parent_id: section.id, name: child, type: ctype, sort_order: cidx++ });
    }
  }

  await db
    .insert(accounts)
    .values({ household_id: hh.id, name: "Primary bank account", type: "bank", currency: opts.base_currency ?? "ZAR" });

  return {
    id: hh.id,
    name: hh.name,
    base_currency: hh.base_currency,
    country: hh.country,
    budget_cycle_day: hh.budget_cycle_day,
  };
}

// ── Calc input loading ────────────────────────────────────────────────────────
export async function loadLinesForCalc(db: DB, householdId: number, periodId: number): Promise<LineCalc[]> {
  const rows = await db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.period_id, periodId), eq(budgetLines.household_id, householdId)));
  if (rows.length === 0) return [];

  const catIds = [...new Set(rows.map((r) => r.category_id))];
  const cats = await db.select().from(categories).where(inArray(categories.id, catIds));
  const catById = new Map(cats.map((c) => [c.id, c]));

  const lineIds = rows.map((r) => r.id);
  const allocs = await db
    .select()
    .from(budgetLineAllocations)
    .where(inArray(budgetLineAllocations.line_id, lineIds));
  const allocByLine = new Map<number, typeof allocs>();
  for (const a of allocs) {
    const list = allocByLine.get(a.line_id) ?? [];
    list.push(a);
    allocByLine.set(a.line_id, list);
  }

  return rows.map((r) => {
    const cat = catById.get(r.category_id);
    return {
      category_type: cat?.type ?? "expense",
      planned_cents: r.planned_amount_cents,
      actual_cents: r.actual_amount_cents,
      owner_member_id: r.owner_member_id,
      category_id: r.category_id,
      category_name: cat?.name ?? null,
      is_transfer: false,
      allocations: (allocByLine.get(r.id) ?? []).map((a) => ({
        member_id: a.member_id,
        method: a.method as "fixed" | "percentage",
        amount_cents: a.amount_cents,
        percent_bp: a.percent_bp,
      })),
    };
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export async function recordAudit(
  db: DB,
  e: {
    action: string;
    entity_type: string;
    entity_id?: number | null;
    household_id?: number | null;
    actor_user_id?: number | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    household_id: e.household_id ?? null,
    actor_user_id: e.actor_user_id ?? null,
    action: e.action,
    entity_type: e.entity_type,
    entity_id: e.entity_id ?? null,
    detail_json: e.detail ?? {},
  });
}

// ── Budget operations ──────────────────────────────────────────────────────────
export async function duplicatePeriod(
  db: DB,
  householdId: number,
  source: typeof budgetPeriods.$inferSelect,
  opts: {
    label: string;
    start_date: string;
    end_date: string;
    copy_ad_hoc: boolean;
    // Optional guided adjustments (decimals, e.g. 0.06 = +6%), applied to planned
    // amounts on copy, scoped by category type. Undefined/0 leaves amounts unchanged.
    adjust?: { income_pct?: number; expense_pct?: number; savings_pct?: number };
  },
  actorUserId: number,
) {
  const [np] = await db
    .insert(budgetPeriods)
    .values({
      household_id: householdId,
      label: opts.label,
      start_date: opts.start_date,
      end_date: opts.end_date,
      status: "draft",
      source: "duplicate",
    })
    .returning();

  // Category types drive which adjustment (if any) applies to each line.
  const cats = await db.select().from(categories).where(eq(categories.household_id, householdId));
  const typeById = new Map(cats.map((c) => [c.id, c.type]));
  const adj = opts.adjust ?? {};
  const scaleFor = (categoryId: number, cents: number) => {
    const t = typeById.get(categoryId);
    let pct = 0;
    if (t === "income") pct = adj.income_pct ?? 0;
    else if (t === "saving" || t === "investment") pct = adj.savings_pct ?? 0;
    else pct = adj.expense_pct ?? 0;
    return pct ? Math.round(cents * (1 + pct)) : cents;
  };

  const src = await db.select().from(budgetLines).where(eq(budgetLines.period_id, source.id));
  let copied = 0;
  for (const line of src) {
    if (!line.is_recurring && !opts.copy_ad_hoc) continue;
    const [clone] = await db
      .insert(budgetLines)
      .values({
        period_id: np.id,
        household_id: householdId,
        category_id: line.category_id,
        item_name: line.item_name,
        owner_member_id: line.owner_member_id,
        payer_member_id: line.payer_member_id,
        beneficiary_member_id: line.beneficiary_member_id,
        planned_amount_cents: scaleFor(line.category_id, line.planned_amount_cents),
        actual_amount_cents: 0,
        due_day: line.due_day,
        due_note: line.due_note,
        recurrence: line.recurrence,
        payment_status: "planned",
        is_recurring: line.is_recurring,
        priority: line.priority,
        sort_order: line.sort_order,
        notes: line.notes,
      })
      .returning();
    const lineAllocs = await db
      .select()
      .from(budgetLineAllocations)
      .where(eq(budgetLineAllocations.line_id, line.id));
    for (const a of lineAllocs) {
      await db.insert(budgetLineAllocations).values({
        line_id: clone.id,
        member_id: a.member_id,
        method: a.method,
        amount_cents: a.amount_cents,
        percent_bp: a.percent_bp,
      });
    }
    copied++;
  }
  await recordAudit(db, {
    action: "budget_period.duplicate",
    entity_type: "budget_period",
    entity_id: np.id,
    household_id: householdId,
    actor_user_id: actorUserId,
    detail: { source_period_id: source.id, lines_copied: copied },
  });
  return np;
}

interface LineInput {
  category_id: number;
  item_name: string;
  owner_member_id?: number | null;
  planned_amount_cents?: number;
  actual_amount_cents?: number;
  due_day?: number | null;
  payment_status?: string;
  is_recurring?: boolean;
  priority?: number;
}

export async function applyBatch(
  db: DB,
  householdId: number,
  period: typeof budgetPeriods.$inferSelect,
  batch: { creates?: LineInput[]; updates?: Record<string, Partial<LineInput>>; deletes?: number[] },
  actorUserId: number,
) {
  if (!EDITABLE_STATUSES.has(period.status))
    throw new HttpError(409, `Period '${period.label}' is ${period.status}; unlock before editing.`);

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const c of batch.creates ?? []) {
    if (!c.item_name) continue;
    await db.insert(budgetLines).values({
      period_id: period.id,
      household_id: householdId,
      category_id: c.category_id,
      item_name: c.item_name,
      owner_member_id: c.owner_member_id ?? null,
      planned_amount_cents: c.planned_amount_cents ?? 0,
      actual_amount_cents: c.actual_amount_cents ?? 0,
      due_day: c.due_day ?? null,
      payment_status: c.payment_status ?? "planned",
      is_recurring: c.is_recurring ?? true,
      priority: c.priority ?? 3,
    });
    created++;
  }
  for (const [id, patch] of Object.entries(batch.updates ?? {})) {
    const lineId = Number(id);
    const existing = await db.query.budgetLines.findFirst({ where: eq(budgetLines.id, lineId) });
    if (!existing || existing.period_id !== period.id) throw new HttpError(404, `Line ${id} not in period`);
    await db.update(budgetLines).set(patch).where(eq(budgetLines.id, lineId));
    updated++;
  }
  for (const id of batch.deletes ?? []) {
    const existing = await db.query.budgetLines.findFirst({ where: eq(budgetLines.id, id) });
    if (existing && existing.period_id === period.id) {
      await db.delete(budgetLineAllocations).where(eq(budgetLineAllocations.line_id, id));
      await db.delete(budgetLines).where(eq(budgetLines.id, id));
      deleted++;
    }
  }
  await recordAudit(db, {
    action: "budget_lines.batch_save",
    entity_type: "budget_period",
    entity_id: period.id,
    household_id: householdId,
    actor_user_id: actorUserId,
    detail: { created, updated, deleted },
  });
  return { created, updated, deleted };
}
