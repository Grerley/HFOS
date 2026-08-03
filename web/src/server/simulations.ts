/**
 * Simulation service: turns a scenario's assumptions into engine results, and
 * computes the integrated household impact of a proposed monthly change.
 *
 * All maths lives in src/lib/simulate.ts and src/lib/calc.ts — this module only
 * marshals inputs, attaches explainability metadata, and reads (never mutates)
 * household state for the impact readout. Scenario isolation (BR-008): running a
 * simulation here does not touch budgets, goals or accounts.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, budgetPeriods, properties } from "../db/schema";
import * as calc from "../lib/calc";
import * as sim from "../lib/simulate";
import { loadLinesForCalc } from "./services";

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : d;
};

export type SimulationType = "investment" | "tax" | "asset";
export const SIMULATION_TYPES: SimulationType[] = ["investment", "tax", "asset"];

export interface ExplainItem {
  label: string;
  formula: string;
  assumptions: Record<string, unknown>;
  indicative: boolean;
}

export interface RunResult {
  type: SimulationType;
  detail: Record<string, unknown>;   // full result (schedules, series) for live UI
  summary: Record<string, unknown>;  // compact headline figures for storage + compare
  explain: ExplainItem[];
  warnings: string[];
  risk_rating: string | null;
  model_version: string;
}

// ── Investment & Savings ──────────────────────────────────────────────────────
function runInvestment(a: Record<string, unknown>): RunResult {
  const input: sim.InvestmentInput = {
    current_balance_cents: num(a.current_balance_cents),
    lump_sum_cents: num(a.lump_sum_cents),
    monthly_contribution_cents: num(a.monthly_contribution_cents),
    contribution_escalation: num(a.contribution_escalation),
    annual_return: num(a.annual_return, 0.10),
    annual_fees: num(a.annual_fees, 0.01),
    annual_inflation: num(a.annual_inflation, 0.05),
    months: num(a.months, 120),
    contribution_timing: a.contribution_timing === "begin" ? "begin" : "end",
    tax_rate_on_growth: num(a.tax_rate_on_growth),
  };
  // Risk profile can drive the return/volatility assumptions unless overridden.
  const riskProfile = (a.risk_profile as sim.RiskProfile) || null;
  if (riskProfile && a.annual_return == null) input.annual_return = sim.riskAssumptions(riskProfile).expected_return;

  const fv = sim.investmentFutureValue(input);
  const warnings: string[] = [];
  if (riskProfile) {
    const w = sim.riskHorizonWarning(riskProfile, input.months);
    if (w) warnings.push(w);
  }

  // Goal-seek block (only when a target is supplied).
  const target = num(a.target_amount_cents);
  const goal = target > 0 ? {
    required_monthly_contribution: sim.requiredMonthlyContribution(target, input),
    months_to_target: sim.monthsToTarget(target, input),
    required_annual_return: sim.requiredAnnualReturn(target, input),
    required_lump_sum: sim.requiredLumpSum(target, input),
    reached: fv.final_nominal_cents >= target,
    gap_cents: Math.max(target - fv.final_nominal_cents, 0),
  } : null;

  // Affordability (only when net income supplied).
  const netIncome = num(a.net_monthly_income_cents);
  const afford = netIncome > 0
    ? sim.affordabilityStatus(input.monthly_contribution_cents, netIncome)
    : null;

  const detail = { ...fv, goal, affordability: afford, target_amount_cents: target || null, risk_profile: riskProfile };
  const summary = {
    final_nominal_cents: fv.final_nominal_cents,
    final_real_cents: fv.final_real_cents,
    contributions_cents: fv.contributions_cents,
    net_return_cents: fv.net_return_cents,
    fees_cents: fv.fees_cents,
    months: fv.months,
    target_amount_cents: target || null,
    goal_reached: goal?.reached ?? null,
    required_monthly_contribution_cents: goal?.required_monthly_contribution.value ?? null,
    affordability_status: afford?.status ?? null,
    monthly_contribution_cents: input.monthly_contribution_cents,
  };
  const explain: ExplainItem[] = [
    {
      label: "Future value",
      formula: fv.formula,
      assumptions: {
        annual_return: input.annual_return, annual_fees: input.annual_fees,
        annual_inflation: input.annual_inflation, months: input.months,
        contribution_escalation: input.contribution_escalation, contribution_timing: input.contribution_timing,
      },
      indicative: true,
    },
    { label: "Real value", formula: "Real = Nominal ÷ (1+inflation)^years (BR-003)", assumptions: { annual_inflation: input.annual_inflation }, indicative: true },
  ];
  return { type: "investment", detail, summary, explain, warnings, risk_rating: riskProfile, model_version: sim.SIMULATE_VERSION };
}

// ── Tax ───────────────────────────────────────────────────────────────────────
function runTax(a: Record<string, unknown>): RunResult {
  const base: sim.TaxInput = {
    year: num(a.year, 2026),
    gross_annual_income_cents: num(a.gross_annual_income_cents),
    age: num(a.age, 35),
    medical_members: num(a.medical_members),
    ra_contribution_cents: num(a.ra_contribution_cents),
    other_deductions_cents: num(a.other_deductions_cents),
    donations_cents: num(a.donations_cents),
    paye_paid_cents: num(a.paye_paid_cents),
  };
  const opt: sim.TaxOptimisation = {
    additional_ra_cents: num(a.additional_ra_cents),
    additional_donation_cents: num(a.additional_donation_cents),
  };
  const cmp = sim.compareTax(base, opt);
  const table = sim.taxTable(base.year);
  const warnings: string[] = [];
  // Alerts (§4.13)
  if (cmp.straight.refund_or_due_cents < 0) warnings.push(`Projected shortfall of ${Math.abs(cmp.straight.refund_or_due_cents) / 100} — PAYE to date looks short of the full-year liability.`);
  const raCapRemaining = cmp.straight.ra_cap_cents - base.ra_contribution_cents;
  if (base.ra_contribution_cents + opt.additional_ra_cents > cmp.straight.ra_cap_cents)
    warnings.push(`Retirement contribution exceeds the deductible cap of ${cmp.straight.ra_cap_cents / 100}; the excess is not deductible this year.`);

  const detail = { ...cmp, tax_table: { year: table.year, version: table.version }, ra_cap_remaining_cents: raCapRemaining };
  const summary = {
    straight_tax_cents: cmp.straight.annual_tax_cents,
    optimised_tax_cents: cmp.optimised.annual_tax_cents,
    tax_saving_cents: cmp.tax_saving_cents,
    additional_cash_cents: cmp.additional_cash_cents,
    net_cash_cost_cents: cmp.net_cash_cost_cents,
    effective_rate: cmp.straight.effective_rate,
    marginal_rate: cmp.straight.marginal_rate,
    refund_or_due_cents: cmp.straight.refund_or_due_cents,
    monthly_net_income_cents: cmp.straight.monthly_net_income_cents,
    table_version: table.version,
  };
  const explain: ExplainItem[] = [
    { label: "Annual tax", formula: cmp.straight.formula, assumptions: { year: base.year, table_version: table.version }, indicative: true },
    { label: "Tax saving", formula: "Tax saving = Straight tax − Optimised tax; shown alongside the additional cash required (§4.9)", assumptions: { additional_ra_cents: opt.additional_ra_cents, additional_donation_cents: opt.additional_donation_cents }, indicative: true },
  ];
  return { type: "tax", detail, summary, explain, warnings, risk_rating: null, model_version: sim.SIMULATE_VERSION };
}

// ── Asset acquisition ─────────────────────────────────────────────────────────
function runAsset(a: Record<string, unknown>): RunResult {
  const price = num(a.purchase_price_cents);
  const deposit = num(a.deposit_cents);
  const costs = num(a.transaction_costs_cents);
  const financedCosts = a.finance_costs === false ? 0 : costs; // costs financed by default
  const financed = sim.financedAmount(price, deposit, financedCosts);
  const rate = num(a.annual_rate, 0.115);
  const months = num(a.repayment_months, 240);
  const balloon = num(a.balloon_cents);
  const monthlyFee = num(a.monthly_fee_cents);

  const baseInput: sim.AmortInput = { principal_cents: financed, annual_rate: rate, months, balloon_cents: balloon, monthly_fee_cents: monthlyFee };
  const base = sim.amortise(baseInput);

  // Optimised strategy
  const extraMonthly = num(a.extra_monthly_cents);
  const optDeposit = num(a.optimised_deposit_cents, deposit);
  const optTerm = num(a.optimised_months, months);
  const optRate = num(a.optimised_annual_rate, rate);
  const optFinanced = sim.financedAmount(price, optDeposit, financedCosts);
  const optInput: sim.AmortInput = {
    principal_cents: optFinanced, annual_rate: optRate, months: optTerm,
    balloon_cents: balloon, extra_monthly_cents: extraMonthly, monthly_fee_cents: monthlyFee,
  };
  const early = sim.earlyRepayment(baseInput, optInput);

  // Affordability + rate sensitivity (need net income)
  const netIncome = num(a.net_monthly_income_cents);
  const maxInstalment = num(a.max_instalment_cents);
  const maxDsr = num(a.max_dsr, 0.35);
  const affordability = maxInstalment > 0 ? sim.maxAffordable(maxInstalment, rate, months, deposit, balloon) : null;
  const sensitivity = sim.rateSensitivity(financed, rate, months, netIncome, maxDsr, balloon);
  const dsr = netIncome > 0 ? Math.round((base.monthly_instalment_cents + monthlyFee) / netIncome * 1e6) / 1e6 : null;
  const npv = sim.npvFinancingCost(base, num(a.discount_rate, 0.08));

  const detail = {
    purchase_price_cents: price, deposit_cents: deposit, transaction_costs_cents: costs, financed_amount_cents: financed,
    base, optimised: early, affordability, rate_sensitivity: sensitivity,
    debt_service_ratio: dsr, npv_financing_cost_cents: npv, loan_to_value: price > 0 ? Math.round(financed / price * 1e6) / 1e6 : 0,
    total_monthly_obligation_cents: base.monthly_instalment_cents + monthlyFee,
  };
  const summary = {
    purchase_price_cents: price,
    financed_amount_cents: financed,
    monthly_instalment_cents: base.monthly_instalment_cents,
    total_interest_cents: base.total_interest_cents,
    interest_saved_cents: early.interest_saved_cents,
    months_saved: early.months_saved,
    debt_service_ratio: dsr,
    max_affordable_price_cents: affordability?.max_price_cents ?? null,
    loan_to_value: price > 0 ? Math.round(financed / price * 1e6) / 1e6 : 0,
  };
  const explain: ExplainItem[] = [
    { label: "Monthly instalment", formula: "PMT = (PV − B·(1+r)⁻ⁿ)·r / (1 − (1+r)⁻ⁿ); r = annual rate ÷ 12", assumptions: { annual_rate: rate, months, balloon_cents: balloon }, indicative: false },
    { label: "Financed amount", formula: "Financed = Price + financed costs − Deposit (BR-006)", assumptions: { finance_costs: financedCosts > 0 }, indicative: false },
    { label: "Interest saved", formula: "Base total interest − optimised total interest, from the amortisation schedule (BR-007)", assumptions: { extra_monthly_cents: extraMonthly, optimised_deposit_cents: optDeposit, optimised_months: optTerm }, indicative: false },
  ];
  return { type: "asset", detail, summary, explain, warnings: [], risk_rating: null, model_version: sim.SIMULATE_VERSION };
}

/** Dispatch a simulation run by type. Throws on an unknown type. */
export function runSimulation(type: string, assumptions: Record<string, unknown>): RunResult {
  switch (type) {
    case "investment": return runInvestment(assumptions);
    case "tax": return runTax(assumptions);
    case "asset": return runAsset(assumptions);
    default: throw new Error(`Unknown simulation type: ${type}`);
  }
}

// ── Integrated household impact (§6, AC-008) ──────────────────────────────────
const NW_LIABILITY_TYPES = new Set(["loan", "credit_card"]);
const NW_IGNORE_TYPES = new Set(["bond"]);

/**
 * Read the household's current monthly position from its latest budget period +
 * balance sheet, then show how a proposed monthly cash change and/or one-off
 * cash outlay would affect surplus, savings rate, DSR and liquidity.
 * Read-only: it never alters the budget (BR-008).
 */
export async function householdImpact(
  db: DB, householdId: number,
  opts: { monthly_expense_delta_cents?: number; monthly_contribution_delta_cents?: number; one_off_cash_cents?: number; new_debt_cents?: number },
) {
  const period = (await db.select().from(budgetPeriods)
    .where(eq(budgetPeriods.household_id, householdId))
    .orderBy(desc(budgetPeriods.start_date)).limit(1)).at(0);

  let income = 0, expenses = 0, savings = 0;
  if (period) {
    const s = calc.periodSummary(await loadLinesForCalc(db, householdId, period.id)).planned;
    income = s.total_income_cents;
    expenses = s.total_expenses_cents; // includes savings/investment outflow
    savings = s.total_savings_cents;
  }

  const accRows = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
  const cash = accRows.filter((x) => !NW_LIABILITY_TYPES.has(x.type) && !NW_IGNORE_TYPES.has(x.type)).reduce((t, x) => t + x.current_balance_cents, 0);
  const accountLiabilities = accRows.filter((x) => NW_LIABILITY_TYPES.has(x.type)).reduce((t, x) => t + Math.abs(x.current_balance_cents), 0);
  const propRows = await db.select().from(properties).where(eq(properties.household_id, householdId));
  const propertyEquity = propRows.reduce((t, p) => t + calc.propertyEquity(p.market_value_cents, p.outstanding_bond_cents, p.ownership_share_bp ?? 10000), 0);
  const netWorth = cash - accountLiabilities + propertyEquity;

  const expDelta = opts.monthly_expense_delta_cents ?? 0;
  const contribDelta = opts.monthly_contribution_delta_cents ?? 0;
  const oneOff = opts.one_off_cash_cents ?? 0;
  const newDebt = opts.new_debt_cents ?? 0;

  const surplusBefore = income - expenses;
  const surplusAfter = income - (expenses + expDelta + contribDelta);
  const savingsRateBefore = income > 0 ? Math.round(savings / income * 1e6) / 1e6 : 0;
  const savingsRateAfter = income > 0 ? Math.round((savings + contribDelta) / income * 1e6) / 1e6 : 0;
  // DSR delta from this decision: the new monthly debt obligation ÷ income.
  const dsrAfter = income > 0 ? Math.round(expDelta / income * 1e6) / 1e6 : 0;
  void newDebt; // reserved: asset value offsets new debt once the asset is valued

  return {
    has_period: !!period,
    period_label: period?.label ?? null,
    monthly_income_cents: income,
    monthly_expenses_cents: expenses,
    surplus_before_cents: surplusBefore,
    surplus_after_cents: surplusAfter,
    savings_rate_before: savingsRateBefore,
    savings_rate_after: savingsRateAfter,
    debt_service_ratio_after: dsrAfter,
    liquidity_before_cents: cash,
    liquidity_after_cents: cash - oneOff,
    net_worth_before_cents: netWorth,
    net_worth_after_cents: netWorth - oneOff, // cash paid out; asset value not yet counted
    new_monthly_obligation_cents: expDelta + contribDelta,
    safe_to_spend_cents: Math.max(surplusAfter, 0),
    warning: surplusAfter < 0 ? "This decision pushes the monthly budget into deficit (BR-002)." : null,
  };
}
