"""Scenario simulator: create, run and compare scenarios against a baseline."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.models import Scenario
from app.schemas import ScenarioCreate, ScenarioOut
from app.services import scenario_service
from app.services.queries import get_scoped_or_404

router = APIRouter(tags=["scenarios"])


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(ctx: HouseholdContext = Depends(get_household_context),
                   db: Session = Depends(get_db)):
    rows = db.scalars(select(Scenario).where(Scenario.household_id == ctx.household_id)).all()
    return [ScenarioOut.model_validate(s) for s in rows]


@router.post("/scenarios", response_model=ScenarioOut, status_code=201)
def create_scenario(payload: ScenarioCreate, ctx: HouseholdContext = Depends(require_write),
                    db: Session = Depends(get_db)):
    results = scenario_service.run_scenario(
        db, ctx.household_id, payload.base_period_id, payload.assumptions_json
    )
    scenario = Scenario(
        household_id=ctx.household_id, name=payload.name, base_period_id=payload.base_period_id,
        description=payload.description, assumptions_json=payload.assumptions_json,
        projected_results_json=results, created_by_id=ctx.user.id,
    )
    db.add(scenario)
    db.commit()
    return ScenarioOut.model_validate(scenario)


@router.post("/scenarios/{scenario_id}/run", response_model=ScenarioOut)
def run_scenario(scenario_id: int, ctx: HouseholdContext = Depends(require_write),
                 db: Session = Depends(get_db)):
    scenario = get_scoped_or_404(db, Scenario, ctx.household_id, scenario_id)
    scenario.projected_results_json = scenario_service.run_scenario(
        db, ctx.household_id, scenario.base_period_id, scenario.assumptions_json
    )
    db.commit()
    return ScenarioOut.model_validate(scenario)


@router.get("/scenarios/{scenario_id}/compare")
def compare_scenario(scenario_id: int, ctx: HouseholdContext = Depends(get_household_context),
                     db: Session = Depends(get_db)):
    scenario = get_scoped_or_404(db, Scenario, ctx.household_id, scenario_id)
    return scenario.projected_results_json or scenario_service.run_scenario(
        db, ctx.household_id, scenario.base_period_id, scenario.assumptions_json
    )
