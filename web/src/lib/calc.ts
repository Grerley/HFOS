/**
 * HFOS calculation engine: the single, deterministic source of all financial maths.
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

/** Amount still to save to reach the target (never negative). */
export function goalRemainingCents(targetCents: number, currentCents: number): number {
  return Math.max(targetCents - currentCents, 0);
}

/**
 * Months to reach the target at a given planned monthly contribution.
 * 0 when already funded; null when it never completes (no positive contribution
 * while still short) so callers can render "no end date" rather than Infinity.
 */
export function goalMonthsToTarget(
  targetCents: number,
  currentCents: number,
  monthlyContributionCents: number,
): number | null {
  const gap = goalRemainingCents(targetCents, currentCents);
  if (gap <= 0) return 0;
  if (monthlyContributionCents <= 0) return null;
  return Math.ceil(gap / monthlyContributionCents);
}

/** How much the planned contribution falls short of what the deadline requires (never negative). */
export function goalMonthlyShortfall(monthlyRequiredCents: number, monthlyContributionCents: number): number {
  return Math.max(monthlyRequiredCents - monthlyContributionCents, 0);
}

/**
 * Pace assessment: is the goal on track to hit its target date at the current
 * planned contribution?
 *  - complete    already funded
 *  - unscheduled no target date, so pace can't be judged
 *  - overdue     target date has passed but it isn't funded
 *  - on_track    planned contribution ≥ what the deadline requires
 *  - behind      planned contribution < what the deadline requires
 */
export function goalPace(
  progress: number,
  hasTargetDate: boolean,
  monthsRemaining: number,
  monthlyContributionCents: number,
  monthlyRequiredCents: number,
): "complete" | "unscheduled" | "overdue" | "on_track" | "behind" {
  if (progress >= 1) return "complete";
  if (!hasTargetDate) return "unscheduled";
  if (monthsRemaining <= 0) return "overdue";
  return monthlyContributionCents >= monthlyRequiredCents ? "on_track" : "behind";
}

// ── Tithe ────────────────────────────────────────────────────────────────────
export const TITHE_RATE_BP = 1000; // 10% in basis points

/** Tithe = a share (default 10%) of an owner's income, rounded to the nearest cent. */
export function titheAmount(incomeCents: number, rateBp: number = TITHE_RATE_BP): number {
  if (incomeCents <= 0) return 0;
  return Math.round((incomeCents * rateBp) / 10000);
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

/** A household's share of a property's equity (market value − outstanding bond). */
export function propertyEquity(marketValueCents: number, outstandingBondCents: number, ownershipShareBp = 10000): number {
  return Math.round(((marketValueCents - outstandingBondCents) * ownershipShareBp) / 10000);
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

// ── Multi-year scenario projection ───────────────────────────────────────────
// A deterministic month-by-month projection of a household's finances. It takes a
// starting state (monthly flows + balances) and assumptions (drift + time-phased
// events) and returns the full trajectory plus headline outcomes. Pure and
// unit-tested; the UI mirrors it only for a live preview, but the server value wins.

/** Effective monthly rate from an annual rate (compounding): (1+a)^(1/12) − 1. */
export function monthlyRate(annual: number): number {
  if (!annual) return 0;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export interface ScenarioStart {
  monthly_income_cents: number;      // total income per month
  monthly_expense_cents: number;     // living expenses per month (excludes contributions)
  monthly_contribution_cents: number; // planned savings/investment routed to investments
  cash_cents: number;                // liquid assets today
  investments_cents: number;         // invested assets today
  liabilities_cents: number;         // debts today (loans, cards)
  other_net_worth_cents: number;     // e.g. current property equity, held unless events change it
}

export interface ScenarioEvent {
  month: number;             // 1-based month it applies / starts
  kind: string;              // see EVENT_KINDS below
  amount_cents?: number;
  pct?: number;              // fractional, e.g. -0.5 for −50%
  end_month?: number | null; // recurring streams: inclusive last month (null = to horizon)
  label?: string;
  // property_purchase / property_sale
  price_cents?: number;
  deposit_cents?: number;
  annual_rate?: number;
  term_months?: number;
  rent_cents?: number;
  clears_liability_cents?: number;
}

export const EVENT_KINDS = [
  "income_delta", "expense_delta", "contribution_delta",
  "one_off_income", "one_off_expense", "debt_extra_payment",
  "recurring_income", "recurring_expense",
  "lump_sum_invest", "property_purchase", "property_sale",
] as const;

export interface ScenarioAssumptions {
  horizon_months: number;
  annual_inflation: number;
  annual_income_growth: number;
  annual_investment_return: number;
  annual_cash_return: number;
  events: ScenarioEvent[];
}

export interface ScenarioMonth {
  month: number;
  income_cents: number;
  expense_cents: number;
  net_cashflow_cents: number;
  cash_cents: number;
  investments_cents: number;
  liabilities_cents: number;
  net_worth_cents: number;
}

export interface Projection {
  months: ScenarioMonth[];
  horizon_net_worth_cents: number;
  horizon_liquid_cents: number;       // cash + investments at horizon
  total_contributions_cents: number;
  min_cash_cents: number;
  runway_months: number | null;       // first month cash < 0 (null if it never does)
  ending_savings_rate: number;
}

const clampHorizon = (m: number) => Math.max(1, Math.min(Math.round(m || 12), 600));

/** Project a single trajectory. Deterministic; integer cents throughout. */
export function projectScenario(start: ScenarioStart, a: ScenarioAssumptions): Projection {
  const H = clampHorizon(a.horizon_months);
  const infM = monthlyRate(a.annual_inflation ?? 0);
  const incGM = monthlyRate(a.annual_income_growth ?? 0);
  const invM = monthlyRate(a.annual_investment_return ?? 0);
  const cashM = monthlyRate(a.annual_cash_return ?? 0);
  const events = (a.events ?? []).filter((e) => e && e.month >= 1);

  let income = start.monthly_income_cents;
  let expense = start.monthly_expense_cents;
  let contribution = start.monthly_contribution_cents;
  let cash = start.cash_cents;
  let investments = start.investments_cents;
  let liabilities = start.liabilities_cents;
  let assetsExtra = 0; // property/other assets acquired via events

  const months: ScenarioMonth[] = [];
  let totalContrib = 0;
  let minCash = cash;
  let runway: number | null = null;

  for (let m = 1; m <= H; m++) {
    // 1) organic drift on the base streams (compounding from month 2 on)
    if (m > 1) {
      income = Math.round(income * (1 + incGM));
      expense = Math.round(expense * (1 + infM));
    }
    // 2) point events at exactly month m (permanent deltas, one-offs, property)
    for (const e of events) {
      if (e.month !== m) continue;
      const amt = Math.round(e.amount_cents ?? 0);
      switch (e.kind) {
        case "income_delta": income = Math.round(income * (1 + (e.pct ?? 0))) + amt; break;
        case "expense_delta": expense = Math.max(0, Math.round(expense * (1 + (e.pct ?? 0))) + amt); break;
        case "contribution_delta": contribution = Math.max(0, contribution + amt); break;
        case "one_off_income": cash += amt; break;
        case "one_off_expense": cash -= amt; break;
        case "debt_extra_payment": cash -= amt; liabilities = Math.max(0, liabilities - amt); break;
        case "lump_sum_invest": cash -= amt; investments += amt; break;
        case "property_purchase": {
          const price = Math.round(e.price_cents ?? 0);
          const dep = Math.round(e.deposit_cents ?? 0);
          cash -= dep + amt; // amount_cents = transfer/transaction costs, if any
          liabilities += Math.max(0, price - dep);
          assetsExtra += price;
          break;
        }
        case "property_sale": {
          cash += Math.round(e.price_cents ?? e.amount_cents ?? 0); // net proceeds
          liabilities = Math.max(0, liabilities - Math.round(e.clears_liability_cents ?? 0));
          assetsExtra = Math.max(0, assetsExtra - Math.round(e.price_cents ?? 0));
          break;
        }
      }
    }
    // 3) recurring streams active this month (inclusive window; property adds bond+rent)
    let recIncome = 0, recExpense = 0;
    for (const e of events) {
      const started = m >= e.month;
      const withinEnd = e.end_month == null || m <= e.end_month;
      if (e.kind === "recurring_income" && started && withinEnd) recIncome += Math.round(e.amount_cents ?? 0);
      if (e.kind === "recurring_expense" && started && withinEnd) recExpense += Math.round(e.amount_cents ?? 0);
      if (e.kind === "property_purchase" && started) {
        const loan = Math.max(0, Math.round(e.price_cents ?? 0) - Math.round(e.deposit_cents ?? 0));
        recExpense += monthlyBondRepayment(loan, e.annual_rate ?? 0.115, e.term_months ?? 240);
        recIncome += Math.round(e.rent_cents ?? 0);
      }
    }

    const monthIncome = income + recIncome;
    const monthExpense = expense + recExpense;
    const netCashflow = monthIncome - monthExpense;
    // Route contribution to investments; the remainder (can be negative) to cash.
    const freeCF = netCashflow - contribution;
    cash += freeCF;
    investments += contribution;
    totalContrib += contribution;

    // 4) growth on balances (cash only earns when positive)
    investments = Math.round(investments * (1 + invM));
    if (cash > 0) cash = Math.round(cash * (1 + cashM));

    if (cash < minCash) minCash = cash;
    if (runway == null && cash < 0) runway = m;

    const netWorth = cash + investments + assetsExtra + start.other_net_worth_cents - liabilities;
    months.push({
      month: m,
      income_cents: monthIncome,
      expense_cents: monthExpense,
      net_cashflow_cents: netCashflow,
      cash_cents: cash,
      investments_cents: investments,
      liabilities_cents: liabilities,
      net_worth_cents: netWorth,
    });
  }

  const last = months[months.length - 1];
  return {
    months,
    horizon_net_worth_cents: last.net_worth_cents,
    horizon_liquid_cents: last.cash_cents + last.investments_cents,
    total_contributions_cents: totalContrib,
    min_cash_cents: minCash,
    runway_months: runway,
    ending_savings_rate: last.income_cents > 0 ? round6(last.net_cashflow_cents / last.income_cents) : 0,
  };
}

/**
 * Run a scenario against its do-nothing baseline (same start & drift, no events)
 * and return both trajectories plus the headline comparison, including the
 * break-even month where the scenario's net worth crosses the baseline's.
 */
export function runProjection(start: ScenarioStart, a: ScenarioAssumptions) {
  const scenario = projectScenario(start, a);
  const baseline = projectScenario(start, { ...a, events: [] });

  // Break-even: first month the sign of (scenario − baseline) net worth flips
  // from its month-1 sign (a cost-now/benefit-later decision crossing over).
  let breakEven: number | null = null;
  const diff0 = scenario.months[0].net_worth_cents - baseline.months[0].net_worth_cents;
  const sign0 = Math.sign(diff0);
  if (sign0 !== 0) {
    for (let i = 1; i < scenario.months.length; i++) {
      const d = scenario.months[i].net_worth_cents - baseline.months[i].net_worth_cents;
      if (Math.sign(d) !== 0 && Math.sign(d) !== sign0) { breakEven = scenario.months[i].month; break; }
    }
  }

  return {
    schema_version: 2,
    formula_version: FORMULA_VERSION,
    horizon_months: scenario.months.length,
    start,
    assumptions: a,
    baseline,
    scenario,
    summary: {
      horizon_net_worth_cents: scenario.horizon_net_worth_cents,
      baseline_net_worth_cents: baseline.horizon_net_worth_cents,
      net_worth_delta_cents: scenario.horizon_net_worth_cents - baseline.horizon_net_worth_cents,
      horizon_liquid_cents: scenario.horizon_liquid_cents,
      total_contributions_cents: scenario.total_contributions_cents,
      min_cash_cents: scenario.min_cash_cents,
      runway_months: scenario.runway_months,
      ending_savings_rate: scenario.ending_savings_rate,
      break_even_month: breakEven,
    },
  };
}

// ── Payment settlement engine ────────────────────────────────────────────────
export interface PaymentRec {
  amount_cents: number;
  is_reversal?: boolean;
  deleted?: boolean;
}

export type PaymentStatus =
  | "not_paid"
  | "partially_paid"
  | "fully_paid"
  | "overpaid"
  | "overdue"
  | "scheduled"
  | "cancelled"
  | "not_applicable";

/** Total paid = sum of active records, with reversals subtracting (BR-003). */
export function paidAmount(records: PaymentRec[]): number {
  return records
    .filter((r) => !r.deleted)
    .reduce((s, r) => s + (r.is_reversal ? -r.amount_cents : r.amount_cents), 0);
}

export interface Settlement {
  planned_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  overpaid_cents: number;
  status: PaymentStatus;
  is_overdue: boolean;
}

/**
 * Derive the settlement position for one expense line (BR-001, BR-002, BR-010).
 * `today` and `dueDate` are ISO dates (YYYY-MM-DD); string comparison is date-correct.
 * `manualStatus` overrides derivation for cancelled | not_applicable | scheduled.
 */
export function settlement(
  plannedCents: number,
  paidCents: number,
  opts: { dueDate?: string | null; today?: string | null; manualStatus?: string | null } = {},
): Settlement {
  const outstanding = Math.max(plannedCents - paidCents, 0); // BR-002: never negative
  const overpaid = Math.max(paidCents - plannedCents, 0);
  const ms = opts.manualStatus;
  const overridden = ms === "cancelled" || ms === "not_applicable" || ms === "scheduled";
  const duePassed = !!(opts.dueDate && opts.today && opts.dueDate < opts.today);

  let status: PaymentStatus;
  if (overridden) status = ms as PaymentStatus;
  else if (paidCents <= 0) status = duePassed ? "overdue" : "not_paid";
  else if (paidCents < plannedCents) status = "partially_paid";
  else if (paidCents === plannedCents) status = "fully_paid";
  else status = "overpaid";

  const is_overdue = !overridden && outstanding > 0 && duePassed;
  return { planned_cents: plannedCents, paid_cents: paidCents, outstanding_cents: outstanding, overpaid_cents: overpaid, status, is_overdue };
}

// ── Cash flow projection ─────────────────────────────────────────────────────
export interface CashEvent {
  date: string; // ISO date
  amount_cents: number; // signed: inflow > 0, outflow < 0
  label?: string;
  kind?: "inflow" | "outflow";
}

export interface CashPoint extends CashEvent {
  balance_cents: number;
}

/**
 * Build a running-balance timeline from an opening balance and dated cash events.
 * Events are summed in date order; each point carries the balance after that event.
 */
export function cashTimeline(openingCents: number, events: CashEvent[]) {
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let bal = openingCents;
  const points: CashPoint[] = sorted.map((e) => {
    bal += e.amount_cents;
    return { ...e, balance_cents: bal };
  });
  return { opening_cents: openingCents, closing_cents: bal, points };
}

/** Lowest balance reached across a timeline (the cash-runway trough), incl. the opening. */
export function lowestBalance(openingCents: number, points: CashPoint[]) {
  let lowest_cents = openingCents;
  let date: string | null = null;
  for (const p of points) {
    if (p.balance_cents < lowest_cents) {
      lowest_cents = p.balance_cents;
      date = p.date;
    }
  }
  return { lowest_cents, date, dips_negative: lowest_cents < 0 };
}

/** Project a balance forward N months at a fixed monthly net run-rate. */
export function forwardProjection(startCents: number, monthlyNetCents: number, months: number) {
  const out: { month_index: number; balance_cents: number }[] = [];
  let bal = startCents;
  for (let i = 1; i <= months; i++) {
    bal += monthlyNetCents;
    out.push({ month_index: i, balance_cents: bal });
  }
  return out;
}

/**
 * Whole months a positive balance lasts at a monthly deficit.
 * Returns null when the run-rate is non-negative (never depletes).
 */
export function runwayMonths(balanceCents: number, monthlyNetCents: number): number | null {
  if (monthlyNetCents >= 0) return null;
  if (balanceCents <= 0) return 0;
  return Math.floor(balanceCents / -monthlyNetCents);
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
