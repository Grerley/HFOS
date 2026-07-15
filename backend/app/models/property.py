"""Property portfolio models."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class Property(PKMixin, TimestampMixin, Base):
    __tablename__ = "properties"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    address_label: Mapped[str | None] = mapped_column(String(200))
    ownership_share_bp: Mapped[int] = mapped_column(Integer, default=10000)  # basis points (100%)
    market_value_cents: Mapped[int] = mapped_column(Integer, default=0)
    valuation_date: Mapped[date | None] = mapped_column(Date)
    outstanding_bond_cents: Mapped[int] = mapped_column(Integer, default=0)
    bond_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    rental_status: Mapped[str] = mapped_column(String(30), default="rented")
    notes: Mapped[str | None] = mapped_column(Text)

    cash_flows: Mapped[list["PropertyCashFlow"]] = relationship(
        back_populates="property", cascade="all, delete-orphan"
    )


class PropertyCashFlow(PKMixin, TimestampMixin, Base):
    """Monthly income/cost model for a property (all amounts in minor units)."""

    __tablename__ = "property_cash_flows"

    property_id: Mapped[int] = mapped_column(
        ForeignKey("properties.id", ondelete="CASCADE"), index=True, nullable=False
    )
    period_id: Mapped[int | None] = mapped_column(ForeignKey("budget_periods.id"))
    label: Mapped[str | None] = mapped_column(String(60))

    rent_cents: Mapped[int] = mapped_column(Integer, default=0)
    bond_cents: Mapped[int] = mapped_column(Integer, default=0)
    levies_cents: Mapped[int] = mapped_column(Integer, default=0)
    rates_cents: Mapped[int] = mapped_column(Integer, default=0)
    utilities_cents: Mapped[int] = mapped_column(Integer, default=0)
    insurance_cents: Mapped[int] = mapped_column(Integer, default=0)
    maintenance_cents: Mapped[int] = mapped_column(Integer, default=0)
    agent_fees_cents: Mapped[int] = mapped_column(Integer, default=0)
    vacancy_cents: Mapped[int] = mapped_column(Integer, default=0)
    other_cents: Mapped[int] = mapped_column(Integer, default=0)

    property: Mapped["Property"] = relationship(back_populates="cash_flows")
