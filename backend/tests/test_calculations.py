"""Unit tests for the calculation engine — the most critical correctness surface.

Each test pins a formula from requirements §9 with explicit, realistic values.
"""
from __future__ import annotations

from app.services import calculations as calc
from app.services.calculations import LineCalc, OwnerSplit


def _period_lines():
    return [
        LineCalc("income", planned_cents=10_000_00, actual_cents=10_000_00, owner_member_id=1,
                 category_id=10, category_name="Salary"),
        LineCalc("income", planned_cents=5_000_00, actual_cents=4_800_00, owner_member_id=2,
                 category_id=10, category_name="Business"),
        LineCalc("expense", planned_cents=3_000_00, actual_cents=3_200_00, owner_member_id=1,
                 category_id=20, category_name="Bond"),
        LineCalc("expense", planned_cents=1_000_00, actual_cents=900_00, owner_member_id=2,
                 category_id=21, category_name="Groceries"),
        LineCalc("saving", planned_cents=2_000_00, actual_cents=2_000_00, owner_member_id=1,
                 category_id=30, category_name="Retirement"),
        LineCalc("investment", planned_cents=1_000_00, actual_cents=1_000_00, owner_member_id=2,
                 category_id=31, category_name="ETF"),
        # A transfer income line must NOT count toward income (double-count rule).
        LineCalc("income", planned_cents=9_999_00, owner_member_id=1, is_transfer=True),
    ]


def test_total_income_excludes_transfers():
    assert calc.total_income(_period_lines()) == 15_000_00


def test_total_expenses_includes_savings_and_investments():
    # 3000 + 1000 (expense) + 2000 (saving) + 1000 (investment) = 7000.00
    assert calc.total_expenses(_period_lines()) == 7_000_00


def test_net_position():
    assert calc.net_position(_period_lines()) == 15_000_00 - 7_000_00


def test_savings_rate():
    # savings (2000 + 1000) / income (15000) = 0.2
    assert calc.savings_rate(_period_lines()) == 0.2


def test_savings_rate_zero_income():
    assert calc.savings_rate([LineCalc("expense", planned_cents=100)]) == 0.0


def test_category_breakdown_percentages_sum_to_one():
    rows = calc.category_breakdown(_period_lines())
    assert abs(sum(r["pct_of_expenses"] for r in rows) - 1.0) < 1e-6
    top = rows[0]
    assert top["category_name"] == "Bond"  # largest outflow


def test_line_variance():
    v = calc.line_variance(3_000_00, 3_200_00)
    assert v["variance_cents"] == 200_00
    assert v["remaining_cents"] == -200_00
    assert v["variance_pct"] == round(200_00 / 3_000_00, 6)


def test_period_variance_actual_basis():
    v = calc.period_variance(_period_lines())
    # actual income 10000 + 4800 = 14800 vs planned 15000 → -200
    assert v["income"]["variance_cents"] == -200_00


def test_owner_positions():
    pos = calc.owner_positions(_period_lines())
    # member 1: income 10000, expenses 3000 (bond) + 2000 (retirement) = 5000
    assert pos[1]["income_cents"] == 10_000_00
    assert pos[1]["expense_cents"] == 5_000_00
    assert pos[1]["net_cents"] == 5_000_00


def test_owner_allocation_percentage_split_reconciles():
    line = LineCalc("expense", planned_cents=1_000_00, allocations=[
        OwnerSplit(member_id=1, method="percentage", percent_bp=6000),
        OwnerSplit(member_id=2, method="percentage", percent_bp=4000),
    ])
    alloc = calc.owner_allocation(line)
    assert alloc[1] == 600_00
    assert alloc[2] == 400_00
    assert sum(alloc.values()) == 1_000_00  # exact reconciliation


def test_owner_allocation_rounding_remainder_assigned():
    # 1000.01 split 1/3 : 2/3 → remainder lands on first member, totals reconcile.
    line = LineCalc("expense", planned_cents=100_001, allocations=[
        OwnerSplit(member_id=1, method="percentage", percent_bp=3333),
        OwnerSplit(member_id=2, method="percentage", percent_bp=6667),
    ])
    alloc = calc.owner_allocation(line)
    assert sum(alloc.values()) == 100_001


def test_property_cash_flow_shortfall():
    cf = calc.PropertyCashFlowInput(rent_cents=15_000_00, bond_cents=13_800_00,
                                    levies_cents=1_900_00, utilities_cents=1_200_00)
    flow = calc.property_cash_flow(cf)
    assert flow["total_costs_cents"] == 16_900_00
    assert flow["surplus_shortfall_cents"] == -1_900_00
    assert flow["is_shortfall"] is True


def test_property_yield_and_ltv():
    cf = calc.PropertyCashFlowInput(rent_cents=15_000_00, bond_cents=13_800_00,
                                    levies_cents=1_900_00)
    m = calc.property_metrics(cf, market_value_cents=2_100_000_00,
                              outstanding_bond_cents=1_450_000_00)
    assert m["gross_yield"] == round(15_000_00 * 12 / 2_100_000_00, 6)
    assert m["loan_to_value"] == round(1_450_000_00 / 2_100_000_00, 6)
    assert m["equity_cents"] == 2_100_000_00 - 1_450_000_00


def test_goal_monthly_requirement_rounds_up():
    # gap 100000 over 3 months → ceil(100000/3) = 33334 cents
    assert calc.goal_monthly_requirement(150_000, 50_000, 3) == 33_334


def test_goal_progress_capped():
    assert calc.goal_progress(100_00, 150_00) == 1.0
    assert calc.goal_progress(100_00, 25_00) == 0.25


def test_expected_value():
    assert calc.expected_value(10_000_00, 7500) == 7_500_00


def test_monthly_bond_repayment_matches_amortisation():
    # R1,000,000 at 11.5% over 240 months ≈ R10,664.29 → 1,066,429 cents (±1 rounding)
    pay = calc.monthly_bond_repayment(1_000_000_00, 0.115, 240)
    assert abs(pay - 1_066_429) <= 50


def test_monthly_bond_repayment_zero_rate():
    assert calc.monthly_bond_repayment(1_200_00, 0.0, 12) == 100_00


def test_net_worth():
    assert calc.net_worth([100_00, 50_00], [30_00]) == 120_00


def test_scenario_delta():
    d = calc.scenario_delta({"net": 5_000_00}, {"net": 3_500_00})
    assert d["net"]["delta"] == -1_500_00
    assert d["net"]["delta_pct"] == round(-1_500_00 / 5_000_00, 6)
