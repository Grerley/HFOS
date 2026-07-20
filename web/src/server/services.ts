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
  goals,
  households,
  householdMembers,
  memberships,
} from "../db/schema";
import { contentHash } from "../lib/hash";
import type { LineCalc } from "../lib/calc";
import { titheAmount } from "../lib/calc";
import { CategoryType, derivePaymentFlags, EDITABLE_STATUSES, OUTFLOW_TYPES, Role } from "../lib/enums";
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
        // Re-derive the due date for the NEW period's month from the recurring day.
        due_date: deriveDueDate(np, line.due_day),
        // Carry the settlement configuration forward.
        payment_type: line.payment_type,
        ...derivePaymentFlags(line.payment_type),
        is_tithe: line.is_tithe,
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
  await recomputeTitheLines(db, householdId, np.id);
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
  payment_type?: string | null;
  is_tithe?: boolean;
  is_recurring?: boolean;
  priority?: number;
}

/**
 * Resolve a recurring "day of month" to the concrete ISO due date that falls
 * inside a period's window. `due_day` is the durable, carry-forward value;
 * `due_date` is derived per period so the settlement/Payments engine (which
 * keys off due_date) always reflects it. Handles month-aligned and cross-month
 * cycles, and clamps to the month length (e.g. day 31 in February → 28/29).
 */
export function deriveDueDate(
  period: { start_date: string; end_date: string },
  dueDay: number | null | undefined,
): string | null {
  if (dueDay == null || dueDay < 1 || dueDay > 31) return null;
  const [sy, sm] = period.start_date.split("-").map(Number);
  const candidate = (y: number, m: number) => {
    const daysInMonth = new Date(y, m, 0).getDate(); // m is 1-based here
    const day = Math.min(dueDay, daysInMonth);
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const inWindow = (d: string) => d >= period.start_date && d <= period.end_date;
  const first = candidate(sy, sm);
  if (inWindow(first)) return first;
  // Cross-month cycle (e.g. 25th→24th): the due day may land in the next month.
  const ny = sm === 12 ? sy + 1 : sy;
  const nm = sm === 12 ? 1 : sm + 1;
  const second = candidate(ny, nm);
  if (inWindow(second)) return second;
  return first; // fall back to the start-month occurrence
}

/**
 * One-off backfill so existing lines (created before due days existed) get due
 * dates without hand-editing each one:
 *   · SYNC — any line that already has a due_day gets its due_date (re)derived.
 *   · SEED — if defaultDueDay is given, payable (outflow) lines that have no due
 *     day are assigned it as a sensible starting point, then their date derived.
 * Income lines are never seeded (they aren't "due"). Locked periods are skipped.
 * Nothing is invented silently — seeding only happens when the caller opts in
 * with an explicit day, and every value stays editable afterwards.
 */
export async function backfillDueDates(db: DB, householdId: number, actorUserId: number, defaultDueDay?: number | null) {
  const lines = await db.select().from(budgetLines).where(eq(budgetLines.household_id, householdId));
  if (!lines.length) return { synced: 0, seeded: 0, skipped_locked: 0, total: 0 };

  const periods = await db.select().from(budgetPeriods).where(eq(budgetPeriods.household_id, householdId));
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const cats = await db.select().from(categories).where(eq(categories.household_id, householdId));
  const typeById = new Map(cats.map((c) => [c.id, c.type]));

  const seedDay = defaultDueDay != null && defaultDueDay >= 1 && defaultDueDay <= 31 ? defaultDueDay : null;
  let synced = 0, seeded = 0, skipped_locked = 0;

  for (const line of lines) {
    const period = periodById.get(line.period_id);
    if (!period) continue;
    if (!EDITABLE_STATUSES.has(period.status)) { skipped_locked++; continue; }

    if (line.due_day != null) {
      const due_date = deriveDueDate(period, line.due_day);
      if (due_date !== line.due_date) {
        await db.update(budgetLines).set({ due_date }).where(eq(budgetLines.id, line.id));
        synced++;
      }
    } else if (seedDay != null && OUTFLOW_TYPES.has(typeById.get(line.category_id) ?? "expense")) {
      await db.update(budgetLines).set({ due_day: seedDay, due_date: deriveDueDate(period, seedDay) }).where(eq(budgetLines.id, line.id));
      seeded++;
    }
  }

  await recordAudit(db, {
    action: "budget_lines.backfill_due_dates", entity_type: "household", entity_id: householdId,
    household_id: householdId, actor_user_id: actorUserId, detail: { synced, seeded, default_due_day: seedDay },
  });
  return { synced, seeded, skipped_locked, total: lines.length };
}

/**
 * Remove a household member cleanly: guard the last owner, null out every
 * owner/responsible reference so nothing is orphaned, drop the member's split
 * allocations, revoke their login membership, then delete the member row.
 */
export async function removeMember(db: DB, householdId: number, memberId: number, actorUserId: number) {
  const member = (await db.select().from(householdMembers).where(eq(householdMembers.id, memberId))).at(0);
  if (!member || member.household_id !== householdId) throw new HttpError(404, "Member not found");

  if (member.role === Role.OWNER) {
    const owners = await db.select().from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.role, Role.OWNER)));
    if (owners.length <= 1) throw new HttpError(409, "You can't remove the household's only owner.");
  }

  const inHh = eq(budgetLines.household_id, householdId);
  await db.update(budgetLines).set({ owner_member_id: null }).where(and(inHh, eq(budgetLines.owner_member_id, memberId)));
  await db.update(budgetLines).set({ payer_member_id: null }).where(and(inHh, eq(budgetLines.payer_member_id, memberId)));
  await db.update(budgetLines).set({ beneficiary_member_id: null }).where(and(inHh, eq(budgetLines.beneficiary_member_id, memberId)));
  await db.update(budgetLines).set({ responsible_member_id: null }).where(and(inHh, eq(budgetLines.responsible_member_id, memberId)));
  await db.delete(budgetLineAllocations).where(eq(budgetLineAllocations.member_id, memberId));
  await db.update(accounts).set({ owner_member_id: null }).where(and(eq(accounts.household_id, householdId), eq(accounts.owner_member_id, memberId)));
  await db.update(categories).set({ default_owner_member_id: null }).where(and(eq(categories.household_id, householdId), eq(categories.default_owner_member_id, memberId)));
  await db.update(goals).set({ owner_member_id: null }).where(and(eq(goals.household_id, householdId), eq(goals.owner_member_id, memberId)));

  // Revoke login access for this household (keep the user account for others).
  if (member.user_id) {
    await db.delete(memberships).where(and(eq(memberships.user_id, member.user_id), eq(memberships.household_id, householdId)));
  }
  await db.delete(householdMembers).where(eq(householdMembers.id, memberId));
  await recordAudit(db, {
    action: "member.removed", entity_type: "household_member", entity_id: memberId,
    household_id: householdId, actor_user_id: actorUserId, detail: { name: member.name, had_login: !!member.user_id },
  });
}

/**
 * Recompute every opt-in tithe line in a period as 10% of its owner member's
 * income (income lines owned by that member). Called after any period edit so
 * the tithe always tracks the latest income. Lines with no owner resolve to 0.
 */
export async function recomputeTitheLines(db: DB, householdId: number, periodId: number) {
  const lines = await db.select().from(budgetLines)
    .where(and(eq(budgetLines.period_id, periodId), eq(budgetLines.household_id, householdId)));
  const titheLines = lines.filter((l) => l.is_tithe);
  if (!titheLines.length) return;

  const catIds = [...new Set(lines.map((l) => l.category_id))];
  const cats = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : [];
  const typeById = new Map(cats.map((c) => [c.id, c.type]));

  const incomeByOwner = new Map<number, number>();
  for (const l of lines) {
    if (typeById.get(l.category_id) === CategoryType.INCOME && l.owner_member_id != null) {
      incomeByOwner.set(l.owner_member_id, (incomeByOwner.get(l.owner_member_id) ?? 0) + l.planned_amount_cents);
    }
  }
  for (const t of titheLines) {
    const income = t.owner_member_id != null ? incomeByOwner.get(t.owner_member_id) ?? 0 : 0;
    const amount = titheAmount(income);
    if (amount !== t.planned_amount_cents) {
      await db.update(budgetLines).set({ planned_amount_cents: amount }).where(eq(budgetLines.id, t.id));
    }
  }
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
      // Derive the concrete due date so Payments picks it up immediately.
      due_date: deriveDueDate(period, c.due_day),
      payment_status: c.payment_status ?? "planned",
      payment_type: c.payment_type ?? "manual",
      ...derivePaymentFlags(c.payment_type),
      is_tithe: c.is_tithe ?? false,
      is_recurring: c.is_recurring ?? true,
      priority: c.priority ?? 3,
    });
    created++;
  }
  for (const [id, patch] of Object.entries(batch.updates ?? {})) {
    const lineId = Number(id);
    const existing = await db.query.budgetLines.findFirst({ where: eq(budgetLines.id, lineId) });
    if (!existing || existing.period_id !== period.id) throw new HttpError(404, `Line ${id} not in period`);
    // When the due day / payment type changes, re-derive the linked fields so Payments stays in sync.
    const set: Record<string, unknown> = { ...patch };
    if ("due_day" in patch) set.due_date = deriveDueDate(period, patch.due_day);
    if ("payment_type" in patch) Object.assign(set, derivePaymentFlags(patch.payment_type));
    await db.update(budgetLines).set(set).where(eq(budgetLines.id, lineId));
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
  // Keep opt-in tithe lines in sync with the latest owner income.
  await recomputeTitheLines(db, householdId, period.id);
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
