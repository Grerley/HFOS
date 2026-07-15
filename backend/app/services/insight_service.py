"""Explainable, rule-based intelligence — the first-release copilot.

Numbers always come from the deterministic calculation engine; this layer only
classifies, thresholds, explains and answers. A `CopilotProvider` seam lets a future
LLM handle phrasing/intent while still calling these deterministic tools for figures
(requirements §12, HFOS-120..123).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.enums import InsightSeverity
from app.services import calculations as calc
from app.services.queries import load_lines_for_calc

# Thresholds (would become household-configurable settings in a later release).
LOW_SAVINGS_RATE = 0.10
OVERSPEND_PCT = 0.10  # 10% over plan on a category triggers a warning


def _rand_to_currency(cents: int) -> str:
    return f"R {cents / 100:,.2f}"


# ── Insight generation (anomaly / health rules) ──────────────────────────────
def generate_period_insights(db: Session, household_id: int, period_id: int) -> list[dict]:
    lines = load_lines_for_calc(db, household_id, period_id)
    summary = calc.period_summary(lines)
    planned, actual, variance = summary["planned"], summary["actual"], summary["variance"]
    insights: list[dict] = []

    if planned["net_position_cents"] < 0:
        insights.append(
            {
                "type": "negative_net_position",
                "severity": InsightSeverity.CRITICAL.value,
                "summary": "Planned expenses exceed planned income this period.",
                "explanation": (
                    f"Planned income {_rand_to_currency(planned['total_income_cents'])} minus "
                    f"planned expenses {_rand_to_currency(planned['total_expenses_cents'])} "
                    f"= {_rand_to_currency(planned['net_position_cents'])}."
                ),
                "action": "Reduce discretionary lines or defer savings to restore a surplus.",
                "evidence": planned,
            }
        )

    if planned["savings_rate"] < LOW_SAVINGS_RATE and planned["total_income_cents"] > 0:
        insights.append(
            {
                "type": "low_savings_rate",
                "severity": InsightSeverity.WARNING.value,
                "summary": f"Savings rate is {planned['savings_rate'] * 100:.1f}%, below the "
                f"{LOW_SAVINGS_RATE * 100:.0f}% guideline.",
                "explanation": (
                    f"Savings & investments {_rand_to_currency(planned['total_savings_cents'])} "
                    f"÷ income {_rand_to_currency(planned['total_income_cents'])}."
                ),
                "action": "Increase a retirement or investment contribution line.",
                "evidence": {"savings_rate": planned["savings_rate"]},
            }
        )

    # Category overspend (actuals meaningfully above plan).
    planned_cats = {
        c["category_id"]: c for c in calc.category_breakdown(lines, basis="planned")
    }
    for c in calc.category_breakdown(lines, basis="actual"):
        p = planned_cats.get(c["category_id"], {}).get("amount_cents", 0)
        if p > 0 and c["amount_cents"] > p * (1 + OVERSPEND_PCT):
            v = calc.line_variance(p, c["amount_cents"])
            insights.append(
                {
                    "type": "category_overspend",
                    "severity": InsightSeverity.WARNING.value,
                    "summary": f"{c['category_name']} is over budget by "
                    f"{_rand_to_currency(v['variance_cents'])}.",
                    "explanation": (
                        f"Actual {_rand_to_currency(c['amount_cents'])} vs planned "
                        f"{_rand_to_currency(p)} ({(v['variance_pct'] or 0) * 100:.1f}% over)."
                    ),
                    "action": f"Review {c['category_name']} transactions for this period.",
                    "evidence": v,
                }
            )

    if variance["expenses"]["variance_cents"] > 0 and actual["total_expenses_cents"] > 0:
        insights.append(
            {
                "type": "expenses_over_plan",
                "severity": InsightSeverity.INFO.value,
                "summary": "Total actual spend is running above plan.",
                "explanation": (
                    f"Actual {_rand_to_currency(actual['total_expenses_cents'])} vs planned "
                    f"{_rand_to_currency(planned['total_expenses_cents'])}."
                ),
                "action": "Check the largest over-budget categories.",
                "evidence": variance["expenses"],
            }
        )
    return insights


# ── Conversational Q&A (rule-based intent routing) ───────────────────────────
@dataclass
class CopilotResult:
    answer: str
    citations: list[dict]
    matched_intent: str
    provider: str = "rules"


INTENTS = {
    "what_changed": ["what changed", "change this month", "difference"],
    "over_budget": ["over budget", "overspend", "why are we over"],
    "afford": ["can we afford", "afford", "should we buy"],
    "savings_track": ["savings goal", "on track", "saving enough", "savings rate"],
    "property_underperform": ["property underperform", "which property", "worst property"],
    "windfall": ["bonus", "windfall", "lump sum", "what should we do with"],
    "summary": ["summary", "how are we doing", "overview", "position"],
}


def _match_intent(question: str) -> str:
    q = question.lower()
    for intent, phrases in INTENTS.items():
        if any(p in q for p in phrases):
            return intent
    return "summary"


def answer_question(
    db: Session, household_id: int, question: str, period_id: int | None
) -> CopilotResult:
    """Deterministic answer over authorised household data. Every figure cited is
    produced by the calculation engine (explainability requirement)."""
    if settings.copilot_provider == "llm":
        # Extension point: an LLM would own phrasing/intent but MUST call the same
        # deterministic tools below for any number. Falls through to rules for now.
        pass

    intent = _match_intent(question)
    if period_id is None:
        return CopilotResult(
            "Tell me which budget period to analyse and I'll break it down.",
            [],
            intent,
        )

    lines = load_lines_for_calc(db, household_id, period_id)
    summary = calc.period_summary(lines)
    planned = summary["planned"]
    citations = [{"source": "calculation_engine", "period_id": period_id, "metrics": planned}]

    if intent == "over_budget":
        cats = summary["category_breakdown"][:3]
        top = ", ".join(f"{c['category_name']} ({_rand_to_currency(c['amount_cents'])})" for c in cats)
        ans = (
            f"Planned expenses total {_rand_to_currency(planned['total_expenses_cents'])} "
            f"against income {_rand_to_currency(planned['total_income_cents'])}, leaving "
            f"{_rand_to_currency(planned['net_position_cents'])}. Biggest categories: {top}."
        )
    elif intent == "savings_track":
        ans = (
            f"Your savings rate this period is {planned['savings_rate'] * 100:.1f}% "
            f"({_rand_to_currency(planned['total_savings_cents'])} of "
            f"{_rand_to_currency(planned['total_income_cents'])} income). "
            + ("That's at or above the 10% guideline." if planned["savings_rate"] >= LOW_SAVINGS_RATE
               else "That's below the 10% guideline — consider lifting a contribution line.")
        )
    elif intent == "afford":
        net = planned["net_position_cents"]
        ans = (
            f"Your planned monthly surplus is {_rand_to_currency(net)}. "
            + ("There is room to take on a new obligation within that surplus."
               if net > 0 else
               "There is no surplus to absorb a new obligation — model it as a scenario first.")
            + " Use the scenario simulator to test a specific amount."
        )
    elif intent == "windfall":
        ans = (
            "Allocate a windfall by priority: (1) top up the emergency fund, "
            "(2) settle high-interest debt, (3) fund goals nearing their target, "
            "(4) invest the remainder. Create a bonus allocation under Goals to plan it, "
            f"then check the effect against your surplus of "
            f"{_rand_to_currency(planned['net_position_cents'])}."
        )
    elif intent == "what_changed":
        var = summary["variance"]
        ans = (
            f"Actual vs plan: income variance {_rand_to_currency(var['income']['variance_cents'])}, "
            f"expense variance {_rand_to_currency(var['expenses']['variance_cents'])}, "
            f"net variance {_rand_to_currency(var['net']['variance_cents'])}."
        )
    elif intent == "property_underperform":
        ans = (
            "Open the Property portfolio to see per-property monthly surplus/shortfall and yield; "
            "the property with the most negative monthly cash flow is the underperformer."
        )
    else:  # summary
        ans = (
            f"Income {_rand_to_currency(planned['total_income_cents'])}, "
            f"expenses {_rand_to_currency(planned['total_expenses_cents'])}, "
            f"surplus {_rand_to_currency(planned['net_position_cents'])}, "
            f"savings rate {planned['savings_rate'] * 100:.1f}%."
        )

    return CopilotResult(ans, citations, intent)
