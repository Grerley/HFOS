"""Immutable audit logging for sensitive financial actions."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.models import AuditEvent
from app.security import content_hash


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    household_id: int | None = None,
    actor_user_id: int | None = None,
    before: dict | None = None,
    after: dict | None = None,
    detail: dict | None = None,
) -> AuditEvent:
    """Append an audit event. Sensitive before/after states are hashed, not stored
    in the clear; a non-sensitive detail summary is kept for traceability."""
    event = AuditEvent(
        household_id=household_id,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_hash=content_hash(json.dumps(before, sort_keys=True, default=str)) if before else None,
        after_hash=content_hash(json.dumps(after, sort_keys=True, default=str)) if after else None,
        detail_json=detail or {},
    )
    db.add(event)
    db.flush()
    return event
