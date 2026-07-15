"""Financial goals with computed monthly requirement and progress."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.models import Goal
from app.schemas import GoalCreate, GoalOut
from app.services import calculations as calc
from app.services.queries import get_scoped_or_404

router = APIRouter(tags=["goals"])


def _months_between(start: date, target: date | None) -> int:
    if not target:
        return 0
    return max((target.year - start.year) * 12 + (target.month - start.month), 0)


def _enrich(goal: Goal) -> dict:
    months = _months_between(date.today(), goal.target_date)
    return {
        **GoalOut.model_validate(goal).model_dump(),
        "progress": calc.goal_progress(goal.target_amount_cents, goal.current_amount_cents),
        "months_remaining": months,
        "monthly_required_cents": calc.goal_monthly_requirement(
            goal.target_amount_cents, goal.current_amount_cents, months
        ),
    }


@router.get("/goals")
def list_goals(ctx: HouseholdContext = Depends(get_household_context),
               db: Session = Depends(get_db)):
    rows = db.scalars(select(Goal).where(Goal.household_id == ctx.household_id)).all()
    return [_enrich(g) for g in rows]


@router.post("/goals", status_code=201)
def create_goal(payload: GoalCreate, ctx: HouseholdContext = Depends(require_write),
                db: Session = Depends(get_db)):
    goal = Goal(household_id=ctx.household_id, **payload.model_dump())
    db.add(goal)
    db.commit()
    return _enrich(goal)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalCreate,
                ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    goal = get_scoped_or_404(db, Goal, ctx.household_id, goal_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    return _enrich(goal)
