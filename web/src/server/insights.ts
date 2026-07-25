/** Scenario engine + explainable rule-based copilot (LLM extension point). */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { accounts, properties } from "../db/schema";
import * as calc from "../lib/calc";
import { loadLinesForCalc } from "./services";

const ASSUMPTION_SCHEMA_VERSION = 1;

// Account-type buckets for the projection's starting balance sheet.
const CASH_TYPES = new Set(["bank", "cash", "savings_pocket"]);
const INVEST_TYPES = new Set(["investment"]);
const LIAB_TYPES = new Set(["loan", "credit_card"]);

// Sensible South-African defaults when the caller omits a global assumption.
export const SCENARIO_DEFAULTS = {
  horizon_months: 60,
  annual_inflation: 0.05,
  annual_income_growth: 0.05,
  annual_investment_return: 0.10,
  annual_cash_return: 0.04,
};
const LOW_SAVINGS_RATE = 0.1;
const OVERSPEND_PCT = 0.1;

const zar = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Metrics {
  total_income_cents: number;
  total_expenses_cents: number;
  net_position_cents: number;
  total_savings_cents: number;
  savings_rate: number;
}

export async function baselineMetrics(db: DB, householdId: number, periodId: number): Promise<Metrics> {
  const lines = await loadLinesForCalc(db, householdId, periodId);
  const p = calc.periodSummary(lines).planned;
  return {
    total_income_cents: p.total_income_cents,
    total_expenses_cents: p.total_expenses_cents,
    net_position_cents: p.net_position_cents,
    total_savings_cents: p.total_savings_cents,
    savings_rate: p.savings_rate,
  };
}

export function applyAssumptions(base: Metrics, a: Record<string, any>): Metrics {
  let income = Math.round(base.total_income_cents * (1 + (a.income_change_pct ?? 0)));
  let expenses = Math.round(base.total_expenses_cents * (1 + (a.expense_change_pct ?? 0)));
  let savings = base.total_savings_cents;

  income += Math.round(a.additional_income_cents ?? 0);
  expenses += Math.round(a.new_monthly_expense_cents ?? 0);

  const extra = Math.round(a.savings_increase_cents ?? 0);
  expenses += extra;
  savings += extra;

  if (a.new_property) {
    const np = a.new_property;
    const principal = Math.round(np.price_cents ?? 0) - Math.round(np.deposit_cents ?? 0);
    const repayment = calc.monthlyBondRepayment(principal, np.annual_rate ?? 0.115, np.term_months ?? 240);
    expenses += repayment;
    income += Math.round(np.rent_cents ?? 0);
  }

  const net = income - expenses;
  const rate = income > 0 ? Math.round((savings / income) * 1e6) / 1e6 : 0;
  return {
    total_income_cents: income,
    total_expenses_cents: expenses,
    net_position_cents: net,
    total_savings_cents: savings,
    savings_rate: rate,
  };
}

export async function runScenario(
  db: DB,
  householdId: number,
  basePeriodId: number | null,
  assumptions: Record<string, any>,
) {
  const base: Metrics = basePeriodId
    ? await baselineMetrics(db, householdId, basePeriodId)
    : { total_income_cents: 0, total_expenses_cents: 0, net_position_cents: 0, total_savings_cents: 0, savings_rate: 0 };
  const projected = applyAssumptions(base, assumptions ?? {});
  return {
    schema_version: ASSUMPTION_SCHEMA_VERSION,
    formula_version: calc.FORMULA_VERSION,
    baseline: base,
    projected,
    deltas: calc.scenarioDelta(base as any, projected as any),
  };
}

// ── Scenario v2: multi-year projection ───────────────────────────────────────
/** Assemble the projection's starting state from the base period + balance sheet. */
export async function scenarioStartState(db: DB, householdId: number, basePeriodId: number | null): Promise<calc.ScenarioStart> {
  let income = 0, expenseLiving = 0, contribution = 0;
  if (basePeriodId) {
    const s = calc.periodSummary(await loadLinesForCalc(db, householdId, basePeriodId)).planned;
    income = s.total_income_cents;
    contribution = s.total_savings_cents;              // savings/investment outflow (a subset of expenses)
    expenseLiving = s.total_expenses_cents - s.total_savings_cents; // pure living expenses
  }
  const accRows = await db.select().from(accounts).where(eq(accounts.household_id, householdId));
  const sumBy = (pred: (t: string) => boolean) => accRows.filter((a) => pred(a.type)).reduce((t, a) => t + a.current_balance_cents, 0);
  const propRows = await db.select().from(properties).where(eq(properties.household_id, householdId));
  const propertyEquity = propRows.reduce((t, pr) => t + calc.propertyEquity(pr.market_value_cents, pr.outstanding_bond_cents, pr.ownership_share_bp), 0);
  return {
    monthly_income_cents: income,
    monthly_expense_cents: expenseLiving,
    monthly_contribution_cents: contribution,
    cash_cents: sumBy((t) => CASH_TYPES.has(t)),
    investments_cents: sumBy((t) => INVEST_TYPES.has(t)),
    liabilities_cents: sumBy((t) => LIAB_TYPES.has(t)),
    other_net_worth_cents: propertyEquity,
  };
}

/** Is this an v2 (projection) assumption payload vs the legacy single-month one? */
export function isProjectionAssumptions(a: Record<string, any> | null | undefined): boolean {
  return !!a && (Array.isArray(a.events) || a.horizon_months != null || a.version === 2 || a.schema_version === 2);
}

export async function runScenarioV2(db: DB, householdId: number, basePeriodId: number | null, assumptions: Record<string, any>) {
  const start = await scenarioStartState(db, householdId, basePeriodId);
  const a: calc.ScenarioAssumptions = {
    horizon_months: Number(assumptions.horizon_months ?? SCENARIO_DEFAULTS.horizon_months),
    annual_inflation: numOr(assumptions.annual_inflation, SCENARIO_DEFAULTS.annual_inflation),
    annual_income_growth: numOr(assumptions.annual_income_growth, SCENARIO_DEFAULTS.annual_income_growth),
    annual_investment_return: numOr(assumptions.annual_investment_return, SCENARIO_DEFAULTS.annual_investment_return),
    annual_cash_return: numOr(assumptions.annual_cash_return, SCENARIO_DEFAULTS.annual_cash_return),
    events: Array.isArray(assumptions.events) ? assumptions.events.filter((e: any) => e && Number(e.month) >= 1) : [],
  };
  return calc.runProjection(start, a);
}

const numOr = (v: any, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Dispatch to the projection engine for v2 payloads, else the legacy engine. */
export async function runScenarioAny(db: DB, householdId: number, basePeriodId: number | null, assumptions: Record<string, any>) {
  return isProjectionAssumptions(assumptions)
    ? runScenarioV2(db, householdId, basePeriodId, assumptions)
    : runScenario(db, householdId, basePeriodId, assumptions);
}

// ── Insights ────────────────────────────────────────────────────────────────
export async function generatePeriodInsights(db: DB, householdId: number, periodId: number) {
  const lines = await loadLinesForCalc(db, householdId, periodId);
  const summary = calc.periodSummary(lines);
  const { planned, actual, variance } = summary;
  const out: {
    type: string;
    severity: string;
    summary: string;
    explanation: string;
    action: string;
    evidence: any;
  }[] = [];

  if (planned.net_position_cents < 0) {
    out.push({
      type: "negative_net_position",
      severity: "critical",
      summary: "Planned expenses exceed planned income this period.",
      explanation: `Planned income ${zar(planned.total_income_cents)} minus planned expenses ${zar(planned.total_expenses_cents)} = ${zar(planned.net_position_cents)}.`,
      action: "Reduce discretionary lines or defer savings to restore a surplus.",
      evidence: planned,
    });
  }
  if (planned.savings_rate < LOW_SAVINGS_RATE && planned.total_income_cents > 0) {
    out.push({
      type: "low_savings_rate",
      severity: "warning",
      summary: `Savings rate is ${(planned.savings_rate * 100).toFixed(1)}%, below the ${(LOW_SAVINGS_RATE * 100).toFixed(0)}% guideline.`,
      explanation: `Savings & investments ${zar(planned.total_savings_cents)} ÷ income ${zar(planned.total_income_cents)}.`,
      action: "Increase a retirement or investment contribution line.",
      evidence: { savings_rate: planned.savings_rate },
    });
  }
  const plannedCats = new Map(calc.categoryBreakdown(lines, "planned").map((c) => [c.category_id, c.amount_cents]));
  for (const c of calc.categoryBreakdown(lines, "actual")) {
    const p = plannedCats.get(c.category_id) ?? 0;
    if (p > 0 && c.amount_cents > p * (1 + OVERSPEND_PCT)) {
      const v = calc.lineVariance(p, c.amount_cents);
      out.push({
        type: "category_overspend",
        severity: "warning",
        summary: `${c.category_name} is over budget by ${zar(v.variance_cents)}.`,
        explanation: `Actual ${zar(c.amount_cents)} vs planned ${zar(p)} (${((v.variance_pct ?? 0) * 100).toFixed(1)}% over).`,
        action: `Review ${c.category_name} transactions for this period.`,
        evidence: v,
      });
    }
  }
  if (variance.expenses.variance_cents > 0 && actual.total_expenses_cents > 0) {
    out.push({
      type: "expenses_over_plan",
      severity: "info",
      summary: "Total actual spend is running above plan.",
      explanation: `Actual ${zar(actual.total_expenses_cents)} vs planned ${zar(planned.total_expenses_cents)}.`,
      action: "Check the largest over-budget categories.",
      evidence: variance.expenses,
    });
  }
  return out;
}

// ── Copilot ───────────────────────────────────────────────────────────────────
const INTENTS: Record<string, string[]> = {
  what_changed: ["what changed", "change this month", "difference"],
  over_budget: ["over budget", "overspend", "why are we over"],
  afford: ["can we afford", "afford", "should we buy"],
  savings_track: ["savings goal", "on track", "saving enough", "savings rate"],
  property_underperform: ["property underperform", "which property", "worst property"],
  windfall: ["bonus", "windfall", "lump sum", "what should we do with"],
  summary: ["summary", "how are we doing", "overview", "position"],
};

function matchIntent(q: string): string {
  const s = q.toLowerCase();
  for (const [intent, phrases] of Object.entries(INTENTS)) if (phrases.some((p) => s.includes(p))) return intent;
  return "summary";
}

export async function answerQuestion(db: DB, householdId: number, question: string, periodId: number | null) {
  const intent = matchIntent(question);
  if (periodId == null) {
    return { answer: "Tell me which budget period to analyse and I'll break it down.", citations: [], matched_intent: intent, provider: "rules" };
  }
  const lines = await loadLinesForCalc(db, householdId, periodId);
  const summary = calc.periodSummary(lines);
  const planned = summary.planned;
  const citations = [{ source: "calculation_engine", period_id: periodId, metrics: planned }];
  let answer: string;

  if (intent === "over_budget") {
    const top = summary.category_breakdown.slice(0, 3).map((c) => `${c.category_name} (${zar(c.amount_cents)})`).join(", ");
    answer = `Planned expenses total ${zar(planned.total_expenses_cents)} against income ${zar(planned.total_income_cents)}, leaving ${zar(planned.net_position_cents)}. Biggest categories: ${top}.`;
  } else if (intent === "savings_track") {
    answer = `Your savings rate this period is ${(planned.savings_rate * 100).toFixed(1)}% (${zar(planned.total_savings_cents)} of ${zar(planned.total_income_cents)} income). ${planned.savings_rate >= LOW_SAVINGS_RATE ? "That's at or above the 10% guideline." : "That's below the 10% guideline — consider lifting a contribution line."}`;
  } else if (intent === "afford") {
    const net = planned.net_position_cents;
    answer = `Your planned monthly surplus is ${zar(net)}. ${net > 0 ? "There is room to take on a new obligation within that surplus." : "There is no surplus to absorb a new obligation — model it as a scenario first."} Use the scenario simulator to test a specific amount.`;
  } else if (intent === "windfall") {
    answer = `Allocate a windfall by priority: (1) top up the emergency fund, (2) settle high-interest debt, (3) fund goals nearing their target, (4) invest the remainder. Create a bonus allocation under Goals to plan it, then check the effect against your surplus of ${zar(planned.net_position_cents)}.`;
  } else if (intent === "what_changed") {
    const v = summary.variance;
    answer = `Actual vs plan: income variance ${zar(v.income.variance_cents)}, expense variance ${zar(v.expenses.variance_cents)}, net variance ${zar(v.net.variance_cents)}.`;
  } else if (intent === "property_underperform") {
    answer = "Open the Property portfolio to see per-property monthly surplus/shortfall and yield; the property with the most negative monthly cash flow is the underperformer.";
  } else {
    answer = `Income ${zar(planned.total_income_cents)}, expenses ${zar(planned.total_expenses_cents)}, surplus ${zar(planned.net_position_cents)}, savings rate ${(planned.savings_rate * 100).toFixed(1)}%.`;
  }
  return { answer, citations, matched_intent: intent, provider: "rules" };
}
