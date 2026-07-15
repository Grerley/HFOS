"""Immutable audit trail for sensitive financial actions."""
from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.database import Base
from app.models.base import PKMixin, TimestampMixin


class AuditEvent(PKMixin, TimestampMixin, Base):
    __tablename__ = "audit_events"

    household_id: Mapped[int | None] = mapped_column(ForeignKey("households.id"), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)  # e.g. budget_line.update
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    before_hash: Mapped[str | None] = mapped_column(String(64))
    after_hash: Mapped[str | None] = mapped_column(String(64))
    # Non-sensitive summary of what changed (values masked/hashed where sensitive).
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_metadata: Mapped[str | None] = mapped_column(Text)
