"""Request dependencies: authentication, household tenancy and RBAC enforcement.

Tenant isolation and role checks live here so they are enforced at the data-access
layer for every route, not merely in the UI (requirements §13).
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.enums import ADMIN_ROLES, WRITE_ROLES
from app.models import Membership, User
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


class HouseholdContext:
    """Resolved (user, household, role) for the active request."""

    def __init__(self, user: User, household_id: int, role: str):
        self.user = user
        self.household_id = household_id
        self.role = role

    def require_write(self) -> None:
        if self.role not in WRITE_ROLES:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Role '{self.role}' cannot modify financial data"
            )

    def require_admin(self) -> None:
        if self.role not in ADMIN_ROLES:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Role '{self.role}' cannot administer this household"
            )


def get_household_context(
    x_household_id: int | None = Header(default=None, alias="X-Household-Id"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdContext:
    """Resolve the active household from the X-Household-Id header and verify the
    user has a membership in it. Falls back to the user's only membership."""
    memberships = db.scalars(
        select(Membership).where(Membership.user_id == user.id)
    ).all()
    if not memberships:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User has no household membership")

    if x_household_id is not None:
        match = next((m for m in memberships if m.household_id == x_household_id), None)
        if not match:
            # Do not reveal whether the household exists — just deny.
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to that household")
        return HouseholdContext(user, match.household_id, match.role)

    m = memberships[0]
    return HouseholdContext(user, m.household_id, m.role)


def require_write(ctx: HouseholdContext = Depends(get_household_context)) -> HouseholdContext:
    ctx.require_write()
    return ctx


def require_admin(ctx: HouseholdContext = Depends(get_household_context)) -> HouseholdContext:
    ctx.require_admin()
    return ctx
