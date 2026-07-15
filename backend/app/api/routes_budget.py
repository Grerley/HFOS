"""Budget periods, lines (incl. batch grid save), status lifecycle and transactions."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.enums import LOCKED_STATUSES, PeriodStatus
from app.models import BudgetLine, BudgetPeriod, Transaction
from app.schemas import (
    BatchLineUpdate,
    LineCreate,
    LineOut,
    LineUpdate,
    PeriodCreate,
    PeriodDuplicate,
    PeriodOut,
    PeriodStatusUpdate,
    TransactionCreate,
    TransactionOut,
)
from app.services import audit_service, budget_service
from app.services.queries import get_period_or_404

router = APIRouter(tags=["budget"])

VALID_STATUSES = {s.value for s in PeriodStatus}


@router.get("/budget-periods", response_model=list[PeriodOut])
def list_periods(ctx: HouseholdContext = Depends(get_household_context),
                 db: Session = Depends(get_db)):
    rows = db.scalars(
        select(BudgetPeriod)
        .where(BudgetPeriod.household_id == ctx.household_id)
        .order_by(BudgetPeriod.start_date.desc())
    ).all()
    return [PeriodOut.model_validate(p) for p in rows]


@router.post("/budget-periods", response_model=PeriodOut, status_code=201)
def create_period(payload: PeriodCreate, ctx: HouseholdContext = Depends(require_write),
                  db: Session = Depends(get_db)):
    period = BudgetPeriod(household_id=ctx.household_id, source="manual",
                          **payload.model_dump())
    db.add(period)
    db.commit()
    return PeriodOut.model_validate(period)


@router.post("/budget-periods/{period_id}/duplicate", response_model=PeriodOut, status_code=201)
def duplicate_period(period_id: int, payload: PeriodDuplicate,
                     ctx: HouseholdContext = Depends(require_write),
                     db: Session = Depends(get_db)):
    source = get_period_or_404(db, ctx.household_id, period_id)
    new_period = budget_service.duplicate_period(
        db, household_id=ctx.household_id, source=source, label=payload.label,
        start_date=payload.start_date, end_date=payload.end_date,
        copy_ad_hoc=payload.copy_ad_hoc, actor_user_id=ctx.user.id,
    )
    db.commit()
    return PeriodOut.model_validate(new_period)


@router.patch("/budget-periods/{period_id}/status", response_model=PeriodOut)
def update_status(period_id: int, payload: PeriodStatusUpdate,
                  ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid status")
    period = get_period_or_404(db, ctx.household_id, period_id)
    before = period.status
    period.status = payload.status
    if payload.status in LOCKED_STATUSES:
        period.locked_at = date.today()
    if payload.status == PeriodStatus.APPROVED.value:
        period.approved_at = date.today()
    audit_service.record(
        db, action="budget_period.status", entity_type="budget_period", entity_id=period.id,
        household_id=ctx.household_id, actor_user_id=ctx.user.id,
        detail={"from": before, "to": payload.status},
    )
    db.commit()
    return PeriodOut.model_validate(period)


@router.get("/budget-periods/{period_id}/lines", response_model=list[LineOut])
def list_lines(period_id: int, ctx: HouseholdContext = Depends(get_household_context),
               db: Session = Depends(get_db)):
    get_period_or_404(db, ctx.household_id, period_id)
    rows = db.scalars(
        select(BudgetLine)
        .where(BudgetLine.period_id == period_id)
        .order_by(BudgetLine.sort_order, BudgetLine.id)
    ).all()
    return [LineOut.model_validate(r) for r in rows]


@router.post("/budget-periods/{period_id}/lines", response_model=LineOut, status_code=201)
def add_line(period_id: int, payload: LineCreate,
             ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    period = get_period_or_404(db, ctx.household_id, period_id)
    if period.status in LOCKED_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Period is locked")
    line = budget_service.create_line(db, ctx.household_id, period_id, payload)
    db.commit()
    return LineOut.model_validate(line)


@router.patch("/budget-lines/{line_id}", response_model=LineOut)
def patch_line(line_id: int, payload: LineUpdate,
               ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    line = db.get(BudgetLine, line_id)
    if not line or line.household_id != ctx.household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found")
    budget_service.update_line(db, line, payload)
    db.commit()
    return LineOut.model_validate(line)


@router.delete("/budget-lines/{line_id}", status_code=204)
def delete_line(line_id: int, ctx: HouseholdContext = Depends(require_write),
                db: Session = Depends(get_db)):
    line = db.get(BudgetLine, line_id)
    if not line or line.household_id != ctx.household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found")
    db.delete(line)
    db.commit()


@router.post("/budget-periods/{period_id}/lines/batch")
def batch_lines(period_id: int, batch: BatchLineUpdate,
                ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    period = get_period_or_404(db, ctx.household_id, period_id)
    result = budget_service.apply_batch(
        db, household_id=ctx.household_id, period=period, batch=batch, actor_user_id=ctx.user.id
    )
    db.commit()
    return result


# ── Transactions (manual actuals) ────────────────────────────────────────────
@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(ctx: HouseholdContext = Depends(get_household_context),
                      db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Transaction)
        .where(Transaction.household_id == ctx.household_id)
        .order_by(Transaction.date.desc())
    ).all()
    return [TransactionOut.model_validate(t) for t in rows]


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate,
                       ctx: HouseholdContext = Depends(require_write),
                       db: Session = Depends(get_db)):
    txn = Transaction(household_id=ctx.household_id, source="manual", **payload.model_dump())
    db.add(txn)
    db.flush()
    # If matched to a line, roll the actual into the line's actual amount.
    if payload.budget_line_id:
        line = db.get(BudgetLine, payload.budget_line_id)
        if line and line.household_id == ctx.household_id:
            line.actual_amount_cents += abs(payload.amount_cents)
    db.commit()
    return TransactionOut.model_validate(txn)
