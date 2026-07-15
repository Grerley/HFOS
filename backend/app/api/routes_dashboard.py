"""Dashboards, reports, insights and the explainable copilot."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import HouseholdContext, get_household_context, require_write
from app.models import Account, BudgetPeriod, HouseholdMember, Insight
from app.enums import AccountType
from app.schemas import CopilotAnswer, CopilotQuery, InsightOut
from app.services import calculations as calc
from app.services import insight_service
from app.services.queries import get_period_or_404, load_lines_for_calc

router = APIRouter(tags=["dashboard"])

LIABILITY_TYPES = {AccountType.LOAN.value, AccountType.CREDIT_CARD.value, AccountType.BOND.value}


def _resolve_period(db: Session, household_id: int, period_id: int | None) -> BudgetPeriod | None:
    if period_id is not None:
        return get_period_or_404(db, household_id, period_id)
    return db.scalar(
        select(BudgetPeriod)
        .where(BudgetPeriod.household_id == household_id)
        .order_by(BudgetPeriod.start_date.desc())
    )


@router.get("/dashboard")
def dashboard(period_id: int | None = None,
              ctx: HouseholdContext = Depends(get_household_context),
              db: Session = Depends(get_db)):
    """The household dashboard bundle: period summary, owner cards, net worth,
    property portfolio cash flow and upcoming bills — all from the calc engine."""
    period = _resolve_period(db, ctx.household_id, period_id)
    if not period:
        return {"has_period": False, "message": "Create a budget period to see your dashboard."}

    lines = load_lines_for_calc(db, ctx.household_id, period.id)
    summary = calc.period_summary(lines)

    # Owner cards need member names.
    members = {
        m.id: m.name
        for m in db.scalars(
            select(HouseholdMember).where(HouseholdMember.household_id == ctx.household_id)
        ).all()
    }
    owner_cards = [
        {"member_id": mid, "member_name": members.get(mid, "Unknown"), **vals}
        for mid, vals in summary["owner_positions"].items()
    ]

    # Net worth from latest account balances.
    accounts = db.scalars(select(Account).where(Account.household_id == ctx.household_id)).all()
    assets = [a.current_balance_cents for a in accounts if a.type not in LIABILITY_TYPES]
    liabilities = [a.current_balance_cents for a in accounts if a.type in LIABILITY_TYPES]
    net_worth_cents = calc.net_worth(assets, liabilities)

    from app.models import Household

    household = db.get(Household, ctx.household_id)

    return {
        "has_period": True,
        "period": {"id": period.id, "label": period.label, "status": period.status,
                   "start_date": period.start_date.isoformat(),
                   "end_date": period.end_date.isoformat()},
        "summary": summary,
        "owner_cards": owner_cards,
        "net_worth_cents": net_worth_cents,
        "currency": household.base_currency if household else "ZAR",
    }


@router.get("/reports/monthly")
def monthly_report(period_id: int, ctx: HouseholdContext = Depends(get_household_context),
                   db: Session = Depends(get_db)):
    period = get_period_or_404(db, ctx.household_id, period_id)
    lines = load_lines_for_calc(db, ctx.household_id, period.id)
    return {
        "period": {"id": period.id, "label": period.label, "status": period.status},
        "summary": calc.period_summary(lines),
    }


@router.get("/reports/trends")
def trends(ctx: HouseholdContext = Depends(get_household_context), db: Session = Depends(get_db)):
    """12-month trend of income/expenses/net/savings across periods (category trend base)."""
    periods = db.scalars(
        select(BudgetPeriod)
        .where(BudgetPeriod.household_id == ctx.household_id)
        .order_by(BudgetPeriod.start_date)
    ).all()
    series = []
    for p in periods[-12:]:
        lines = load_lines_for_calc(db, ctx.household_id, p.id)
        s = calc.period_summary(lines)["planned"]
        series.append({
            "period_id": p.id, "label": p.label,
            "income_cents": s["total_income_cents"],
            "expenses_cents": s["total_expenses_cents"],
            "net_cents": s["net_position_cents"],
            "savings_cents": s["total_savings_cents"],
            "savings_rate": s["savings_rate"],
        })
    return {"series": series}


# ── Insights ─────────────────────────────────────────────────────────────────
@router.get("/insights", response_model=list[InsightOut])
def list_insights(ctx: HouseholdContext = Depends(get_household_context),
                  db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Insight)
        .where(Insight.household_id == ctx.household_id, Insight.status != "dismissed")
        .order_by(Insight.created_at.desc())
    ).all()
    return [InsightOut.model_validate(i) for i in rows]


@router.post("/insights/generate/{period_id}", response_model=list[InsightOut])
def generate_insights(period_id: int, ctx: HouseholdContext = Depends(require_write),
                      db: Session = Depends(get_db)):
    period = get_period_or_404(db, ctx.household_id, period_id)
    found = insight_service.generate_period_insights(db, ctx.household_id, period.id)
    created = []
    for item in found:
        insight = Insight(
            household_id=ctx.household_id, period_id=period.id, type=item["type"],
            severity=item["severity"], summary=item["summary"], explanation=item["explanation"],
            action=item["action"], evidence_json=item.get("evidence", {}),
        )
        db.add(insight)
        created.append(insight)
    db.commit()
    return [InsightOut.model_validate(i) for i in created]


@router.patch("/insights/{insight_id}/status", response_model=InsightOut)
def update_insight_status(insight_id: int, new_status: str,
                          ctx: HouseholdContext = Depends(require_write),
                          db: Session = Depends(get_db)):
    insight = db.get(Insight, insight_id)
    if not insight or insight.household_id != ctx.household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Insight not found")
    insight.status = new_status
    db.commit()
    return InsightOut.model_validate(insight)


# ── Copilot ──────────────────────────────────────────────────────────────────
@router.post("/copilot/ask", response_model=CopilotAnswer)
def copilot_ask(payload: CopilotQuery, ctx: HouseholdContext = Depends(get_household_context),
                db: Session = Depends(get_db)):
    period = _resolve_period(db, ctx.household_id, payload.period_id)
    result = insight_service.answer_question(
        db, ctx.household_id, payload.question, period.id if period else None
    )
    return CopilotAnswer(
        answer=result.answer, citations=result.citations,
        matched_intent=result.matched_intent, provider=result.provider,
    )
