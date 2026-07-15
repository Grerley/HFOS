"""Budget period and line operations: duplication and batch grid saves."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import EDITABLE_STATUSES, PaymentStatus
from app.models import BudgetLine, BudgetLineAllocation, BudgetPeriod
from app.schemas import BatchLineUpdate, LineCreate, LineUpdate
from app.services import audit_service


def duplicate_period(
    db: Session,
    *,
    household_id: int,
    source: BudgetPeriod,
    label: str,
    start_date: date,
    end_date: date,
    copy_ad_hoc: bool,
    actor_user_id: int | None,
) -> BudgetPeriod:
    """Create a new period from an existing one. Recurring lines are copied with
    actuals reset; ad-hoc (non-recurring) lines are copied only when requested
    (backlog HFOS-020, HFOS-054)."""
    new_period = BudgetPeriod(
        household_id=household_id,
        label=label,
        start_date=start_date,
        end_date=end_date,
        status="draft",
        source="duplicate",
    )
    db.add(new_period)
    db.flush()

    src_lines = db.scalars(
        select(BudgetLine).where(BudgetLine.period_id == source.id)
    ).all()
    copied = 0
    for line in src_lines:
        if not line.is_recurring and not copy_ad_hoc:
            continue
        clone = BudgetLine(
            period_id=new_period.id,
            household_id=household_id,
            category_id=line.category_id,
            item_name=line.item_name,
            owner_member_id=line.owner_member_id,
            payer_member_id=line.payer_member_id,
            beneficiary_member_id=line.beneficiary_member_id,
            planned_amount_cents=line.planned_amount_cents,
            actual_amount_cents=0,  # actuals reset on duplication
            due_day=line.due_day,
            due_note=line.due_note,
            recurrence=line.recurrence,
            payment_status=PaymentStatus.PLANNED.value,
            is_recurring=line.is_recurring,
            priority=line.priority,
            sort_order=line.sort_order,
            notes=line.notes,
        )
        db.add(clone)
        db.flush()
        for a in line.allocations:
            db.add(
                BudgetLineAllocation(
                    line_id=clone.id,
                    member_id=a.member_id,
                    method=a.method,
                    amount_cents=a.amount_cents,
                    percent_bp=a.percent_bp,
                )
            )
        copied += 1

    audit_service.record(
        db,
        action="budget_period.duplicate",
        entity_type="budget_period",
        entity_id=new_period.id,
        household_id=household_id,
        actor_user_id=actor_user_id,
        detail={"source_period_id": source.id, "lines_copied": copied},
    )
    return new_period


def _apply_allocations(db: Session, line: BudgetLine, allocations) -> None:
    for existing in list(line.allocations):
        db.delete(existing)
    db.flush()
    for a in allocations or []:
        db.add(
            BudgetLineAllocation(
                line_id=line.id,
                member_id=a.member_id,
                method=a.method,
                amount_cents=a.amount_cents,
                percent_bp=a.percent_bp,
            )
        )


def create_line(db: Session, household_id: int, period_id: int, payload: LineCreate) -> BudgetLine:
    line = BudgetLine(
        period_id=period_id,
        household_id=household_id,
        category_id=payload.category_id,
        item_name=payload.item_name,
        owner_member_id=payload.owner_member_id,
        payer_member_id=payload.payer_member_id,
        beneficiary_member_id=payload.beneficiary_member_id,
        planned_amount_cents=payload.planned_amount_cents,
        actual_amount_cents=payload.actual_amount_cents,
        due_day=payload.due_day,
        due_note=payload.due_note,
        recurrence=payload.recurrence,
        payment_status=payload.payment_status,
        is_recurring=payload.is_recurring,
        priority=payload.priority,
        notes=payload.notes,
    )
    db.add(line)
    db.flush()
    _apply_allocations(db, line, payload.allocations)
    db.flush()
    return line


def update_line(db: Session, line: BudgetLine, payload: LineUpdate) -> BudgetLine:
    data = payload.model_dump(exclude_unset=True)
    allocations = data.pop("allocations", None)
    for field, value in data.items():
        setattr(line, field, value)
    if allocations is not None:
        _apply_allocations(db, line, payload.allocations)
    db.flush()
    return line


def apply_batch(
    db: Session,
    *,
    household_id: int,
    period: BudgetPeriod,
    batch: BatchLineUpdate,
    actor_user_id: int | None,
) -> dict:
    """Apply a grid batch (creates/updates/deletes) atomically. Editing a locked
    period is blocked here so the rule holds regardless of caller."""
    if period.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Period '{period.label}' is {period.status}; unlock before editing.",
        )

    created, updated, deleted = 0, 0, 0
    for payload in batch.creates:
        create_line(db, household_id, period.id, payload)
        created += 1
    for line_id, payload in batch.updates.items():
        line = db.get(BudgetLine, int(line_id))
        if not line or line.period_id != period.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Line {line_id} not in period")
        update_line(db, line, payload)
        updated += 1
    for line_id in batch.deletes:
        line = db.get(BudgetLine, int(line_id))
        if line and line.period_id == period.id:
            db.delete(line)
            deleted += 1

    audit_service.record(
        db,
        action="budget_lines.batch_save",
        entity_type="budget_period",
        entity_id=period.id,
        household_id=household_id,
        actor_user_id=actor_user_id,
        detail={"created": created, "updated": updated, "deleted": deleted},
    )
    return {"created": created, "updated": updated, "deleted": deleted}
