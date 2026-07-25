import { describe, expect, it } from "vitest";
import { projectScenario, runProjection, monthlyRate, type ScenarioStart, type ScenarioAssumptions } from "../src/lib/calc";

const START: ScenarioStart = {
  monthly_income_cents: 10_000_00,   // R10,000.00
  monthly_expense_cents: 6_000_00,
  monthly_contribution_cents: 0,
  cash_cents: 0,
  investments_cents: 0,
  liabilities_cents: 0,
  other_net_worth_cents: 0,
};
const FLAT: ScenarioAssumptions = {
  horizon_months: 12, annual_inflation: 0, annual_income_growth: 0,
  annual_investment_return: 0, annual_cash_return: 0, events: [],
};

describe("projectScenario", () => {
  it("accumulates surplus to cash with no drift or events", () => {
    const p = projectScenario(START, FLAT);
    expect(p.months).toHaveLength(12);
    // R4,000 surplus/month × 12 → R48,000
    expect(p.months[11].cash_cents).toBe(4_000_00 * 12);
    expect(p.horizon_net_worth_cents).toBe(4_000_00 * 12);
    expect(p.runway_months).toBeNull();
    expect(p.ending_savings_rate).toBeCloseTo(0.4, 6);
  });

  it("routes contributions to investments and the rest to cash", () => {
    const p = projectScenario({ ...START, monthly_contribution_cents: 1_000_00 }, FLAT);
    expect(p.months[11].investments_cents).toBe(1_000_00 * 12);      // no return
    expect(p.months[11].cash_cents).toBe(3_000_00 * 12);             // surplus − contribution
    expect(p.total_contributions_cents).toBe(1_000_00 * 12);
    expect(p.horizon_net_worth_cents).toBe(4_000_00 * 12);           // conserved
  });

  it("compounds investment returns above raw contributions", () => {
    const p = projectScenario({ ...START, monthly_contribution_cents: 1_000_00 }, { ...FLAT, annual_investment_return: 0.12 });
    expect(p.months[11].investments_cents).toBeGreaterThan(1_000_00 * 12);
    expect(monthlyRate(0.12)).toBeGreaterThan(0);
  });

  it("detects runway when income collapses and cash drains", () => {
    const p = projectScenario(
      { ...START, monthly_income_cents: 5_000_00, monthly_expense_cents: 4_000_00, cash_cents: 10_000_00 },
      { ...FLAT, horizon_months: 6, events: [{ month: 1, kind: "income_delta", pct: -1 }] },
    );
    // cash: 10k → 6k → 2k → −2k at month 3
    expect(p.runway_months).toBe(3);
    expect(p.min_cash_cents).toBeLessThan(0);
  });

  it("applies inflation drift to expenses over time", () => {
    const p = projectScenario(START, { ...FLAT, annual_inflation: 0.12 });
    expect(p.months[11].expense_cents).toBeGreaterThan(START.monthly_expense_cents);
  });
});

describe("runProjection", () => {
  it("returns baseline + scenario and a net-worth delta at horizon", () => {
    const r = runProjection({ ...START, monthly_contribution_cents: 1_000_00 }, {
      ...FLAT, annual_investment_return: 0.10,
      events: [{ month: 1, kind: "lump_sum_invest", amount_cents: 5_000_00 }],
    });
    // Moving cash into investments that earn a return beats leaving it in 0%-cash.
    expect(r.summary.net_worth_delta_cents).toBeGreaterThan(0);
    expect(r.baseline.months).toHaveLength(12);
    expect(r.scenario.months).toHaveLength(12);
  });

  it("finds a break-even month for a cost-now / benefit-later decision", () => {
    const r = runProjection(
      { ...START, monthly_income_cents: 5_000_00, monthly_expense_cents: 3_000_00, cash_cents: 0, monthly_contribution_cents: 0 },
      {
        ...FLAT, horizon_months: 24,
        events: [
          { month: 1, kind: "one_off_expense", amount_cents: 12_000_00 }, // upfront cost
          { month: 1, kind: "recurring_income", amount_cents: 1_500_00 }, // ongoing benefit
        ],
      },
    );
    expect(r.summary.break_even_month).not.toBeNull();
    expect(r.summary.break_even_month!).toBeGreaterThan(1);
  });

  it("reports no break-even when the scenario never crosses baseline", () => {
    const r = runProjection(START, { ...FLAT, events: [{ month: 1, kind: "one_off_income", amount_cents: 1_000_00 }] });
    // Always ahead of baseline → never crosses.
    expect(r.summary.break_even_month).toBeNull();
    expect(r.summary.net_worth_delta_cents).toBe(1_000_00);
  });
});
