"""Budget domain: categories, periods, lines, allocations, transactions."""
from __future__ import annotations

from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class Category(PKMixin, TimestampMixin, Base):
    """Hierarchical income/expense/saving/investment/transfer grouping."""

    __tablename__ = "categories"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # CategoryType
    default_owner_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # True for the top-level workbook sections (Mandatory Obligations, Insurance, ...).
    is_section: Mapped[bool] = mapped_column(Boolean, default=False)

    children: Mapped[list["Category"]] = relationship()


class BudgetPeriod(PKMixin, TimestampMixin, Base):
    __tablename__ = "budget_periods"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label: Mapped[str] = mapped_column(String(60), nullable=False)  # e.g. "Jan4Feb"
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    locked_at: Mapped[date | None] = mapped_column(Date)
    approved_at: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(String(40))  # manual | workbook_import
    notes: Mapped[str | None] = mapped_column(Text)

    lines: Mapped[list["BudgetLine"]] = relationship(
        back_populates="period", cascade="all, delete-orphan"
    )


class BudgetLine(PKMixin, TimestampMixin, Base):
    __tablename__ = "budget_lines"

    period_id: Mapped[int] = mapped_column(
        ForeignKey("budget_periods.id", ondelete="CASCADE"), index=True, nullable=False
    )
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)

    owner_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))
    payer_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))
    beneficiary_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))

    planned_amount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    actual_amount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    due_day: Mapped[int | None] = mapped_column(Integer)  # 1..31
    due_note: Mapped[str | None] = mapped_column(String(120))  # raw workbook due text
    recurrence: Mapped[str] = mapped_column(String(20), default="monthly")
    payment_status: Mapped[str] = mapped_column(String(20), default="planned")
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=3)  # 1 highest .. 5 lowest
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    # Provenance for imported lines (e.g. "workbook:Jan4Feb!A44").
    source_ref: Mapped[str | None] = mapped_column(String(120))
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)

    period: Mapped["BudgetPeriod"] = relationship(back_populates="lines")
    category: Mapped["Category"] = relationship()
    allocations: Mapped[list["BudgetLineAllocation"]] = relationship(
        back_populates="line", cascade="all, delete-orphan"
    )


class BudgetLineAllocation(PKMixin, Base):
    """Per-owner split of a line, by fixed cents or percentage (basis points)."""

    __tablename__ = "budget_line_allocations"

    line_id: Mapped[int] = mapped_column(
        ForeignKey("budget_lines.id", ondelete="CASCADE"), index=True, nullable=False
    )
    member_id: Mapped[int] = mapped_column(ForeignKey("household_members.id"), nullable=False)
    method: Mapped[str] = mapped_column(String(12), default="fixed")  # fixed | percentage
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)  # when method == fixed
    percent_bp: Mapped[int] = mapped_column(Integer, default=0)  # basis points when percentage

    line: Mapped["BudgetLine"] = relationship(back_populates="allocations")


class Transaction(PKMixin, TimestampMixin, Base):
    __tablename__ = "transactions"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    merchant: Mapped[str | None] = mapped_column(String(160))
    # Signed minor units: positive = inflow, negative = outflow.
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    budget_line_id: Mapped[int | None] = mapped_column(ForeignKey("budget_lines.id"))
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    transfer_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    source: Mapped[str] = mapped_column(String(30), default="manual")
    confidence_bp: Mapped[int | None] = mapped_column(Integer)  # auto-categorisation confidence
    notes: Mapped[str | None] = mapped_column(Text)
    # Reserved for future decimal quantities without breaking the cents contract.
    _reserved_numeric: Mapped[float | None] = mapped_column(Numeric(18, 4))
