// Ported from backend/tests/test_calculations.py — pins each formula with explicit values.
import { describe, expect, it } from "vitest";
import * as calc from "../src/lib/calc";
import type { LineCalc } from "../src/lib/calc";

function periodLines(): LineCalc[] {
  return [
    { category_type: "income", planned_cents: 1000000, actual_cents: 1000000, owner_member_id: 1, category_id: 10, category_name: "Salary" },
    { category_type: "income", planned_cents: 500000, actual_cents: 480000, owner_member_id: 2, category_id: 10, category_name: "Business" },
    { category_type: "expense", planned_cents: 300000, actual_cents: 320000, owner_member_id: 1, category_id: 20, category_name: "Bond" },
    { category_type: "expense", planned_cents: 100000, actual_cents: 90000, owner_member_id: 2, category_id: 21, category_name: "Groceries" },
    { category_type: "saving", planned_cents: 200000, actual_cents: 200000, owner_member_id: 1, category_id: 30, category_name: "Retirement" },
    { category_type: "investment", planned_cents: 100000, actual_cents: 100000, owner_member_id: 2, category_id: 31, category_name: "ETF" },
    { category_type: "income", planned_cents: 999900, owner_member_id: 1, is_transfer: true },
  ];
}

describe("calculation engine", () => {
  it("total income excludes transfers", () => {
    expect(calc.totalIncome(periodLines())).toBe(1500000);
  });

  it("total expenses includes savings and investments", () => {
    expect(calc.totalExpenses(periodLines())).toBe(700000);
  });

  it("net position", () => {
    expect(calc.netPosition(periodLines())).toBe(1500000 - 700000);
  });

  it("savings rate", () => {
    expect(calc.savingsRate(periodLines())).toBe(0.2);
  });

  it("savings rate with zero income", () => {
    expect(calc.savingsRate([{ category_type: "expense", planned_cents: 100 }])).toBe(0);
  });

  it("category breakdown percentages sum to one", () => {
    const rows = calc.categoryBreakdown(periodLines());
    expect(Math.abs(rows.reduce((s, r) => s + r.pct_of_expenses, 0) - 1)).toBeLessThan(1e-6);
    expect(rows[0].category_name).toBe("Bond");
  });

  it("line variance", () => {
    const v = calc.lineVariance(300000, 320000);
    expect(v.variance_cents).toBe(20000);
    expect(v.remaining_cents).toBe(-20000);
    expect(v.variance_pct).toBe(Math.round((20000 / 300000) * 1e6) / 1e6);
  });

  it("period variance on actual basis", () => {
    const v = calc.periodVariance(periodLines());
    expect(v.income.variance_cents).toBe(-20000);
  });

  it("owner positions", () => {
    const pos = calc.ownerPositions(periodLines());
    expect(pos[1].income_cents).toBe(1000000);
    expect(pos[1].expense_cents).toBe(500000);
    expect(pos[1].net_cents).toBe(500000);
  });

  it("percentage split reconciles exactly", () => {
    const line: LineCalc = {
      category_type: "expense",
      planned_cents: 100000,
      allocations: [
        { member_id: 1, method: "percentage", percent_bp: 6000 },
        { member_id: 2, method: "percentage", percent_bp: 4000 },
      ],
    };
    const a = calc.ownerAllocation(line);
    expect(a[1]).toBe(60000);
    expect(a[2]).toBe(40000);
    expect(a[1] + a[2]).toBe(100000);
  });

  it("rounding remainder is assigned so splits reconcile", () => {
    const line: LineCalc = {
      category_type: "expense",
      planned_cents: 100001,
      allocations: [
        { member_id: 1, method: "percentage", percent_bp: 3333 },
        { member_id: 2, method: "percentage", percent_bp: 6667 },
      ],
    };
    const a = calc.ownerAllocation(line);
    expect(Object.values(a).reduce((s, v) => s + v, 0)).toBe(100001);
  });

  it("property cash flow shortfall", () => {
    const flow = calc.propertyCashFlow({ rent_cents: 1500000, bond_cents: 1380000, levies_cents: 190000, utilities_cents: 120000 });
    expect(flow.total_costs_cents).toBe(1690000);
    expect(flow.surplus_shortfall_cents).toBe(-190000);
    expect(flow.is_shortfall).toBe(true);
  });

  it("property yield and ltv", () => {
    const m = calc.propertyMetrics({ rent_cents: 1500000, bond_cents: 1380000, levies_cents: 190000 }, 210000000, 145000000);
    expect(m.gross_yield).toBe(Math.round((1500000 * 12 / 210000000) * 1e6) / 1e6);
    expect(m.loan_to_value).toBe(Math.round((145000000 / 210000000) * 1e6) / 1e6);
    expect(m.equity_cents).toBe(210000000 - 145000000);
  });

  it("goal monthly requirement rounds up", () => {
    expect(calc.goalMonthlyRequirement(150000, 50000, 3)).toBe(33334);
  });

  it("goal progress capped", () => {
    expect(calc.goalProgress(10000, 15000)).toBe(1);
    expect(calc.goalProgress(10000, 2500)).toBe(0.25);
  });

  it("expected value", () => {
    expect(calc.expectedValue(1000000, 7500)).toBe(750000);
  });

  it("tithe is 10% of income, rounded, never negative", () => {
    expect(calc.titheAmount(1000000)).toBe(100000); // 10% of 10,000.00
    expect(calc.titheAmount(123455)).toBe(12346); // rounds to nearest cent
    expect(calc.titheAmount(0)).toBe(0);
    expect(calc.titheAmount(-500)).toBe(0);
    expect(calc.titheAmount(1000000, 1250)).toBe(125000); // configurable rate (12.5%)
  });

  it("monthly bond repayment matches amortisation", () => {
    const pay = calc.monthlyBondRepayment(100000000, 0.115, 240);
    expect(Math.abs(pay - 1066429)).toBeLessThanOrEqual(50);
  });

  it("monthly bond repayment zero rate", () => {
    expect(calc.monthlyBondRepayment(120000, 0, 12)).toBe(10000);
  });

  it("net worth", () => {
    expect(calc.netWorth([10000, 5000], [3000])).toBe(12000);
  });

  it("property equity nets bond and applies ownership share", () => {
    expect(calc.propertyEquity(1_000_000, 400_000)).toBe(600_000); // full ownership
    expect(calc.propertyEquity(1_000_000, 400_000, 5000)).toBe(300_000); // 50% share
    expect(calc.propertyEquity(500_000, 700_000)).toBe(-200_000); // underwater
  });

  it("scenario delta", () => {
    const d = calc.scenarioDelta({ net: 500000 }, { net: 350000 });
    expect(d.net.delta).toBe(-150000);
    expect(d.net.delta_pct).toBe(Math.round((-150000 / 500000) * 1e6) / 1e6);
  });

  it("cash timeline accumulates in date order", () => {
    const { points, closing_cents, opening_cents } = calc.cashTimeline(100000, [
      { date: "2026-01-20", amount_cents: -30000 },
      { date: "2026-01-05", amount_cents: 50000 },
      { date: "2026-01-10", amount_cents: -20000 },
    ]);
    expect(opening_cents).toBe(100000);
    expect(points.map((p) => p.balance_cents)).toEqual([150000, 130000, 100000]);
    expect(closing_cents).toBe(100000);
  });

  it("lowest balance finds the runway trough and flags negatives", () => {
    const { points } = calc.cashTimeline(10000, [
      { date: "2026-01-05", amount_cents: -25000 },
      { date: "2026-01-25", amount_cents: 40000 },
    ]);
    const low = calc.lowestBalance(10000, points);
    expect(low.lowest_cents).toBe(-15000);
    expect(low.date).toBe("2026-01-05");
    expect(low.dips_negative).toBe(true);
  });

  it("forward projection compounds a monthly net", () => {
    const fwd = calc.forwardProjection(100000, -20000, 3);
    expect(fwd.map((f) => f.balance_cents)).toEqual([80000, 60000, 40000]);
  });

  it("runway months: null when non-negative, floor of months otherwise", () => {
    expect(calc.runwayMonths(100000, 5000)).toBeNull();
    expect(calc.runwayMonths(100000, -30000)).toBe(3);
    expect(calc.runwayMonths(0, -30000)).toBe(0);
  });
});
