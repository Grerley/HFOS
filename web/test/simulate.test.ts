// Simulation engine tests. Where possible each assertion is an independent
// formula check or a cross-check against the already-tested calc.ts, not a pin
// of whatever the engine happens to emit. Maps to acceptance criteria AC-001..010
// and business rules BR-003/006/007.
import { describe, expect, it } from "vitest";
import * as sim from "../src/lib/simulate";
import { monthlyBondRepayment } from "../src/lib/calc";

describe("real returns (BR-003)", () => {
  it("derives real from nominal and inflation", () => {
    // (1.10 / 1.05) − 1 = 0.047619…
    expect(sim.realReturn(0.10, 0.05)).toBe(0.047619);
  });
  it("real value deflates a future nominal amount", () => {
    // R100 in 1 year at 10% inflation ≈ R90.91
    expect(sim.realValue(10000, 0.10, 1)).toBe(9091);
  });
});

describe("investment future value (AC-001)", () => {
  it("with zero return, final = principal + contributions and no growth/fees", () => {
    const r = sim.investmentFutureValue({
      current_balance_cents: 100000, lump_sum_cents: 50000, monthly_contribution_cents: 10000,
      annual_return: 0, annual_fees: 0, months: 24,
    });
    expect(r.principal_cents).toBe(150000);
    expect(r.contributions_cents).toBe(240000);
    expect(r.final_nominal_cents).toBe(390000);
    expect(r.gross_return_cents).toBe(0);
    expect(r.fees_cents).toBe(0);
  });

  it("compounds a lump sum to the annual rate over 12 months (no fees)", () => {
    const r = sim.investmentFutureValue({
      current_balance_cents: 1_000_000, monthly_contribution_cents: 0,
      annual_return: 0.12, annual_fees: 0, months: 12,
    });
    // monthlyRate compounds exactly back to the annual rate; allow ±R1 for rounding.
    expect(Math.abs(r.final_nominal_cents - 1_120_000)).toBeLessThanOrEqual(100);
  });

  it("separately discloses contributions and growth (identity holds)", () => {
    const r = sim.investmentFutureValue({
      current_balance_cents: 500000, monthly_contribution_cents: 20000,
      annual_return: 0.10, annual_fees: 0.01, months: 60,
    });
    expect(r.final_nominal_cents).toBe(r.principal_cents + r.contributions_cents + r.net_return_cents);
    expect(r.net_return_cents).toBe(r.gross_return_cents - r.fees_cents - r.tax_cents);
    expect(r.final_real_cents).toBeLessThan(r.final_nominal_cents); // inflation erodes value
    expect(r.series).toHaveLength(60);
  });
});

describe("goal-seeking (AC-002)", () => {
  it("solves the monthly contribution to reach a target", () => {
    const target = 5_000_000;
    const inputs = { current_balance_cents: 200000, annual_return: 0.09, annual_fees: 0.005, months: 120, annual_inflation: 0.05 };
    const res = sim.requiredMonthlyContribution(target, inputs);
    expect(res.feasible).toBe(true);
    // Plugging the solved contribution back in must reach (≈) the target.
    const check = sim.investmentFutureValue({ ...inputs, monthly_contribution_cents: res.value! });
    expect(check.final_nominal_cents).toBeGreaterThanOrEqual(target - 5000);
  });
  it("flags an implausible required return", () => {
    const res = sim.requiredAnnualReturn(100_000_000, { current_balance_cents: 100000, monthly_contribution_cents: 10000, months: 24 });
    expect(res.feasible).toBe(false);
  });
  it("reports months to target as finite when funded by contributions", () => {
    const res = sim.monthsToTarget(1_000_000, { current_balance_cents: 0, monthly_contribution_cents: 50000, annual_return: 0.08, months: 1200 });
    expect(res.value).not.toBeNull();
    expect(res.value!).toBeGreaterThan(0);
  });
});

describe("emergency fund (§3.9)", () => {
  it("computes required reserve, gap and months of cover", () => {
    const r = sim.emergencyFund({ essential_monthly_cents: 300000, months_cover: 6, current_cents: 600000, monthly_contribution_cents: 100000 });
    expect(r.required_cents).toBe(1_800_000);
    expect(r.gap_cents).toBe(1_200_000);
    expect(r.months_of_cover_now).toBe(2);
    expect(r.months_to_close).toBe(12);
  });
});

describe("risk mapping (§3.4)", () => {
  it("warns when a high-risk profile is used for a short horizon", () => {
    expect(sim.riskHorizonWarning("high", 24)).not.toBeNull();
    expect(sim.riskHorizonWarning("low", 24)).toBeNull();
  });
});

describe("SA tax (AC-003, AC-004)", () => {
  it("computes annual tax for R500,000 taxable, below 65, no medical (2025)", () => {
    const r = sim.computeTax({
      year: 2025, gross_annual_income_cents: 50_000_000, age: 40, medical_members: 0,
      ra_contribution_cents: 0, other_deductions_cents: 0, donations_cents: 0, paye_paid_cents: 0,
    });
    expect(r.taxable_income_cents).toBe(50_000_000);
    expect(r.annual_tax_cents).toBe(10_027_200); // R100,272.00
    expect(r.marginal_rate).toBe(0.31);
    expect(r.effective_rate).toBe(0.200544);
  });

  it("shows tax saving AND the additional cash for an RA top-up (AC-004)", () => {
    const base = {
      year: 2025, gross_annual_income_cents: 50_000_000, age: 40, medical_members: 0,
      ra_contribution_cents: 0, other_deductions_cents: 0, donations_cents: 0, paye_paid_cents: 0,
    };
    const cmp = sim.compareTax(base, { additional_ra_cents: 5_000_000, additional_donation_cents: 0 });
    expect(cmp.tax_saving_cents).toBe(1_550_000);       // R15,500 saved
    expect(cmp.additional_cash_cents).toBe(5_000_000);  // R50,000 contributed
    expect(cmp.net_cash_cost_cents).toBe(3_450_000);
    expect(cmp.effective_deduction_return).toBe(0.31);  // saving ÷ cash = marginal rate
  });

  it("medical credits reduce tax and applies age rebates", () => {
    const r = sim.computeTax({
      year: 2025, gross_annual_income_cents: 50_000_000, age: 67, medical_members: 2,
      ra_contribution_cents: 0, other_deductions_cents: 0, donations_cents: 0, paye_paid_cents: 0,
    });
    // primary + secondary rebate, plus 2-member medical credit (364+364)*12.
    expect(r.rebates_cents).toBe(1_723_500 + 944_400);
    expect(r.medical_credits_cents).toBe((36_400 + 36_400) * 12);
  });

  it("rejects an unsupported tax year (BR-004)", () => {
    expect(() => sim.computeTax({ year: 1999, gross_annual_income_cents: 1, age: 30, medical_members: 0, ra_contribution_cents: 0, other_deductions_cents: 0, donations_cents: 0, paye_paid_cents: 0 })).toThrow();
  });
});

describe("asset financing (AC-005, BR-006, BR-007)", () => {
  it("financed amount = price + costs − deposit (BR-006)", () => {
    expect(sim.financedAmount(100_000_000, 20_000_000, 5_000_000)).toBe(85_000_000);
  });

  it("instalment matches the independently-tested bond formula", () => {
    const P = 85_000_000, rate = 0.115, n = 240;
    expect(sim.instalment(P, rate, n, 0)).toBe(monthlyBondRepayment(P, rate, n));
  });

  it("amortises to (near) zero — outstanding comes from the schedule (BR-007)", () => {
    const r = sim.amortise({ principal_cents: 85_000_000, annual_rate: 0.115, months: 240 });
    expect(r.schedule.at(-1)!.balance_cents).toBe(0);
    expect(r.months_to_payoff).toBe(240);
    expect(r.total_interest_cents).toBeGreaterThan(0);
  });

  it("honours a balloon/residual", () => {
    const balloon = 20_000_000;
    const r = sim.amortise({ principal_cents: 60_000_000, annual_rate: 0.12, months: 72, balloon_cents: balloon });
    // Before the final clearing payment the balance tracks down toward the balloon.
    expect(r.schedule[70].balance_cents).toBeGreaterThan(balloon - 1_000_000);
  });
});

describe("early repayment (AC-006)", () => {
  it("extra monthly payment saves interest and time", () => {
    const base = { principal_cents: 85_000_000, annual_rate: 0.115, months: 240 };
    const res = sim.earlyRepayment(base, { ...base, extra_monthly_cents: 200_000 });
    expect(res.interest_saved_cents).toBeGreaterThan(0);
    expect(res.months_saved).toBeGreaterThan(0);
    expect(res.optimised.months_to_payoff).toBeLessThan(res.base.months_to_payoff);
  });
});

describe("affordability & rate stress (AC-007, §5.7)", () => {
  it("max affordable loan inverts the instalment", () => {
    const rate = 0.115, n = 240, maxInst = 900_000, deposit = 20_000_000;
    const { max_loan_cents, max_price_cents } = sim.maxAffordable(maxInst, rate, n, deposit);
    // The instalment on the max loan should be ≈ the max instalment (±R1).
    expect(Math.abs(sim.instalment(max_loan_cents, rate, n) - maxInst)).toBeLessThanOrEqual(100);
    expect(max_price_cents).toBe(max_loan_cents + deposit);
  });

  it("rate sensitivity raises the instalment and DSR as rates rise", () => {
    const rows = sim.rateSensitivity(85_000_000, 0.115, 240, 4_000_000, 0.35);
    expect(rows[0].additional_cost_cents).toBe(0); // +0pp is the base
    expect(rows[3].instalment_cents).toBeGreaterThan(rows[0].instalment_cents);
    expect(rows[3].debt_service_ratio!).toBeGreaterThan(rows[0].debt_service_ratio!);
  });
});

describe("amortisation point & NPV (§5.11, §5.12)", () => {
  it("tracks principal/interest split and equity at a point", () => {
    const r = sim.amortise({ principal_cents: 85_000_000, annual_rate: 0.115, months: 240 });
    const at120 = sim.amortPoint(r, 120, 105_000_000);
    expect(at120.payments_made).toBe(120);
    expect(at120.outstanding_cents).toBeLessThan(85_000_000);
    expect(at120.equity_cents).toBe(105_000_000 - at120.outstanding_cents);
    expect(at120.pct_repaid).toBeGreaterThan(0);
    expect(at120.pct_repaid).toBeLessThan(1);
  });

  it("NPV of financing cost is positive and below the nominal interest", () => {
    const r = sim.amortise({ principal_cents: 85_000_000, annual_rate: 0.115, months: 240, monthly_fee_cents: 6900 });
    const npv = sim.npvFinancingCost(r, 0.08);
    expect(npv).toBeGreaterThan(0);
    expect(npv).toBeLessThan(r.total_interest_cents + r.total_fees_cents);
  });
});
