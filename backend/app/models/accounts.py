"""Account and dated-balance models."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class Account(PKMixin, TimestampMixin, Base):
    __tablename__ = "accounts"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    institution: Mapped[str | None] = mapped_column(String(120))
    owner_member_id: Mapped[int | None] = mapped_column(ForeignKey("household_members.id"))
    currency: Mapped[str] = mapped_column(String(3), default="ZAR", nullable=False)
    # Latest known balance (minor units). Authoritative history lives in AccountBalance.
    current_balance_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    balance_date: Mapped[date | None] = mapped_column(Date)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    balances: Mapped[list["AccountBalance"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class AccountBalance(PKMixin, TimestampMixin, Base):
    """Dated balance snapshot; net-worth uses the latest dated value per account."""

    __tablename__ = "account_balances"

    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    balance_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    account: Mapped["Account"] = relationship(back_populates="balances")
