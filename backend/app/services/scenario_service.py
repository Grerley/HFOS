"""Scenario engine: clone a baseline period's metrics, apply structured assumptions,
and compute projected results plus deltas. Assumptions are versioned JSON.

Scenarios never mutate real budgets — they are stored separately (requirements §8).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.services import calculations as calc
from app.services.queries import load_lines_for_calc

ASSUMPTION_SCHEMA_VERSION = 1

# Assumption keys understood by the engine (all optional):
#   income_change_pct: float        e.g. -0.20 for a 20% income cut
#   expense_change_pct: float       proportional change to all expenses
#   additional_income_cents: int    once-off/new recurring income
#   new_monthly_expense_cents: int  new recurring obligation
#   savings_increase_cents: int     extra monthly saving (also lifts expenses)
#   new_property: {price_cents, deposit_cents, annual_rate, term_months, rent_cents}


def baseline_metrics(db: Session, household_id: int, period_id: int) -> dict:
    lines = load_lines_for_calc(db, household_id, period_id)
    s = calc.period_summary(lines)["planned"]
    return {
        "total_income_cents": s["total_income_cents"],
        "total_expenses_cents": s["total_expenses_cents"],
        "net_position_cents": s["net_position_cents"],
        "total_savings_cents": s["total_savings_cents"],
        "savings_rate": s["savings_rate"],
    }


def apply_assumptions(base: dict, assumptions: dict) -> dict:
    income = base["total_income_cents"]
    expenses = base["total_expenses_cents"]
    savings = base["total_savings_cents"]

    income = round(income * (1 + assumptions.get("income_change_pct", 0.0)))
    expenses = round(expenses * (1 + assumptions.get("expense_change_pct", 0.0)))

    income += int(assumptions.get("additional_income_cents", 0))
    expenses += int(assumptions.get("new_monthly_expense_cents", 0))

    extra_savings = int(assumptions.get("savings_increase_cents", 0))
    expenses += extra_savings
    savings += extra_savings

    new_prop = assumptions.get("new_property")
    if new_prop:
        principal = int(new_prop.get("price_cents", 0)) - int(new_prop.get("deposit_cents", 0))
        repayment = calc.monthly_bond_repayment(
            principal,
            float(new_prop.get("annual_rate", 0.115)),
            int(new_prop.get("term_months", 240)),
        )
        expenses += repayment
        income += int(new_prop.get("rent_cents", 0))

    net = income - expenses
    rate = round(savings / income, 6) if income > 0 else 0.0
    return {
        "total_income_cents": income,
        "total_expenses_cents": expenses,
        "net_position_cents": net,
        "total_savings_cents": savings,
        "savings_rate": rate,
    }


def run_scenario(db: Session, household_id: int, base_period_id: int | None,
                 assumptions: dict) -> dict:
    base = (
        baseline_metrics(db, household_id, base_period_id)
        if base_period_id
        else {
            "total_income_cents": 0,
            "total_expenses_cents": 0,
            "net_position_cents": 0,
            "total_savings_cents": 0,
            "savings_rate": 0.0,
        }
    )
    projected = apply_assumptions(base, assumptions or {})
    return {
        "schema_version": ASSUMPTION_SCHEMA_VERSION,
        "formula_version": calc.FORMULA_VERSION,
        "baseline": base,
        "projected": projected,
        "deltas": calc.scenario_delta(base, projected),
    }
