/**
 * HFOS calculation engine — the single, deterministic source of all financial maths.
 * Faithful TypeScript port of backend/app/services/calculations.py.
 *
 * Rules: money is integer minor units (cents); ratios are numbers rounded to 6 dp.
 * Every formula is defined once here; UI and API never re-implement any of it.
 */
import { CategoryType, OUTFLOW_TYPES, SAVINGS_TYPES } from "./enums";

export const FORMULA_VERSION = "1.0.0";

export type Basis = "planned" | "actual";

export interface OwnerSplit {
  member_id: number;
  method?: "fixed" | "percentage";
  amount_cents?: number;
  percent_bp?: number;
}

export interface LineCalc {
  category_type: string;
  planned_cents?: number;
  actual_cents?: number;
  owner_member_id?: number | null;
  category_id?: number | null;
  category_name?: string | null;
  is_transfer?: boolean;
  allocations?: OwnerSplit[];
}

// Round a ratio to 6 decimal places (mirrors Python round(x, 6) for these magnitudes).
function round6(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

function amountOf(line: LineCalc, basis: Basis): number {
  return basis === "actual" ? line.actual_cents ?? 0 : line.planned_cents ?? 0;
}

const isIncome = (l: LineCalc) => l.category_type === CategoryType.INCOME && !l.is_transfer;
const isOutflow = (l: LineCalc) => OUTFLOW_TYPES.has(l.category_type) && !l.is_transfer;
const isSavings = (l: LineCalc) => SAVINGS_TYPES.has(l.category_type) && !l.is_transfer;

// ── Period totals ────────────────────────────────────────────────────────────
export function totalIncome(lines: LineCalc[], basis: Basis = "planned"): number {
  return lines.filter(isIncome).reduce((s, l) => s + amountOf(l, basis), 0);
}

export function totalExpenses(lines: LineCalc[], basis: Basis = "planned"): number {
  return lines.filter(isOutflow).reduce((s, l) => s + amountOf(l, basis), 0);
}

export function netPosition(lines: LineCalc[], basis: Basis = "planned"): number {
  return totalIncome(lines, basis) - totalExpenses(lines, basis);
}

export function totalSavings(lines: LineCalc[], basis: Basis = "planned"): number {
  return lines.filter(isSavings).reduce((s, l) => s + amountOf(l, basis), 0);
}

export function savingsRate(lines: LineCalc[], basis: Basis = "planned"): number {
  const income = totalIncome(lines, basis);
  if (income <= 0) return 0;
  return round6(totalSavings(lines, basis) / income);
}

// ── Owner-level ──────────────────────────────────────────────────────────────
export function ownerAllocation(line: LineCalc, basis: Basis = "planned"): Record<number, number> {
  const amount = amountOf(line, basis);
  if (line.allocations && line.allocations.length) {
    const out: Record<number, number> = {};
    let allocated = 0;
    for (const split of line.allocations) {
      const share =
        split.method === "percentage"
          ? Math.floor((amount * (split.percent_bp ?? 0)) / 10000)
          : split.amount_cents ?? 0;
      out[split.member_id] = (out[split.member_id] ?? 0) + share;
      allocated += share;
    }
    const remainder = amount - allocated;
    if (remainder) {
      const first = line.allocations[0].member_id;
      out[first] = (out[first] ?? 0) + remainder;
    }
    return out;
  }
  if (line.owner_member_id != null) return { [line.owner_member_id]: amount };
  return {};
}

export interface OwnerPosition {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
}

export function ownerPositions(
  lines: LineCalc[],
  basis: Basis = "planned",
): Record<number, OwnerPosition> {
  const result: Record<number, OwnerPosition> = {};
  const bucket = (id: number) =>
    (result[id] ??= { income_cents: 0, expense_cents: 0, net_cents: 0 });

  for (const line of lines) {
    if (isIncome(line)) {
      for (const [mid, amt] of Object.entries(ownerAllocation(line, basis))) {
        bucket(Number(mid)).income_cents += amt;
      }
    } else if (isOutflow(line)) {
      for (const [mid, amt] of Object.entries(ownerAllocation(line, basis))) {
        bucket(Number(mid)).expense_cents += amt;
      }
    }
  }
  for (const b of Object.values(result)) b.net_cents = b.income_cents - b.expense_cents;
  return result;
}

// ── Category breakdown ───────────────────────────────────────────────────────
export interface CategoryRow {
  category_id: number | null;
  category_name: string | null;
  amount_cents: number;
  pct_of_expenses: number;
}

export function categoryBreakdown(lines: LineCalc[], basis: Basis = "planned"): CategoryRow[] {
  const totals = new Map<string, { id: number | null; name: string | null; amount: number }>();
  for (const line of lines) {
    if (!isOutflow(line)) continue;
    const key = `${line.category_id}::${line.category_name}`;
    const cur = totals.get(key) ?? {
      id: line.category_id ?? null,
      name: line.category_name ?? null,
      amount: 0,
    };
    cur.amount += amountOf(line, basis);
    totals.set(key, cur);
  }
  const grand = totalExpenses(lines, basis);
  const rows: CategoryRow[] = [...totals.values()].map((t) => ({
    category_id: t.id,
    category_name: t.name,
    amount_cents: t.amount,
    pct_of_expenses: grand ? round6(t.amount / grand) : 0,
  }));
  rows.sort((a, b) => b.amount_cents - a.amount_cents);
  return rows;
}

// ── Variance ─────────────────────────────────────────────────────────────────
export interface Variance {
  planned_cents: number;
  actual_cents: number;
  variance_cents: number;
  variance_pct: number | null;
  remaining_cents: number;
}

export function lineVariance(plannedCents: number, actualCents: number): Variance {
  const variance = actualCents - plannedCents;
  return {
    planned_cents: plannedCents,
    actual_cents: actualCents,
    variance_cents: variance,
    variance_pct: plannedCents ? round6(variance / plannedCents) : null,
    remaining_cents: plannedCents - actualCents,
  };
}

export function periodVariance(lines: LineCalc[]) {
  return {
    income: lineVariance(totalIncome(lines, "planned"), totalIncome(lines, "actual")),
    expenses: lineVariance(totalExpenses(lines, "planned"), totalExpenses(lines, "actual")),
    net: {
      planned_cents: netPosition(lines, "planned"),
      actual_cents: netPosition(lines, "actual"),
      variance_cents: netPosition(lines, "actual") - netPosition(lines, "planned"),
    },
  };
}

// ── Property ─────────────────────────────────────────────────────────────────
export interface PropertyCashFlowInput {
  rent_cents?: number;
  bond_cents?: number;
  levies_cents?: number;
  rates_cents?: number;
  utilities_cents?: number;
  insurance_cents?: number;
  maintenance_cents?: number;
  agent_fees_cents?: number;
  vacancy_cents?: number;
  other_cents?: number;
}

export function propertyCosts(cf: PropertyCashFlowInput): number {
  return (
    (cf.bond_cents ?? 0) +
    (cf.levies_cents ?? 0) +
    (cf.rates_cents ?? 0) +
    (cf.utilities_cents ?? 0) +
    (cf.insurance_cents ?? 0) +
    (cf.maintenance_cents ?? 0) +
    (cf.agent_fees_cents ?? 0) +
    (cf.vacancy_cents ?? 0) +
    (cf.other_cents ?? 0)
  );
}

export function propertyCashFlow(cf: PropertyCashFlowInput) {
  const costs = propertyCosts(cf);
  const surplus = (cf.rent_cents ?? 0) - costs;
  return {
    rent_cents: cf.rent_cents ?? 0,
    total_costs_cents: costs,
    surplus_shortfall_cents: surplus,
    is_shortfall: surplus < 0,
  };
}

export function grossRentalYield(annualRentCents: number, marketValueCents: number): number {
  if (marketValueCents <= 0) return 0;
  return round6(annualRentCents / marketValueCents);
}

export function netRentalYield(annualNoiCents: number, marketValueCents: number): number {
  if (marketValueCents <= 0) return 0;
  return round6(annualNoiCents / marketValueCents);
}

export function loanToValue(outstandingBondCents: number, marketValueCents: number): number {
  if (marketValueCents <= 0) return 0;
  return round6(outstandingBondCents / marketValueCents);
}

export function propertyMetrics(
  cf: PropertyCashFlowInput,
  marketValueCents: number,
  outstandingBondCents: number,
) {
  const flow = propertyCashFlow(cf);
  const monthlyNoi = (cf.rent_cents ?? 0) - (propertyCosts(cf) - (cf.bond_cents ?? 0));
  return {
    ...flow,
    gross_yield: grossRentalYield((cf.rent_cents ?? 0) * 12, marketValueCents),
    net_yield: netRentalYield(monthlyNoi * 12, marketValueCents),
    loan_to_value: loanToValue(outstandingBondCents, marketValueCents),
    equity_cents: marketValueCents - outstandingBondCents,
  };
}

// ── Goals ────────────────────────────────────────────────────────────────────
export function goalMonthlyRequirement(
  targetCents: number,
  currentCents: number,
  monthsRemaining: number,
): number {
  const gap = Math.max(targetCents - currentCents, 0);
  if (monthsRemaining <= 0) return gap;
  return Math.ceil(gap / monthsRemaining);
}

export function goalProgress(targetCents: number, currentCents: number): number {
  if (targetCents <= 0) return 0;
  return round6(Math.min(currentCents / targetCents, 1));
}

// ── Receivables / weighted inflows ───────────────────────────────────────────
export function expectedValue(amountCents: number, probabilityBp: number): number {
  return Math.floor((amountCents * probabilityBp) / 10000);
}

// ── Bond / loan amortisation ─────────────────────────────────────────────────
export function monthlyBondRepayment(
  principalCents: number,
  annualRate: number,
  termMonths: number,
): number {
  if (termMonths <= 0) return principalCents;
  const r = annualRate / 12;
  if (r === 0) return Math.ceil(principalCents / termMonths);
  const factor = (r * (1 + r) ** termMonths) / ((1 + r) ** termMonths - 1);
  return Math.round(principalCents * factor);
}

// ── Net worth ────────────────────────────────────────────────────────────────
export function netWorth(assetBalancesCents: number[], liabilityBalancesCents: number[]): number {
  return (
    assetBalancesCents.reduce((s, b) => s + b, 0) -
    liabilityBalancesCents.reduce((s, b) => s + Math.abs(b), 0)
  );
}

// ── Scenario deltas ──────────────────────────────────────────────────────────
export function scenarioDelta(
  baseline: Record<string, number>,
  scenario: Record<string, number>,
) {
  const out: Record<string, { baseline: number; scenario: number; delta: number; delta_pct: number | null }> = {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(scenario)]);
  for (const key of keys) {
    const base = baseline[key] ?? 0;
    const scen = scenario[key] ?? 0;
    const delta = scen - base;
    out[key] = { baseline: base, scenario: scen, delta, delta_pct: base ? round6(delta / base) : null };
  }
  return out;
}

// ── Period summary (dashboard bundle) ────────────────────────────────────────
export function periodSummary(lines: LineCalc[]) {
  const totals = (basis: Basis) => ({
    total_income_cents: totalIncome(lines, basis),
    total_expenses_cents: totalExpenses(lines, basis),
    net_position_cents: netPosition(lines, basis),
    total_savings_cents: totalSavings(lines, basis),
    savings_rate: savingsRate(lines, basis),
  });
  return {
    formula_version: FORMULA_VERSION,
    planned: totals("planned"),
    actual: totals("actual"),
    variance: periodVariance(lines),
    category_breakdown: categoryBreakdown(lines, "planned"),
    owner_positions: ownerPositions(lines, "planned"),
  };
}
