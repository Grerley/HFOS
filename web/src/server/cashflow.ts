/**
 * Cash-flow forecast service: turns the current period's obligations and income
 * into a dated timeline, a cash-runway trough, and a forward run-rate projection.
 *
 * Modelling is explainable and conservative:
 *  · Opening = today's liquid account balances (what's actually in the bank now).
 *  · Remaining outflows = each line's OUTSTANDING amount (from the settlement engine),
 *    placed on its due date (overdue / undated fall on "today").
 *  · Remaining inflows = income lines not yet received this month, placed on their
 *    due date (undated income falls on the period start, or today if that has passed).
 *  · Forward months extend the closing balance at the period's planned net run-rate.
 * All money maths is delegated to the calc engine; this file only shapes inputs.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, budgetLines, budgetPeriods, categories } from "../db/schema";
import * as calc from "../lib/calc";
import { CategoryType, OUTFLOW_TYPES } from "../lib/enums";
import { periodSettlement, todayISO } from "./payments";

// Liquid = spendable now. Liabilities and long-horizon assets are excluded from runway.
const LIABILITY_TYPES = new Set(["loan", "credit_card", "bond"]);
const ILLIQUID_ASSET_TYPES = new Set(["investment", "retirement", "pension", "property", "ra", "tfsa"]);
const isLiquid = (type: string) => !LIABILITY_TYPES.has(type) && !ILLIQUID_ASSET_TYPES.has(type);

const clampToToday = (date: string, today: string) => (date < today ? today : date);

export async function cashFlowForecast(db: DB, householdId: number, periodId: number, months = 12) {
  const period = (await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, periodId))).at(0)!;
  const today = todayISO();

  // Opening liquid balance.
  const accRows = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
  const liquid = accRows.filter((a) => a.is_active && isLiquid(a.type));
  const opening_cents = liquid.reduce((s, a) => s + a.current_balance_cents, 0);

  // Outflow events from the settlement engine (outstanding only).
  const settle = await periodSettlement(db, householdId, periodId);
  const events: calc.CashEvent[] = [];
  for (const l of settle.lines) {
    if (l.outstanding_cents <= 0) continue;
    if (l.status === "cancelled" || l.status === "not_applicable") continue;
    events.push({
      date: clampToToday(l.due_date ?? period.end_date, today),
      amount_cents: -l.outstanding_cents,
      label: l.item_name,
      kind: "outflow",
    });
  }

  // Inflow events from income lines (planned, treated as still-to-be-received this month).
  const lines = await db
    .select()
    .from(budgetLines)
    .where(and(eq(budgetLines.period_id, periodId), eq(budgetLines.household_id, householdId)));
  const catIds = [...new Set(lines.map((l) => l.category_id))];
  const cats = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : [];
  const typeById = new Map(cats.map((c) => [c.id, c.type]));
  for (const l of lines) {
    if (typeById.get(l.category_id) !== CategoryType.INCOME) continue;
    if (l.planned_amount_cents <= 0) continue;
    events.push({
      date: clampToToday(l.due_date ?? period.start_date, today),
      amount_cents: l.planned_amount_cents,
      label: l.item_name,
      kind: "inflow",
    });
  }

  const timeline = calc.cashTimeline(opening_cents, events);
  const trough = calc.lowestBalance(opening_cents, timeline.points);

  // Forward run-rate = this period's planned net position (income − outflows).
  const linesForCalc = lines.map((l) => ({
    category_type: typeById.get(l.category_id) ?? "expense",
    planned_cents: l.planned_amount_cents,
    actual_cents: l.actual_amount_cents,
  }));
  const monthly_net_cents = calc.netPosition(linesForCalc, "planned");
  const forward = calc.forwardProjection(timeline.closing_cents, monthly_net_cents, months);
  const runway_months = calc.runwayMonths(timeline.closing_cents, monthly_net_cents);

  const inflow_total_cents = events.filter((e) => e.amount_cents > 0).reduce((s, e) => s + e.amount_cents, 0);
  const outflow_total_cents = events.filter((e) => e.amount_cents < 0).reduce((s, e) => s - e.amount_cents, 0);

  return {
    has_period: true,
    period: { id: period.id, label: period.label, start_date: period.start_date, end_date: period.end_date },
    today,
    opening_cents,
    closing_cents: timeline.closing_cents,
    liquid_accounts: liquid.map((a) => ({ id: a.id, name: a.name, type: a.type, balance_cents: a.current_balance_cents })),
    inflow_total_cents,
    outflow_total_cents,
    monthly_net_cents,
    runway_months,
    lowest: trough,
    timeline: timeline.points,
    forward,
  };
}
