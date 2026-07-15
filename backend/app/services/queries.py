"""Tenant-scoped query helpers. Every read/write goes through a household filter so
isolation is enforced in the data-access layer, not just the UI."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BudgetLine, BudgetPeriod, Category
from app.services.calculations import LineCalc, OwnerSplit


def get_period_or_404(db: Session, household_id: int, period_id: int) -> BudgetPeriod:
    period = db.get(BudgetPeriod, period_id)
    if not period or period.household_id != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget period not found")
    return period


def get_scoped_or_404(db: Session, model, household_id: int, entity_id: int):
    obj = db.get(model, entity_id)
    if not obj or getattr(obj, "household_id", None) != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return obj


def load_lines_for_calc(db: Session, household_id: int, period_id: int) -> list[LineCalc]:
    """Load a period's lines and adapt them to the calculation engine's inputs,
    resolving each line's category type and name in a single query per lookup."""
    rows = db.scalars(
        select(BudgetLine).where(
            BudgetLine.period_id == period_id, BudgetLine.household_id == household_id
        )
    ).all()
    cat_ids = {r.category_id for r in rows}
    cats = {
        c.id: c
        for c in db.scalars(select(Category).where(Category.id.in_(cat_ids))).all()
    }
    out: list[LineCalc] = []
    for r in rows:
        cat = cats.get(r.category_id)
        out.append(
            LineCalc(
                category_type=cat.type if cat else "expense",
                planned_cents=r.planned_amount_cents,
                actual_cents=r.actual_amount_cents,
                owner_member_id=r.owner_member_id,
                category_id=r.category_id,
                category_name=cat.name if cat else None,
                is_transfer=False,
                allocations=[
                    OwnerSplit(
                        member_id=a.member_id,
                        method=a.method,
                        amount_cents=a.amount_cents,
                        percent_bp=a.percent_bp,
                    )
                    for a in r.allocations
                ],
            )
        )
    return out
