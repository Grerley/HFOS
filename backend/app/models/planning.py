"""Goals, goal funding, scenarios and insights."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class Goal(PKMixin, TimestampMixin, Base):
    __tablename__ = "goals"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    goal_type: Mapped[str | None] = mapped_column(String(40))  # emergency_fund, school_fees, ...
    target_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    current_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    target_date: Mapped[date | None] = mapped_column(Date)
    monthly_contribution_cents: Mapped[int] = mapped_column(Integer, default=0)
    owner_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))
    priority: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(20), default="active")
    linked_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    fundings: Mapped[list["GoalFunding"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )


class GoalFunding(PKMixin, TimestampMixin, Base):
    """A funding source/allocation towards a goal (bonus, asset sale, monthly line)."""

    __tablename__ = "goal_fundings"

    goal_id: Mapped[int] = mapped_column(
        ForeignKey("goals.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    expected_date: Mapped[date | None] = mapped_column(Date)
    probability_bp: Mapped[int] = mapped_column(Integer, default=10000)  # basis points

    goal: Mapped["Goal"] = relationship(back_populates="fundings")


class Scenario(PKMixin, TimestampMixin, Base):
    __tablename__ = "scenarios"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    base_period_id: Mapped[int | None] = mapped_column(ForeignKey("budget_periods.id"))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Structured, versioned assumptions and computed results (requirement Appendix B).
    assumptions_json: Mapped[dict] = mapped_column(JSON, default=dict)
    projected_results_json: Mapped[dict] = mapped_column(JSON, default=dict)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class Insight(PKMixin, TimestampMixin, Base):
    __tablename__ = "insights"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    period_id: Mapped[int | None] = mapped_column(ForeignKey("budget_periods.id"))
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="info")
    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")
    # The exact calc-engine numbers cited by this insight (explainability).
    evidence_json: Mapped[dict] = mapped_column(JSON, default=dict)
