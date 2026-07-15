"""Property portfolio: properties, monthly cash flow, yield and LTV metrics."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.models import Property, PropertyCashFlow
from app.schemas import CashFlowCreate, CashFlowOut, PropertyCreate, PropertyOut
from app.services import calculations as calc
from app.services.queries import get_scoped_or_404

router = APIRouter(tags=["property"])


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(ctx: HouseholdContext = Depends(get_household_context),
                    db: Session = Depends(get_db)):
    rows = db.scalars(select(Property).where(Property.household_id == ctx.household_id)).all()
    return [PropertyOut.model_validate(p) for p in rows]


@router.post("/properties", response_model=PropertyOut, status_code=201)
def create_property(payload: PropertyCreate, ctx: HouseholdContext = Depends(require_write),
                    db: Session = Depends(get_db)):
    prop = Property(household_id=ctx.household_id, **payload.model_dump())
    db.add(prop)
    db.commit()
    return PropertyOut.model_validate(prop)


@router.post("/properties/{property_id}/cash-flows", response_model=CashFlowOut, status_code=201)
def add_cash_flow(property_id: int, payload: CashFlowCreate,
                  ctx: HouseholdContext = Depends(require_write), db: Session = Depends(get_db)):
    get_scoped_or_404(db, Property, ctx.household_id, property_id)
    cf = PropertyCashFlow(property_id=property_id, **payload.model_dump())
    db.add(cf)
    db.commit()
    return CashFlowOut.model_validate(cf)


@router.get("/properties/{property_id}/cash-flow")
def property_cash_flow(property_id: int, ctx: HouseholdContext = Depends(get_household_context),
                       db: Session = Depends(get_db)):
    """Aggregate the property's latest cash-flow model into surplus/shortfall + yields."""
    prop = get_scoped_or_404(db, Property, ctx.household_id, property_id)
    latest = db.scalar(
        select(PropertyCashFlow)
        .where(PropertyCashFlow.property_id == property_id)
        .order_by(PropertyCashFlow.id.desc())
    )
    if not latest:
        return {"property_id": property_id, "has_data": False}
    cf = calc.PropertyCashFlowInput(
        rent_cents=latest.rent_cents, bond_cents=latest.bond_cents, levies_cents=latest.levies_cents,
        rates_cents=latest.rates_cents, utilities_cents=latest.utilities_cents,
        insurance_cents=latest.insurance_cents, maintenance_cents=latest.maintenance_cents,
        agent_fees_cents=latest.agent_fees_cents, vacancy_cents=latest.vacancy_cents,
        other_cents=latest.other_cents,
    )
    metrics = calc.property_metrics(cf, prop.market_value_cents, prop.outstanding_bond_cents)
    return {"property_id": property_id, "has_data": True, "name": prop.name, **metrics}


@router.get("/properties-summary")
def portfolio_summary(ctx: HouseholdContext = Depends(get_household_context),
                      db: Session = Depends(get_db)):
    """Portfolio-wide monthly cash flow across all properties (dashboard tile)."""
    props = db.scalars(select(Property).where(Property.household_id == ctx.household_id)).all()
    total_surplus = 0
    per_property = []
    for prop in props:
        latest = db.scalar(
            select(PropertyCashFlow)
            .where(PropertyCashFlow.property_id == prop.id)
            .order_by(PropertyCashFlow.id.desc())
        )
        if not latest:
            continue
        cf = calc.PropertyCashFlowInput(
            rent_cents=latest.rent_cents, bond_cents=latest.bond_cents,
            levies_cents=latest.levies_cents, rates_cents=latest.rates_cents,
            utilities_cents=latest.utilities_cents, insurance_cents=latest.insurance_cents,
            maintenance_cents=latest.maintenance_cents, agent_fees_cents=latest.agent_fees_cents,
            vacancy_cents=latest.vacancy_cents, other_cents=latest.other_cents,
        )
        flow = calc.property_cash_flow(cf)
        total_surplus += flow["surplus_shortfall_cents"]
        per_property.append({"property_id": prop.id, "name": prop.name, **flow})
    return {"total_monthly_surplus_cents": total_surplus, "properties": per_property}
