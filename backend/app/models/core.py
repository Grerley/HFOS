"""Identity and household tenancy models."""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class User(PKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Household(PKMixin, TimestampMixin, Base):
    __tablename__ = "households"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), default="ZAR", nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="ZA", nullable=False)
    # Day of month the household's planning cycle rolls over (workbook "Dec4Jan" model).
    budget_cycle_day: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    members: Mapped[list["HouseholdMember"]] = relationship(
        back_populates="household", cascade="all, delete-orphan"
    )
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="household", cascade="all, delete-orphan"
    )


class HouseholdMember(PKMixin, TimestampMixin, Base):
    """A person in the household. May be a login user or a planning-only entity
    (child, dependant, beneficiary) — mirrors workbook owner columns Yamu/Gee/Purity."""

    __tablename__ = "household_members"

    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    relationship_label: Mapped[str | None] = mapped_column(String(60))  # spouse, child, self...
    role: Mapped[str] = mapped_column(String(20), default="partner", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    household: Mapped["Household"] = relationship(back_populates="members")


class Membership(PKMixin, TimestampMixin, Base):
    """Access grant: which user can access which household, with what role."""

    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "household_id", name="uq_user_household"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), default="owner", nullable=False)

    user: Mapped["User"] = relationship(back_populates="memberships")
    household: Mapped["Household"] = relationship(back_populates="memberships")
