"""HFOS calculation engine — the single, deterministic source of all financial maths.

Design rules (from the requirements pack):
  * Pure functions over plain inputs → trivially unit-testable and reproducible.
  * Money is integer minor units (cents). No floats for money. Ratios are floats.
  * Every formula is defined here once; the frontend never re-implements any of it.
  * FORMULA_VERSION is bumped when a rule changes, and persisted with snapshots so a
    stored metric is always reproducible.

Nothing in this module imports the ORM or the database — the service layer adapts
ORM rows into these lightweight inputs and back.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.enums import CategoryType, OUTFLOW_TYPES, SAVINGS_TYPES

FORMULA_VERSION = "1.0.0"


# ── Inputs ────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class OwnerSplit:
    member_id: int
    method: str = "fixed"  # "fixed" | "percentage"
    amount_cents: int = 0
    percent_bp: int = 0  # basis points (10000 == 100%)


@dataclass
class LineCalc:
    """A single budget line reduced to what the engine needs."""

    category_type: str
    planned_cents: int = 0
    actual_cents: int = 0
    owner_member_id: int | None = None
    category_id: int | None = None
    category_name: str | None = None
    is_transfer: bool = False
    allocations: list[OwnerSplit] = field(default_factory=list)


def _is_income(line: LineCalc) -> bool:
    return line.category_type == CategoryType.INCOME.value and not line.is_transfer


def _is_outflow(line: LineCalc) -> bool:
    return line.category_type in OUTFLOW_TYPES and not line.is_transfer


def _is_savings(line: LineCalc) -> bool:
    return line.category_type in SAVINGS_TYPES and not line.is_transfer


# ── Period totals ─────────────────────────────────────────────────────────────
def total_income(lines: list[LineCalc], *, basis: str = "planned") -> int:
    """Sum of income lines, excluding transfers that would double-count cash."""
    return sum(_amount(l, basis) for l in lines if _is_income(l))


def total_expenses(lines: list[LineCalc], *, basis: str = "planned") -> int:
    """Sum of expense, saving and investment (outflow) lines. Transfers excluded."""
    return sum(_amount(l, basis) for l in lines if _is_outflow(l))


def net_position(lines: list[LineCalc], *, basis: str = "planned") -> int:
    """Total income minus total expenses for the period (surplus if positive)."""
    return total_income(lines, basis=basis) - total_expenses(lines, basis=basis)


def total_savings(lines: list[LineCalc], *, basis: str = "planned") -> int:
    return sum(_amount(l, basis) for l in lines if _is_savings(l))


def savings_rate(lines: list[LineCalc], *, basis: str = "planned") -> float:
    """Savings & investment outflows divided by total income (0 when no income)."""
    income = total_income(lines, basis=basis)
    if income <= 0:
        return 0.0
    return round(total_savings(lines, basis=basis) / income, 6)


def _amount(line: LineCalc, basis: str) -> int:
    return line.actual_cents if basis == "actual" else line.planned_cents


# ── Owner-level ───────────────────────────────────────────────────────────────
def owner_allocation(line: LineCalc, basis: str = "planned") -> dict[int, int]:
    """Split a line's amount across members. Explicit allocations win; otherwise the
    whole amount lands on the line owner. Percentage splits use basis points."""
    amount = _amount(line, basis)
    if line.allocations:
        out: dict[int, int] = {}
        allocated = 0
        for split in line.allocations:
            if split.method == "percentage":
                share = amount * split.percent_bp // 10000
            else:
                share = split.amount_cents
            out[split.member_id] = out.get(split.member_id, 0) + share
            allocated += share
        # Assign any rounding remainder to the first member so splits reconcile exactly.
        remainder = amount - allocated
        if remainder and line.allocations:
            first = line.allocations[0].member_id
            out[first] = out.get(first, 0) + remainder
        return out
    if line.owner_member_id is not None:
        return {line.owner_member_id: amount}
    return {}


def owner_positions(lines: list[LineCalc], *, basis: str = "planned") -> dict[int, dict]:
    """Per-member income, expenses (responsibility) and net position."""
    result: dict[int, dict] = {}

    def bucket(member_id: int) -> dict:
        return result.setdefault(
            member_id, {"income_cents": 0, "expense_cents": 0, "net_cents": 0}
        )

    for line in lines:
        if _is_income(line):
            for mid, amt in owner_allocation(line, basis).items():
                bucket(mid)["income_cents"] += amt
        elif _is_outflow(line):
            for mid, amt in owner_allocation(line, basis).items():
                bucket(mid)["expense_cents"] += amt
    for b in result.values():
        b["net_cents"] = b["income_cents"] - b["expense_cents"]
    return result


# ── Category breakdown ────────────────────────────────────────────────────────
def category_breakdown(lines: list[LineCalc], *, basis: str = "planned") -> list[dict]:
    """Outflow totals grouped by category, with each category's % of total expenses."""
    totals: dict[tuple[int | None, str | None], int] = {}
    for line in lines:
        if _is_outflow(line):
            key = (line.category_id, line.category_name)
            totals[key] = totals.get(key, 0) + _amount(line, basis)
    grand = total_expenses(lines, basis=basis)
    rows = []
    for (cat_id, name), amount in totals.items():
        rows.append(
            {
                "category_id": cat_id,
                "category_name": name,
                "amount_cents": amount,
                "pct_of_expenses": round(amount / grand, 6) if grand else 0.0,
            }
        )
    rows.sort(key=lambda r: r["amount_cents"], reverse=True)
    return rows


# ── Variance (actual vs planned) ──────────────────────────────────────────────
def line_variance(planned_cents: int, actual_cents: int) -> dict:
    """Variance for a single line/category. Positive variance == spent more than plan."""
    variance = actual_cents - planned_cents
    pct = round(variance / planned_cents, 6) if planned_cents else None
    return {
        "planned_cents": planned_cents,
        "actual_cents": actual_cents,
        "variance_cents": variance,
        "variance_pct": pct,
        "remaining_cents": planned_cents - actual_cents,
    }


def period_variance(lines: list[LineCalc]) -> dict:
    """Income, expense and net variance for a whole period."""
    return {
        "income": line_variance(
            total_income(lines, basis="planned"), total_income(lines, basis="actual")
        ),
        "expenses": line_variance(
            total_expenses(lines, basis="planned"), total_expenses(lines, basis="actual")
        ),
        "net": {
            "planned_cents": net_position(lines, basis="planned"),
            "actual_cents": net_position(lines, basis="actual"),
            "variance_cents": net_position(lines, basis="actual")
            - net_position(lines, basis="planned"),
        },
    }


# ── Property ──────────────────────────────────────────────────────────────────
@dataclass
class PropertyCashFlowInput:
    rent_cents: int = 0
    bond_cents: int = 0
    levies_cents: int = 0
    rates_cents: int = 0
    utilities_cents: int = 0
    insurance_cents: int = 0
    maintenance_cents: int = 0
    agent_fees_cents: int = 0
    vacancy_cents: int = 0
    other_cents: int = 0


def property_costs(cf: PropertyCashFlowInput) -> int:
    return (
        cf.bond_cents
        + cf.levies_cents
        + cf.rates_cents
        + cf.utilities_cents
        + cf.insurance_cents
        + cf.maintenance_cents
        + cf.agent_fees_cents
        + cf.vacancy_cents
        + cf.other_cents
    )


def property_cash_flow(cf: PropertyCashFlowInput) -> dict:
    """Monthly surplus/shortfall: rent minus all property costs."""
    costs = property_costs(cf)
    surplus = cf.rent_cents - costs
    return {
        "rent_cents": cf.rent_cents,
        "total_costs_cents": costs,
        "surplus_shortfall_cents": surplus,
        "is_shortfall": surplus < 0,
    }


def gross_rental_yield(annual_rent_cents: int, market_value_cents: int) -> float:
    if market_value_cents <= 0:
        return 0.0
    return round(annual_rent_cents / market_value_cents, 6)


def net_rental_yield(annual_net_operating_cents: int, market_value_cents: int) -> float:
    if market_value_cents <= 0:
        return 0.0
    return round(annual_net_operating_cents / market_value_cents, 6)


def loan_to_value(outstanding_bond_cents: int, market_value_cents: int) -> float:
    if market_value_cents <= 0:
        return 0.0
    return round(outstanding_bond_cents / market_value_cents, 6)


def property_metrics(cf: PropertyCashFlowInput, market_value_cents: int,
                     outstanding_bond_cents: int) -> dict:
    """Full monthly cash-flow + annualised yield + LTV for one property."""
    flow = property_cash_flow(cf)
    # Net operating income excludes the bond (financing), per standard NOI definition.
    monthly_noi = cf.rent_cents - (property_costs(cf) - cf.bond_cents)
    return {
        **flow,
        "gross_yield": gross_rental_yield(cf.rent_cents * 12, market_value_cents),
        "net_yield": net_rental_yield(monthly_noi * 12, market_value_cents),
        "loan_to_value": loan_to_value(outstanding_bond_cents, market_value_cents),
        "equity_cents": market_value_cents - outstanding_bond_cents,
    }


# ── Goals ─────────────────────────────────────────────────────────────────────
def goal_monthly_requirement(
    target_cents: int, current_cents: int, months_remaining: int
) -> int:
    """Monthly contribution needed to close the gap by the target date."""
    gap = max(target_cents - current_cents, 0)
    if months_remaining <= 0:
        return gap
    # Round up so the goal is fully funded within the horizon.
    return -(-gap // months_remaining)


def goal_progress(target_cents: int, current_cents: int) -> float:
    if target_cents <= 0:
        return 0.0
    return round(min(current_cents / target_cents, 1.0), 6)


# ── Receivables / probability-weighted inflows ────────────────────────────────
def expected_value(amount_cents: int, probability_bp: int) -> int:
    return amount_cents * probability_bp // 10000


# ── Bond / loan amortisation (for property acquisition scenarios) ─────────────
def monthly_bond_repayment(
    principal_cents: int, annual_rate: float, term_months: int
) -> int:
    """Standard amortising loan payment. annual_rate as a fraction, e.g. 0.115."""
    if term_months <= 0:
        return principal_cents
    r = annual_rate / 12.0
    if r == 0:
        return -(-principal_cents // term_months)
    factor = (r * (1 + r) ** term_months) / ((1 + r) ** term_months - 1)
    return round(principal_cents * factor)


# ── Net worth ─────────────────────────────────────────────────────────────────
def net_worth(asset_balances_cents: list[int], liability_balances_cents: list[int]) -> int:
    return sum(asset_balances_cents) - sum(abs(b) for b in liability_balances_cents)


# ── Scenario deltas ───────────────────────────────────────────────────────────
def scenario_delta(baseline: dict, scenario: dict) -> dict:
    """Compare two metric bundles → absolute and percentage deltas per key."""
    out: dict[str, dict] = {}
    keys = set(baseline) | set(scenario)
    for key in keys:
        base = baseline.get(key, 0) or 0
        scen = scenario.get(key, 0) or 0
        delta = scen - base
        pct = round(delta / base, 6) if isinstance(base, (int, float)) and base else None
        out[key] = {"baseline": base, "scenario": scen, "delta": delta, "delta_pct": pct}
    return out


# ── Period summary (the dashboard's core bundle) ──────────────────────────────
def period_summary(lines: list[LineCalc]) -> dict:
    """Everything the household dashboard needs for one period, in one pass."""
    return {
        "formula_version": FORMULA_VERSION,
        "planned": {
            "total_income_cents": total_income(lines, basis="planned"),
            "total_expenses_cents": total_expenses(lines, basis="planned"),
            "net_position_cents": net_position(lines, basis="planned"),
            "total_savings_cents": total_savings(lines, basis="planned"),
            "savings_rate": savings_rate(lines, basis="planned"),
        },
        "actual": {
            "total_income_cents": total_income(lines, basis="actual"),
            "total_expenses_cents": total_expenses(lines, basis="actual"),
            "net_position_cents": net_position(lines, basis="actual"),
            "total_savings_cents": total_savings(lines, basis="actual"),
            "savings_rate": savings_rate(lines, basis="actual"),
        },
        "variance": period_variance(lines),
        "category_breakdown": category_breakdown(lines, basis="planned"),
        "owner_positions": owner_positions(lines, basis="planned"),
    }
